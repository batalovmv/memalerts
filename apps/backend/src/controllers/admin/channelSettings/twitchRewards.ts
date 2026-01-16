import type { AuthRequest } from '../../../middleware/auth.js';
import type { Channel } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import {
  createChannelReward,
  createEventSubSubscription,
  deleteChannelReward,
  deleteEventSubSubscription,
  getAuthenticatedTwitchUser,
  getChannelInformation,
  getChannelRewards,
  getEventSubSubscriptions,
  updateChannelReward,
} from '../../../utils/twitchApi.js';
import { isBetaBackend } from '../../../utils/envMode.js';
import { logger } from '../../../utils/logger.js';
import { asRecord, getErrorMessage, type UpdateChannelSettingsBody } from './shared.js';

type TwitchRewardResult = {
  rewardIdForCoinsOverride: string | null;
  coinIconUrl: string | null;
};

function getRewardIconUrl(
  reward: { image?: { url_1x?: string; url_2x?: string; url_4x?: string } | null } | null | undefined
): string | null {
  const img = reward?.image;
  return img?.url_1x || img?.url_2x || img?.url_4x || null;
}

export async function handleTwitchRewardSettings(params: {
  req: AuthRequest;
  userId: string;
  channelId: string;
  channel: Channel;
  body: UpdateChannelSettingsBody;
  bodyRec: Record<string, unknown>;
}): Promise<TwitchRewardResult> {
  const { req, userId, channelId, channel, body, bodyRec } = params;
  const channelRec = asRecord(channel);
  const channelRewardIdForCoins = typeof channelRec.rewardIdForCoins === 'string' ? channelRec.rewardIdForCoins : null;
  let rewardIdForCoinsOverride = typeof bodyRec.rewardIdForCoins === 'string' ? bodyRec.rewardIdForCoins : null;

  let coinIconUrl: string | null = null;
  const currentRewardEnabled = Boolean(channelRec.rewardEnabled);
  const rewardEnabledProvided = body.rewardEnabled !== undefined;
  const wantsRewardEnabled = rewardEnabledProvided ? !!body.rewardEnabled : currentRewardEnabled;
  const isRewardToggle = rewardEnabledProvided && wantsRewardEnabled !== currentRewardEnabled;
  const hasRewardUpdateFields =
    body.rewardIdForCoins !== undefined ||
    body.rewardTitle !== undefined ||
    body.rewardCost !== undefined ||
    body.rewardCoins !== undefined;

  if ((isRewardToggle && wantsRewardEnabled) || (!isRewardToggle && wantsRewardEnabled && hasRewardUpdateFields)) {
    const broadcasterId = channel.twitchChannelId;
    if (!broadcasterId) {
      throw Object.assign(new Error('This channel is not linked to Twitch.'), {
        status: 400,
        errorCode: 'TWITCH_CHANNEL_NOT_LINKED',
      });
    }

    if (isRewardToggle && wantsRewardEnabled) {
      if (!body.rewardCost || !body.rewardCoins) {
        throw Object.assign(new Error('Reward cost and coins are required when enabling reward'), {
          status: 400,
          errorCode: 'REWARD_COST_COINS_REQUIRED',
        });
      }

      const userWithToken = await prisma.user.findUnique({
        where: { id: userId },
        select: { twitchAccessToken: true, twitchRefreshToken: true },
      });

      if (!userWithToken || !userWithToken.twitchAccessToken) {
        throw Object.assign(
          new Error('Twitch access token not found. Please log out and log in again to refresh your authorization.'),
          { status: 401, requiresReauth: true }
        );
      }

      try {
        const who = await getAuthenticatedTwitchUser(userId);
        const tokenTwitchUserId = who?.id || null;
        if (tokenTwitchUserId && tokenTwitchUserId !== String(broadcasterId)) {
          throw Object.assign(
            new Error('Twitch account mismatch. Please log in as the channel owner to manage rewards.'),
            {
              status: 403,
              errorCode: 'TWITCH_ACCOUNT_MISMATCH',
              requiresReauth: true,
            }
          );
        }
      } catch (e: unknown) {
        logger.warn('twitch.identity_check.failed', {
          requestId: req.requestId,
          userId,
          channelId,
          errorMessage: getErrorMessage(e),
        });
      }

      try {
        const info = await getChannelInformation(userId, broadcasterId);
        const btRaw = info?.broadcaster_type;
        if (btRaw === null || btRaw === undefined) {
          logger.warn('twitch.eligibility.unknown', {
            requestId: req.requestId,
            userId,
            channelId,
            broadcasterId,
            tokenMode: info?._meta?.tokenMode,
            itemKeys: info?._meta?.itemKeys,
            rawBroadcasterType: info?._meta?.rawBroadcasterType,
          });
          if (!isBetaBackend()) {
            throw Object.assign(
              new Error('Unable to verify Twitch eligibility at the moment. Please try again later.'),
              {
                status: 502,
                errorCode: 'TWITCH_ELIGIBILITY_UNKNOWN',
              }
            );
          }
        }

        const bt = String(btRaw).toLowerCase();
        const eligible = bt === 'affiliate' || bt === 'partner';
        if (!eligible) {
          throw Object.assign(new Error('The broadcaster does not have partner or affiliate status.'), {
            status: 403,
            errorCode: 'TWITCH_REWARD_NOT_AVAILABLE',
          });
        }
      } catch (e: unknown) {
        logger.error('twitch.eligibility.check_failed', {
          requestId: req.requestId,
          userId,
          channelId,
          broadcasterId,
          errorMessage: getErrorMessage(e),
        });
        const message = getErrorMessage(e);
        throw Object.assign(new Error(message || 'Failed to check Twitch channel eligibility'), {
          status: 502,
          errorCode: 'TWITCH_ELIGIBILITY_CHECK_FAILED',
        });
      }

      let existingRewardId: string | null = null;
      let oldRewardsToDelete: string[] = [];
      try {
        const rewards = await getChannelRewards(userId, broadcasterId);

        const rewardsData = Array.isArray(rewards?.data) ? rewards.data : [];
        if (rewardsData.length) {
          if (channelRewardIdForCoins) {
            const storedReward = rewardsData.find((r) => r.id === channelRewardIdForCoins);
            if (storedReward) {
              existingRewardId = channelRewardIdForCoins;
            }
          }

          if (!existingRewardId) {
            const matchingReward = rewardsData.find(
              (r) => r.title?.includes('Coins') || r.title?.includes('монет') || r.title?.includes('тест')
            );
            if (matchingReward) {
              existingRewardId = matchingReward.id ?? null;
            }
          }

          oldRewardsToDelete = rewardsData
            .filter(
              (r) =>
                r.id !== existingRewardId &&
                (r.title?.includes('Coins') || r.title?.includes('Get') || r.title?.includes('монет'))
            )
            .map((r) => r.id)
            .filter((id): id is string => Boolean(id));
        }
      } catch (error: unknown) {
        logger.warn('twitch.rewards.fetch_failed', {
          requestId: req.requestId,
          userId,
          channelId,
          broadcasterId,
          errorMessage: getErrorMessage(error),
        });
      }

      for (const oldRewardId of oldRewardsToDelete) {
        try {
          await deleteChannelReward(userId, broadcasterId, oldRewardId);
        } catch (error: unknown) {
          logger.warn('twitch.rewards.delete_old_failed', {
            requestId: req.requestId,
            userId,
            channelId,
            broadcasterId,
            rewardId: oldRewardId,
            errorMessage: getErrorMessage(error),
          });
        }
      }

      if (existingRewardId) {
        try {
          await updateChannelReward(userId, broadcasterId, existingRewardId, {
            title: body.rewardTitle || `Get ${body.rewardCoins} Coins`,
            cost: body.rewardCost,
            is_enabled: true,
            prompt: `Redeem ${body.rewardCost} channel points to get ${body.rewardCoins} coins!`,
          });
          rewardIdForCoinsOverride = existingRewardId;

          try {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            const rewardDetails = await getChannelRewards(userId, broadcasterId, existingRewardId);
            coinIconUrl = getRewardIconUrl(rewardDetails.data?.[0]) ?? coinIconUrl;
          } catch (error: unknown) {
            logger.warn('twitch.rewards.fetch_icon_failed', {
              requestId: req.requestId,
              userId,
              channelId,
              broadcasterId,
              rewardId: existingRewardId,
              errorMessage: getErrorMessage(error),
            });
          }
        } catch (error: unknown) {
          logger.warn('twitch.rewards.update_failed', {
            requestId: req.requestId,
            userId,
            channelId,
            broadcasterId,
            rewardId: existingRewardId,
            errorMessage: getErrorMessage(error),
          });
          const rewardResponse = await createChannelReward(
            userId,
            broadcasterId,
            body.rewardTitle || `Get ${body.rewardCoins} Coins`,
            body.rewardCost,
            `Redeem ${body.rewardCost} channel points to get ${body.rewardCoins} coins!`
          );
          const createdReward = rewardResponse.data?.[0] ?? null;
          rewardIdForCoinsOverride = createdReward?.id ?? null;
          coinIconUrl = getRewardIconUrl(createdReward);

          if (!coinIconUrl) {
            try {
              await new Promise((resolve) => setTimeout(resolve, 1000));
              const rewardDetails = await getChannelRewards(
                userId,
                broadcasterId,
                rewardIdForCoinsOverride ?? undefined
              );
              coinIconUrl = getRewardIconUrl(rewardDetails.data?.[0]) ?? coinIconUrl;
            } catch (error: unknown) {
              logger.warn('twitch.rewards.fetch_icon_failed', {
                requestId: req.requestId,
                userId,
                channelId,
                broadcasterId,
                rewardId: rewardIdForCoinsOverride,
                errorMessage: getErrorMessage(error),
              });
            }
          }
        }
      } else {
        const rewardResponse = await createChannelReward(
          userId,
          broadcasterId,
          body.rewardTitle || `Get ${body.rewardCoins} Coins`,
          body.rewardCost,
          `Redeem ${body.rewardCost} channel points to get ${body.rewardCoins} coins!`
        );
        const createdReward = rewardResponse.data?.[0] ?? null;
        rewardIdForCoinsOverride = createdReward?.id ?? null;
        coinIconUrl = getRewardIconUrl(createdReward);

        if (!coinIconUrl) {
          try {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            const rewardDetails = await getChannelRewards(userId, broadcasterId, rewardIdForCoinsOverride ?? undefined);
            coinIconUrl = getRewardIconUrl(rewardDetails.data?.[0]) ?? coinIconUrl;
          } catch (error: unknown) {
            logger.warn('twitch.rewards.fetch_icon_failed', {
              requestId: req.requestId,
              userId,
              channelId,
              broadcasterId,
              rewardId: rewardIdForCoinsOverride,
              errorMessage: getErrorMessage(error),
            });
          }
        }
      }

      try {
        const domain = process.env.DOMAIN || 'twitchmemes.ru';
        const reqHost = req.get('host') || '';
        const allowedHosts = new Set([domain, `www.${domain}`, `beta.${domain}`]);
        const apiBaseUrl = allowedHosts.has(reqHost) ? `https://${reqHost}` : `https://${domain}`;
        const webhookUrl = `${apiBaseUrl}/webhooks/twitch/eventsub`;

        try {
          const existingSubs = await getEventSubSubscriptions(broadcasterId);

          const subsData = Array.isArray(existingSubs?.data) ? existingSubs.data : [];
          const relevantSubs = subsData
            .map((sub) => asRecord(sub))
            .filter(
              (sub) =>
                sub.type === 'channel.channel_points_custom_reward_redemption.add' &&
                (sub.status === 'enabled' || sub.status === 'webhook_callback_verification_pending')
            );

          const hasActiveSubscription = relevantSubs.some((sub) => asRecord(sub.transport).callback === webhookUrl);

          if (!hasActiveSubscription) {
            const mismatchedSubs = relevantSubs.filter((s) => asRecord(s.transport).callback !== webhookUrl);
            if (mismatchedSubs.length > 0) {
              logger.warn('admin.channel_settings.eventsub_callback_mismatch', {
                desiredWebhookUrl: webhookUrl,
                existingCallbacks: mismatchedSubs.map((s) => ({
                  id: s.id,
                  status: s.status,
                  callback: asRecord(s.transport).callback,
                })),
              });
              for (const sub of mismatchedSubs) {
                const subId = typeof sub.id === 'string' ? sub.id : '';
                if (!subId) continue;
                try {
                  await deleteEventSubSubscription(subId);
                  logger.info('admin.channel_settings.eventsub_deleted', {
                    id: subId,
                    callback: asRecord(sub.transport).callback,
                  });
                } catch (deleteErr: unknown) {
                  logger.error('admin.channel_settings.eventsub_delete_failed', {
                    id: subId,
                    error: getErrorMessage(deleteErr),
                  });
                }
              }
            }
            try {
              await createEventSubSubscription(userId, broadcasterId, webhookUrl, process.env.TWITCH_EVENTSUB_SECRET!);
            } catch (createErr: unknown) {
              const errRec = asRecord(createErr);
              if (errRec.status === 409) {
                logger.warn('admin.channel_settings.eventsub_create_conflict', {
                  desiredWebhookUrl: webhookUrl,
                  error: getErrorMessage(createErr),
                });
                for (const sub of relevantSubs) {
                  const subId = typeof sub.id === 'string' ? sub.id : '';
                  if (!subId) continue;
                  try {
                    await deleteEventSubSubscription(subId);
                  } catch (deleteErr: unknown) {
                    logger.error('admin.channel_settings.eventsub_cleanup_delete_failed', {
                      id: subId,
                      error: getErrorMessage(deleteErr),
                    });
                  }
                }
                await createEventSubSubscription(
                  userId,
                  broadcasterId,
                  webhookUrl,
                  process.env.TWITCH_EVENTSUB_SECRET!
                );
              } else {
                throw createErr;
              }
            }
          }
        } catch (checkError: unknown) {
          logger.error('admin.channel_settings.eventsub_check_failed', { errorMessage: getErrorMessage(checkError) });
          await createEventSubSubscription(userId, broadcasterId, webhookUrl, process.env.TWITCH_EVENTSUB_SECRET!);
        }
      } catch (error: unknown) {
        logger.error('admin.channel_settings.eventsub_create_failed', { errorMessage: getErrorMessage(error) });
      }
    }

    if (!isRewardToggle && wantsRewardEnabled && hasRewardUpdateFields) {
      const rewardId = rewardIdForCoinsOverride ?? channelRewardIdForCoins;
      const cost = body.rewardCost ?? (channelRec.rewardCost as number | null | undefined) ?? null;
      const coins = body.rewardCoins ?? (channelRec.rewardCoins as number | null | undefined) ?? null;
      const title = body.rewardTitle ?? (channelRec.rewardTitle as string | null | undefined) ?? null;

      if (rewardId && cost && coins) {
        try {
          await updateChannelReward(userId, broadcasterId, rewardId, {
            title: title || `Get ${coins} Coins`,
            cost,
            is_enabled: true,
            prompt: `Redeem ${cost} channel points to get ${coins} coins!`,
          });
        } catch (error: unknown) {
          logger.warn('twitch.rewards.light_update_failed', {
            requestId: req.requestId,
            userId,
            channelId,
            broadcasterId,
            rewardId,
            errorMessage: getErrorMessage(error),
          });
        }
      }
    }
  } else if (isRewardToggle && !wantsRewardEnabled) {
    const broadcasterId = channel.twitchChannelId;
    if (broadcasterId && channelRewardIdForCoins) {
      try {
        await updateChannelReward(userId, broadcasterId, channelRewardIdForCoins, {
          is_enabled: false,
        });
      } catch (error: unknown) {
        logger.error('admin.channel_settings.reward_disable_failed', { errorMessage: getErrorMessage(error) });
      }
    }
  }

  return { rewardIdForCoinsOverride, coinIconUrl };
}
