import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import type { Server } from 'socket.io';
import { prisma } from '../../lib/prisma.js';
import { updateChannelSettingsSchema } from '../../shared/index.js';
import { ZodError } from 'zod';
import {
  createChannelReward,
  updateChannelReward,
  deleteChannelReward,
  getChannelInformation,
  getChannelRewards,
  getAuthenticatedTwitchUser,
  createEventSubSubscription,
  getEventSubSubscriptions,
  deleteEventSubSubscription,
} from '../../utils/twitchApi.js';
import { logger } from '../../utils/logger.js';
import { isBetaBackend } from '../../utils/envMode.js';
import { normalizeDashboardCardOrder } from '../../utils/dashboardCardOrder.js';
import { channelMetaCache } from '../viewer/cache.js';
import { nsKey, redisDel } from '../../utils/redisCache.js';

export const updateChannelSettings = async (req: AuthRequest, res: Response) => {
  const channelId = req.channelId;
  const userId = req.userId;

  if (!channelId || !userId) {
    return res.status(400).json({ error: 'Channel ID and User ID required' });
  }

  try {
    const body = updateChannelSettingsSchema.parse(req.body);

    // Get channel and user info
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
    });

    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    // Handle reward enable/disable
    let coinIconUrl: string | null = null;
    const currentRewardEnabled = !!(channel as any).rewardEnabled;
    const rewardEnabledProvided = body.rewardEnabled !== undefined;
    const wantsRewardEnabled = rewardEnabledProvided ? !!body.rewardEnabled : currentRewardEnabled;
    const isRewardToggle = rewardEnabledProvided && wantsRewardEnabled !== currentRewardEnabled;
    const hasRewardUpdateFields =
      body.rewardIdForCoins !== undefined ||
      body.rewardTitle !== undefined ||
      body.rewardCost !== undefined ||
      body.rewardCoins !== undefined;

    // Perf: the Twitch reward enable flow is expensive (eligibility checks + reward discovery + EventSub).
    // Only run it when rewardEnabled actually changes (false -> true). For normal edits (title/cost/coins),
    // do a lightweight update against the already known rewardId.
    if ((isRewardToggle && wantsRewardEnabled) || (!isRewardToggle && wantsRewardEnabled && hasRewardUpdateFields)) {
      // Twitch-only: rewards/EventSub require a Twitch-linked channel.
      const broadcasterId = channel.twitchChannelId;
      if (!broadcasterId) {
        return res.status(400).json({
          error: 'This channel is not linked to Twitch.',
          errorCode: 'TWITCH_CHANNEL_NOT_LINKED',
        });
      }

      if (isRewardToggle && wantsRewardEnabled) {
        // Enable reward - create or update in Twitch
        if (!body.rewardCost || !body.rewardCoins) {
          return res.status(400).json({
            error: 'Reward cost and coins are required when enabling reward',
            errorCode: 'REWARD_COST_COINS_REQUIRED',
          });
        }

        // Check if user has access token
        const userWithToken = await prisma.user.findUnique({
          where: { id: userId },
          select: { twitchAccessToken: true, twitchRefreshToken: true },
        });

        if (!userWithToken || !userWithToken.twitchAccessToken) {
          return res.status(401).json({
            error: 'Twitch access token not found. Please log out and log in again to refresh your authorization.',
            requiresReauth: true,
          });
        }

        // Ensure the logged-in Twitch account matches the broadcaster we are trying to manage.
        // Otherwise Twitch will deny reward management, even if the channel is affiliate/partner.
        try {
          const who = await getAuthenticatedTwitchUser(userId);
          const tokenTwitchUserId = who?.id || null;
          if (tokenTwitchUserId && tokenTwitchUserId !== String(broadcasterId)) {
            return res.status(403).json({
              error: 'Twitch account mismatch. Please log in as the channel owner to manage rewards.',
              errorCode: 'TWITCH_ACCOUNT_MISMATCH',
              requiresReauth: true,
            });
          }
        } catch (e: any) {
          // If we can't validate identity, proceed; Twitch API calls below will still fail if mismatched.
          // On beta we still want to return a helpful error when possible.
          logger.warn('twitch.identity_check.failed', {
            requestId: req.requestId,
            userId,
            channelId,
            errorMessage: e?.message,
          });
        }

        // Prevent enabling rewards for channels without affiliate/partner status.
        try {
          const info = await getChannelInformation(userId, broadcasterId);
          const btRaw = info?.broadcaster_type;
          if (btRaw === null || btRaw === undefined) {
            // We couldn't reliably check eligibility. On beta, don't hard-block: allow attempt and let Twitch
            // enforce the real rule. On prod, keep it strict to avoid confusing UX.
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
              return res.status(502).json({
                error: 'Unable to verify Twitch eligibility at the moment. Please try again later.',
                errorCode: 'TWITCH_ELIGIBILITY_UNKNOWN',
              });
            }
          }

          const bt = String(btRaw).toLowerCase();
          const eligible = bt === 'affiliate' || bt === 'partner';
          if (!eligible) {
            return res.status(403).json({
              error: 'The broadcaster does not have partner or affiliate status.',
              errorCode: 'TWITCH_REWARD_NOT_AVAILABLE',
            });
          }
        } catch (e: any) {
          logger.error('twitch.eligibility.check_failed', {
            requestId: req.requestId,
            userId,
            channelId,
            broadcasterId,
            errorMessage: e?.message,
          });
          return res.status(502).json({
            error: e?.message || 'Failed to check Twitch channel eligibility',
            errorCode: 'TWITCH_ELIGIBILITY_CHECK_FAILED',
          });
        }

        // First, try to get existing rewards to see if we already have one
        let existingRewardId: string | null = null;
        let oldRewardsToDelete: string[] = [];
        try {
          const rewards = await getChannelRewards(userId, broadcasterId);

          if (rewards?.data) {
            // Check if we have a stored reward ID that still exists
            if ((channel as any).rewardIdForCoins) {
              const storedReward = rewards.data.find((r: any) => r.id === (channel as any).rewardIdForCoins);
              if (storedReward) {
                existingRewardId = (channel as any).rewardIdForCoins;
              }
            }

            // If no stored reward found, try to find a reward with matching title pattern
            if (!existingRewardId) {
              const matchingReward = rewards.data.find(
                (r: any) => r.title?.includes('Coins') || r.title?.includes('монет') || r.title?.includes('тест')
              );
              if (matchingReward) {
                existingRewardId = matchingReward.id;
              }
            }

            // Find old rewards to delete (rewards with "Coins" in title that are not the current one)
            oldRewardsToDelete = rewards.data
              .filter(
                (r: any) =>
                  r.id !== existingRewardId && (r.title?.includes('Coins') || r.title?.includes('Get') || r.title?.includes('монет'))
              )
              .map((r: any) => r.id);
          }
        } catch (error: any) {
          logger.warn('twitch.rewards.fetch_failed', {
            requestId: req.requestId,
            userId,
            channelId,
            broadcasterId,
            errorMessage: error?.message,
          });
          // Continue with create/update logic
        }

        // Delete old rewards
        for (const oldRewardId of oldRewardsToDelete) {
          try {
            await deleteChannelReward(userId, broadcasterId, oldRewardId);
          } catch (error: any) {
            logger.warn('twitch.rewards.delete_old_failed', {
              requestId: req.requestId,
              userId,
              channelId,
              broadcasterId,
              rewardId: oldRewardId,
              errorMessage: error?.message,
            });
            // Continue even if deletion fails
          }
        }

        if (existingRewardId) {
          // Update existing reward
          try {
            await updateChannelReward(userId, broadcasterId, existingRewardId, {
              title: body.rewardTitle || `Get ${body.rewardCoins} Coins`,
              cost: body.rewardCost,
              is_enabled: true,
              prompt: `Redeem ${body.rewardCost} channel points to get ${body.rewardCoins} coins!`,
            });
            (body as any).rewardIdForCoins = existingRewardId;

            // Fetch reward details to get image URL (wait a bit for Twitch to process)
            try {
              await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second for Twitch to process
              const rewardDetails = await getChannelRewards(userId, broadcasterId, existingRewardId);
              if (
                rewardDetails?.data?.[0]?.image?.url_1x ||
                rewardDetails?.data?.[0]?.image?.url_2x ||
                rewardDetails?.data?.[0]?.image?.url_4x
              ) {
                coinIconUrl =
                  rewardDetails.data[0].image.url_1x || rewardDetails.data[0].image.url_2x || rewardDetails.data[0].image.url_4x;
              }
            } catch (error) {
              logger.warn('twitch.rewards.fetch_icon_failed', {
                requestId: req.requestId,
                userId,
                channelId,
                broadcasterId,
                rewardId: existingRewardId,
              });
            }
          } catch (error: any) {
            logger.warn('twitch.rewards.update_failed', {
              requestId: req.requestId,
              userId,
              channelId,
              broadcasterId,
              rewardId: existingRewardId,
              errorMessage: error?.message,
            });
            // If update fails, create new one
            const rewardResponse = await createChannelReward(
              userId,
              broadcasterId,
              body.rewardTitle || `Get ${body.rewardCoins} Coins`,
              body.rewardCost,
              `Redeem ${body.rewardCost} channel points to get ${body.rewardCoins} coins!`
            );
            (body as any).rewardIdForCoins = rewardResponse.data[0].id;

            // Extract image URL from reward response or fetch details
            if (rewardResponse?.data?.[0]?.image?.url_1x || rewardResponse?.data?.[0]?.image?.url_2x || rewardResponse?.data?.[0]?.image?.url_4x) {
              coinIconUrl = rewardResponse.data[0].image.url_1x || rewardResponse.data[0].image.url_2x || rewardResponse.data[0].image.url_4x;
            } else {
              // If image not in response, fetch reward details
              try {
                await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second for Twitch to process
                const rewardDetails = await getChannelRewards(userId, broadcasterId, (body as any).rewardIdForCoins ?? undefined);
                if (
                  rewardDetails?.data?.[0]?.image?.url_1x ||
                  rewardDetails?.data?.[0]?.image?.url_2x ||
                  rewardDetails?.data?.[0]?.image?.url_4x
                ) {
                  coinIconUrl =
                    rewardDetails.data[0].image.url_1x || rewardDetails.data[0].image.url_2x || rewardDetails.data[0].image.url_4x;
                }
              } catch (error) {
                logger.warn('twitch.rewards.fetch_icon_failed', {
                  requestId: req.requestId,
                  userId,
                  channelId,
                  broadcasterId,
                  rewardId: (body as any).rewardIdForCoins ?? null,
                });
              }
            }
          }
        } else {
          // Create new reward
          const rewardResponse = await createChannelReward(
            userId,
            broadcasterId,
            body.rewardTitle || `Get ${body.rewardCoins} Coins`,
            body.rewardCost,
            `Redeem ${body.rewardCost} channel points to get ${body.rewardCoins} coins!`
          );
          (body as any).rewardIdForCoins = rewardResponse.data[0].id;

          // Extract image URL from reward response or fetch details
          if (rewardResponse?.data?.[0]?.image?.url_1x || rewardResponse?.data?.[0]?.image?.url_2x || rewardResponse?.data?.[0]?.image?.url_4x) {
            coinIconUrl = rewardResponse.data[0].image.url_1x || rewardResponse.data[0].image.url_2x || rewardResponse.data[0].image.url_4x;
          } else {
            // If image not in response, fetch reward details
            try {
              await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second for Twitch to process
              const rewardDetails = await getChannelRewards(userId, broadcasterId, (body as any).rewardIdForCoins ?? undefined);
              if (
                rewardDetails?.data?.[0]?.image?.url_1x ||
                rewardDetails?.data?.[0]?.image?.url_2x ||
                rewardDetails?.data?.[0]?.image?.url_4x
              ) {
                coinIconUrl = rewardDetails.data[0].image.url_1x || rewardDetails.data[0].image.url_2x || rewardDetails.data[0].image.url_4x;
              }
            } catch (error) {
              logger.warn('twitch.rewards.fetch_icon_failed', {
                requestId: req.requestId,
                userId,
                channelId,
                broadcasterId,
                rewardId: (body as any).rewardIdForCoins ?? null,
              });
            }
          }
        }

        // Create EventSub subscription if it doesn't exist
        try {
          // Use the current request host as the webhook callback base URL.
          // This avoids hardcoding production domain and prevents beta from registering prod callbacks.
          const domain = process.env.DOMAIN || 'twitchmemes.ru';
          const reqHost = req.get('host') || '';
          const allowedHosts = new Set([domain, `www.${domain}`, `beta.${domain}`]);
          const apiBaseUrl = allowedHosts.has(reqHost) ? `https://${reqHost}` : `https://${domain}`;
          const webhookUrl = `${apiBaseUrl}/webhooks/twitch/eventsub`;

          // Check existing subscriptions first
          try {
            const existingSubs = await getEventSubSubscriptions(broadcasterId);

            // Check if we already have an active subscription for this event type
            const relevantSubs = (existingSubs?.data || []).filter(
              (sub: any) =>
                sub.type === 'channel.channel_points_custom_reward_redemption.add' &&
                (sub.status === 'enabled' || sub.status === 'webhook_callback_verification_pending')
            );

            const hasActiveSubscription = relevantSubs.some((sub: any) => sub.transport?.callback === webhookUrl);

            if (hasActiveSubscription) {
              // Subscription already exists and is active, skip creation
            } else {
              // If there is an active subscription but with a different callback, log it.
              const mismatchedSubs = relevantSubs.filter((s: any) => s.transport?.callback !== webhookUrl);
              if (mismatchedSubs.length > 0) {
                console.warn('[adminController] EventSub subscription callback mismatch, will delete and re-create', {
                  desiredWebhookUrl: webhookUrl,
                  existingCallbacks: mismatchedSubs.map((s: any) => ({ id: s.id, status: s.status, callback: s.transport?.callback })),
                });
                // Delete mismatched subscriptions to allow a deterministic re-register
                for (const sub of mismatchedSubs) {
                  try {
                    await deleteEventSubSubscription(sub.id);
                    console.log('[adminController] Deleted EventSub subscription:', { id: sub.id, callback: sub.transport?.callback });
                  } catch (deleteErr) {
                    console.error('[adminController] Failed to delete EventSub subscription:', {
                      id: sub.id,
                      error: (deleteErr as any)?.message,
                    });
                  }
                }
              }
              // Create new subscription
              try {
                await createEventSubSubscription(userId, broadcasterId, webhookUrl, process.env.TWITCH_EVENTSUB_SECRET!);
              } catch (createErr: any) {
                // If Twitch says "already exists", do a best-effort cleanup and retry once.
                if (createErr?.status === 409) {
                  console.warn('[adminController] EventSub create returned 409, retrying after cleanup', {
                    desiredWebhookUrl: webhookUrl,
                    error: createErr?.message,
                  });
                  for (const sub of relevantSubs) {
                    try {
                      await deleteEventSubSubscription(sub.id);
                    } catch (deleteErr) {
                      console.error('[adminController] Cleanup delete failed:', { id: sub.id, error: (deleteErr as any)?.message });
                    }
                  }
                  await createEventSubSubscription(userId, broadcasterId, webhookUrl, process.env.TWITCH_EVENTSUB_SECRET!);
                } else {
                  throw createErr;
                }
              }
            }
          } catch (checkError: any) {
            // If check fails, try to create anyway
            console.error('Error checking subscriptions, will try to create:', checkError);
            await createEventSubSubscription(userId, broadcasterId, webhookUrl, process.env.TWITCH_EVENTSUB_SECRET!);
          }
        } catch (error: any) {
          // Log but don't fail - subscription might already exist
          console.error('Error creating EventSub subscription:', error);
        }
      }

      if (!isRewardToggle && wantsRewardEnabled && hasRewardUpdateFields) {
        // Lightweight update of an already-enabled reward (avoid eligibility + reward discovery + EventSub).
        const rewardId = ((body as any).rewardIdForCoins ?? (channel as any).rewardIdForCoins) as string | null;
        const cost = ((body as any).rewardCost ?? (channel as any).rewardCost) as number | null;
        const coins = ((body as any).rewardCoins ?? (channel as any).rewardCoins) as number | null;
        const title = ((body as any).rewardTitle ?? (channel as any).rewardTitle) as string | null;

        if (rewardId && cost && coins) {
          try {
            await updateChannelReward(userId, broadcasterId, rewardId, {
              title: title || `Get ${coins} Coins`,
              cost,
              is_enabled: true,
              prompt: `Redeem ${cost} channel points to get ${coins} coins!`,
            });
            // Do not fetch icon here: it's expensive and rarely changes.
          } catch (error: any) {
            logger.warn('twitch.rewards.light_update_failed', {
              requestId: req.requestId,
              userId,
              channelId,
              broadcasterId,
              rewardId,
              errorMessage: error?.message,
            });
          }
        }
      }
    } else if (isRewardToggle && !wantsRewardEnabled) {
      // Disable reward - disable in Twitch but don't delete (only if this is a real toggle).
      const broadcasterId = channel.twitchChannelId;
      if (broadcasterId && (channel as any).rewardIdForCoins) {
        try {
          await updateChannelReward(userId, broadcasterId, (channel as any).rewardIdForCoins, {
            is_enabled: false,
          });
        } catch (error: any) {
          console.error('Error disabling reward:', error);
          // If reward doesn't exist, just continue
        }
      }
    }

    // Update channel in database
    const updateData: any = {
      rewardIdForCoins: body.rewardIdForCoins !== undefined ? body.rewardIdForCoins : (channel as any).rewardIdForCoins,
      coinPerPointRatio: body.coinPerPointRatio !== undefined ? body.coinPerPointRatio : channel.coinPerPointRatio,
      rewardEnabled: body.rewardEnabled !== undefined ? body.rewardEnabled : (channel as any).rewardEnabled,
      rewardTitle: body.rewardTitle !== undefined ? body.rewardTitle : (channel as any).rewardTitle,
      rewardCost: body.rewardCost !== undefined ? body.rewardCost : (channel as any).rewardCost,
      rewardCoins: body.rewardCoins !== undefined ? body.rewardCoins : (channel as any).rewardCoins,
      rewardOnlyWhenLive:
        (body as any).rewardOnlyWhenLive !== undefined ? (body as any).rewardOnlyWhenLive : (channel as any).rewardOnlyWhenLive,
      submissionRewardCoins: body.submissionRewardCoins !== undefined ? body.submissionRewardCoins : (channel as any).submissionRewardCoins,
      submissionRewardCoinsUpload:
        (body as any).submissionRewardCoinsUpload !== undefined
          ? (body as any).submissionRewardCoinsUpload
          : (channel as any).submissionRewardCoinsUpload,
      submissionRewardCoinsPool:
        (body as any).submissionRewardCoinsPool !== undefined ? (body as any).submissionRewardCoinsPool : (channel as any).submissionRewardCoinsPool,
      submissionRewardOnlyWhenLive:
        (body as any).submissionRewardOnlyWhenLive !== undefined
          ? (body as any).submissionRewardOnlyWhenLive
          : (channel as any).submissionRewardOnlyWhenLive,
      submissionsEnabled: (body as any).submissionsEnabled !== undefined ? (body as any).submissionsEnabled : (channel as any).submissionsEnabled,
      submissionsOnlyWhenLive:
        (body as any).submissionsOnlyWhenLive !== undefined ? (body as any).submissionsOnlyWhenLive : (channel as any).submissionsOnlyWhenLive,
      primaryColor: body.primaryColor !== undefined ? body.primaryColor : (channel as any).primaryColor,
      secondaryColor: body.secondaryColor !== undefined ? body.secondaryColor : (channel as any).secondaryColor,
      accentColor: body.accentColor !== undefined ? body.accentColor : (channel as any).accentColor,
      overlayMode: body.overlayMode !== undefined ? body.overlayMode : (channel as any).overlayMode,
      overlayShowSender: body.overlayShowSender !== undefined ? body.overlayShowSender : (channel as any).overlayShowSender,
      overlayMaxConcurrent: body.overlayMaxConcurrent !== undefined ? body.overlayMaxConcurrent : (channel as any).overlayMaxConcurrent,
      overlayStyleJson: body.overlayStyleJson !== undefined ? body.overlayStyleJson : (channel as any).overlayStyleJson,
      boostyBlogName: (body as any).boostyBlogName !== undefined ? (body as any).boostyBlogName : (channel as any).boostyBlogName,
      boostyCoinsPerSub:
        (body as any).boostyCoinsPerSub !== undefined ? (body as any).boostyCoinsPerSub : (channel as any).boostyCoinsPerSub,
      boostyTierCoinsJson:
        (body as any).boostyTierCoins !== undefined ? (body as any).boostyTierCoins : (channel as any).boostyTierCoinsJson,
      boostyDiscordTierRolesJson:
        (body as any).boostyDiscordTierRoles !== undefined
          ? (body as any).boostyDiscordTierRoles
          : (channel as any).boostyDiscordTierRolesJson,
      discordSubscriptionsGuildId:
        (body as any).discordSubscriptionsGuildId !== undefined
          ? (body as any).discordSubscriptionsGuildId
          : (channel as any).discordSubscriptionsGuildId,
    };

    // Streamer dashboard layout (cross-device): accept array or null (reset).
    if ((body as any).dashboardCardOrder !== undefined) {
      const v = (body as any).dashboardCardOrder;
      updateData.dashboardCardOrder = v === null ? null : normalizeDashboardCardOrder(v);
    }

    // Only update coinIconUrl if we have a value or if reward is being disabled
    if (coinIconUrl !== null || body.rewardEnabled === false) {
      updateData.coinIconUrl = body.rewardEnabled === false ? null : coinIconUrl;
    }

    const updatedChannel = await prisma.channel.update({
      where: { id: channelId },
      data: updateData,
    });

    // Invalidate cached public channel metadata (used by /channels/:slug?includeMemes=false).
    // This prevents stale dashboardCardOrder/branding settings after updates.
    try {
      const slugLower = String((updatedChannel as any).slug || (channel as any).slug || '').toLowerCase();
      if (slugLower) {
        channelMetaCache.delete(slugLower);
        void redisDel(nsKey('channel_meta', slugLower));
      }
    } catch {
      // ignore best-effort cache invalidation
    }

    // Push submissions gate state to connected clients in the channel room (dashboard/overlay/etc).
    try {
      const io: Server = req.app.get('io');
      const slug = String((updatedChannel as any).slug || (channel as any).slug || '').toLowerCase();
      if (slug) {
        io.to(`channel:${slug}`).emit('submissions:status', {
          enabled: (updatedChannel as any).submissionsEnabled ?? true,
          onlyWhenLive: (updatedChannel as any).submissionsOnlyWhenLive ?? false,
        });
      }
    } catch (emitErr) {
      console.error('Error emitting submissions:status after settings update:', emitErr);
    }

    // Push overlay config to connected overlay clients (OBS) in real-time.
    // Overlay listens to overlay:config, so settings apply without requiring OBS reload.
    try {
      const io: Server = req.app.get('io');
      const slug = String((updatedChannel as any).slug || (channel as any).slug || '').toLowerCase();
      if (slug) {
        io.to(`channel:${slug}`).emit('overlay:config', {
          overlayMode: (updatedChannel as any).overlayMode ?? 'queue',
          overlayShowSender: (updatedChannel as any).overlayShowSender ?? false,
          overlayMaxConcurrent: (updatedChannel as any).overlayMaxConcurrent ?? 3,
          overlayStyleJson: (updatedChannel as any).overlayStyleJson ?? null,
        });
      }
    } catch (emitErr) {
      console.error('Error emitting overlay:config after settings update:', emitErr);
    }

    res.json(updatedChannel);
  } catch (error: any) {
    console.error('Error updating channel settings:', error);
    if (error instanceof ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    return res.status(500).json({ error: error.message || 'Failed to update channel settings' });
  }
};


