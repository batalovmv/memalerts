import { prisma } from '../../lib/prisma.js';
import { fetchGoogleTokenInfo } from '../../auth/providers/youtube.js';
import {
  fetchMyYouTubeChannelIdDetailed,
  getValidYouTubeBotAccessToken,
  getYouTubeExternalAccount,
} from '../../utils/youtubeApi.js';
import { logger } from '../../utils/logger.js';
import type { FetchMyYouTubeChannelIdDiagnostics } from '../../utils/youtubeApi.js';
import type { GoogleTokenInfo } from '../../auth/providers/youtube.js';
import { isPrismaFeatureUnavailable } from './botIntegrationsShared.js';
import type { BotPatchApplyResult, BotPatchContext, BotPatchResult } from './botSettingsPatchTypes.js';

export async function prepareYouTubePatch(ctx: BotPatchContext): Promise<BotPatchResult> {
  if (!ctx.enabled) return { ok: true, data: {} };
  if (!ctx.req.userId) return { ok: false, status: 401, body: { error: 'Unauthorized' } };

  // Diagnostics to quickly detect "needs relink" cases (missing refresh token / missing scopes).
  const acc = await getYouTubeExternalAccount(ctx.req.userId);
  logger.info('streamer.bots.youtube.enable_attempt', {
    requestId: ctx.req.requestId,
    channelId: ctx.channelId,
    userId: ctx.req.userId,
    hasExternalAccount: !!acc,
    hasRefreshToken: Boolean(acc?.refreshToken),
    hasAccessToken: Boolean(acc?.accessToken),
    tokenExpiresAt: acc?.tokenExpiresAt ? new Date(acc.tokenExpiresAt).toISOString() : null,
    scopes: acc?.scopes || null,
  });

  const diag: FetchMyYouTubeChannelIdDiagnostics = await fetchMyYouTubeChannelIdDetailed(ctx.req.userId);
  const youtubeChannelId = diag.channelId;
  if (!youtubeChannelId) {
    // Best-effort tokeninfo to see actual scopes on the current access token.
    // This helps distinguish "missing scopes" from "token revoked/expired".
    let tokenInfo: GoogleTokenInfo | null = null;
    if (acc?.accessToken) {
      tokenInfo = await fetchGoogleTokenInfo({ accessToken: acc.accessToken });
    }
    logger.warn('streamer.bots.youtube.enable_failed', {
      requestId: ctx.req.requestId,
      channelId: ctx.channelId,
      userId: ctx.req.userId,
      reason: diag.reason || 'failed_to_resolve_channel_id',
      httpStatus: diag.httpStatus,
      googleError: diag.googleError,
      googleErrorDescription: diag.googleErrorDescription,
      youtubeErrorReason: diag.youtubeErrorReason,
      youtubeErrorMessage: diag.youtubeErrorMessage,
      requiredScopesMissing: diag.requiredScopesMissing,
      accountScopes: diag.accountScopes,
      tokeninfoScopes: tokenInfo?.scope ?? null,
      tokeninfoHasSub: Boolean(tokenInfo?.sub || tokenInfo?.user_id),
      tokeninfoError: tokenInfo?.error ?? null,
      tokeninfoErrorDescription: tokenInfo?.error_description ?? null,
    });
    const reason = diag.reason || 'failed_to_resolve_channel_id';
    const msgByReason: Record<string, string> = {
      missing_scopes:
        'YouTube is linked without required permissions. Please re-link YouTube and grant the requested access.',
      missing_refresh_token:
        'YouTube link is missing refresh token. Please re-link YouTube and confirm the consent screen (offline access).',
      invalid_grant: 'YouTube refresh token was revoked/invalid. Please re-link YouTube.',
      api_insufficient_permissions:
        'YouTube API rejected the token due to insufficient permissions. Please re-link YouTube and grant the requested access.',
      api_unauthorized: 'YouTube token is not authorized. Please re-link YouTube.',
    };

    const relinkReasons = new Set([
      'missing_scopes',
      'missing_refresh_token',
      'invalid_grant',
      'api_insufficient_permissions',
      'api_unauthorized',
    ]);

    if (relinkReasons.has(reason)) {
      return {
        ok: false,
        status: 412,
        body: {
          errorCode: 'YOUTUBE_RELINK_REQUIRED',
          error:
            msgByReason[reason] ||
            'Failed to resolve YouTube channelId. Please re-link YouTube with required scopes and try again.',
          details: {
            needsRelink: true,
            reason,
            requiredScopesMissing: diag.requiredScopesMissing,
          },
        },
      };
    }

    if (reason === 'api_youtube_signup_required') {
      return {
        ok: false,
        status: 409,
        body: {
          errorCode: 'YOUTUBE_CHANNEL_REQUIRED',
          error: 'Your Google account has no YouTube channel. Please create/activate a YouTube channel and try again.',
          details: {
            reason,
            // Helps support/debugging when multiple YouTube accounts are linked.
            externalAccountId: acc?.id ?? null,
          },
        },
      };
    }

    if (reason === 'api_access_not_configured') {
      return {
        ok: false,
        status: 503,
        body: {
          errorCode: 'YOUTUBE_API_NOT_CONFIGURED',
          error: 'YouTube Data API is not configured for this application. Please contact support.',
          details: { reason },
        },
      };
    }

    if (reason === 'api_quota') {
      return {
        ok: false,
        status: 503,
        body: {
          errorCode: 'YOUTUBE_API_QUOTA',
          error: 'YouTube API quota exceeded. Please try again later.',
          details: { reason },
        },
      };
    }

    return {
      ok: false,
      status: 400,
      body: {
        errorCode: 'YOUTUBE_ENABLE_FAILED',
        error: 'Failed to enable YouTube bot. Please try again or contact support.',
        details: {
          reason,
          httpStatus: diag.httpStatus,
          youtubeErrorReason: diag.youtubeErrorReason,
          youtubeErrorMessage: diag.youtubeErrorMessage,
          googleError: diag.googleError,
          googleErrorDescription: diag.googleErrorDescription,
          requiredScopesMissing: diag.requiredScopesMissing,
        },
      },
    };
  }

  // Ensure we have SOME sender identity configured for chat writes:
  // - either global shared bot (DB credential or ENV YOUTUBE_BOT_REFRESH_TOKEN)
  // - or per-channel bot override (YouTubeBotIntegration row)
  const botAccessToken = await getValidYouTubeBotAccessToken();
  let hasOverride = false;
  try {
    const override = await prisma.youTubeBotIntegration.findUnique({
      where: { channelId: ctx.channelId },
      select: { enabled: true },
    });
    hasOverride = Boolean(override?.enabled);
  } catch (error) {
    if (!isPrismaFeatureUnavailable(error)) throw error;
    hasOverride = false;
  }
  if (hasOverride && !ctx.customBotEntitled) hasOverride = false;

  if (!botAccessToken && !hasOverride) {
    return {
      ok: false,
      status: 503,
      body: {
        errorCode: 'YOUTUBE_BOT_NOT_CONFIGURED',
        error: 'YouTube bot is not configured (missing global bot credential/token and no per-channel bot override).',
      },
    };
  }

  return { ok: true, data: { youtubeChannelId } };
}

