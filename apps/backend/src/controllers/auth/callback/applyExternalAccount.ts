import type { ExternalAccountProvider, OAuthStateKind, Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import { hasChannelEntitlement } from '../../../utils/entitlements.js';
import {
  fetchMyYouTubeChannelIdByAccessToken,
  fetchMyYouTubeChannelProfileByAccessToken,
  fetchYouTubeChannelProfilePublicByChannelId,
} from '../../../utils/youtubeApi.js';
import { claimPendingCoinGrantsTx } from '../../../rewards/pendingCoinGrants.js';
import { logger } from '../../../utils/logger.js';
import { getErrorMessage } from '../utils.js';
import type { WalletUpdatedEvent } from '../../../realtime/walletBridge.js';
import { ECONOMY_CONSTANTS, grantAccountLinkBonusTx } from '../../../services/economy/economyService.js';

type AuthenticatedUserWithRelations = NonNullable<Awaited<ReturnType<typeof prisma.user.findUnique>>>;

type ApplyExternalAccountParams = {
  provider: ExternalAccountProvider;
  providerAccountId: string;
  user: AuthenticatedUserWithRelations;
  stateKind: OAuthStateKind;
  statePreview?: string;
  stateChannelId?: string;
  displayName: string | null;
  login: string | null;
  avatarUrl: string | null;
  profileUrl: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  scopes: string | null;
  requestId?: string;
};

type ApplyExternalAccountResult = {
  botLinkSubscriptionDenied: boolean;
  botLinkSubscriptionDeniedProvider: string | null;
  claimedWalletEvents: WalletUpdatedEvent[];
};

function resolveLinkBonusChannelId(user: AuthenticatedUserWithRelations): string | null {
  const direct = String(user.channelId || '').trim();
  if (direct) return direct;

  const wallets = Array.isArray((user as { wallets?: unknown }).wallets)
    ? ((user as { wallets: Array<{ channelId: string; updatedAt?: Date }> }).wallets || [])
    : [];
  if (wallets.length === 0) return null;

  const sorted = [...wallets].sort((a, b) => {
    const aTime = a.updatedAt instanceof Date ? a.updatedAt.getTime() : 0;
    const bTime = b.updatedAt instanceof Date ? b.updatedAt.getTime() : 0;
    return bTime - aTime;
  });
  const top = sorted[0];
  return top?.channelId ? String(top.channelId) : null;
}

export async function applyExternalAccount(params: ApplyExternalAccountParams): Promise<ApplyExternalAccountResult> {
  const botLinkChannelId = params.stateKind === 'bot_link' ? String(params.stateChannelId || '').trim() : '';
  const isBotLinkProvider =
    params.stateKind === 'bot_link' &&
    (params.provider === 'youtube' ||
      params.provider === 'vkvideo' ||
      params.provider === 'twitch');

  let botLinkSubscriptionDenied = false;
  let botLinkSubscriptionDeniedProvider: string | null = null;
  let allowPerChannelBotOverride = true;
  const claimedWalletEvents: WalletUpdatedEvent[] = [];

  if (isBotLinkProvider && botLinkChannelId) {
    const isGlobalSentinel =
      (params.provider === 'youtube' && botLinkChannelId === '__global_youtube_bot__') ||
      (params.provider === 'vkvideo' && botLinkChannelId === '__global_vkvideo_bot__') ||
      (params.provider === 'twitch' && botLinkChannelId === '__global_twitch_bot__');

    if (!isGlobalSentinel) {
      allowPerChannelBotOverride = await hasChannelEntitlement(botLinkChannelId, 'custom_bot');
      if (!allowPerChannelBotOverride) {
        botLinkSubscriptionDenied = true;
        botLinkSubscriptionDeniedProvider = params.provider;
        logger.info('entitlement.denied', {
          channelId: botLinkChannelId,
          provider: params.provider,
          action: 'bot_link_apply',
          requestId: params.requestId || null,
        });
      }
    }
  }

  await prisma.$transaction(async (tx) => {
    const externalUpdate: Prisma.ExternalAccountUpdateInput = {
      user: { connect: { id: params.user.id } },
      accessToken: params.accessToken,
      tokenExpiresAt: params.tokenExpiresAt,
      scopes: params.scopes,
    };
    if (params.displayName) externalUpdate.displayName = params.displayName;
    if (params.login) externalUpdate.login = params.login;
    if (params.avatarUrl) externalUpdate.avatarUrl = params.avatarUrl;
    if (params.profileUrl) externalUpdate.profileUrl = params.profileUrl;
    if (params.refreshToken) externalUpdate.refreshToken = params.refreshToken;

    const upserted = await tx.externalAccount.upsert({
      where: { provider_providerAccountId: { provider: params.provider, providerAccountId: params.providerAccountId } },
      create: {
        userId: params.user.id,
        provider: params.provider,
        providerAccountId: params.providerAccountId,
        displayName: params.displayName,
        login: params.login,
        avatarUrl: params.avatarUrl,
        profileUrl: params.profileUrl,
        accessToken: params.accessToken,
        refreshToken: params.refreshToken,
        tokenExpiresAt: params.tokenExpiresAt,
        scopes: params.scopes,
      },
      update: externalUpdate,
      select: { id: true },
    });

    if (params.provider === 'youtube' && params.accessToken) {
      try {
        const profile = await fetchMyYouTubeChannelProfileByAccessToken(params.accessToken);
        const channelId = profile?.channelId || (await fetchMyYouTubeChannelIdByAccessToken(params.accessToken));
        if (channelId) {
          const data: Prisma.ExternalAccountUpdateInput = {
            login: channelId,
            profileUrl: `https://www.youtube.com/channel/${channelId}`,
          };
          if (profile?.title) data.displayName = profile.title;
          if (profile?.avatarUrl) data.avatarUrl = profile.avatarUrl;
          if (!data.displayName || !data.avatarUrl) {
            const publicProfile = await fetchYouTubeChannelProfilePublicByChannelId(channelId);
            if (!data.displayName && publicProfile?.title) data.displayName = publicProfile.title;
            if (!data.avatarUrl && publicProfile?.avatarUrl) data.avatarUrl = publicProfile.avatarUrl;
          }

          await tx.externalAccount.update({ where: { id: upserted.id }, data });
        }
      } catch {
        // ignore
      }
    }

    if (params.provider === 'twitch' && params.stateKind === 'login') {
      if (params.user.twitchUserId && params.user.twitchUserId !== params.providerAccountId) {
        logger.error('oauth.twitch.login.user_mismatch_guard', {
          requestId: params.requestId,
          state: params.statePreview,
          twitchUserId: params.providerAccountId,
          userId: params.user.id,
          userTwitchUserId: params.user.twitchUserId,
        });
        throw new Error('twitch_user_mismatch');
      }

      await tx.user.update({
        where: { id: params.user.id },
        data: {
          twitchUserId: params.providerAccountId,
          displayName: params.displayName || params.user.displayName,
          profileImageUrl: params.avatarUrl || null,
          twitchAccessToken: params.accessToken,
          twitchRefreshToken: params.refreshToken,
        },
      });
    }

    if (
      (params.provider === 'youtube' || params.provider === 'vkvideo' || params.provider === 'twitch') &&
      params.stateKind === 'bot_link'
    ) {
      const channelId = String(params.stateChannelId || '').trim();
      if (!channelId) {
        throw new Error('missing_bot_link_channel');
      }

      if (params.provider === 'youtube') {
        if (channelId === '__global_youtube_bot__') {
          await tx.globalYouTubeBotCredential.deleteMany({});
          await tx.globalYouTubeBotCredential.create({
            data: { externalAccountId: upserted.id, enabled: true },
            select: { id: true },
          });
        } else if (allowPerChannelBotOverride) {
          await tx.youTubeBotIntegration.upsert({
            where: { channelId },
            create: { channelId, externalAccountId: upserted.id, enabled: true },
            update: { externalAccountId: upserted.id, enabled: true },
            select: { id: true },
          });
        }
      }

      if (params.provider === 'vkvideo') {
        if (channelId === '__global_vkvideo_bot__') {
          await tx.globalVkVideoBotCredential.deleteMany({});
          await tx.globalVkVideoBotCredential.create({
            data: { externalAccountId: upserted.id, enabled: true },
            select: { id: true },
          });
        } else if (allowPerChannelBotOverride) {
          await tx.vkVideoBotIntegration.upsert({
            where: { channelId },
            create: { channelId, externalAccountId: upserted.id, enabled: true },
            update: { externalAccountId: upserted.id, enabled: true },
            select: { id: true },
          });
        }
      }

      if (params.provider === 'twitch') {
        if (channelId === '__global_twitch_bot__') {
          await tx.globalTwitchBotCredential.deleteMany({});
          await tx.globalTwitchBotCredential.create({
            data: { externalAccountId: upserted.id, enabled: true },
            select: { id: true },
          });
        } else if (allowPerChannelBotOverride) {
          await tx.twitchBotIntegration.upsert({
            where: { channelId },
            create: { channelId, externalAccountId: upserted.id, enabled: true },
            update: { externalAccountId: upserted.id, enabled: true },
            select: { id: true },
          });
        }
      }

    }

    if (
      params.stateKind === 'link' &&
      (params.provider === 'youtube' || params.provider === 'vkvideo')
    ) {
      try {
        const channelId = resolveLinkBonusChannelId(params.user);
        if (channelId) {
          const bonus = await grantAccountLinkBonusTx({
            tx,
            userId: params.user.id,
            channelId,
            provider: params.provider,
            bonusCoins: ECONOMY_CONSTANTS.accountLinkBonusCoins,
          });
          if (bonus.granted && typeof bonus.balance === 'number') {
            const channel = await tx.channel.findUnique({
              where: { id: channelId },
              select: { slug: true },
            });
            claimedWalletEvents.push({
              userId: params.user.id,
              channelId,
              balance: bonus.balance,
              delta: ECONOMY_CONSTANTS.accountLinkBonusCoins,
              reason: 'account_link_bonus',
              channelSlug: channel?.slug ?? undefined,
            });
          }
        }
      } catch (error: unknown) {
        logger.warn('account_link_bonus.failed', {
          provider: params.provider,
          errorMessage: getErrorMessage(error),
        });
      }
    }

    if (
      params.stateKind !== 'bot_link' &&
      (params.provider === 'vkvideo' || params.provider === 'twitch')
    ) {
      try {
        const events = await claimPendingCoinGrantsTx({
          tx: tx,
          userId: params.user.id,
          provider: params.provider,
          providerAccountId: params.providerAccountId,
        });
        if (events.length) claimedWalletEvents.push(...events);
      } catch (error: unknown) {
        logger.warn('external_rewards.claim_failed', {
          provider: params.provider,
          errorMessage: getErrorMessage(error),
        });
      }
    }
  });

  return {
    botLinkSubscriptionDenied,
    botLinkSubscriptionDeniedProvider,
    claimedWalletEvents,
  };
}
