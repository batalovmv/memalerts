# MemAlerts — 90‑Day Project Plan (RU-only, free-first)

## Purpose

This document captures the **product direction and execution plan** for the next 90 days. It is written to be used as a reference during development and prioritization.

## Current Constraints (given)

- **Language**: **Russian only**. (English translations may exist as a “universal” fallback, but RU is the only supported product language for now.)
- **Monetization**: **no payments yet**. All “coins” are earned by viewers **inside streamer channels** via engagement/rewards. The product is **fully free** in the early stage.
- **Long-term monetization idea (later)**: subscriptions for optional advanced features (e.g. **using custom/self-hosted bots instead of built-in bots**, extra automation, advanced controls).
- **90-day goal**: **stabilize what exists today** — remove problems, fix bugs, and make current functionality reliable.

## Product Thesis

MemAlerts improves streamer engagement by turning “memes on screen” into a **highly customizable realtime overlay** with **automatic viewer rewards** (free for viewers) and a future-ready **multistream automation** layer (bots).

## Key Differentiators

- **Fully customizable overlay**: not just “show meme on screen”, but **deep UI/UX customization** of the overlay experience.
- **Automatic balance top-ups (free for viewers)**: viewers can earn coins through **rewards/likes/engagement**, automatically credited for their streamer. The streamer does not need to do anything for this loop to work.
- **Multistream bot suite (in progress)**: users connect multiple platforms; configured bots automate tasks across platforms “for them”. This is a strategic pillar, even if bots are still being refined.

## What “Success” Looks Like in 90 Days

- **Stability**: the current feature set works consistently under real streams without crashes or “random” failures.
- **Safety**: key security boundaries remain intact (cookies/instances separation, CSRF boundaries, internal relay locality, realtime privacy).
- **Operator confidence**: faster debugging, better logs/metrics, fewer production incidents.
- **Streamer confidence**: clear setup, predictable overlay behavior, reliable submissions and rewards.

## Non-Goals (for the next 90 days)

- Adding a full payment system.
- Expanding to multiple product languages (beyond incidental/fallback translation).
- Large feature expansions that increase surface area unless required to fix reliability.

## Execution Principles

- **Reliability over novelty**: prefer hardening and cleanup over new capabilities.
- **Minimal-risk changes**: small diffs, maintain backwards compatibility.
- **Test-driven fixes**: treat existing tests as contracts; add coverage where bugs were found.
- **Observe before optimizing**: add metrics/logs around bottlenecks and failures first.

## Workstreams

### 1) Core stability (API + DB)

- **Audit and fix** top recurring errors and edge cases (timeouts, invalid states, Prisma errors, missing constraints).
- **Data invariants**: prevent inconsistent states (especially around submissions, file hashes, wallet/coins).
- **Rate limits / abuse controls**: ensure basic protections exist where needed (without harming legitimate usage).

### 2) Realtime stability (Socket.IO + overlays)

- **Room correctness**: channel/user rooms must be joined only when authorized; room naming must be normalized.
- **Privacy**: wallet/balance events must never leak to unintended rooms.
- **Resilience**: recover gracefully from reconnects, token rotation, and transient network issues.
- **Latency budget**: define targets and observe p95/p99 event delivery time.

### 3) Uploads & submissions (video pipeline)

- **Reliability**: stable handling of edge cases (partial uploads, corrupted files, unsupported containers).
- **Performance controls**: concurrency knobs and backpressure for hashing/ffprobe-heavy work.
- **Storage**: consistent behavior for local vs S3 modes (including dedup and URL generation).

### 4) Security boundaries (must not regress)

Maintain and continuously verify:

- **beta ↔ prod isolation** (cookie names, secrets, origins)
- **CSRF boundaries** (protected methods, explicit exceptions)
- **Internal relay** security (localhost-only + required header)
- **Realtime privacy** (no balance leaks)

Add tests when a bug fix touches these areas.

### 5) Bots & multistream (stabilize the base)

- **Operational hardening**: restart behavior, token refresh flows, safe retries, clearer logging.
- **Incremental rollout**: enable only what is stable; keep experimental connectors behind flags.
- **Quality bar**: “bot does no harm” — avoid duplicate messages, spam, or unexpected actions.

### 6) UX foundation (even in backend scope)

Backend changes that reduce setup friction:

- More helpful error messages for common misconfigurations.
- Clearer defaults (safe and predictable).
- Faster “first success”: streamer can set up overlay and see it working quickly.

## Metrics to Track (lightweight)

- **Reliability**
  - API error rate (5xx) and top endpoints by failures
  - Realtime disconnect/reconnect frequency
  - Upload failure rate and top reasons
- **Latency**
  - p95/p99 for key realtime events (overlay updates)
  - upload processing time distribution (hashing, ffprobe)
- **Product**
  - streamers activated (overlay connected)
  - submissions per stream, accept/reject ratio
  - coins earned via rewards (per channel)

## 90‑Day Milestones (weekly buckets)

### Weeks 1–2: Stabilization baseline

- Establish a “top issues” list from logs + user reports.
- Add/adjust instrumentation for the most critical paths.
- Fix highest-impact crashes and data integrity bugs.
- Tighten tests for the areas touched by fixes.

### Weeks 3–4: Realtime + overlay reliability

- Fix reconnect/token rotation edge cases.
- Validate room authorization flows and privacy boundaries.
- Add targeted load tests or scripted scenarios for stream-like usage.

### Weeks 5–6: Uploads/submissions hardening

- Improve validation and error handling for video edge cases.
- Confirm dedup behavior and concurrency/backpressure under load.
- Validate storage modes (local/S3) and delivery URLs.

### Weeks 7–8: Bots hardening (no big expansions)

- Improve bot stability and observability (safe retries, idempotency where needed).
- Reduce operational “unknowns” with better logs and clear failure modes.
- Keep experimental multistream features behind flags if not stable.

### Weeks 9–10: Polish + regression prevention

- Convert recurring bug classes into tests.
- Reduce “sharp edges” and improve diagnostics for misconfigurations.
- Document known operational runbooks (deploy, logs, common failures).

### Weeks 11–12: Release readiness

- Run a full regression pass (tests + real scenario checklist).
- Close remaining P0/P1 bugs.
- Prepare a stable “beta graduation” checklist and a release note template.

## Definition of Done (for this 90‑day phase)

- **No P0/P1 known issues** in the current feature set.
- **Stable under real streams** (no frequent crashes, broken overlays, or stuck queues).
- **Security invariants preserved** (beta/prod isolation, CSRF rules, internal relay locality, privacy).
- **Observability baseline**: enough logs/metrics to diagnose incidents quickly.

## Risks & Mitigations

- **Scope creep** → enforce non-goals; new features only if required to fix reliability.
- **Bot instability** → feature flags, staged rollout, conservative retries.
- **Video pipeline costs/performance** → strict limits, backpressure, dedup, and cleanup policies.
- **Security regressions** → keep boundaries explicit, expand tests when changing auth/csrf/internal/realtime code.

## Notes on Future Monetization (post‑stability)

Once the core is reliable and the product has active users:

- Introduce **subscriptions** for advanced capabilities, primarily:
  - custom/self-hosted bot support
  - higher limits and premium overlay customization
  - advanced automation and analytics


