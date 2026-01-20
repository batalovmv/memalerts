#!/usr/bin/env python3
"""
VPS nginx patch (beta): add /api/* compatibility right after the /me/* proxy marker.

This is intentionally pragmatic and idempotent:
- Find the LAST occurrence of `# memalerts-managed: proxy /me/* (fix SPA HTML)` in the vhost file.
  (In this setup, the later one is the beta SSL server block.)
- Clone the following `location ^~ /me/ { ... }` block into `location ^~ /api/ { ... }`
  and set `proxy_pass http://localhost:3002/;` (trailing slash strips /api prefix).
"""

from __future__ import annotations

import re
from pathlib import Path

TARGET = Path("/etc/nginx/sites-available/memalerts")
if not TARGET.exists():
    TARGET = Path("/etc/nginx/sites-enabled/memalerts")

ME_MARKER = "# memalerts-managed: proxy /me/* (fix SPA HTML)"
API_MARKER = "# memalerts-managed: compat /api/* -> /*"


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

    marker_idx = text.rfind(ME_MARKER)
    if marker_idx == -1:
        raise SystemExit(f"ERROR: marker not found: {ME_MARKER}")

    # If API marker already appears after the last /me marker, treat as already patched.
    if text.find(API_MARKER, marker_idx) != -1:
        print("NOOP: /api compat already present after beta /me marker")
        return 0

    m_loc = re.search(r"^\s*location\s+\^~\s+/me/\s*\{", text[marker_idx:], flags=re.MULTILINE)
    if not m_loc:
        raise SystemExit("ERROR: could not find `location ^~ /me/ {` after marker")

    loc_start = marker_idx + m_loc.start(0)
    me_block, me_end = extract_braced_block(text, loc_start)
    if not me_block or me_end == -1:
        raise SystemExit("ERROR: failed to parse /me/ block braces")

    # Clone /me/ -> /api/
    api_block = re.sub(
        r"^(\s*)location\s+\^~\s+/me/\s*\{",
        r"\1" + API_MARKER + r"\n\1location ^~ /api/ {",
        me_block,
        flags=re.MULTILINE,
        count=1,
    )
    # Ensure /api prefix stripping
    api_block = re.sub(r"proxy_pass\s+http://localhost:3002\s*;", "proxy_pass http://localhost:3002/;", api_block)

    insertion = "\n" + api_block + "\n"
    text = text[:me_end] + insertion + text[me_end:]

    bak = TARGET.with_suffix(TARGET.suffix + ".bak.memalerts-api-after-me")
    bak.write_text(orig, encoding="utf-8")
    TARGET.write_text(text, encoding="utf-8")
    print(f"PATCHED: {TARGET} (backup: {bak})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())



