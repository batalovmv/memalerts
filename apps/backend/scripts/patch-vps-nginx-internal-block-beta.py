#!/usr/bin/env python3
"""
VPS nginx patch (beta): ensure /internal/* is NOT exposed publicly.

Requirement:
- External clients must get 404 for /internal/* (and nginx must not proxy it).

This script patches the active vhost file:
- /etc/nginx/sites-available/memalerts (or sites-enabled fallback)

It will (idempotent):
- Find the beta SSL server block (server_name beta.twitchmemes.ru + listen 443 ssl).
- If missing, insert:
    location ^~ /internal/ { return 404; }
  before the SPA fallback `location / { ... }` in that server block.
"""

from __future__ import annotations

import re
from pathlib import Path

TARGET = Path("/etc/nginx/sites-available/memalerts")
if not TARGET.exists():
    TARGET = Path("/etc/nginx/sites-enabled/memalerts")


def server_blocks(text: str) -> list[tuple[int, int]]:
    blocks: list[tuple[int, int]] = []
    i = 0
    n = len(text)
    while i < n:
        m = re.search(r"\bserver\s*\{", text[i:])
        if not m:
            break
        start = i + m.start()
        j = start + m.end() - m.start()
        depth = 0
        while j < n:
            ch = text[j]
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    end = j + 1
                    blocks.append((start, end))
                    i = end
                    break
            j += 1
        else:
            break
    return blocks


def main() -> int:
    text = TARGET.read_text(encoding="utf-8")
    orig = text
    changed = False

    for start, end in reversed(server_blocks(text)):
        sb = text[start:end]
        if "server_name beta.twitchmemes.ru;" not in sb:
            continue
        if not re.search(r"^\s*listen\s+443\b.*\bssl\b", sb, flags=re.MULTILINE):
            continue

        if re.search(r"^\s*location\s+\^~\s+/internal/\s*\{", sb, flags=re.MULTILINE):
            continue

        # Robust insertion: right after `server_name beta.twitchmemes.ru;` line inside this server block.
        m_sn = re.search(r"^\s*server_name\s+beta\.twitchmemes\.ru\s*;\s*$", sb, flags=re.MULTILINE)
        if not m_sn:
            raise SystemExit("ERROR: could not find server_name line inside beta SSL server block")
        line_end = sb.find("\n", m_sn.end(0))
        if line_end == -1:
            line_end = m_sn.end(0)
        insert_point = line_end + 1 if line_end < len(sb) else len(sb)
        indent = "    "

        block = (
            "\n"
            f"{indent}# memalerts-managed: block internal relay (external must get 404)\n"
            f"{indent}location ^~ /internal/ {{\n"
            f"{indent}    return 404;\n"
            f"{indent}}}\n"
        )

        sb = sb[:insert_point] + block + sb[insert_point:]
        text = text[:start] + sb + text[end:]
        changed = True
        break

    if not changed:
        print("NOOP: nothing to change")
        return 0

    bak = TARGET.with_suffix(TARGET.suffix + ".bak.memalerts-internal-beta")
    bak.write_text(orig, encoding="utf-8")
    TARGET.write_text(text, encoding="utf-8")
    print(f"PATCHED: {TARGET} (backup: {bak})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


