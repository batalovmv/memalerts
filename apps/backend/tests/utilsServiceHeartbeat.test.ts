import { prisma } from '../src/lib/prisma.js';
import { resolveServiceHeartbeatId, startServiceHeartbeat } from '../src/utils/serviceHeartbeat.js';

async function waitForHeartbeat(id: string): Promise<unknown> {
  for (let i = 0; i < 10; i += 1) {
    const row = await prisma.serviceHeartbeat.findUnique({ where: { id } });
    if (row) return row;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

describe('utils: serviceHeartbeat', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('builds heartbeat ids with instance suffix', () => {
    process.env.INSTANCE = 'beta';
    expect(resolveServiceHeartbeatId('api')).toBe('api-beta');
    expect(resolveServiceHeartbeatId('')).toBe('unknown-beta');
  });

  it('writes heartbeat rows and can be stopped', async () => {
    process.env.INSTANCE = '';
    const id = resolveServiceHeartbeatId('svc-test');
    const heartbeat = startServiceHeartbeat({
      service: 'svc-test',
      intervalMs: 5000,
      meta: { role: 'worker' },
    });

    const row = await waitForHeartbeat(id);
    heartbeat.stop();

    expect(row).toBeTruthy();
    if (row && typeof row === 'object' && 'meta' in row) {
      const meta = (row as { meta?: Record<string, unknown> }).meta;
      expect(meta?.role).toBe('worker');
    }
  });
});
