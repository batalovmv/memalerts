import { beforeEach, describe, expect, it, vi } from 'vitest';

class MockQueue {
  name: string;
  opts: unknown;
  add = vi.fn();
  getJobCounts = vi.fn();

  constructor(name: string, opts: unknown) {
    this.name = name;
    this.opts = opts;
  }
}

const queueInstances = new Map<string, MockQueue>();

const bullmqMocks = vi.hoisted(() => ({
  Queue: vi.fn((name: string, opts: unknown) => {
    const instance = new MockQueue(name, opts);
    queueInstances.set(name, instance);
    return instance;
  }),
}));

const connectionMocks = vi.hoisted(() => ({
  getBullmqConnection: vi.fn(),
  getBullmqPrefix: vi.fn(),
}));

vi.mock('bullmq', () => ({ Queue: bullmqMocks.Queue }));
vi.mock('../src/queues/bullmqConnection.js', () => connectionMocks);

import {
  AI_MODERATION_JOB_NAME,
  AI_MODERATION_QUEUE_NAME,
  AI_MODERATION_DLQ_NAME,
  enqueueAiModerationDlq,
  enqueueAiModerationJob,
  getAiModerationDlq,
  getAiModerationDlqCounts,
  getAiModerationQueueCounts,
  getAiModerationQueue,
} from '../src/queues/aiModerationQueue.js';
import {
  CHAT_OUTBOX_JOB_NAME,
  enqueueChatOutboxJob,
  getChatOutboxQueue,
  getChatOutboxQueueCounts,
} from '../src/queues/chatOutboxQueue.js';

describe('queues', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    for (const instance of queueInstances.values()) {
      instance.add.mockReset();
      instance.getJobCounts.mockReset();
    }
    process.env = { ...originalEnv };
    process.env.AI_BULLMQ_ENABLED = '1';
    process.env.CHAT_OUTBOX_BULLMQ_ENABLED = '1';
    connectionMocks.getBullmqConnection.mockReturnValue({});
    connectionMocks.getBullmqPrefix.mockReturnValue('test');
  });

  it('enqueues AI moderation jobs with retry options', async () => {
    const queue = getAiModerationQueue();
    expect(queue).not.toBeNull();
    const instance = queueInstances.get(AI_MODERATION_QUEUE_NAME);
    expect(instance).toBeDefined();

    const res = await enqueueAiModerationJob('sub-1', { reason: 'test' });
    expect(res.enqueued).toBe(true);
    expect(res.jobId).toBe('ai-sub-1');

    expect(instance?.add).toHaveBeenCalledWith(
      AI_MODERATION_JOB_NAME,
      { submissionId: 'sub-1', reason: 'test' },
      expect.objectContaining({
        attempts: expect.any(Number),
        backoff: { type: 'custom' },
      })
    );
  });

  it('enqueues AI moderation dead letter jobs', async () => {
    await enqueueAiModerationDlq({
      submissionId: 'sub-1',
      jobId: 'job-1',
      errorMessage: 'boom',
      attemptsMade: 2,
      failedAt: '2025-01-01T00:00:00.000Z',
    });

    const dlqInstance = queueInstances.get(AI_MODERATION_DLQ_NAME);
    expect(dlqInstance).toBeDefined();
    expect(dlqInstance.add).toHaveBeenCalledWith(
      'ai-moderation-dlq',
      expect.objectContaining({ submissionId: 'sub-1', jobId: 'job-1', errorMessage: 'boom' }),
      expect.objectContaining({ jobId: expect.stringContaining('ai-dlq-sub-1-2025-01-01T00-00-00-000Z') })
    );
  });

  it('returns queue counts for AI and chat outbox queues', async () => {
    const queue = getAiModerationQueue();
    const instance = queueInstances.get(AI_MODERATION_QUEUE_NAME);
    instance?.getJobCounts.mockResolvedValue({ waiting: 1, active: 2, delayed: 3, failed: 4, completed: 5 });

    const counts = await getAiModerationQueueCounts();
    expect(counts).toEqual({ waiting: 1, active: 2, delayed: 3, failed: 4, completed: 5 });

    const chatQueue = getChatOutboxQueue('twitch');
    const chatInstance = queueInstances.get('chat-outbox-twitch');
    chatInstance?.getJobCounts.mockResolvedValue({ waiting: 0, active: 1, delayed: 0, failed: 0, completed: 2 });

    const chatCounts = await getChatOutboxQueueCounts('twitch');
    expect(chatCounts).toEqual({ waiting: 0, active: 1, delayed: 0, failed: 0, completed: 2 });

    expect(queue).not.toBeNull();
    expect(chatQueue).not.toBeNull();
  });

  it('enqueues chat outbox jobs with configured attempts', async () => {
    process.env.CHAT_OUTBOX_MAX_ATTEMPTS = '3';
    const queue = getChatOutboxQueue('twitch');
    const instance = queueInstances.get('chat-outbox-twitch');
    expect(queue).not.toBeNull();

    const res = await enqueueChatOutboxJob({ platform: 'twitch', outboxId: 'outbox:1', channelId: 'ch-1' });
    expect(res.enqueued).toBe(true);
    expect(res.jobId).toBe('outbox-1');

    expect(instance?.add).toHaveBeenCalledWith(
      CHAT_OUTBOX_JOB_NAME,
      { platform: 'twitch', outboxId: 'outbox:1', channelId: 'ch-1' },
      expect.objectContaining({
        attempts: 3,
        backoff: { type: 'custom' },
      })
    );
  });

  it('skips enqueue when queues are disabled', async () => {
    process.env.AI_BULLMQ_ENABLED = '0';
    process.env.CHAT_OUTBOX_BULLMQ_ENABLED = '0';

    const aiRes = await enqueueAiModerationJob('sub-1');
    const chatRes = await enqueueChatOutboxJob({ platform: 'twitch', outboxId: 'outbox-2', channelId: 'ch-1' });

    expect(aiRes.enqueued).toBe(false);
    expect(aiRes.jobId).toBeNull();
    expect(chatRes.enqueued).toBe(false);
    expect(chatRes.jobId).toBeNull();
  });

  it('returns DLQ counts when enabled', async () => {
    const dlq = queueInstances.get(AI_MODERATION_DLQ_NAME);
    if (dlq) {
      dlq.getJobCounts.mockResolvedValue({ failed: 7 });
    }
    if (!dlq) {
      const created = getAiModerationDlq();
      const instance = queueInstances.get(AI_MODERATION_DLQ_NAME);
      instance?.getJobCounts.mockResolvedValue({ failed: 7 });
      void created;
    }

    const counts = await getAiModerationDlqCounts();
    expect(counts).toEqual({ failed: 7 });
  });
});
