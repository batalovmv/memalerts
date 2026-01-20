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
const chatOutbox = vi.hoisted(() => ({
  startOutboxWorker: vi.fn(() => ({ close: vi.fn() })),
  processOutboxOnce: vi.fn(),
}));
const chatIngest = vi.hoisted(() => ({ ingestChatOnce: vi.fn() }));
const eventSubscriptions = vi.hoisted(() => ({ ensureKickEventSubscriptions: vi.fn() }));
const createKickChatSubscriptions = vi.hoisted(() => vi.fn(() => subscriptions));
const createKickChatCommands = vi.hoisted(() => vi.fn(() => chatCommands));
const createKickChatOutbox = vi.hoisted(() => vi.fn(() => chatOutbox));
const createKickChatIngest = vi.hoisted(() => vi.fn(() => chatIngest));
const createKickEventSubscriptions = vi.hoisted(() => vi.fn(() => eventSubscriptions));

vi.mock('../../src/config/loadEnv.js', () => ({}));
vi.mock('../../src/tracing/init.js', () => ({}));
vi.mock('../../src/bots/env.js', () => ({ validateKickChatbotEnv: vi.fn() }));
vi.mock('../../src/utils/serviceHeartbeat.js', () => ({ startServiceHeartbeat }));
vi.mock('../../src/utils/logger.js', () => ({ logger: loggerMock }));
vi.mock('../../src/lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../../src/bots/kickChatSubscriptions.js', () => ({ createKickChatSubscriptions }));
vi.mock('../../src/bots/kickChatCommands.js', () => ({ createKickChatCommands }));
vi.mock('../../src/bots/kickChatOutbox.js', () => ({ createKickChatOutbox }));
vi.mock('../../src/bots/kickChatIngest.js', () => ({ createKickChatIngest }));
vi.mock('../../src/bots/kickEventSubscriptions.js', () => ({ createKickEventSubscriptions }));

const baseEnv = { ...process.env };

async function importRunner() {
  await import('../../src/bots/kickChatbotRunner.js');
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

describe('kick chatbot runner', () => {
  it('starts services when enabled', async () => {
    process.env.KICK_CHAT_BOT_ENABLED = '1';
    process.env.CHATBOT_BACKEND_BASE_URL = 'https://api.example.com';
    process.env.KICK_CHAT_POLL_URL_TEMPLATE = 'https://kick.example/{channelId}/poll';

    await importRunner();

    expect(prismaMock.$connect).toHaveBeenCalled();
    expect(subscriptions.syncSubscriptions).toHaveBeenCalled();
    expect(chatCommands.refreshCommands).toHaveBeenCalled();
    expect(eventSubscriptions.ensureKickEventSubscriptions).toHaveBeenCalled();
    expect(loggerMock.info).toHaveBeenCalledWith(
      'kick_chatbot.started',
      expect.objectContaining({
        syncSeconds: expect.any(Number),
        commandsRefreshSeconds: expect.any(Number),
        outboxPollMs: expect.any(Number),
        ingestPollMs: expect.any(Number),
        hasChatIngest: true,
      })
    );
  });
});
