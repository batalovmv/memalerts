# Security

## HTTP security headers

Helmet is configured in `src/index.ts` with the following CSP directives (nonce-based):

```txt
default-src 'self';
script-src 'self' 'nonce-<per-request>';
style-src 'self' 'nonce-<per-request>';
img-src 'self' data: blob: https://static-cdn.jtvnw.net https://*.twitch.tv;
media-src 'self' data: blob: https://static-cdn.jtvnw.net;
connect-src 'self' wss: ws: https://id.twitch.tv https://api.twitch.tv https://static-cdn.jtvnw.net;
font-src 'self' data:;
object-src 'none';
base-uri 'self';
form-action 'self' https://id.twitch.tv;
frame-ancestors 'none';
report-uri /csp-report;
```

Permissions-Policy is also set to disable sensitive APIs (camera, microphone, geolocation, etc).

The CSP nonce is generated per request and exposed via `X-CSP-Nonce`.

Optional CSP report-only mode:

- Set `CSP_REPORT_ONLY=1` to emit `Content-Security-Policy-Report-Only` (same directives).
- Violations are reported to `POST /csp-report`.

## CORS allowlist

Allowed origins are computed in `src/index.ts` by `getAllowedOrigins()`:

- `WEB_URL` is allowed only if it matches the instance type (beta vs production).
- `DOMAIN` adds `https://<domain>` and `https://www.<domain>` for the same instance type.
- `OVERLAY_URL` is always allowed.
- Fallback for dev is `http://localhost:5173` and `http://localhost:5174`.

## Cookies

Authentication cookies:

- Production cookie name: `token`
- Beta cookie name: `token_beta`
- Flags: `HttpOnly`, `SameSite=Lax`, `Secure` in production.

## JWT rotation

- New tokens include a `kid` header (derived from the current secret fingerprint).
- Set `JWT_SECRET_PREVIOUS` to the old secret during a rotation window so existing tokens remain valid.
- Use `pnpm tsx scripts/rotate-jwt-secret.ts` to update `.env` and validate the rotation locally.
- After clients have refreshed, remove `JWT_SECRET_PREVIOUS`.
- Monitor `memalerts_jwt_previous_key_verifications_total` to confirm old tokens have drained.

## Rate limiting

Rate limiters live in `src/middleware/rateLimit.ts`:

- `globalLimiter`: 100 requests per 15 minutes per IP.
- `uploadLimiter`: 30 requests per minute per user (fallback to IP).
- `activateMemeLimiter`: 1 request per 3 seconds per IP.
- `moderationActionLimiter`: 60 requests per minute per user (fallback to IP).
- `publicSubmissionsControlLimiter`: 15 requests per minute per IP.
- `ownerResolveLimiter`: 60 requests per minute per user (fallback to IP).

`Retry-After` is included on blocked responses using the reset timestamp.

Trusted proxy enforcement:

- `TRUSTED_PROXY_IPS` (comma-separated) controls which upstreams are allowed to supply `X-Forwarded-For`/`X-Real-IP`/`CF-Connecting-IP`.
- Requests from untrusted proxies ignore forwarded headers and log `security.rate_limit.bypass_attempt`.

## Uploads security

Uploads are served by Express static with hardening:

- `X-Content-Type-Options: nosniff`
- `Content-Disposition: attachment` for non-video files
- `Content-Type: application/octet-stream` for non-video files

If uploads are served by nginx instead of Express, configure the same headers there.

## Updating CSP for new resources

When a new domain or resource type is needed:

1) Update the `helmet({ contentSecurityPolicy: { directives: { ... }}})` block in `src/index.ts`.
2) Add the exact scheme + host to the correct directive (`img-src`, `connect-src`, etc).
3) For WebSockets, include `wss:` (and `ws:` only in dev).
4) Run `pnpm test` to verify CSP and header tests.

## CI security scanning

CI includes:

- `npm audit --audit-level=high` (fails on high/critical vulnerabilities).
- Snyk dependency scan (requires `SNYK_TOKEN` and `.snyk` policy file).
- CodeQL SAST (GitHub code scanning).
- Slack notifications via `SLACK_SECURITY_WEBHOOK_URL` when security findings are detected.

Triage process:

1) Confirm whether the finding is exploitable in production (runtime vs dev dependency).
2) Patch or upgrade the affected dependency; update lockfile and re-run scans.
3) If a finding is a false positive, add a scoped ignore to `.snyk` with a short justification and expiry.
4) Document the outcome in the PR and in `CHANGELOG.md` when appropriate.
