# Observability

## RequestId debugging

- Every HTTP response includes `X-Request-Id` (generated or forwarded from `X-Request-Id`/`X-Correlation-Id`).
- Structured logs automatically include `requestId`, `userId`, and `channelId` from AsyncLocalStorage.
- Errors include `traceId` (when tracing is enabled) so you can jump to Jaeger.
- Use the request id to correlate API logs, background jobs, and errors across services.

### Quick workflow

1) Find the `X-Request-Id` in the client response headers.
2) Search logs by `requestId` in your log aggregator or `jq`:

```bash
rg "\"requestId\":\"<id>\"" /var/log/memalerts-api.log
```

### Common fields

- `requestId`: correlation id for a single request (propagated between services).
- `traceId`: OpenTelemetry trace id (visible in Jaeger when tracing is enabled).
- `userId`: authenticated user (if any).
- `channelId`: channel context (if any).
- `service`: service name (`INSTANCE`).
- `env`: runtime environment (`NODE_ENV`).
- `instanceId`: unique host/instance identifier (`INSTANCE_ID` or `HOSTNAME`).

## Distributed tracing (OpenTelemetry + Jaeger)

- OTel auto-instrumentation covers HTTP/Express and outgoing fetch/undici calls.
- Trace propagation uses `traceparent` headers to connect cross-service spans.
- Sampling defaults to 100% error traces and 10% successful traces.

### Quick start

1) Run Jaeger locally (`http://localhost:16686`).
2) Set `OTEL_EXPORTER_JAEGER_ENDPOINT=http://localhost:14268/api/traces`.
3) Restart the API and hit any endpoint.
4) Search for the `traceId` from logs or error responses in the Jaeger UI.

### Key env

- `OTEL_ENABLED=1` to force-enable tracing.
- `OTEL_EXPORTER_JAEGER_ENDPOINT` or `JAEGER_ENDPOINT` for collector HTTP endpoint.
- `OTEL_EXPORTER_JAEGER_AGENT_HOST`/`OTEL_EXPORTER_JAEGER_AGENT_PORT` for agent mode.
- `OTEL_SUCCESS_SAMPLE_RATE` (default 0.1).
- `OTEL_TRACE_MAX_MS` and `OTEL_TRACE_DECISION_TTL_MS` to bound trace buffering.

## Error tracking (Sentry)

- Server errors are captured by Sentry middleware when `SENTRY_DSN` is set.
- PII scrubbing removes emails; user IDs are allowed.
- Releases are attached via `SENTRY_RELEASE` (or `RELEASE`/`GIT_SHA`).
- Suggested alert: issue count or error rate spikes over 5-10 minutes.

## Centralized logging

- Logs are structured JSON (Pino) with `requestId`/`traceId`.
- Use `LOG_TRANSPORT_TARGET` + `LOG_TRANSPORT_OPTIONS` to ship logs, or log to stdout and forward via your agent.
- For file shipping, set `LOG_TRANSPORT_TARGET=pino/file` and `LOG_TRANSPORT_OPTIONS={"destination":"/var/log/memalerts-api.log","mkdir":true}`.
- `tools/observability/vector.toml` ships JSON logs to Elasticsearch (ELK).

### Local ELK stack

- `tools/observability/docker-compose.logging.yml` starts Elasticsearch + Kibana + Vector.
- Apply retention: `tools/observability/elasticsearch/ilm-policy-30d.json` and `tools/observability/elasticsearch/index-template.json`.

### ELK retention (30 days)

1) Create ILM policy: `tools/observability/elasticsearch/ilm-policy-30d.json`.
2) Create index template: `tools/observability/elasticsearch/index-template.json`.
3) Ensure indices use `memalerts-logs-*` pattern.

### Saved queries (Kibana)

- `requestId:"<id>"`
- `traceId:"<id>"`
- `event:"http.error"`
- `event:"http.request" AND status:>=500`
- `event:"db.slow_query"`
- `event:"security.rate_limit.blocked"`

### Log-based alerts

- `event:"http.error"` spike over baseline (5m).
- `event:"db.slow_query"` rate above 1/min.
- `event:"security.rate_limit.blocked"` above expected traffic.

## Metrics + Grafana

- `tools/observability/docker-compose.observability.yml` runs Prometheus + Grafana locally.
- Jaeger is included on `http://localhost:16686` (collector: `http://localhost:14268/api/traces`).
- Update `tools/observability/prometheus.yml` target to your API host.
- Dashboards are provisioned from `tools/observability/grafana/dashboards`.
- Prometheus alert rules live in `tools/observability/prometheus-alerts.yml`.
- Grafana alert rules are provisioned from `tools/observability/grafana/provisioning/alerting`.

### Dashboards included

- HTTP metrics: throughput, errors, latency (`tools/observability/grafana/dashboards/memalerts-http.json`).
- AI jobs: queue depth + failures (`tools/observability/grafana/dashboards/memalerts-ai-jobs.json`).
- Bot outbox: pending/failures/latency (`tools/observability/grafana/dashboards/memalerts-bot-outbox.json`).
- Wallet operations: ops + conflicts (`tools/observability/grafana/dashboards/memalerts-wallet.json`).

### Canary-friendly metrics

- `memalerts_instance_info{instanceId="...",service="..."}` is emitted for instance-level filtering (e.g., canary vs stable).
