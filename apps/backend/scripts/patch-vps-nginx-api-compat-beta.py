#!/usr/bin/env python3
"""
VPS nginx patch: add /api/* compatibility proxy for beta.

Fixes:
- https://beta.twitchmemes.ru/api/me/preferences returning SPA HTML instead of hitting backend.

Approach (idempotent):
- In /etc/nginx/sites-available/memalerts (or sites-enabled fallback),
  find the beta SSL server block (server_name beta.twitchmemes.ru + listen 443 ssl).
- If it doesn't contain `location ^~ /api/ {`, insert it right after `location ^~ /me/ { ... }`.

Important:
- Uses `proxy_pass http://localhost:3002/;` (trailing slash) to strip `/api/` prefix.
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


def extract_braced_block(s: str, start_idx: int) -> tuple[str, int]:
    brace_open = s.find("{", start_idx)
    if brace_open == -1:
        return ("", -1)
    i = brace_open + 1
    depth = 1
    while i < len(s):
        ch = s[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                return (s[start_idx:end], end)
        i += 1
    return ("", -1)


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

        if re.search(r"^\s*location\s+\^~\s+/api/\s*\{", sb, flags=re.MULTILINE):
            continue

        # Prefer cloning headers from our already-inserted /me/ proxy block (marked).
        # This avoids brittle matching on the exact `location` line formatting.
        marker = "# memalerts-managed: proxy /me/* (fix SPA HTML)"
        marker_idx = sb.find(marker)
        if marker_idx == -1:
            raise SystemExit("ERROR: beta SSL server block missing /me/* marker; run the /me proxy patch first")

        # Find the next `location ... {` header after the marker.
        m_me = re.search(r"^(?P<indent>\s*)location\s+[^\{]+\{", sb[marker_idx:], flags=re.MULTILINE)
        if not m_me:
            raise SystemExit("ERROR: could not find a location block after the /me/* marker")
        indent = m_me.group("indent")
        me_start = marker_idx + m_me.start(0)
        me_block, me_end = extract_braced_block(sb, me_start)
        if not me_block or me_end == -1:
            raise SystemExit("ERROR: failed to parse /me/ location block braces")

        # Create /api/ location by cloning /me/ and adjusting header + proxy_pass.
        api_block = (
            indent
            + "# memalerts-managed: compat /api/* -> /*\n"
            + re.sub(r"^(?P<ind>\s*)location\s+[^\{]+\{", r"\g<ind>location ^~ /api/ {", me_block, flags=re.MULTILINE, count=1)
        )
        # Ensure proxy_pass strips /api prefix
        api_block = re.sub(
            r"proxy_pass\s+http://localhost:3002\s*;",
            "proxy_pass http://localhost:3002/;",
            api_block,
        )

        insertion = "\n" + api_block + "\n"
        sb = sb[:me_end] + insertion + sb[me_end:]

        text = text[:start] + sb + text[end:]
        changed = True
        break

    if not changed:
        print("NOOP: nothing to change")
        return 0

    bak = TARGET.with_suffix(TARGET.suffix + ".bak.memalerts-api-compat-beta")
    bak.write_text(orig, encoding="utf-8")
    TARGET.write_text(text, encoding="utf-8")
    print(f"PATCHED: {TARGET} (backup: {bak})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


