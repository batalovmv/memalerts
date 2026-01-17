import { beforeEach, describe, expect, it, vi } from 'vitest';

type JobHandler = (job: { data?: Record<string, unknown>; id?: string; attemptsMade?: number }) => Promise<void>;

class MockWorker {
  name: string;
  processor: JobHandler;
  opts: unknown;
  close = vi.fn(async () => undefined);
  handlers = new Map<string, Array<(...args: unknown[]) => void>>();

  constructor(name: string, processor: JobHandler, opts: unknown) {
    this.name = name;
    this.processor = processor;
    this.opts = opts;
  }

  on(event: string, handler: (...args: unknown[]) => void) {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
    return this;
  }
}

const workerInstances: MockWorker[] = [];

const bullmqMocks = vi.hoisted(() => ({
  Worker: vi.fn((name: string, processor: JobHandler, opts: unknown) => {
    const instance = new MockWorker(name, processor, opts);
    workerInstances.push(instance);
    return instance;
  }),
}));

const bullmqConnectionMocks = vi.hoisted(() => ({
  getBullmqConnection: vi.fn(),
  getBullmqPrefix: vi.fn(),
}));

const aiQueueMocks = vi.hoisted(() => ({
  enqueueAiModerationDlq: vi.fn(),
}));

vi.mock('bullmq', () => ({ Worker: bullmqMocks.Worker }));
vi.mock('../src/queues/bullmqConnection.js', () => bullmqConnectionMocks);
vi.mock('../src/queues/aiModerationQueue.js', async () => {
  const actual = await vi.importActual('../src/queues/aiModerationQueue.js');
  return { ...actual, enqueueAiModerationDlq: aiQueueMocks.enqueueAiModerationDlq };
});

import { prisma } from '../src/lib/prisma.js';
import * as aiQueueModule from '../src/jobs/aiQueue.js';
import * as aiModerationSubmissions from '../src/jobs/aiModerationSubmissions.js';
import { runAiWatchdogOnce } from '../src/jobs/aiQueue.js';
import { recomputeChannelDailyStats } from '../src/jobs/channelDailyStatsRollup.js';
import { startAiModerationWorker } from '../src/workers/aiModerationWorker.js';
import { createChannel, createMemeActivation, createSubmission, createUser } from './factories/index.js';

describe('jobs and workers', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    workerInstances.length = 0;
    process.env = { ...originalEnv };
    process.env.AI_BULLMQ_ENABLED = '1';
    bullmqConnectionMocks.getBullmqConnection.mockReturnValue({});
    bullmqConnectionMocks.getBullmqPrefix.mockReturnValue('test');
  });

  it('runs AI analysis jobs through the worker processor', async () => {
    const claimSpy = vi.spyOn(aiQueueModule, 'tryClaimAiSubmission').mockResolvedValue({
      claimed: true,
      workerId: 'worker-1',
    });
    const processSpy = vi.spyOn(aiModerationSubmissions, 'processOneSubmission').mockResolvedValue(undefined);

    const handle = startAiModerationWorker();
    expect(handle).not.toBeNull();
    const worker = workerInstances[0];
    expect(worker).toBeDefined();

    await worker.processor({ data: { submissionId: 'sub-1' }, id: 'job-1', attemptsMade: 0 });

    expect(claimSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        submissionId: 'sub-1',
      })
    );
    expect(processSpy).toHaveBeenCalledWith('sub-1');

    await handle?.stop();
    expect(worker.close).toHaveBeenCalled();

    claimSpy.mockRestore();
    processSpy.mockRestore();
  });

  it('does not start worker when disabled', () => {
    process.env.AI_BULLMQ_ENABLED = '0';
    const handle = startAiModerationWorker();
    expect(handle).toBeNull();
  });

  it('recovers stuck AI submissions via watchdog', async () => {
    const channel = await createChannel({ slug: 'job-watchdog', name: 'Job Watchdog' });
    const user = await createUser({ role: 'viewer' });
    const past = new Date(Date.now() - 60 * 60_000);

    const submission = await createSubmission({
      channelId: channel.id,
      submitterUserId: user.id,
      status: 'pending',
      sourceKind: 'upload',
      aiStatus: 'processing',
      aiRetryCount: 0,
      aiLastTriedAt: past,
      aiProcessingStartedAt: past,
      aiLockedBy: 'worker',
      aiLockExpiresAt: new Date(Date.now() - 60_000),
    });

    const res = await runAiWatchdogOnce({ limit: 10 });
    expect(res.recovered).toBeGreaterThanOrEqual(1);

    const updated = await prisma.memeSubmission.findUnique({
      where: { id: submission.id },
      select: { aiStatus: true, aiError: true, aiLockedBy: true },
    });

    expect(updated?.aiStatus).toBe('pending');
    expect(updated?.aiError).toBe('stuck_recovered');
    expect(updated?.aiLockedBy).toBeNull();
  });

  it('recomputes channel daily stats rollups', async () => {
    const channel = await createChannel({ slug: 'job-rollup', name: 'Job Rollup' });
    const user = await createUser({ role: 'viewer' });
    await createMemeActivation({ channelId: channel.id, userId: user.id, status: 'done', coinsSpent: 150 });

    const res = await recomputeChannelDailyStats({ days: 1 });
    expect(res.rowsUpserted).toBeGreaterThan(0);

    const row = await prisma.channelDailyStats.findFirst({
      where: { channelId: channel.id },
      select: { totalActivationsCount: true, totalCoinsSpentSum: true },
    });

    expect(row?.totalActivationsCount).toBeGreaterThan(0);
    expect(typeof row?.totalCoinsSpentSum).toBe('bigint');
  });
});
