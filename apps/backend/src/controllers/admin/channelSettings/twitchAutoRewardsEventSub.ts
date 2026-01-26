import type { AuthRequest } from '../../../middleware/auth.js';
import type { Channel } from '@prisma/client';
import {
  getEventSubSubscriptions,
  createEventSubSubscriptionOfType,
  deleteEventSubSubscription,
} from '../../../utils/twitchApi.js';
import { asRecord } from './shared.js';

export async function ensureTwitchAutoRewardsEventSubs(params: {
  req: AuthRequest;
  channel: Channel;
  updateData: Record<string, unknown>;
}) {
  const { req, channel, updateData } = params;
  try {
    const cfg = updateData.twitchAutoRewardsJson;
    const cfgRec = asRecord(cfg);
    const broadcasterId = String(channel.twitchChannelId || '').trim();
    if (Object.keys(cfgRec).length && broadcasterId && process.env.TWITCH_EVENTSUB_SECRET) {
      const domain = process.env.DOMAIN || 'twitchmemes.ru';
      const reqHost = req.get('host') || '';
      const allowedHosts = new Set([domain, `www.${domain}`, `beta.${domain}`]);
      const apiBaseUrl = allowedHosts.has(reqHost) ? `https://${reqHost}` : `https://${domain}`;
      const webhookUrl = `${apiBaseUrl}/webhooks/twitch/eventsub`;

      const wantTypes: Array<{ type: string; version: string; condition: Record<string, string> }> = [];

      const followRec = asRecord(cfgRec.follow);
      const subscribeRec = asRecord(cfgRec.subscribe);
      const resubRec = asRecord(cfgRec.resubMessage);
      const giftRec = asRecord(cfgRec.giftSub);
      const cheerRec = asRecord(cfgRec.cheer);
      const raidRec = asRecord(cfgRec.raid);
      const channelPointsRec = asRecord(cfgRec.channelPoints);
      const chatRec = asRecord(cfgRec.chat);
      const chatFirstRec = asRecord(chatRec.firstMessage);
      const chatThresholdRec = asRecord(chatRec.messageThresholds);
      const chatStreakRec = asRecord(chatRec.dailyStreak);

      const followEnabled = Boolean(followRec.enabled) && Number(followRec.coins ?? 0) > 0;
      const subEnabled = Boolean(subscribeRec.enabled);
      const resubEnabled = Boolean(resubRec.enabled);
      const giftEnabled = Boolean(giftRec.enabled);
      const cheerEnabled = Boolean(cheerRec.enabled);
      const raidEnabled = Boolean(raidRec.enabled);
      const channelPointsEnabled = Boolean(channelPointsRec.enabled);
      const chatEnabled =
        Boolean(chatFirstRec.enabled) || Boolean(chatThresholdRec.enabled) || Boolean(chatStreakRec.enabled);

      if (followEnabled) {
        wantTypes.push({
          type: 'channel.follow',
          version: '2',
          condition: { broadcaster_user_id: broadcasterId, moderator_user_id: broadcasterId },
        });
      }
      if (subEnabled)
        wantTypes.push({
          type: 'channel.subscribe',
          version: '1',
          condition: { broadcaster_user_id: broadcasterId },
        });
      if (resubEnabled)
        wantTypes.push({
          type: 'channel.subscription.message',
          version: '1',
          condition: { broadcaster_user_id: broadcasterId },
        });
      if (giftEnabled)
        wantTypes.push({
          type: 'channel.subscription.gift',
          version: '1',
          condition: { broadcaster_user_id: broadcasterId },
        });
      if (cheerEnabled)
        wantTypes.push({ type: 'channel.cheer', version: '1', condition: { broadcaster_user_id: broadcasterId } });
      if (raidEnabled) {
        wantTypes.push({ type: 'channel.raid', version: '1', condition: { to_broadcaster_user_id: broadcasterId } });
      }
      if (channelPointsEnabled) {
        wantTypes.push({
          type: 'channel.channel_points_custom_reward_redemption.add',
          version: '1',
          condition: { broadcaster_user_id: broadcasterId },
        });
      }
      if (chatEnabled) {
        wantTypes.push({ type: 'stream.online', version: '1', condition: { broadcaster_user_id: broadcasterId } });
        wantTypes.push({ type: 'stream.offline', version: '1', condition: { broadcaster_user_id: broadcasterId } });
      }

      if (wantTypes.length) {
        const existing = await getEventSubSubscriptions(broadcasterId);
        const subs = Array.isArray(existing?.data) ? existing.data : [];

        const relevant = subs
          .map((s) => asRecord(s))
          .filter(
            (s) =>
              wantTypes.some((w) => w.type === s.type) &&
              (s.status === 'enabled' ||
                s.status === 'webhook_callback_verification_pending' ||
                s.status === 'authorization_revoked')
          );

        const mismatched = relevant.filter((s) => asRecord(s.transport).callback !== webhookUrl);
        for (const s of mismatched) {
          try {
            await deleteEventSubSubscription(String(s.id));
          } catch {
            // ignore
          }
        }

        for (const w of wantTypes) {
          const has = relevant.some((s) => s.type === w.type && asRecord(s.transport).callback === webhookUrl);
          if (has) continue;
          try {
            await createEventSubSubscriptionOfType({
              type: w.type,
              version: w.version,
              broadcasterId,
              webhookUrl,
              secret: process.env.TWITCH_EVENTSUB_SECRET!,
              condition: w.condition,
            });
          } catch {
            // ignore
          }
        }
      }
    }
  } catch {
    // ignore
  }
}
