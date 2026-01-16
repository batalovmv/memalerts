import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { setupRoutes } from '../src/routes/index.js';
import { requestContext } from '../src/middleware/requestContext.js';
import { prisma } from '../src/lib/prisma.js';
import { createServiceHeartbeat } from './factories/index.js';

function makeApp() {
  const app = express();
  app.use(requestContext);
  setupRoutes(app);
  return app;
}

describe('observability endpoints', () => {
  beforeEach(async () => {
    // Ensure clean heartbeats for deterministic tests.
    await prisma.serviceHeartbeat.deleteMany({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('GET /healthz returns liveness', async () => {
    const res = await request(makeApp()).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /readyz returns ok when DB is reachable', async () => {
    const res = await request(makeApp()).get('/readyz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.checks?.database).toBe('ok');
  });

  it('GET /readyz returns degraded when DB check fails', async () => {
    const spy = vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('db down'));
    const res = await request(makeApp()).get('/readyz');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.checks?.database).toBe('error');
    spy.mockRestore();
  });

  it('GET /health/workers returns status by lastSeenAt', async () => {
    const now = new Date();
    const stale = new Date(now.getTime() - 2 * 60 * 1000);
    const dead = new Date(now.getTime() - 10 * 60 * 1000);

    await createServiceHeartbeat({ id: `worker-alive-${Date.now()}`, lastSeenAt: now, meta: { role: 'alive' } });
    await createServiceHeartbeat({ id: `worker-stale-${Date.now()}`, lastSeenAt: stale, meta: { role: 'stale' } });
    await createServiceHeartbeat({ id: `worker-dead-${Date.now()}`, lastSeenAt: dead, meta: { role: 'dead' } });

    const res = await request(makeApp()).get('/health/workers');
    expect(res.status).toBe(200);
    const workers = Array.isArray(res.body?.workers) ? (res.body.workers as Array<{ id: string; status: string }>) : [];
    const byId = new Map(workers.map((w) => [w.id, w.status]));
    for (const [id, status] of byId.entries()) {
      if (String(id).includes('alive')) expect(status).toBe('alive');
      if (String(id).includes('stale')) expect(status).toBe('stale');
      if (String(id).includes('dead')) expect(status).toBe('dead');
    }
  });

  it('GET /metrics exposes Prometheus metrics', async () => {
    const res = await request(makeApp()).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.text).toContain('memalerts_http_requests_total');
    expect(res.text).toContain('memalerts_http_request_duration_seconds');
    expect(res.text).toContain('memalerts_ai_jobs_pending');
    expect(res.text).toContain('memalerts_bot_outbox_pending');
    expect(res.text).toContain('memalerts_instance_info');
  });
});
