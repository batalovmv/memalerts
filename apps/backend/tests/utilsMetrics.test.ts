import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

const baseEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...baseEnv };
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...baseEnv };
  vi.restoreAllMocks();
});

describe('utils: metrics', () => {
  it('records counters and histograms for http requests', async () => {
    const metrics = await import('../src/utils/metrics.js');

    metrics.recordHttpRequest({ method: 'GET', route: '/health', status: 200, durationSeconds: 0.12 });
    const output = await metrics.metricsRegistry().metrics();

    expect(output).toContain('memalerts_http_requests_total');
    expect(output).toContain('method="GET"');
    expect(output).toContain('route="/health"');
    expect(output).toContain('memalerts_http_request_duration_seconds');
  });

  it('sets gauges and counters for ai jobs and wallets', async () => {
    const metrics = await import('../src/utils/metrics.js');

    metrics.setAiJobMetrics({ pending: 5, processing: 2, failedTotal: 3 });
    metrics.recordWalletOperation({ operation: 'increment', amount: 10 });

    const output = await metrics.metricsRegistry().metrics();

    expect(output).toMatch(/memalerts_ai_jobs_pending\s+5/);
    expect(output).toMatch(/memalerts_ai_jobs_processing\s+2/);
    expect(output).toContain('memalerts_ai_jobs_failed_total');
    expect(output).toContain('memalerts_wallet_operations_total');
  });

  it('records client timeouts in histograms', async () => {
    const metrics = await import('../src/utils/metrics.js');

    metrics.recordHttpClientTimeout({ service: 'twitch', timeoutMs: 1500 });
    const output = await metrics.metricsRegistry().metrics();

    expect(output).toContain('memalerts_http_client_timeout_seconds');
    expect(output).toContain('service="twitch"');
  });

  it('records bot outbox, chat outbox, and retry metrics', async () => {
    const metrics = await import('../src/utils/metrics.js');

    metrics.setBotOutboxMetrics({ platform: 'twitch', pending: 3, failedTotal: 2 });
    metrics.setChatOutboxQueueDepth({ platform: 'twitch', state: 'waiting', depth: 7 });
    metrics.recordChatOutboxQueueLatency({ platform: 'twitch', latencySeconds: 1.5 });
    metrics.recordRetryAttempt('twitch');
    metrics.recordRetryOutcome({ service: 'twitch', outcome: 'success' });

    const output = await metrics.metricsRegistry().metrics();

    expect(output).toContain('memalerts_bot_outbox_pending');
    expect(output).toContain('platform="twitch"');
    expect(output).toContain('memalerts_chat_outbox_queue_depth');
    expect(output).toContain('state="waiting"');
    expect(output).toContain('memalerts_http_client_retry_attempts_total');
    expect(output).toContain('memalerts_http_client_retry_outcomes_total');
  });

  it('records circuit state, heartbeat, and misc counters', async () => {
    const metrics = await import('../src/utils/metrics.js');

    metrics.setCircuitState('ai', 'open');
    metrics.setServiceHeartbeatState('bot', 'alive');
    metrics.recordWalletRaceConflict();
    metrics.recordJwtPreviousKeyVerification('overlay');
    metrics.recordFileHashOrphanFile('s3');
    metrics.recordDbSlowQuery({ durationMs: 750 });

    const output = await metrics.metricsRegistry().metrics();

    expect(output).toContain('memalerts_circuit_state');
    expect(output).toContain('service="ai"');
    expect(output).toContain('state="open"');
    expect(output).toContain('memalerts_service_heartbeat_state');
    expect(output).toContain('service="bot"');
    expect(output).toContain('wallet_race_conflicts_total');
    expect(output).toContain('memalerts_jwt_previous_key_verifications_total');
    expect(output).toContain('memalerts_filehash_orphan_files_total');
    expect(output).toContain('memalerts_db_slow_queries_total');
  });
});
