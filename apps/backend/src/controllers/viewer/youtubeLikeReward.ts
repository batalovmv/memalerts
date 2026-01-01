import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { emitWalletUpdated, relayWalletUpdatedToPeer } from '../../realtime/walletBridge.js';
import { fetchLiveVideoIdByChannelId, getYouTubeExternalAccount, getYouTubeVideoRating, getValidYouTubeAccessToken, getValidYouTubeAccessTokenByExternalAccountId } from '../../utils/youtubeApi.js';

type ClaimStatus =
  | 'disabled'
  | 'need_youtube_link'
  | 'need_relink_scopes'
  | 'not_live'
  | 'cooldown'
  | 'not_liked'
  | 'already_awarded'
  | 'awarded'
  | 'failed';

function hasStrongLikeScope(scopes: string | null | undefined): boolean {
  const set = new Set(
    String(scopes || '')
      .split(/[ ,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
  );
  // videos.getRating is allowed by youtube.force-ssl (recommended) or broader youtube scope.
  return set.has('https://www.googleapis.com/auth/youtube.force-ssl') || set.has('https://www.googleapis.com/auth/youtube');
}

export async function claimYouTubeLikeReward(req: AuthRequest, res: Response) {
  if (!req.userId) return res.status(401).json({ errorCode: 'UNAUTHORIZED', error: 'Unauthorized', requestId: req.requestId });

  const channelSlug = String((req.body as any)?.channelSlug || '').trim().toLowerCase();
  const requestedVideoId = String((req.body as any)?.videoId || '').trim();
  if (!channelSlug) return res.status(400).json({ errorCode: 'BAD_REQUEST', error: 'Bad Request', requestId: req.requestId });

  const channel = await prisma.channel.findUnique({
    where: { slug: channelSlug },
    select: {
      id: true,
      slug: true,
      youtubeLikeRewardEnabled: true as any,
      youtubeLikeRewardCoins: true as any,
      youtubeLikeRewardOnlyWhenLive: true as any,
    },
  });
  if (!channel) return res.status(404).json({ errorCode: 'NOT_FOUND', error: 'Not Found', requestId: req.requestId });

  const enabled = Boolean((channel as any).youtubeLikeRewardEnabled);
  const coinsToGrant = Number((channel as any).youtubeLikeRewardCoins ?? 0);
  const onlyWhenLive = Boolean((channel as any).youtubeLikeRewardOnlyWhenLive);
  if (!enabled || !Number.isFinite(coinsToGrant) || coinsToGrant <= 0) {
    return res.json({ status: 'disabled' as ClaimStatus, channelSlug: channel.slug, videoId: requestedVideoId || null });
  }

  // Viewer must have a usable YouTube external account (NOT a bot_link one).
  const acc = await getYouTubeExternalAccount(req.userId);
  if (!acc?.id) {
    return res.json({ status: 'need_youtube_link' as ClaimStatus, channelSlug: channel.slug, videoId: requestedVideoId || null });
  }
  if (!hasStrongLikeScope(acc.scopes)) {
    return res.json({
      status: 'need_relink_scopes' as ClaimStatus,
      channelSlug: channel.slug,
      videoId: requestedVideoId || null,
      requiredScopes: ['https://www.googleapis.com/auth/youtube.force-ssl'],
      accountScopes: acc.scopes ?? null,
    });
  }

  // Determine videoId: explicit OR resolve current live by the streamer's linked YouTube account (via bot subscription state).
  let videoId = requestedVideoId || null;
  let liveVideoId: string | null = null;

  if (!videoId || onlyWhenLive) {
    try {
      const sub = await (prisma as any).youTubeChatBotSubscription.findUnique({
        where: { channelId: channel.id },
        select: { enabled: true, userId: true, youtubeChannelId: true },
      });
      const streamerUserId = String((sub as any)?.userId || '').trim();
      const youtubeChannelId = String((sub as any)?.youtubeChannelId || '').trim();
      const subEnabled = Boolean((sub as any)?.enabled);
      if (!subEnabled || !streamerUserId || !youtubeChannelId) {
        liveVideoId = null;
      } else {
        const streamerAccessToken = await getValidYouTubeAccessToken(streamerUserId);
        if (!streamerAccessToken) {
          liveVideoId = null;
        } else {
          liveVideoId = await fetchLiveVideoIdByChannelId({ accessToken: streamerAccessToken, youtubeChannelId });
        }
      }
    } catch (e: any) {
      // Feature not deployed / migrations not applied / any lookup error => treat as not live.
      if (e?.code !== 'P2021') logger.warn('youtube_like_reward.live_video_lookup_failed', { requestId: req.requestId, errorMessage: e?.message || String(e) });
      liveVideoId = null;
    }
  }

  if (!videoId) videoId = liveVideoId;
  if (!videoId) return res.json({ status: 'not_live' as ClaimStatus, channelSlug: channel.slug, videoId: null });
  if (onlyWhenLive && (!liveVideoId || videoId !== liveVideoId)) {
    return res.json({ status: 'not_live' as ClaimStatus, channelSlug: channel.slug, videoId: liveVideoId });
  }

  const MIN_CHECK_INTERVAL_MS = 10_000;

  // Ensure claim row exists (idempotent).
  await (prisma as any).youTubeLikeRewardClaim.createMany({
    data: [{ channelId: channel.id, userId: req.userId, videoId }],
    skipDuplicates: true,
  });

  const claim = await (prisma as any).youTubeLikeRewardClaim.findFirst({
    where: { channelId: channel.id, userId: req.userId, videoId },
    select: { id: true, awardedAt: true, lastCheckedAt: true, coinsGranted: true },
  });
  if (!claim?.id) return res.status(503).json({ errorCode: 'SERVICE_UNAVAILABLE', error: 'Service Unavailable', requestId: req.requestId });

  if (claim.awardedAt) {
    return res.json({ status: 'already_awarded' as ClaimStatus, channelSlug: channel.slug, videoId, coinsGranted: claim.coinsGranted ?? coinsToGrant });
  }

  const lastCheckedAtMs = claim.lastCheckedAt ? new Date(claim.lastCheckedAt).getTime() : 0;
  if (lastCheckedAtMs && Date.now() - lastCheckedAtMs < MIN_CHECK_INTERVAL_MS) {
    return res.json({ status: 'cooldown' as ClaimStatus, channelSlug: channel.slug, videoId });
  }

  // Check rating via viewer token (force-ssl).
  let rating: string = 'unspecified';
  try {
    const token = await getValidYouTubeAccessTokenByExternalAccountId(acc.id);
    if (!token) throw new Error('Missing YouTube access token');
    rating = await getYouTubeVideoRating({ accessToken: token, videoId });
  } catch (e: any) {
    const lastError = e?.message || String(e);
    logger.warn('youtube_like_reward.get_rating_failed', { requestId: req.requestId, channelId: channel.id, userId: req.userId, videoId, errorMessage: lastError });
    await (prisma as any).youTubeLikeRewardClaim.updateMany({
      where: { id: claim.id },
      data: { lastCheckedAt: new Date(), lastRating: String(rating || 'unspecified'), lastError },
    });
    return res.json({ status: 'failed' as ClaimStatus, channelSlug: channel.slug, videoId });
  }

  // Update claim with rating (best-effort).
  await (prisma as any).youTubeLikeRewardClaim.updateMany({
    where: { id: claim.id },
    data: { lastCheckedAt: new Date(), lastRating: rating, lastError: null },
  });

  if (rating !== 'like') {
    return res.json({ status: 'not_liked' as ClaimStatus, channelSlug: channel.slug, videoId, rating });
  }

  // Award coins exactly-once.
  const r = await prisma.$transaction(async (tx) => {
    const awarded = await (tx as any).youTubeLikeRewardClaim.updateMany({
      where: { id: claim.id, awardedAt: null },
      data: { awardedAt: new Date(), coinsGranted: coinsToGrant },
    });
    if (!awarded?.count) {
      const row = await (tx as any).youTubeLikeRewardClaim.findUnique({ where: { id: claim.id }, select: { coinsGranted: true } });
      return { ok: false as const, already: true as const, coinsGranted: Number((row as any)?.coinsGranted ?? coinsToGrant) };
    }

    const wallet = await tx.wallet.upsert({
      where: { userId_channelId: { userId: req.userId!, channelId: channel.id } },
      create: { userId: req.userId!, channelId: channel.id, balance: coinsToGrant },
      update: { balance: { increment: coinsToGrant } },
      select: { balance: true },
    });

    return { ok: true as const, already: false as const, balance: Number(wallet.balance ?? 0), coinsGranted: coinsToGrant };
  });

  if (!r.ok) {
    return res.json({ status: 'already_awarded' as ClaimStatus, channelSlug: channel.slug, videoId, coinsGranted: r.coinsGranted });
  }

  // Emit wallet update (best-effort).
  try {
    const io = req.app.get('io');
    const ev = {
      userId: req.userId,
      channelId: channel.id,
      channelSlug: channel.slug,
      balance: r.balance,
      delta: r.coinsGranted,
      reason: 'youtube_like_reward',
    };
    emitWalletUpdated(io, ev as any);
    void relayWalletUpdatedToPeer(ev as any);
  } catch (e: any) {
    logger.warn('youtube_like_reward.wallet_emit_failed', { requestId: req.requestId, errorMessage: e?.message || String(e) });
  }

  return res.json({ status: 'awarded' as ClaimStatus, channelSlug: channel.slug, videoId, coinsGranted: r.coinsGranted, balance: r.balance });
}


