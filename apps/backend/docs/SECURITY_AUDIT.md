# Security Audit (OWASP Top 10)

Date: 2026-01-18

Scope: memalerts-backend (API, auth, storage, background jobs, CI workflows).

Summary: No critical issues found in baseline review. Follow-ups listed below.

## A01: Broken Access Control

- Auth is enforced via `token` / `token_beta` cookies (HttpOnly, SameSite=Lax, Secure in prod).
- Role checks exist for streamer/admin/owner endpoints.
- Internal relay endpoints require localhost + `x-memalerts-internal` header.

## A02: Cryptographic Failures

- JWT signing uses secrets from `.env`; rotation supported via `JWT_SECRET_PREVIOUS`.
- HTTPS termination handled at nginx/Cloudflare.
- Sensitive secrets stored in GitHub Actions secrets and synced to VPS `.env`.

## A03: Injection

- Prisma ORM used for DB access (parameterized queries).
- Input validation via Zod schemas in controllers.

## A04: Insecure Design

- Beta/prod isolation enforced (cookies, origins, env).
- Rate limiting present globally and per sensitive endpoints.

## A05: Security Misconfiguration

- Helmet configured with CSP and Permissions-Policy.
- CORS allowlist based on instance type and configured domains.
- Log and error responses avoid leaking secrets.

## A06: Vulnerable and Outdated Components

- CI runs `pnpm audit --audit-level=high` and Snyk scan.

## A07: Identification and Authentication Failures

- OAuth providers validated and state checked.
- CSRF protection enforced on state-changing routes.

## A08: Software and Data Integrity Failures

- CI includes CodeQL and Snyk checks.
- Deploys require passing tests and health checks.

## A09: Security Logging and Monitoring Failures

- Structured logs include requestId/userId/channelId when available.
- Security events are logged (rate limit blocks, auth failures).
- External monitoring and uptime checks in place.

## A10: Server-Side Request Forgery (SSRF)

- External downloads are validated by URL and content-type in submission import flow.

## Follow-ups

- Periodic review of CSP directives as new assets/domains are added.
- Consider WAF rules for high-risk endpoints if traffic increases.
