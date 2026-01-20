# ADR 0002: In-Process Schedulers (With Migration Plan)

Date: 2026-01-16
Status: Accepted

## Context

The backend runs periodic maintenance and rollup jobs (stats rollups, cleanup, rewards). We need a reliable scheduling mechanism without adding heavy operational complexity in early stages.

## Decision

Run schedulers in-process within the API service. This keeps deployment simple and avoids a separate scheduler service while load is moderate.

## Consequences

- Single-instance deployments are straightforward, but multiple API replicas can duplicate work.
- We guard some tasks with locks and keep intervals conservative.
- Migration plan: move recurring jobs to BullMQ/worker services as we scale (AI pipeline already supports BullMQ with `AI_BULLMQ_ENABLED`).
