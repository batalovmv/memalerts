# Resilience Patterns

This backend applies circuit breakers, retries with exponential backoff, and explicit timeouts for external services.

## Circuit breakers

- Services: Twitch, YouTube, OpenAI.
- Behavior: after consecutive failures, the circuit opens and fails fast for 30 seconds, then transitions to half-open.
- Failure classification: network errors, timeouts, and HTTP 5xx/408/429 are counted as failures; other 4xx do not trip the circuit.

Environment overrides (optional):
- `{SERVICE}_CIRCUIT_FAILURE_THRESHOLD`
- `{SERVICE}_CIRCUIT_RESET_TIMEOUT_MS`
- `{SERVICE}_CIRCUIT_SUCCESS_THRESHOLD`
- `{SERVICE}_CIRCUIT_HALF_OPEN_MAX_IN_FLIGHT`

## Retries (exponential backoff + jitter)

- Services: Discord, Boosty, Kick, Trovo.
- Default policy: 3 attempts, exponential backoff with full jitter.
- Retries are only applied to transient failures (HTTP 5xx/408/429, network errors).

Environment overrides (optional):
- `{SERVICE}_RETRY_MAX_ATTEMPTS`
- `{SERVICE}_RETRY_BASE_DELAY_MS`
- `{SERVICE}_RETRY_MAX_DELAY_MS`

## Timeouts

All external requests have explicit timeouts and are controlled via `{SERVICE}_HTTP_TIMEOUT_MS` per service.

Common services:
- `TWITCH_HTTP_TIMEOUT_MS`
- `YOUTUBE_HTTP_TIMEOUT_MS`
- `OPENAI_HTTP_TIMEOUT_MS`
- `DISCORD_HTTP_TIMEOUT_MS`
- `BOOSTY_HTTP_TIMEOUT_MS`
- `KICK_HTTP_TIMEOUT_MS`
- `TROVO_HTTP_TIMEOUT_MS`

## Observability

- Prometheus metrics:
  - `memalerts_circuit_state` (labels: service, state)
  - `memalerts_http_client_retry_attempts_total` (labels: service)
  - `memalerts_http_client_retry_outcomes_total` (labels: service, outcome)
  - `memalerts_http_client_timeout_seconds` (labels: service)
- Health endpoint:
  - `GET /health/circuits` returns circuit status and overall health.

## Failure modes

- Circuit open: requests fail fast with 503 (relay unavailable).
- Timeout: request aborts and surfaces a timeout error.
- Retries: transient errors are retried; non-transient errors return immediately.
