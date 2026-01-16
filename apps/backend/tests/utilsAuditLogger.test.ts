import type { Request } from 'express';

import { prisma } from '../src/lib/prisma.js';
import {
  auditLog,
  getRequestMetadata,
  logAdminAction,
  logAuthEvent,
  logFileUpload,
  logMemeActivation,
  logSecurityEvent,
} from '../src/utils/auditLogger.js';
import { createChannel, createUser } from './factories/index.js';

function makeRequest(headers: Record<string, string>): Request {
  return {
    headers,
    socket: { remoteAddress: '127.0.0.1' },
    ip: '127.0.0.1',
  } as unknown as Request;
}

describe('utils: auditLogger', () => {
  it('writes audit logs only when channelId is provided', async () => {
    const channel = await createChannel();
    const before = await prisma.auditLog.count();

    await auditLog({ action: 'test.no_channel', actorId: null });
    const mid = await prisma.auditLog.count();
    expect(mid).toBe(before);

    await auditLog({
      action: 'test.with_channel',
      actorId: null,
      channelId: channel.id,
      payload: { ok: true },
    });
    const after = await prisma.auditLog.count();
    expect(after).toBe(before + 1);
  });

  it('extracts request metadata in priority order', () => {
    const req = makeRequest({ 'cf-connecting-ip': '1.1.1.1', 'user-agent': 'UA' });
    const meta = getRequestMetadata(req);
    expect(meta.ipAddress).toBe('1.1.1.1');
    expect(meta.userAgent).toBe('UA');
  });

  it('logs audit helper events', async () => {
    const channel = await createChannel();
    const user = await createUser();
    const req = makeRequest({ 'x-forwarded-for': '2.2.2.2', 'user-agent': 'Agent' });

    await logFileUpload(user.id, channel.id, 'file.webm', 123, true, req);
    await logAdminAction('approve_submission', user.id, channel.id, 'sub-1', { reason: 'ok' }, true, req);
    await logMemeActivation(user.id, channel.id, 'meme-1', 50, true, req);
    await logSecurityEvent('csrf_blocked', null, channel.id, { reason: 'bad' }, req);

    const logs = await prisma.auditLog.findMany({ where: { channelId: channel.id } });
    const actions = logs.map((log) => log.action);
    expect(actions).toEqual(
      expect.arrayContaining(['file.upload', 'admin.approve_submission', 'meme.activate', 'security.csrf_blocked'])
    );

    const fileLog = logs.find((log) => log.action === 'file.upload');
    expect(fileLog).toBeTruthy();
    if (fileLog) {
      const payload = JSON.parse(fileLog.payloadJson);
      expect(payload.fileName).toBe('file.webm');
      expect(payload.fileSize).toBe(123);
    }

    const countBefore = await prisma.auditLog.count();
    await logAuthEvent('login', user.id, true, req);
    const countAfter = await prisma.auditLog.count();
    expect(countAfter).toBe(countBefore);
  });
});
