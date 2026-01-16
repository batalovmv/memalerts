import type { AuthRequest } from '../../../middleware/auth.js';
import type { Channel } from '@prisma/client';
import {
  createKickEventSubscription,
  getKickExternalAccount,
  getValidKickAccessTokenByExternalAccountId,
  listKickEventSubscriptions,
} from '../../../utils/kickApi.js';
import { asRecord } from './shared.js';

export async function handleKickRewardToggle(params: {
  req: AuthRequest;
  userId: string;
  channel: Channel;
  bodyRec: Record<string, unknown>;
}): Promise<string | undefined> {
  const { req, userId, channel, bodyRec } = params;
  const channelRec = asRecord(channel);
  const currentKickRewardEnabled = Boolean(channelRec.kickRewardEnabled);
  const kickRewardEnabledProvided = bodyRec.kickRewardEnabled !== undefined;
  const wantsKickRewardEnabled = kickRewardEnabledProvided
    ? Boolean(bodyRec.kickRewardEnabled)
    : currentKickRewardEnabled;
  const isKickRewardToggle = kickRewardEnabledProvided && wantsKickRewardEnabled !== currentKickRewardEnabled;
  let kickRewardsSubscriptionIdToSave: string | undefined = undefined;

  if (isKickRewardToggle && wantsKickRewardEnabled) {
    const acc = await getKickExternalAccount(userId);
    if (!acc?.id) {
      throw Object.assign(new Error('Kick account is not linked. Please link Kick in integrations first.'), {
        status: 400,
        errorCode: 'KICK_NOT_LINKED',
      });
    }

    const scopes = String(acc.scopes || '')
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!scopes.includes('events:subscribe')) {
      throw Object.assign(
        new Error('Kick scope missing: events:subscribe. Please re-link Kick with the required permissions.'),
        {
          status: 400,
          errorCode: 'KICK_SCOPE_MISSING_EVENTS_SUBSCRIBE',
        }
      );
    }

    const accessToken = await getValidKickAccessTokenByExternalAccountId(acc.id);
    if (!accessToken) {
      throw Object.assign(
        new Error(
          'Kick access token not found/expired. Please log out and log in again to refresh your authorization.'
        ),
        { status: 401, requiresReauth: true, errorCode: 'KICK_ACCESS_TOKEN_MISSING' }
      );
    }

    const callbackUrl = (() => {
      const envUrl = String(process.env.KICK_WEBHOOK_CALLBACK_URL || '').trim();
      if (envUrl) return envUrl;
      const domain = process.env.DOMAIN || 'twitchmemes.ru';
      const reqHost = req.get('host') || '';
      const allowedHosts = new Set([domain, `www.${domain}`, `beta.${domain}`]);
      const apiBaseUrl = allowedHosts.has(reqHost) ? `https://${reqHost}` : `https://${domain}`;
      return `${apiBaseUrl}/webhooks/kick/events`;
    })();

    const eventName = 'channel.reward.redemption.updated';
    let subId: string | null = null;

    const listed = await listKickEventSubscriptions({ accessToken });
    if (listed.ok) {
      const match = (listed.subscriptions || []).find((s: unknown) => {
        const rec = asRecord(s);
        const transport = asRecord(rec.transport);
        const e = String(rec.event ?? rec.type ?? rec.name ?? '')
          .trim()
          .toLowerCase();
        const cb = String(rec.callback_url ?? rec.callback ?? transport.callback ?? '').trim();
        return e === eventName && cb === callbackUrl;
      });
      const matchRec = asRecord(match);
      const idRaw = matchRec.id ?? matchRec.subscription_id ?? matchRec.subscriptionId ?? null;
      subId = String(idRaw || '').trim() || null;
    }

    if (!subId) {
      const created = await createKickEventSubscription({
        accessToken,
        callbackUrl,
        event: eventName,
        version: 'v1',
      });
      if (!created.ok || !created.subscriptionId) {
        throw Object.assign(new Error('Failed to create Kick event subscription. Please try again.'), {
          status: 502,
          errorCode: 'KICK_SUBSCRIPTION_CREATE_FAILED',
        });
      }
      subId = created.subscriptionId;
    }

    kickRewardsSubscriptionIdToSave = subId ?? undefined;
  }

  return kickRewardsSubscriptionIdToSave;
}
