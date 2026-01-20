import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  vi.restoreAllMocks();
});

describe('env validation', () => {
  it('should fail on missing required env', async () => {
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'development',
      DATABASE_URL: '',
      JWT_SECRET: '',
      TWITCH_CLIENT_ID: '',
      TWITCH_CLIENT_SECRET: '',
      TWITCH_EVENTSUB_SECRET: '',
    };

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code ?? 'unknown'}`);
    }) as never);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(import('../src/config/env.js')).rejects.toThrow('process.exit:');
    expect(exitSpy).toHaveBeenCalled();
  });

  it('should pass with required env', async () => {
    process.env = {
      PATH: ORIGINAL_ENV.PATH,
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db?schema=public',
      JWT_SECRET: '1234567890abcdef',
      TWITCH_CLIENT_ID: 'twitch-client-id',
      TWITCH_CLIENT_SECRET: 'twitch-client-secret',
      TWITCH_EVENTSUB_SECRET: 'twitch-eventsub-secret',
    };

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code ?? 'unknown'}`);
    }) as never);

    await expect(import('../src/config/env.js')).resolves.toBeDefined();
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
