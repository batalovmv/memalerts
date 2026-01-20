# ADR 0003: Separate Beta/Prod Auth Cookies

Date: 2026-01-16
Status: Accepted

## Context

We run beta and production on different subdomains. Sharing a single cookie name across subdomains risks sending prod cookies to beta, causing auth failures and confusing user sessions.

## Decision

Use distinct cookie names: `token` for production and `token_beta` for beta. The auth middleware selects the correct cookie based on domain/instance hints.

## Consequences

- Safer separation of sessions between environments.
- Slightly more complexity in auth handling and tests.
- Frontend and test utilities must set/read the correct cookie for the target environment.
