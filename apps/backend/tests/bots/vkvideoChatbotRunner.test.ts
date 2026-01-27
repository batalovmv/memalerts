import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
const startServiceHeartbeat = vi.hoisted(() => vi.fn(() => ({ stop: vi.fn() })));
const prismaMock = vi.hoisted(() => ({ $connect: vi.fn(), $disconnect: vi.fn() }));
const streamEvents = vi.hoisted(() => ({ syncSubscriptions: vi.fn() }));
const chatOutbox = vi.hoisted(() => ({
  startOutboxWorker: vi.fn(() => ({ close: vi.fn() })),
  processOutboxOnce: vi.fn(),
}));
const createVkvideoStreamEvents = vi.hoisted(() => vi.fn(() => streamEvents));
const createVkvideoChatOutbox = vi.hoisted(() => vi.fn(() => chatOutbox));

vi.mock('../../src/config/loadEnv.js', () => ({}));
vi.mock('../../src/tracing/init.js', () => ({}));
vi.mock('../../src/bots/env.js', () => ({ validateVkvideoChatbotEnv: vi.fn() }));
vi.mock('../../src/utils/serviceHeartbeat.js', () => ({ startServiceHeartbeat }));
vi.mock('../../src/utils/logger.js', () => ({ logger: loggerMock }));
vi.mock('../../src/lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../../src/bots/vkvideoStreamEvents.js', () => ({ createVkvideoStreamEvents }));
vi.mock('../../src/bots/vkvideoChatOutbox.js', () => ({ createVkvideoChatOutbox }));

const baseEnv = { ...process.env };

async function importRunner() {
  await import('../../src/bots/vkvideoChatbotRunner.js');
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...baseEnv };
  vi.spyOn(globalThis, 'setInterval').mockImplementation(() => 0 as unknown as NodeJS.Timeout);
  vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => undefined);
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...baseEnv };
  vi.restoreAllMocks();
});

describe('vkvideo chatbot runner', () => {
  it('skips when disabled', async () => {
    process.env.VKVIDEO_CHAT_BOT_ENABLED = '0';

    await importRunner();

    expect(loggerMock.info).toHaveBeenCalledWith('vkvideo_chatbot.disabled', {});
    expect(startServiceHeartbeat).not.toHaveBeenCalled();
  });

  it('starts services when enabled', async () => {
    process.env.VKVIDEO_CHAT_BOT_ENABLED = '1';
    process.env.CHATBOT_BACKEND_BASE_URL = 'https://api.example.com';

    await importRunner();

    expect(prismaMock.$connect).toHaveBeenCalled();
    expect(streamEvents.syncSubscriptions).toHaveBeenCalled();
    expect(loggerMock.info).toHaveBeenCalledWith(
      'vkvideo_chatbot.started',
      expect.objectContaining({
        syncSeconds: expect.any(Number),
        outboxPollMs: expect.any(Number),
      })
    );
  });
});
