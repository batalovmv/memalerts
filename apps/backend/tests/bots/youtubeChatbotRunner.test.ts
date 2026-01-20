import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
const startServiceHeartbeat = vi.hoisted(() => vi.fn(() => ({ stop: vi.fn() })));
const prismaMock = vi.hoisted(() => ({ $connect: vi.fn(), $disconnect: vi.fn() }));
const subscriptions = vi.hoisted(() => ({ syncSubscriptions: vi.fn() }));
const chatCommands = vi.hoisted(() => ({ refreshCommands: vi.fn() }));
const chatPolling = vi.hoisted(() => ({ pollChatsOnce: vi.fn() }));
const chatOutbox = vi.hoisted(() => ({
  startOutboxWorker: vi.fn(() => ({ close: vi.fn() })),
  processOutboxOnce: vi.fn(),
}));
const createYouTubeChatSubscriptions = vi.hoisted(() => vi.fn(() => subscriptions));
const createYouTubeChatCommands = vi.hoisted(() => vi.fn(() => chatCommands));
const createYouTubeChatPolling = vi.hoisted(() => vi.fn(() => chatPolling));
const createYouTubeChatOutbox = vi.hoisted(() => vi.fn(() => chatOutbox));

vi.mock('../../src/config/loadEnv.js', () => ({}));
vi.mock('../../src/tracing/init.js', () => ({}));
vi.mock('../../src/bots/env.js', () => ({ validateYoutubeChatbotEnv: vi.fn() }));
vi.mock('../../src/utils/serviceHeartbeat.js', () => ({ startServiceHeartbeat }));
vi.mock('../../src/utils/logger.js', () => ({ logger: loggerMock }));
vi.mock('../../src/lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../../src/bots/youtubeChatSubscriptions.js', () => ({ createYouTubeChatSubscriptions }));
vi.mock('../../src/bots/youtubeChatCommands.js', () => ({ createYouTubeChatCommands }));
vi.mock('../../src/bots/youtubeChatPolling.js', () => ({ createYouTubeChatPolling }));
vi.mock('../../src/bots/youtubeChatOutbox.js', () => ({ createYouTubeChatOutbox }));

const baseEnv = { ...process.env };

async function importRunner() {
  await import('../../src/bots/youtubeChatbotRunner.js');
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

describe('youtube chatbot runner', () => {
  it('starts services with base urls', async () => {
    process.env.CHATBOT_BACKEND_BASE_URL = 'https://api.example.com';

    await importRunner();

    expect(prismaMock.$connect).toHaveBeenCalled();
    expect(subscriptions.syncSubscriptions).toHaveBeenCalled();
    expect(loggerMock.info).toHaveBeenCalledWith(
      'youtube_chatbot.started',
      expect.objectContaining({
        syncSeconds: expect.any(Number),
        liveCheckSeconds: expect.any(Number),
        commandsRefreshSeconds: expect.any(Number),
        outboxPollMs: expect.any(Number),
      })
    );
  });
});
