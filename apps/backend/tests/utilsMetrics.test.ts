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
});
