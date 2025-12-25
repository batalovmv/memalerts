import type { Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import type { AuthRequest } from '../../middleware/auth.js';
import { logger } from '../../utils/logger.js';
import { hasChannelEntitlement } from '../../utils/entitlements.js';

function parseIsoDateOrNull(v: any): Date | null {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
}

function isPrismaTableMissingError(e: any): boolean {
  return e?.code === 'P2021';
}

export const entitlementsController = {
  // GET /owner/entitlements/custom-bot?channelId=...
  getCustomBot: async (req: AuthRequest, res: Response) => {
    const channelId = String((req.query as any)?.channelId || '').trim();
    if (!channelId) return res.status(400).json({ error: 'Bad Request', message: 'channelId is required' });
    try {
      const row = await prisma.channelEntitlement.findUnique({
        where: { channelId_key: { channelId, key: 'custom_bot' } },
        select: { enabled: true, expiresAt: true, source: true, updatedAt: true, createdAt: true },
      });
      const active = await hasChannelEntitlement(channelId, 'custom_bot');
      return res.json({
        channelId,
        key: 'custom_bot',
        enabled: Boolean(row?.enabled),
        expiresAt: row?.expiresAt ? new Date(row.expiresAt).toISOString() : null,
        source: row?.source ? String(row.source) : null,
        active,
        updatedAt: row?.updatedAt ? new Date(row.updatedAt).toISOString() : null,
        createdAt: row?.createdAt ? new Date(row.createdAt).toISOString() : null,
      });
    } catch (e: any) {
      if (isPrismaTableMissingError(e)) return res.status(404).json({ error: 'Not Found', message: 'Feature not available' });
      throw e;
    }
  },

  // POST /owner/entitlements/custom-bot/grant  body: { channelId, expiresAt?, source? }
  grantCustomBot: async (req: AuthRequest, res: Response) => {
    const channelId = String((req.body as any)?.channelId || '').trim();
    if (!channelId) return res.status(400).json({ error: 'Bad Request', message: 'channelId is required' });

    const expiresAt = parseIsoDateOrNull((req.body as any)?.expiresAt);
    if ((req.body as any)?.expiresAt && !expiresAt) {
      return res.status(400).json({ error: 'Bad Request', message: 'expiresAt must be ISO date string or null' });
    }
    const source = String((req.body as any)?.source || '').trim() || 'manual';

    try {
      await prisma.channelEntitlement.upsert({
        where: { channelId_key: { channelId, key: 'custom_bot' } },
        create: { channelId, key: 'custom_bot', enabled: true, expiresAt, source },
        update: { enabled: true, expiresAt, source },
        select: { id: true },
      });
      const active = await hasChannelEntitlement(channelId, 'custom_bot');
      return res.json({ ok: true, channelId, key: 'custom_bot', active, expiresAt: expiresAt ? expiresAt.toISOString() : null, source });
    } catch (e: any) {
      if (isPrismaTableMissingError(e)) return res.status(404).json({ error: 'Not Found', message: 'Feature not available' });
      logger.warn('owner.entitlements.grant_failed', { channelId, key: 'custom_bot', errorMessage: e?.message || String(e) });
      throw e;
    }
  },

  // POST /owner/entitlements/custom-bot/revoke  body: { channelId }
  revokeCustomBot: async (req: AuthRequest, res: Response) => {
    const channelId = String((req.body as any)?.channelId || '').trim();
    if (!channelId) return res.status(400).json({ error: 'Bad Request', message: 'channelId is required' });
    try {
      await prisma.channelEntitlement.updateMany({
        where: { channelId, key: 'custom_bot' },
        data: { enabled: false },
      });
      const active = await hasChannelEntitlement(channelId, 'custom_bot');
      return res.json({ ok: true, channelId, key: 'custom_bot', active });
    } catch (e: any) {
      if (isPrismaTableMissingError(e)) return res.status(404).json({ error: 'Not Found', message: 'Feature not available' });
      logger.warn('owner.entitlements.revoke_failed', { channelId, key: 'custom_bot', errorMessage: e?.message || String(e) });
      throw e;
    }
  },
};


