import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
const startServiceHeartbeat = vi.hoisted(() => vi.fn(() => ({ stop: vi.fn() })));
const prismaMock = vi.hoisted(() => ({ $connect: vi.fn(), $disconnect: vi.fn() }));
const chatCommands = vi.hoisted(() => ({ refreshCommands: vi.fn(), handleIncomingChat: vi.fn() }));
const rewardProcessor = vi.hoisted(() => ({ handleChatRewards: vi.fn() }));
const streamEvents = vi.hoisted(() => ({ syncSubscriptions: vi.fn(), disconnectAll: vi.fn() }));
const chatOutbox = vi.hoisted(() => ({
  startOutboxWorker: vi.fn(() => ({ close: vi.fn() })),
  processOutboxOnce: vi.fn(),
}));
const createTrovoChatCommands = vi.hoisted(() => vi.fn(() => chatCommands));
const createTrovoRewardProcessor = vi.hoisted(() => vi.fn(() => rewardProcessor));
const createTrovoStreamEvents = vi.hoisted(() => vi.fn(() => streamEvents));
const createTrovoChatOutbox = vi.hoisted(() => vi.fn(() => chatOutbox));

vi.mock('../../src/config/loadEnv.js', () => ({}));
vi.mock('../../src/tracing/init.js', () => ({}));
vi.mock('../../src/bots/env.js', () => ({ validateTrovoChatbotEnv: vi.fn() }));
vi.mock('../../src/utils/serviceHeartbeat.js', () => ({ startServiceHeartbeat }));
vi.mock('../../src/utils/logger.js', () => ({ logger: loggerMock }));
vi.mock('../../src/lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../../src/bots/trovoChatCommands.js', () => ({ createTrovoChatCommands }));
vi.mock('../../src/bots/trovoRewardProcessor.js', () => ({ createTrovoRewardProcessor }));
vi.mock('../../src/bots/trovoStreamEvents.js', () => ({ createTrovoStreamEvents }));
vi.mock('../../src/bots/trovoChatOutbox.js', () => ({ createTrovoChatOutbox }));

const baseEnv = { ...process.env };

async function importRunner() {
  await import('../../src/bots/trovoChatbotRunner.js');
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

describe('trovo chatbot runner', () => {
  it('starts services when enabled', async () => {
    process.env.TROVO_CHAT_BOT_ENABLED = '1';
    process.env.CHATBOT_BACKEND_BASE_URL = 'https://api.example.com';
    process.env.TROVO_CHAT_WS_URL = 'wss://trovo.example/chat';

    await importRunner();

    expect(prismaMock.$connect).toHaveBeenCalled();
    expect(streamEvents.syncSubscriptions).toHaveBeenCalled();
    expect(chatCommands.refreshCommands).toHaveBeenCalled();
    expect(loggerMock.info).toHaveBeenCalledWith(
      'trovo_chatbot.started',
      expect.objectContaining({
        syncSeconds: expect.any(Number),
        commandsRefreshSeconds: expect.any(Number),
        outboxPollMs: expect.any(Number),
        wsUrl: 'wss://trovo.example/chat',
      })
    );
  });
});