export async function applyYouTubePatch(
  ctx: BotPatchContext,
  data: { youtubeChannelId?: string | null }
): Promise<BotPatchApplyResult> {
  if (ctx.enabled) {
    if (!ctx.req.userId) return { ok: false, status: 401, body: { error: 'Unauthorized' } };
    if (!data.youtubeChannelId) {
      // Defensive: should not happen because precondition handles it.
      return {
        ok: false,
        status: 412,
        body: {
          errorCode: 'YOUTUBE_RELINK_REQUIRED',
          error: 'Failed to resolve YouTube channelId. Please re-link YouTube and try again.',
          details: { needsRelink: true },
        },
      };
    }
    await prisma.youTubeChatBotSubscription.upsert({
      where: { channelId: ctx.channelId },
      create: {
        channelId: ctx.channelId,
        userId: ctx.req.userId,
        youtubeChannelId: data.youtubeChannelId,
        enabled: true,
      },
      update: { userId: ctx.req.userId, youtubeChannelId: data.youtubeChannelId, enabled: true },
      select: { id: true },
    });
    return { ok: true };
  }

  // Best-effort disable: if subscription exists, mark it disabled.
  await prisma.youTubeChatBotSubscription.updateMany({
    where: { channelId: ctx.channelId },
    data: { enabled: false },
  });
  return { ok: true };
}
