#!/usr/bin/env python3
"""
Idempotent patcher for existing Nginx + Fail2ban configs for MemAlerts.

Goal: add only missing pieces (gzip, uploads cache headers, nginx rate-limit zones,
and optional fail2ban jail/filter) without overwriting existing configs.

This script is intended to be run on the VPS with sudo.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import os
import re
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional


NGINX_SITES_AVAILABLE = Path("/etc/nginx/sites-available")
NGINX_SITES_ENABLED = Path("/etc/nginx/sites-enabled")
NGINX_CONF_D = Path("/etc/nginx/conf.d")
NGINX_BACKUP_DIR = Path("/etc/nginx/backup")
FAIL2BAN_FILTER_D = Path("/etc/fail2ban/filter.d")
FAIL2BAN_JAIL_D = Path("/etc/fail2ban/jail.d")

MARKER = "# memalerts-managed"


def _now_tag() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y%m%d-%H%M%S")


def _die(msg: str, code: int = 2) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)
    raise SystemExit(code)


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        _die(f"File not found: {path}")
    except PermissionError:
        _die(f"Permission denied reading: {path}. Run with sudo.")


def _write_text(path: Path, content: str, *, dry_run: bool) -> None:
    if dry_run:
        return
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
    except PermissionError:
        _die(f"Permission denied writing: {path}. Run with sudo.")


def _backup_file(path: Path, *, dry_run: bool) -> Optional[Path]:
    if not path.exists():
        return None
    # IMPORTANT: never leave backups inside /etc/nginx/sites-enabled/,
    # because nginx often includes sites-enabled/* and would treat backups as vhosts.
    backup_name = f"{path.name}.bak.{_now_tag()}"
    backup_path = (NGINX_BACKUP_DIR / backup_name)
    if dry_run:
        return backup_path
    NGINX_BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, backup_path)
    return backup_path


def _ensure_file_if_missing(path: Path, content: str, *, dry_run: bool) -> bool:
    """
    Returns True if file was created, False if already existed.
    """
    if path.exists():
        return False
    _write_text(path, content, dry_run=dry_run)
    return True


@dataclass(frozen=True)
class PatchResult:
    changed: bool
    details: list[str]


def ensure_gzip_conf(*, dry_run: bool) -> PatchResult:
    path = NGINX_CONF_D / "memalerts-compress.conf"
    content = (
        f"{MARKER}: gzip\n"
        "gzip on;\n"
        "gzip_vary on;\n"
        "gzip_proxied any;\n"
        "gzip_comp_level 6;\n"
        "gzip_min_length 1024;\n"
        "gzip_types\n"
        "  text/plain\n"
        "  text/css\n"
        "  text/xml\n"
        "  application/json\n"
        "  application/javascript\n"
        "  application/xml\n"
        "  application/xml+rss\n"
        "  image/svg+xml;\n"
    )
    created = _ensure_file_if_missing(path, content, dry_run=dry_run)
    return PatchResult(changed=created, details=[f"create {path}"] if created else [f"keep {path}"])


def ensure_rate_limit_zones_conf(*, dry_run: bool) -> PatchResult:
    """
    Defines limit zones in http context via conf.d include.
    Note: we only define zones. Applying limit_req happens inside vhost location blocks.
    """
    path = NGINX_CONF_D / "memalerts-rate-limit.conf"
    content = (
        f"{MARKER}: rate-limit zones\n"
        "# Per-IP zones. Tune rates on the server if needed.\n"
        "limit_req_zone $binary_remote_addr zone=memalerts_api_per_ip:10m rate=10r/s;\n"
        "limit_req_zone $binary_remote_addr zone=memalerts_auth_per_ip:10m rate=2r/s;\n"
        "limit_conn_zone $binary_remote_addr zone=memalerts_conn_per_ip:10m;\n"
    )
    created = _ensure_file_if_missing(path, content, dry_run=dry_run)
    return PatchResult(changed=created, details=[f"create {path}"] if created else [f"keep {path}"])


def _iter_files(dir_path: Path) -> Iterable[Path]:
    if not dir_path.exists():
        return
    for p in sorted(dir_path.iterdir()):
        if p.is_file():
            yield p


def _iter_nginx_site_files() -> Iterable[Path]:
    """
    Scan both sites-available and sites-enabled.
    We de-duplicate by resolved real path to avoid double-patching symlinked vhosts.
    """
    seen: set[Path] = set()
    for base in (NGINX_SITES_AVAILABLE, NGINX_SITES_ENABLED):
        for p in _iter_files(base):
            try:
                real = p.resolve()
            except Exception:
                real = p
            if real in seen:
                continue
            seen.add(real)
            yield p


def _server_blocks(text: str) -> list[tuple[int, int]]:
    """
    Returns list of (start_idx, end_idx) for top-level 'server { ... }' blocks.
    Very small brace parser to avoid regex disasters.
    """
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
            # Unbalanced braces; stop to avoid corrupting the file.
            break
    return blocks


def _server_names(server_block: str) -> list[str]:
    m = re.search(r"^\s*server_name\s+([^;]+);", server_block, flags=re.MULTILINE)
    if not m:
        return []
    raw = m.group(1)
    names: list[str] = []
    for part in raw.split():
        part = part.strip()
        if not part or part.startswith("$"):
            continue
        # strip trailing tokens like comments not expected here
        names.append(part)
    return names


def _normalize_domain(d: str) -> str:
    d = d.strip()
    if not d or d.lower() in {"site.ru", "example.com", "domain.com"}:
        _die(f"Refusing placeholder domain: {d}. Pass your real domain.")
    return d


def _ensure_uploads_location(server_block: str, *, uploads_alias_dir: str) -> tuple[str, bool]:
    """
    Ensures there's a location /uploads/ block with caching headers.
    If location exists, we add only missing cache directives.
    """
    changed = False

    # Normalize alias path: must end with /
    alias_dir = uploads_alias_dir
    if not alias_dir.endswith("/"):
        alias_dir += "/"

    loc_re = re.compile(r"(^\s*location\s+/uploads/\s*\{)", flags=re.MULTILINE)
    m = loc_re.search(server_block)
    if not m:
        # Insert before location / { if present, else before final } of server
        location_uploads = (
            "\n"
            f"    {MARKER}: uploads cache\n"
            "    location /uploads/ {\n"
            f"        alias {alias_dir};\n"
            "        expires 30d;\n"
            '        add_header Cache-Control "public, max-age=2592000, immutable" always;\n'
            '        add_header Accept-Ranges "bytes" always;\n'
            "        try_files $uri =404;\n"
            "    }\n"
        )
        insert_point = server_block.find("\n    location / {")
        if insert_point == -1:
            insert_point = server_block.rfind("\n}")
        if insert_point == -1:
            return (server_block, False)
        server_block = server_block[:insert_point] + location_uploads + server_block[insert_point:]
        return (server_block, True)

    # Location exists — patch inside it if needed.
    # Find the braces for this location block.
    start = m.start(1)
    brace_open = server_block.find("{", start)
    if brace_open == -1:
        return (server_block, False)
    j = brace_open + 1
    depth = 1
    while j < len(server_block):
        ch = server_block[j]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                loc_end = j + 1
                loc_block = server_block[start:loc_end]
                patched = loc_block
                # Only add if missing
                if "expires " not in loc_block:
                    patched = patched[:-1] + "        expires 30d;\n" + "    }\n"
                    changed = True
                if "Cache-Control" not in loc_block:
                    patched = patched[:-1] + '        add_header Cache-Control "public, max-age=2592000, immutable" always;\n' + "    }\n"
                    changed = True
                if "Accept-Ranges" not in loc_block:
                    patched = patched[:-1] + '        add_header Accept-Ranges "bytes" always;\n' + "    }\n"
                    changed = True
                if "try_files" not in loc_block:
                    patched = patched[:-1] + "        try_files $uri =404;\n" + "    }\n"
                    changed = True
                if changed:
                    server_block = server_block[:start] + patched + server_block[loc_end:]
                return (server_block, changed)
        j += 1

    return (server_block, False)


def _ensure_location_rate_limit(
    server_block: str,
    *,
    location_prefix_regex: str,
    zone: str,
    burst: int,
) -> tuple[str, bool]:
    """
    Adds `limit_req zone=...` inside matching location block(s) if not present.
    We patch only if location exists and doesn't already have `limit_req`.
    """
    changed = False
    loc_header_re = re.compile(rf"(^\s*location\s+{location_prefix_regex}\s*\{{)", flags=re.MULTILINE)
    for m in list(loc_header_re.finditer(server_block)):
        start = m.start(1)
        brace_open = server_block.find("{", start)
        if brace_open == -1:
            continue
        j = brace_open + 1
        depth = 1
        while j < len(server_block):
            ch = server_block[j]
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    loc_end = j + 1
                    loc_block = server_block[start:loc_end]
                    if "limit_req " in loc_block:
                        break
                    insertion = f"        {MARKER}: rate-limit\n        limit_req zone={zone} burst={burst} nodelay;\n"
                    # Insert right after opening brace line
                    brace_line_end = server_block.find("\n", brace_open)
                    if brace_line_end == -1:
                        break
                    server_block = server_block[: brace_line_end + 1] + insertion + server_block[brace_line_end + 1 :]
                    changed = True
                    break
            j += 1
    return (server_block, changed)


def patch_nginx_site_file(
    path: Path,
    *,
    match_domains: set[str],
    uploads_alias_by_domain: dict[str, str],
    dry_run: bool,
) -> PatchResult:
    text = _read_text(path)
    blocks = _server_blocks(text)
    if not blocks:
        return PatchResult(changed=False, details=[f"skip (no server blocks): {path}"])

    changed = False
    details: list[str] = []

    new_text = text
    # Iterate from end to start so indices remain valid while replacing.
    for start, end in reversed(blocks):
        server_block = new_text[start:end]
        names = set(_server_names(server_block))
        matched = (names & match_domains)
        if not matched:
            continue

        # Pick uploads alias dir based on which domain matched this server block.
        # Prefer an explicit mapping; otherwise keep the first matched domain.
        uploads_alias_dir = None
        for d in sorted(matched):
            if d in uploads_alias_by_domain:
                uploads_alias_dir = uploads_alias_by_domain[d]
                break
        if uploads_alias_dir is None:
            # Fallback: keep existing uploads config only; do not auto-insert.
            uploads_alias_dir = ""

        patched = server_block
        if uploads_alias_dir:
            patched, c1 = _ensure_uploads_location(patched, uploads_alias_dir=uploads_alias_dir)
        else:
            c1 = False
        patched, c2 = _ensure_location_rate_limit(
            patched,
            location_prefix_regex=r"=" + r"\s*/me",  # exact match
            zone="memalerts_api_per_ip",
            burst=30,
        )
        patched, c3 = _ensure_location_rate_limit(
            patched,
            location_prefix_regex=r"\^~\s+/auth/",
            zone="memalerts_auth_per_ip",
            burst=10,
        )
        patched, c4 = _ensure_location_rate_limit(
            patched,
            location_prefix_regex=r"/socket\.io/",
            zone="memalerts_api_per_ip",
            burst=60,
        )
        patched, c5 = _ensure_location_rate_limit(
            patched,
            location_prefix_regex=r"/",
            zone="memalerts_api_per_ip",
            burst=80,
        )

        if any([c1, c2, c3, c4, c5]):
            new_text = new_text[:start] + patched + new_text[end:]
            changed = True
            details.append(f"patch vhost: {path} (server_name: {' '.join(sorted(matched))})")

    if not changed:
        return PatchResult(changed=False, details=[f"keep {path}"])

    _backup_file(path, dry_run=dry_run)
    _write_text(path, new_text, dry_run=dry_run)
    return PatchResult(changed=True, details=details)


def ensure_fail2ban_req_limit(*, dry_run: bool) -> PatchResult:
    """
    Adds a jail+filter that bans IPs generating repeated Nginx limit_req messages.
    Does not overwrite existing files.
    """
    filter_path = FAIL2BAN_FILTER_D / "nginx-req-limit.conf"
    jail_path = FAIL2BAN_JAIL_D / "nginx-req-limit.local"

    filter_content = (
        f"{MARKER}: fail2ban filter\n"
        "[Definition]\n"
        "failregex = ^\\s*\\d{4}/\\d{2}/\\d{2} \\d{2}:\\d{2}:\\d{2} \\[error\\] .* limiting requests, excess:.* by zone \".*\", client: <HOST>, server: .*\n"
        "ignoreregex =\n"
    )
    jail_content = (
        f"{MARKER}: fail2ban jail\n"
        "[nginx-req-limit]\n"
        "enabled = true\n"
        "filter = nginx-req-limit\n"
        "logpath = /var/log/nginx/error.log\n"
        "findtime = 10m\n"
        "maxretry = 30\n"
        "bantime = 1h\n"
    )

    details: list[str] = []
    changed = False

    created_filter = _ensure_file_if_missing(filter_path, filter_content, dry_run=dry_run)
    created_jail = _ensure_file_if_missing(jail_path, jail_content, dry_run=dry_run)
    changed = created_filter or created_jail
    details.append(("create " if created_filter else "keep ") + str(filter_path))
    details.append(("create " if created_jail else "keep ") + str(jail_path))

    return PatchResult(changed=changed, details=details)


def main() -> None:
    parser = argparse.ArgumentParser(description="Patch Nginx/Fail2ban configs for MemAlerts without overwriting.")
    parser.add_argument("--prod-domain", required=True, help="Production domain, e.g. twitchmemes.ru")
    parser.add_argument("--beta-domain", required=False, help="Beta domain, e.g. beta.twitchmemes.ru")
    parser.add_argument(
        "--prod-backend-dir",
        required=True,
        help="Path to prod backend directory on server, e.g. /opt/memalerts-backend",
    )
    parser.add_argument(
        "--beta-backend-dir",
        required=False,
        help="Path to beta backend directory on server, e.g. /opt/memalerts-backend-beta",
    )
    parser.add_argument("--dry-run", action="store_true", help="Do not write changes; just print actions.")
    parser.add_argument("--with-fail2ban", action="store_true", help="Also create fail2ban jail/filter (if missing).")

    args = parser.parse_args()

    prod_domain = _normalize_domain(args.prod_domain)
    beta_domain = _normalize_domain(args.beta_domain) if args.beta_domain else None

    match_domains = {prod_domain, f"www.{prod_domain}"}
    if beta_domain:
        match_domains.add(beta_domain)

    prod_uploads = str(Path(args.prod_backend_dir) / "uploads")
    uploads_alias_by_domain = {
        prod_domain: prod_uploads,
        f"www.{prod_domain}": prod_uploads,
    }
    if beta_domain and args.beta_backend_dir:
        uploads_alias_by_domain[beta_domain] = str(Path(args.beta_backend_dir) / "uploads")

    results: list[PatchResult] = []
    results.append(ensure_gzip_conf(dry_run=args.dry_run))
    results.append(ensure_rate_limit_zones_conf(dry_run=args.dry_run))

    # Patch vhosts. We patch any file that contains matching server_name(s).
    any_vhost_patched = False
    for site_file in _iter_nginx_site_files():
        r = patch_nginx_site_file(
            site_file,
            match_domains=match_domains,
            uploads_alias_by_domain=uploads_alias_by_domain,
            dry_run=args.dry_run,
        )
        results.append(r)
        if r.changed:
            any_vhost_patched = True

    if beta_domain and args.beta_backend_dir:
        # If beta vhost exists and matches beta domain, it should have been patched above.
        # We intentionally don't attempt to force-create it.
        pass

    if args.with_fail2ban:
        results.append(ensure_fail2ban_req_limit(dry_run=args.dry_run))

    # Print summary
    for r in results:
        for line in r.details:
            print(line)

    if not any_vhost_patched:
        _die(
            "No nginx vhost files were patched. "
            "Ensure your vhost in /etc/nginx/sites-available has a server_name matching the domains you passed."
        )


if __name__ == "__main__":
    main()


