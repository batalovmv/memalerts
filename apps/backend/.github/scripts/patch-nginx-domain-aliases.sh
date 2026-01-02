#!/usr/bin/env bash
set -euo pipefail

# Idempotent nginx patch:
# - Add twitchmemes.ru aliases to the existing memalerts nginx site file.
# - Fix beta routing so beta.twitchmemes.ru matches the beta server block (proxy to :3002).
#
# Safe by design: only touches server_name lines and (optionally) uploads CORS regex
# in /etc/nginx/sites-available/memalerts, then runs `nginx -t` and reloads.

SITE_PATH="${SITE_PATH:-/etc/nginx/sites-available/memalerts}"

if [ ! -f "$SITE_PATH" ]; then
  echo "❌ nginx site file not found: $SITE_PATH"
  exit 1
fi

echo "Patching nginx site: $SITE_PATH"

python3 - <<'PY'
from __future__ import annotations

from pathlib import Path
import re

path = Path("/etc/nginx/sites-available/memalerts")
text = path.read_text(encoding="utf-8")

def add_aliases_to_server_name(line: str, aliases: list[str]) -> str:
    # line: "server_name a b;"
    m = re.match(r"^(\s*server_name\s+)(.+?)(\s*;\s*)$", line)
    if not m:
        return line
    prefix, names_str, suffix = m.groups()
    names = [n for n in re.split(r"\s+", names_str.strip()) if n]
    for a in aliases:
        if a not in names:
            names.append(a)
    return f"{prefix}{' '.join(names)}{suffix}"

lines = text.splitlines(True)
out: list[str] = []

for raw in lines:
    line = raw.rstrip("\n")
    # Production server_name: add twitchmemes.ru aliases
    if re.search(r"^\s*server_name\s+.*\btwitchalerts\.ru\b", line) and "beta.twitchalerts.ru" not in line:
        line = add_aliases_to_server_name(line, ["twitchmemes.ru", "www.twitchmemes.ru"])

    # Beta server_name: add beta.twitchmemes.ru alias
    if re.search(r"^\s*server_name\s+.*\bbeta\.twitchalerts\.ru\b", line):
        line = add_aliases_to_server_name(line, ["beta.twitchmemes.ru"])

    # Uploads CORS allowlist regex: include twitchmemes domains if present
    # Example existing:
    # if ($http_origin ~* "^https://(www\.)?(twitchalerts\.ru|beta\.twitchalerts\.ru)$") {
    if "if ($http_origin" in line and "twitchalerts\\.ru" in line and "twitchmemes\\.ru" not in line:
        line = line.replace(
            r"(twitchalerts\.ru|beta\.twitchalerts\.ru)",
            r"(twitchalerts\.ru|beta\.twitchalerts\.ru|twitchmemes\.ru|beta\.twitchmemes\.ru)",
        )

    out.append(line + "\n")

new_text = "".join(out)

# Fix beta uploads alias (Cloudflare/NGINX static) to point at beta backend directory.
# Scope this to the beta section so we don't touch production uploads.
marker = "# Beta domain:"
idx = new_text.find(marker)
if idx != -1:
    prod_part = new_text[:idx]
    beta_part = new_text[idx:]
    beta_part = beta_part.replace(
        "alias /opt/memalerts-backend/uploads/;",
        "alias /opt/memalerts-backend-beta/uploads/;",
    )
    new_text = prod_part + beta_part
if new_text == text:
    print("No changes needed (already patched).")
else:
    path.write_text(new_text, encoding="utf-8")
    print("Patched successfully.")
PY

echo "Testing nginx config..."
sudo nginx -t

echo "Reloading nginx..."
sudo systemctl reload nginx

echo "✅ nginx patched + reloaded"


