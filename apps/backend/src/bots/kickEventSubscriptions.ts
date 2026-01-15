import { logger } from '../utils/logger.js';
import { createKickEventSubscription, getKickExternalAccount, getValidKickAccessTokenByExternalAccountId, listKickEventSubscriptions } from '../utils/kickApi.js';
import { asRecord, type KickChannelState } from './kickChatbotShared.js';

function resolveKickWebhookCallbackUrl(): string | null {
  const envUrl = String(process.env.KICK_WEBHOOK_CALLBACK_URL || '').trim();
  if (envUrl) return envUrl;

  const domain = String(process.env.DOMAIN || '').trim();
  if (!domain) return null;

  const port = String(process.env.PORT || '3001').trim();
  const base = port === '3002' ? `https://beta.${domain}` : `https://${domain}`;
  return `${base}/webhooks/kick/events`;
}

export function createKickEventSubscriptions(params: {
  states: Map<string, KickChannelState>;
  stoppedRef: { value: boolean };
}) {
  const { states, stoppedRef } = params;

  const ensureKickEventSubscriptions = async () => {
    if (stoppedRef.value) return;
    if (states.size === 0) return;

    const callbackUrl = resolveKickWebhookCallbackUrl();
    if (!callbackUrl) return;

    const EVENT_NAMES = [
      'chat.message.sent',
      'channel.followed',
      'channel.subscription.new',
      'channel.subscription.renewal',
      'channel.subscription.gifts',
      'kicks.gifted',
      'livestream.status.updated',
      'channel.reward.redemption.updated',
    ];

    const byUserId = new Map<string, { accessToken: string; subs: unknown[] } | null>();
    for (const st of states.values()) {
      const userId = String(st.userId || '').trim();
      if (!userId || byUserId.has(userId)) continue;

      const acc = await getKickExternalAccount(userId);
      if (!acc?.id) {
        byUserId.set(userId, null);
        continue;
      }
      const token = await getValidKickAccessTokenByExternalAccountId(acc.id);
      if (!token) {
        byUserId.set(userId, null);
        continue;
      }

      const listed = await listKickEventSubscriptions({ accessToken: token });
      if (!listed.ok) {
        byUserId.set(userId, { accessToken: token, subs: [] });
        continue;
      }
      byUserId.set(userId, { accessToken: token, subs: listed.subscriptions || [] });
    }

    for (const st of states.values()) {
      const userId = String(st.userId || '').trim();
      if (!userId) continue;
      const ctx = byUserId.get(userId) || null;
      if (!ctx) continue;

      for (const eventName of EVENT_NAMES) {
        const want = String(eventName || '')
          .trim()
          .toLowerCase();
        if (!want) continue;

        const hasSub =
          (ctx.subs || []).find((s) => {
            const sub = asRecord(s);
            const transport = asRecord(sub.transport);
            const e = String(sub.event ?? sub.type ?? sub.name ?? '')
              .trim()
              .toLowerCase();
            const cb = String(sub.callback_url ?? sub.callback ?? transport.callback ?? '').trim();
            return e === want && cb === callbackUrl;
          }) != null;

        if (hasSub) continue;

        const created = await createKickEventSubscription({
          accessToken: ctx.accessToken,
          callbackUrl,
          event: want,
          version: 'v1',
        });
        if (!created.ok) {
          logger.warn('kick_chatbot.events_subscription_create_failed', {
            channelId: st.channelId,
            event: want,
            status: created.status,
          });
        } else {
          logger.info('kick_chatbot.events_subscription_created', {
            channelId: st.channelId,
            event: want,
            subscriptionId: created.subscriptionId,
          });
        }
      }
    }
  };

  return { ensureKickEventSubscriptions };
}
