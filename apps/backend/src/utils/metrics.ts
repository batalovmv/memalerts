import type { CounterLabelValues, CounterLike, MetricsRegistry } from './metricsRegistry.js';
import { createRegistry } from './metricsRegistry.js';

const metricsBackend = createRegistry();
const registry = metricsBackend.registry;

const instanceInfo = metricsBackend.gauge({
  name: 'memalerts_instance_info',
  help: 'Memalerts instance metadata',
  labelNames: ['instanceId', 'service'],
});

const httpRequestsTotal = metricsBackend.counter({
  name: 'memalerts_http_requests_total',
  help: 'Total HTTP requests processed',
  labelNames: ['method', 'route', 'status'],
});

const httpRequestDurationSeconds = metricsBackend.histogram({
  name: 'memalerts_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['route'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

const dbSlowQueriesTotal = metricsBackend.counter({
  name: 'memalerts_db_slow_queries_total',
  help: 'Total slow database queries',
});

const dbSlowQueryDurationSeconds = metricsBackend.histogram({
  name: 'memalerts_db_slow_query_duration_seconds',
  help: 'Slow database query duration in seconds',
  buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
});

const aiJobsPending = metricsBackend.gauge({
  name: 'memalerts_ai_jobs_pending',
  help: 'AI jobs pending in the queue',
});

const aiJobsProcessing = metricsBackend.gauge({
  name: 'memalerts_ai_jobs_processing',
  help: 'AI jobs being processed',
});

const aiJobsFailedTotal = metricsBackend.counter({
  name: 'memalerts_ai_jobs_failed_total',
  help: 'Total AI jobs failed',
});

const botOutboxPending = metricsBackend.gauge({
  name: 'memalerts_bot_outbox_pending',
  help: 'Bot outbox messages pending delivery',
  labelNames: ['platform'],
});

const botOutboxFailedTotal = metricsBackend.counter({
  name: 'memalerts_bot_outbox_failed_total',
  help: 'Total bot outbox messages failed',
  labelNames: ['platform'],
});

const chatOutboxQueueDepth = metricsBackend.gauge({
  name: 'memalerts_chat_outbox_queue_depth',
  help: 'BullMQ chat outbox queue depth by state',
  labelNames: ['platform', 'state'],
});

const chatOutboxQueueLatencySeconds = metricsBackend.histogram({
  name: 'memalerts_chat_outbox_queue_latency_seconds',
  help: 'Time from enqueue to processing for chat outbox jobs',
  labelNames: ['platform'],
  buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 120],
});

const walletRaceConflictsTotal = metricsBackend.counter({
  name: 'wallet_race_conflicts_total',
  help: 'Total wallet lock conflicts detected',
});

const walletOperationsTotal = metricsBackend.counter({
  name: 'memalerts_wallet_operations_total',
  help: 'Total wallet balance operations',
  labelNames: ['operation'],
});

const walletOperationAmountTotal = metricsBackend.counter({
  name: 'memalerts_wallet_operation_amount_total',
  help: 'Total wallet balance delta by operation',
  labelNames: ['operation'],
});

const jwtPreviousKeyVerificationsTotal = metricsBackend.counter({
  name: 'memalerts_jwt_previous_key_verifications_total',
  help: 'Total JWT verifications that used the previous signing key',
  labelNames: ['context'],
});

const fileHashOrphanFilesTotal = metricsBackend.counter({
  name: 'memalerts_filehash_orphan_files_total',
  help: 'Total orphaned files detected after FileHash refcount reached zero',
  labelNames: ['storage'],
});

const circuitState = metricsBackend.gauge({
  name: 'memalerts_circuit_state',
  help: 'Circuit breaker state (1 = current state)',
  labelNames: ['service', 'state'],
});

const serviceHeartbeatState = metricsBackend.gauge({
  name: 'memalerts_service_heartbeat_state',
  help: 'Service heartbeat state (1 = current state)',
  labelNames: ['service', 'state'],
});

const httpClientRetryAttemptsTotal = metricsBackend.counter({
  name: 'memalerts_http_client_retry_attempts_total',
  help: 'Total retry attempts for external HTTP calls',
  labelNames: ['service'],
});

const httpClientRetryOutcomesTotal = metricsBackend.counter({
  name: 'memalerts_http_client_retry_outcomes_total',
  help: 'Final outcomes for external HTTP calls that use retries',
  labelNames: ['service', 'outcome'],
});

const httpClientTimeoutSeconds = metricsBackend.histogram({
  name: 'memalerts_http_client_timeout_seconds',
  help: 'External HTTP client timeout duration in seconds',
  labelNames: ['service'],
  buckets: [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120],
});

const instanceIdLabel = String(process.env.INSTANCE_ID || process.env.HOSTNAME || 'unknown').trim() || 'unknown';
const serviceLabel = String(process.env.INSTANCE || 'api').trim() || 'api';
instanceInfo.set({ instanceId: instanceIdLabel, service: serviceLabel }, 1);

const counterLastValues = new Map<string, number>();

function counterKey(name: string, labels: CounterLabelValues | null): string {
  return `${name}:${labels ? JSON.stringify(labels) : ''}`;
}

function applyCounterTotal(metric: CounterLike, total: number, labels?: CounterLabelValues) {
  const normalizedTotal = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  const key = counterKey(metric.name, labels || null);
  const last = counterLastValues.get(key);

  if (last == null) {
    metric.inc(labels || {}, normalizedTotal);
    counterLastValues.set(key, normalizedTotal);
    return;
  }

  if (normalizedTotal >= last) {
    const delta = normalizedTotal - last;
    if (delta > 0) metric.inc(labels || {}, delta);
    counterLastValues.set(key, normalizedTotal);
  }
}

export function recordHttpRequest(params: { method: string; route: string; status: number; durationSeconds: number }) {
  const route = params.route || 'unknown';
  const status = String(params.status || 0);
  httpRequestsTotal.inc({ method: params.method, route, status }, 1);
  httpRequestDurationSeconds.observe({ route }, Math.max(0, params.durationSeconds));
}

export function recordDbSlowQuery(params: { durationMs: number }) {
  const durationMs = Math.max(0, params.durationMs);
  dbSlowQueriesTotal.inc();
  dbSlowQueryDurationSeconds.observe({}, durationMs / 1000);
}

export function setAiJobMetrics(params: { pending: number; processing: number; failedTotal: number }) {
  aiJobsPending.set(Math.max(0, Math.floor(params.pending)));
  aiJobsProcessing.set(Math.max(0, Math.floor(params.processing)));
  applyCounterTotal(aiJobsFailedTotal, params.failedTotal);
}

export function setBotOutboxMetrics(params: { platform: string; pending: number; failedTotal: number }) {
  const platform = params.platform;
  botOutboxPending.set({ platform }, Math.max(0, Math.floor(params.pending)));
  applyCounterTotal(botOutboxFailedTotal, params.failedTotal, { platform });
}

export function setChatOutboxQueueDepth(params: { platform: string; state: string; depth: number }) {
  const platform = params.platform;
  const state = params.state;
  chatOutboxQueueDepth.set({ platform, state }, Math.max(0, Math.floor(params.depth)));
}

export function recordChatOutboxQueueLatency(params: { platform: string; latencySeconds: number }) {
  const platform = params.platform;
  const latencySeconds = Math.max(0, params.latencySeconds);
  chatOutboxQueueLatencySeconds.observe({ platform }, latencySeconds);
}

export function recordWalletRaceConflict() {
  walletRaceConflictsTotal.inc();
}

export function recordWalletOperation(params: { operation: 'increment' | 'decrement' | 'set'; amount?: number }) {
  const operation = params.operation;
  walletOperationsTotal.inc({ operation }, 1);
  const amount = params.amount ?? 0;
  if (Number.isFinite(amount) && amount > 0) {
    walletOperationAmountTotal.inc({ operation }, amount);
  }
}

export function recordJwtPreviousKeyVerification(context: string) {
  const label = context ? context : 'unknown';
  jwtPreviousKeyVerificationsTotal.inc({ context: label });
}

export function recordFileHashOrphanFile(storage: string) {
  const label = storage ? storage : 'unknown';
  fileHashOrphanFilesTotal.inc({ storage: label });
}

const CIRCUIT_STATES = ['closed', 'open', 'half_open'] as const;
const HEARTBEAT_STATES = ['alive', 'stale', 'dead'] as const;

export function setCircuitState(service: string, state: string) {
  const label = service ? service : 'unknown';
  for (const s of CIRCUIT_STATES) {
    circuitState.set({ service: label, state: s }, s === state ? 1 : 0);
  }
}

export function setServiceHeartbeatState(service: string, state: string) {
  const label = service ? service : 'unknown';
  for (const s of HEARTBEAT_STATES) {
    serviceHeartbeatState.set({ service: label, state: s }, s === state ? 1 : 0);
  }
}

export function recordRetryAttempt(service: string) {
  const label = service ? service : 'unknown';
  httpClientRetryAttemptsTotal.inc({ service: label });
}

export function recordRetryOutcome(params: { service: string; outcome: 'success' | 'failure' }) {
  const label = params.service ? params.service : 'unknown';
  const outcome = params.outcome || 'failure';
  httpClientRetryOutcomesTotal.inc({ service: label, outcome });
}

export function recordHttpClientTimeout(params: { service: string; timeoutMs: number }) {
  const label = params.service ? params.service : 'unknown';
  const seconds = Math.max(0, params.timeoutMs) / 1000;
  httpClientTimeoutSeconds.observe({ service: label }, seconds);
}

export function metricsRegistry(): MetricsRegistry {
  return registry;
}
