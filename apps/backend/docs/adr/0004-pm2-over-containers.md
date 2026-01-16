# ADR 0004: PM2 Over Containers (Current Ops)

Date: 2026-01-16
Status: Accepted

## Context

Production runs on a VPS with a straightforward CI/CD pipeline. We need a reliable process manager, log handling, and fast deploys without introducing container orchestration overhead.

## Decision

Use PM2 to manage the Node.js process (restart on failure, log rotation, simple status commands). Containerization is deferred until operational complexity or scaling requirements justify it.

## Consequences

- Deployments remain lightweight and fast on VPS.
- Host-level dependencies must be managed (Node, system packages).
- If we move to containers later, we will revisit process management, logging, and health checks accordingly.
