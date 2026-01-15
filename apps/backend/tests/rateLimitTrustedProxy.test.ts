import type { Request } from 'express';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getClientIP } from '../src/middleware/rateLimit.js';

function makeReq(headers: Record<string, string>, remoteAddress: string): Request {
  return {
    headers,
    socket: { remoteAddress },
    ip: remoteAddress,
    path: '/test',
    method: 'GET',
  } as unknown as Request;
}

describe('rate limit trusted proxy handling', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('ignores forwarded headers when proxy is not trusted', () => {
    process.env.TRUSTED_PROXY_IPS = '10.0.0.1';
    const req = makeReq({ 'x-forwarded-for': '8.8.8.8' }, '192.168.0.10');
    expect(getClientIP(req)).toBe('192.168.0.10');
  });

  it('uses forwarded headers when proxy is trusted', () => {
    process.env.TRUSTED_PROXY_IPS = '192.168.0.10';
    const req = makeReq({ 'x-forwarded-for': '8.8.8.8, 1.1.1.1' }, '192.168.0.10');
    expect(getClientIP(req)).toBe('8.8.8.8');
  });
});
