import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loggerMock = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../../src/utils/logger.js', () => ({ logger: loggerMock }));

import {
  validateChatbotEnv,
  validateKickChatbotEnv,
  validateTrovoChatbotEnv,
  validateVkvideoChatbotEnv,
  validateYoutubeChatbotEnv,
} from '../../src/bots/env.js';

const ORIGINAL_ENV = process.env;

function setBaseEnv() {
  process.env = {
    PATH: ORIGINAL_ENV.PATH,
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://localhost:5432/db',
    CHATBOT_BACKEND_BASE_URL: 'https://api.example.com',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env = {
    PATH: ORIGINAL_ENV.PATH,
    NODE_ENV: 'test',
  };
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  vi.restoreAllMocks();
});

describe('bot env validation', () => {
  it('validates runner envs with base url', () => {
    setBaseEnv();

    expect(validateChatbotEnv().CHATBOT_BACKEND_BASE_URL).toBe('https://api.example.com');
    expect(validateKickChatbotEnv().CHATBOT_BACKEND_BASE_URL).toBe('https://api.example.com');
    expect(validateTrovoChatbotEnv().CHATBOT_BACKEND_BASE_URL).toBe('https://api.example.com');
    expect(validateVkvideoChatbotEnv().CHATBOT_BACKEND_BASE_URL).toBe('https://api.example.com');
    expect(validateYoutubeChatbotEnv().CHATBOT_BACKEND_BASE_URL).toBe('https://api.example.com');
  });

  it('logs and exits on invalid base url list', () => {
    process.env = {
      PATH: ORIGINAL_ENV.PATH,
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://localhost:5432/db',
      CHATBOT_BACKEND_BASE_URL: '',
      CHATBOT_BACKEND_BASE_URLS: 'https://good.example,not-a-url',
    };

    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(((code?: number) => {
        throw new Error(`exit:${code ?? 0}`);
      }) as never);

    expect(() => validateChatbotEnv()).toThrow('exit:1');
    expect(loggerMock.error).toHaveBeenCalledWith('chatbot.env_invalid', expect.any(Object));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
