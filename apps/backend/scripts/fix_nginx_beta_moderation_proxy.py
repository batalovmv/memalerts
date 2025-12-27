#!/usr/bin/env python3
"""
Fix nginx SPA fallback hijacking MemAlerts backend moderation API on beta domain.

Problem:
  /moderation/meme-assets is a backend API, but nginx SPA try_files fallback serves /index.html.

Solution:
  Insert a dedicated location block for:
    location ^~ /moderation/meme-assets { proxy_pass http://localhost:3002; ... }
  inside beta.twitchmemes.ru server block BEFORE the generic backend-regex and SPA fallback.

Target file (VPS):
  /etc/nginx/sites-enabled/memalerts
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path


LOCATION_NEEDLE = "location ^~ /moderation/meme-assets"
BETA_MARKER = "# Beta domain: beta.twitchmemes.ru"
INSERT_BEFORE = "\n    # Other backend routes (excluding /auth, /me, /uploads, and /socket.io which are handled above)"

LOCATION_BLOCK = """

    # Moderation API routes (must be BEFORE SPA fallback)
    # Frontend also has /moderation page, so proxy ONLY API subpaths.
    location ^~ /moderation/meme-assets {
        proxy_pass http://localhost:3002;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # Pass Cloudflare real client IP header
        proxy_set_header CF-Connecting-IP $http_cf_connecting_ip;
        proxy_set_header Cookie $http_cookie;
        proxy_cache_bypass $http_upgrade;
        proxy_pass_header Set-Cookie;
        proxy_cookie_path / /;
        proxy_intercept_errors off;
        proxy_next_upstream off;
        proxy_redirect off;
    }
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", default="/etc/nginx/sites-enabled/memalerts")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    path = Path(args.file)
    text = path.read_text("utf-8")

    if LOCATION_NEEDLE in text:
        print("OK: moderation proxy location already present")
        return 0

    mi = text.find(BETA_MARKER)
    if mi == -1:
        print("ERROR: beta marker not found", file=sys.stderr)
        return 2

    sub = text[mi:]
    ib = sub.find(INSERT_BEFORE)
    if ib == -1:
        print("ERROR: insert point not found in beta section", file=sys.stderr)
        return 3

    new_sub = sub[:ib] + LOCATION_BLOCK + sub[ib:]
    new_text = text[:mi] + new_sub

    # Safety: create a timestamped backup next to the config.
    backup = path.with_name(path.name + f".bak_moderation_{int(time.time())}")
    if not args.dry_run:
        backup.write_text(text, encoding="utf-8")
        path.write_text(new_text, encoding="utf-8")

    print(f"OK: inserted moderation proxy location into {path}")
    print(f"Backup: {backup}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


