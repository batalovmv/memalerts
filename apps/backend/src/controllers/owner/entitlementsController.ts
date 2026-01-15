import type { Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import type { AuthRequest } from '../../middleware/auth.js';
import { logger } from '../../utils/logger.js';
import { hasChannelEntitlement } from '../../utils/entitlements.js';
import { auditLog, getRequestMetadata } from '../../utils/auditLogger.js';
import {
  normalizeExternalId,
  normalizeProvider,
  isValidTwitchExternalId,
  resolveChannelByProviderExternalId,
} from '../../utils/channelResolve.js';

function parseIsoDateOrNull(v: unknown): Date | null {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
}

function isPrismaTableMissingError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'code' in e && (e as { code?: string }).code === 'P2021';
}

export const entitlementsController = {
  // GET /owner/entitlements/custom-bot?channelId=...
  getCustomBot: async (req: AuthRequest, res: Response) => {
    const query = req.query as Record<string, unknown>;
    const channelId = String(query.channelId || '').trim();
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
    } catch (e: unknown) {
      if (isPrismaTableMissingError(e))
        return res.status(404).json({ error: 'Not Found', message: 'Feature not available' });
      throw e;
    }
  },

  // POST /owner/entitlements/custom-bot/grant  body: { channelId, expiresAt?, source? }
  grantCustomBot: async (req: AuthRequest, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const channelId = String(body.channelId || '').trim();
    if (!channelId) return res.status(400).json({ error: 'Bad Request', message: 'channelId is required' });

    const expiresAt = parseIsoDateOrNull(body.expiresAt);
    if (body.expiresAt && !expiresAt) {
      return res.status(400).json({ error: 'Bad Request', message: 'expiresAt must be ISO date string or null' });
    }
    const source = String(body.source || '').trim() || 'manual';

    try {
      await prisma.channelEntitlement.upsert({
        where: { channelId_key: { channelId, key: 'custom_bot' } },
        create: { channelId, key: 'custom_bot', enabled: true, expiresAt, source },
        update: { enabled: true, expiresAt, source },
        select: { id: true },
      });
      const active = await hasChannelEntitlement(channelId, 'custom_bot');
      return res.json({
        ok: true,
        channelId,
        key: 'custom_bot',
        active,
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
        source,
      });
    } catch (e: unknown) {
      if (isPrismaTableMissingError(e))
        return res.status(404).json({ error: 'Not Found', message: 'Feature not available' });
      const errorMessage = e instanceof Error ? e.message : String(e);
      logger.warn('owner.entitlements.grant_failed', {
        channelId,
        key: 'custom_bot',
        errorMessage,
      });
      throw e;
    }
  },

  // POST /owner/entitlements/custom-bot/revoke  body: { channelId }
  revokeCustomBot: async (req: AuthRequest, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const channelId = String(body.channelId || '').trim();
    if (!channelId) return res.status(400).json({ error: 'Bad Request', message: 'channelId is required' });
    try {
      await prisma.channelEntitlement.updateMany({
        where: { channelId, key: 'custom_bot' },
        data: { enabled: false },
      });
      const active = await hasChannelEntitlement(channelId, 'custom_bot');
      return res.json({ ok: true, channelId, key: 'custom_bot', active });
    } catch (e: unknown) {
      if (isPrismaTableMissingError(e))
        return res.status(404).json({ error: 'Not Found', message: 'Feature not available' });
      const errorMessage = e instanceof Error ? e.message : String(e);
      logger.warn('owner.entitlements.revoke_failed', {
        channelId,
        key: 'custom_bot',
        errorMessage,
      });
      throw e;
    }
  },

  // POST /owner/entitlements/custom-bot/grant-by-provider
  // body: { provider: "twitch", externalId: "12345" }
  grantCustomBotByProvider: async (req: AuthRequest, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const provider = normalizeProvider(body.provider);
    const externalId = normalizeExternalId(body.externalId);

    if (!provider || !externalId) {
      return res.status(400).json({ error: 'Bad Request', message: 'provider and externalId are required' });
    }
    if (provider !== 'twitch') {
      return res.status(400).json({ error: 'Bad Request', message: 'Unsupported provider' });
    }
    if (!isValidTwitchExternalId(externalId)) {
      return res
        .status(400)
        .json({ error: 'Bad Request', message: 'externalId must be a numeric Twitch broadcaster_id' });
    }

    const { ipAddress, userAgent } = getRequestMetadata(req);
    const actorId = req.userId || null;

    const resolved = await resolveChannelByProviderExternalId(provider, externalId);
    if (!resolved) {
      await auditLog({
        action: 'owner.entitlements.custom_bot.grant_by_provider',
        actorId,
        payload: { provider, externalId, result: 'NOT_FOUND' },
        ipAddress,
        userAgent,
        success: false,
        error: 'NOT_FOUND',
      });
      return res.status(404).json({ error: 'NOT_FOUND' });
    }

    const channelId = resolved.channelId;
    const source = 'manual_by_provider';

    try {
      await prisma.channelEntitlement.upsert({
        where: { channelId_key: { channelId, key: 'custom_bot' } },
        create: { channelId, key: 'custom_bot', enabled: true, expiresAt: null, source },
        update: { enabled: true, expiresAt: null, source },
        select: { id: true },
      });

      await auditLog({
        action: 'owner.entitlements.custom_bot.grant_by_provider',
        actorId,
        channelId,
        payload: { provider: resolved.provider, externalId: resolved.externalId, channelId, granted: true },
        ipAddress,
        userAgent,
        success: true,
      });

      return res.json({ channelId, granted: true });
    } catch (e: unknown) {
      if (isPrismaTableMissingError(e))
        return res.status(404).json({ error: 'Not Found', message: 'Feature not available' });
      const errorMessage = e instanceof Error ? e.message : String(e);
      logger.warn('owner.entitlements.grant_by_provider_failed', {
        channelId,
        key: 'custom_bot',
        provider,
        externalId,
        errorMessage,
      });

      await auditLog({
        action: 'owner.entitlements.custom_bot.grant_by_provider',
        actorId,
        channelId,
        payload: { provider, externalId, channelId, granted: false },
        ipAddress,
        userAgent,
        success: false,
        error: errorMessage,
      });

      throw e;
    }
  },
};
