#!/usr/bin/env python3
"""
Emergency nginx vhost patcher for MemAlerts.

Goal (idempotent):
- Ensure `/me/*` is proxied to backend, not served by SPA `location / { try_files ... /index.html; }`.

Real-world issue:
- Some nginx configs proxy only `location = /me` but not `/me/preferences`,
  so `/me/preferences` falls through to SPA and returns HTML.

This script patches the live VPS vhost config in-place.

It will (idempotent):
- Clone any existing `location = /me { ... }` into `location ^~ /me/ { ... }` if missing.
  This covers both prod and beta vhosts in a shared config file.
- Ensure `/internal/*` is blocked (404).
- Ensure optional `/api/*` compat exists (`/api/* -> /*`) for setups where frontend uses `/api`.
"""

from __future__ import annotations

import re
from pathlib import Path

# The current VPS source-of-truth vhost file (see docs/VPS_STRUCTURE.md).
# Note: /etc/nginx/sites-enabled/memalerts is usually a symlink to sites-available.
TARGET = Path("/etc/nginx/sites-available/memalerts")
if not TARGET.exists():
    TARGET = Path("/etc/nginx/sites-enabled/memalerts")


def find_block_ends_for_location_me(text: str) -> list[tuple[int, int, str]]:
    """
    Returns [(start_idx, end_idx, indent)] for each `location = /me { ... }` block.
    """
    out: list[tuple[int, int, str]] = []
    for m in re.finditer(r"^(?P<indent>\s*)location\s*=\s*/me\s*\{", text, flags=re.MULTILINE):
        start = m.start(0)
        indent = m.group("indent")
        block, end = extract_braced_block(text, start)
        if not block or end == -1:
            continue
        out.append((start, end, indent))
    return out


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


def ensure_block_before_location_slash(server_block: str, block: str) -> tuple[str, bool]:
    """
    Insert `block` before `location / {` if present, else before final `}`.
    """
    insert_point = server_block.find("\n    location / {")
    if insert_point == -1:
        insert_point = server_block.rfind("\n}")
    if insert_point == -1:
        return (server_block, False)
    if not block.startswith("\n"):
        block = "\n" + block
    if not block.endswith("\n"):
        block = block + "\n"
    return (server_block[:insert_point] + block + server_block[insert_point:], True)


def main() -> int:
    text = TARGET.read_text(encoding="utf-8")
    orig = text

    changed_any = False

    # 1) Ensure /me/* exists by cloning location = /me blocks (common pattern in this vhost).
    if not re.search(r"^\s*location\s+\^~\s+/me/\s*\{", text, flags=re.MULTILINE):
        blocks = find_block_ends_for_location_me(text)
        if not blocks:
            raise SystemExit("ERROR: no `location = /me {` blocks found to clone")

        # Insert after each `location = /me` block (iterate from end to keep indices stable).
        for start, end, indent in reversed(blocks):
            block, _end2 = extract_braced_block(text, start)
            if not block:
                continue
            cloned = re.sub(
                r"^(\s*)location\s*=\s*/me\s*\{",
                r"\1location ^~ /me/ {",
                block,
                flags=re.MULTILINE,
            )
            insertion = "\n" + indent + "# memalerts-managed: proxy /me/* (fix SPA HTML)\n" + cloned + "\n"
            text = text[:end] + insertion + text[end:]
            changed_any = True

    # 2) Ensure beta server blocks have /internal blocked and /api compat.
    # We patch only blocks containing `server_name beta.twitchmemes.ru;`.
    # Insert before `location / {` if present to avoid SPA fallback catching these paths.
    def _server_blocks(s: str) -> list[tuple[int, int]]:
        blocks: list[tuple[int, int]] = []
        i = 0
        n = len(s)
        while i < n:
            m = re.search(r"\bserver\s*\{", s[i:])
            if not m:
                break
            start = i + m.start()
            j = start + m.end() - m.start()
            depth = 0
            while j < n:
                ch = s[j]
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

    for start, end in reversed(_server_blocks(text)):
        sb = text[start:end]
        if "server_name beta.twitchmemes.ru;" not in sb:
            continue

        # Use indentation of existing locations in this server.
        m_indent = re.search(r"^(?P<indent>\s*)location\s*=\s*/me\s*\{", sb, flags=re.MULTILINE)
        indent = m_indent.group("indent") if m_indent else "    "

        inserted_any = False

        if not re.search(r"^\s*location\s+\^~\s+/internal/\s*\{", sb, flags=re.MULTILINE):
            sb, c = ensure_block_before_location_slash(
                sb,
                f"{indent}# memalerts-managed: block internal relay\n"
                f"{indent}location ^~ /internal/ {{\n"
                f"{indent}    return 404;\n"
                f"{indent}}}\n",
            )
            inserted_any = inserted_any or c

        if not re.search(r"^\s*location\s+\^~\s+/api/\s*\{", sb, flags=re.MULTILINE):
            sb, c = ensure_block_before_location_slash(
                sb,
                f"{indent}# memalerts-managed: compat /api/* -> /*\n"
                f"{indent}location ^~ /api/ {{\n"
                f"{indent}    proxy_pass http://localhost:3002/;\n"
                f"{indent}    proxy_http_version 1.1;\n"
                f"{indent}    proxy_set_header Host $host;\n"
                f"{indent}    proxy_set_header X-Real-IP $remote_addr;\n"
                f"{indent}    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n"
                f"{indent}    proxy_set_header X-Forwarded-Proto $scheme;\n"
                f"{indent}    proxy_set_header CF-Connecting-IP $http_cf_connecting_ip;\n"
                f"{indent}    proxy_set_header Cookie $http_cookie;\n"
                f"{indent}    proxy_cache_bypass $http_upgrade;\n"
                f"{indent}    proxy_pass_header Set-Cookie;\n"
                f"{indent}    proxy_cookie_path / /;\n"
                f"{indent}}}\n",
            )
            inserted_any = inserted_any or c

        if inserted_any:
            text = text[:start] + sb + text[end:]
            changed_any = True

    if not changed_any:
        print("NOOP: nothing to change")
        return 0

    bak = TARGET.with_suffix(TARGET.suffix + ".bak.memalerts-me-proxy")
    bak.write_text(orig, encoding="utf-8")
    TARGET.write_text(text, encoding="utf-8")
    print(f"PATCHED: {TARGET} (backup: {bak})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


