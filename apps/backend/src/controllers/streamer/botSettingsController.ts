import type { Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import type { AuthRequest } from '../../middleware/auth.js';
import { hasChannelEntitlement } from '../../utils/entitlements.js';
import {
  extractVkVideoChannelIdFromUrl,
  fetchVkVideoCurrentUser,
  getVkVideoExternalAccount,
} from '../../utils/vkvideoApi.js';
import {
  type BotIntegrationPatchBody,
  normalizeProvider,
  PROVIDERS,
  requireChannelId,
  getTwitchEnabledFallback,
  getVkVideoEnabledFallback,
  isPrismaFeatureUnavailable,
  normalizeVkVideoCurrentUserRoot,
  extractVkVideoChannelUrls,
} from './botIntegrationsShared.js';
import type {
  BotPatchApplyResult,
  BotPatchContext,
  BotPatchPrepared,
  BotPatchResult,
} from './botSettingsPatchTypes.js';
import { prepareTwitchPatch, applyTwitchPatch } from './botSettingsPatchTwitch.js';
import { prepareYouTubePatch, applyYouTubePatch } from './botSettingsPatchYouTube.js';
import { prepareVkVideoPatch, applyVkVideoPatch } from './botSettingsPatchVkVideo.js';

type ProviderPatchHandler = {
  prepare: (ctx: BotPatchContext) => Promise<BotPatchResult>;
  apply: (ctx: BotPatchContext, data: BotPatchPrepared) => Promise<BotPatchApplyResult>;
};

const PATCH_HANDLERS: Record<string, ProviderPatchHandler> = {
  twitch: {
    prepare: prepareTwitchPatch,
    apply: applyTwitchPatch,
  },
  youtube: {
    prepare: prepareYouTubePatch,
    apply: applyYouTubePatch,
  },
  vkvideo: {
    prepare: prepareVkVideoPatch,
    apply: applyVkVideoPatch,
  },
};

export const botSettingsController = {
  // GET /streamer/bots/vkvideo/candidates
  // Returns VKVideo channel URLs for the authenticated user (from VKVideo Live DevAPI current_user),
  // so frontend can auto-fill vkvideoChannelUrl when enabling the bot.
  vkvideoCandidates: async (req: AuthRequest, res: Response) => {
    if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });

    const account = await getVkVideoExternalAccount(req.userId);
    if (!account?.accessToken) {
      return res.status(400).json({
        error: 'Bad Request',
        code: 'VKVIDEO_NOT_LINKED',
        message: 'VKVideo account is not linked',
      });
    }

    const currentUser = await fetchVkVideoCurrentUser({ accessToken: account.accessToken });
    if (!currentUser.ok) {
      return res.status(400).json({
        error: 'Bad Request',
        code: 'VKVIDEO_CURRENT_USER_FAILED',
        message: `Failed to load VKVideo current_user (${currentUser.error || 'unknown'})`,
      });
    }

    const root = normalizeVkVideoCurrentUserRoot(currentUser.data);
    const unique = extractVkVideoChannelUrls(root);

    const items = unique
      .map((url) => ({
        url,
        vkvideoChannelId: extractVkVideoChannelIdFromUrl(url),
      }))
      .filter((x) => Boolean(x.url));

    return res.json({ items });
  },

  // GET /streamer/bots
  get: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;

    try {
      const rows = await prisma.botIntegrationSettings.findMany({
        where: { channelId },
        select: { provider: true, enabled: true, updatedAt: true },
      });

      const byProvider = new Map<string, { enabled: boolean; updatedAt: string | null }>();
      for (const r of rows) {
        const provider = String(r.provider ?? '').toLowerCase();
        if (!provider) continue;
        byProvider.set(provider, {
          enabled: Boolean(r.enabled),
          updatedAt: r.updatedAt ? r.updatedAt.toISOString() : null,
        });
      }

      // Ensure stable shape with defaults for known providers.
      // Twitch falls back to ChatBotSubscription if no row exists yet.
      const twitch = byProvider.get('twitch') ?? {
        enabled: await getTwitchEnabledFallback(channelId),
        updatedAt: null,
      };
      const vkvideo = byProvider.get('vkvideo') ?? {
        enabled: await getVkVideoEnabledFallback(channelId),
        updatedAt: null,
      };
      const youtube = byProvider.get('youtube') ?? { enabled: false, updatedAt: null };
      return res.json({
        items: [
          { provider: 'twitch', ...twitch },
          { provider: 'vkvideo', ...vkvideo },
          { provider: 'youtube', ...youtube },
        ],
      });
    } catch (error) {
      // Prisma "table does not exist" (feature not deployed / migrations not applied)
      if (isPrismaFeatureUnavailable(error)) {
        return res.status(404).json({ error: 'Not Found', message: 'Feature not available' });
      }
      throw error;
    }
  },

  // PATCH /streamer/bots/:provider  body: { enabled: boolean }
  patch: async (req: AuthRequest, res: Response) => {
    const channelId = requireChannelId(req, res);
    if (!channelId) return;

    const rawProvider = String(req.params.provider ?? '')
      .trim()
      .toLowerCase();
    if (rawProvider === 'vkplaylive') {
      // Deprecated integration: we use vkvideo instead.
      return res.status(410).json({
        error: 'Gone',
        code: 'PROVIDER_DEPRECATED',
        message: 'vkplaylive integration is deprecated. Use vkvideo instead.',
      });
    }
    const provider = normalizeProvider(rawProvider);
    if (!provider) {
      return res.status(400).json({
        errorCode: 'VALIDATION_ERROR',
        error: `provider must be one of: ${PROVIDERS.join(', ')}`,
        details: { provider: rawProvider, allowed: PROVIDERS },
      });
    }

    const body = req.body as BotIntegrationPatchBody;
    const enabled = body.enabled;
    if (typeof enabled !== 'boolean') {
      const contentType = String(req.get('content-type') || '');
      const hint = contentType.toLowerCase().includes('application/json')
        ? null
        : 'Check request headers: Content-Type must be application/json';
      return res.status(400).json({
        errorCode: 'VALIDATION_ERROR',
        error: 'enabled must be boolean',
        details: {
          field: 'enabled',
          receivedType: typeof enabled,
          hint,
        },
      });
    }

    try {
      const customBotEntitled = await hasChannelEntitlement(channelId, 'custom_bot');
      const handler = PATCH_HANDLERS[provider];
      const ctx = { req, channelId, provider, enabled, customBotEntitled, body };
      const prepared = handler ? await handler.prepare(ctx) : { ok: true as const, data: {} };
      if (!prepared.ok) {
        return res.status(prepared.status).json(prepared.body);
      }

      // Persist toggle (idempotent).
      await prisma.botIntegrationSettings.upsert({
        where: { channelId_provider: { channelId, provider } },
        create: { channelId, provider, enabled },
        update: { enabled },
        select: { id: true },
      });

      // Provider-specific side effects.
      if (handler) {
        const applied = await handler.apply(ctx, prepared.data);
        if (!applied.ok) return res.status(applied.status).json(applied.body);
      }

      return res.json({ ok: true });
    } catch (error) {
      // Prisma "table does not exist" (feature not deployed / migrations not applied)
      if (isPrismaFeatureUnavailable(error)) {
        return res.status(404).json({ error: 'Not Found', message: 'Feature not available' });
      }
      throw error;
    }
  },
};
