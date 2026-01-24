import { prisma } from '../lib/prisma.js';
import { recordExternalRewardEventTx } from '../rewards/externalRewardEvents.js';
import { claimPendingCoinGrantsTx } from '../rewards/pendingCoinGrants.js';
import { resolveMemalertsUserIdFromChatIdentity } from '../utils/chatIdentity.js';
import { logger } from '../utils/logger.js';
import {
  asRecord,
  getErrorMessage,
  type TrovoChannelState,
} from './trovoChatbotShared.js';
import {
  handleTrovoChatRewards,
  handleTrovoFollowRewards,
  handleTrovoGiftSubRewards,
  handleTrovoRaidRewards,
  handleTrovoSubscribeRewards,
} from './trovoRewardHandlers.js';
type AutoRewardsCache = Map<string, { ts: number; cfg: unknown | null }>;
export function createTrovoAutoRewards(params?: { autoRewardsCacheMs?: number }) {
  const autoRewardsByChannelId: AutoRewardsCache = new Map();
  const AUTO_REWARDS_CACHE_MS = params?.autoRewardsCacheMs ?? 60_000;
  async function getAutoRewardsConfig(channelId: string): Promise<unknown | null> {
    const id = String(channelId || '').trim();
    if (!id) return null;
    const now = Date.now();
    const cached = autoRewardsByChannelId.get(id);
    if (cached && now - cached.ts < AUTO_REWARDS_CACHE_MS) return cached.cfg ?? null;
    try {
      const ch = await prisma.channel.findUnique({ where: { id }, select: { twitchAutoRewardsJson: true } });
      const cfg = (ch as { twitchAutoRewardsJson?: unknown } | null)?.twitchAutoRewardsJson ?? null;
      autoRewardsByChannelId.set(id, { ts: now, cfg });
      return cfg ?? null;
    } catch {
      autoRewardsByChannelId.set(id, { ts: now, cfg: null });
      return null;
    }
  }

  const handleAutoRewards = async (params: {
    st: TrovoChannelState;
    envelope: unknown;
    chat: unknown;
  }): Promise<{ skipCommands: boolean }> => {
    const chatRec = asRecord(params.chat);
    const chatType = Number.isFinite(Number(chatRec.type)) ? Number(chatRec.type) : null;

    try {
      const cfg = await getAutoRewardsConfig(params.st.channelId);
      if (cfg && typeof cfg === 'object') {
        const channelCfg = asRecord(cfg);
        const eventAt = (() => {
          const ts = chatRec.send_time ?? chatRec.sendTime ?? chatRec.timestamp ?? null;
          const n = Number(ts);
          if (Number.isFinite(n)) return new Date(n < 1e12 ? n * 1000 : n);
          const parsed = Date.parse(String(ts || ''));
          return Number.isFinite(parsed) ? new Date(parsed) : new Date();
        })();

        const providerAccountId = String(chatRec.uid ?? chatRec.sender_id ?? '').trim() || null;
        const envelopeRec = asRecord(params.envelope);
        const envelopeData = asRecord(envelopeRec.data);
        const eventEid = String(envelopeData.eid ?? chatRec.eid ?? chatRec.id ?? chatRec.msg_id ?? '').trim();

        const recordAndMaybeClaim = async (recordParams: {
          providerEventId: string;
          providerAccountId: string;
          eventType:
            | 'twitch_follow'
            | 'twitch_subscribe'
            | 'twitch_resub_message'
            | 'twitch_gift_sub'
            | 'twitch_raid'
            | 'twitch_chat_first_message'
            | 'twitch_chat_messages_threshold'
            | 'twitch_chat_daily_streak';
          currency: 'twitch_units';
          amount: number;
          coinsToGrant: number;
          status: 'eligible' | 'ignored';
          reason?: string | null;
          rawMeta: unknown;
        }) => {
          const coins = Number.isFinite(recordParams.coinsToGrant) ? Math.floor(recordParams.coinsToGrant) : 0;
          await prisma.$transaction(async (tx: Parameters<typeof recordExternalRewardEventTx>[0]['tx']) => {
            await recordExternalRewardEventTx({
              tx,
              provider: 'trovo',
              providerEventId: recordParams.providerEventId,
              channelId: params.st.channelId,
              providerAccountId: recordParams.providerAccountId,
              eventType: recordParams.eventType,
              currency: recordParams.currency,
              amount: recordParams.amount,
              coinsToGrant: coins,
              status: recordParams.status,
              reason: recordParams.reason ?? null,
              eventAt,
              rawPayloadJson: JSON.stringify(recordParams.rawMeta ?? {}),
            });

            const linkedUserId = await resolveMemalertsUserIdFromChatIdentity({
              provider: 'trovo',
              platformUserId: recordParams.providerAccountId,
            });
            if (linkedUserId && recordParams.status === 'eligible' && coins > 0) {
              await claimPendingCoinGrantsTx({
                tx,
                userId: linkedUserId,
                provider: 'trovo',
                providerAccountId: recordParams.providerAccountId,
              });
            }
          });
        };

        if (chatType === 5003 && providerAccountId) {
          const skipCommands = await handleTrovoFollowRewards({
            st: params.st,
            channelCfg,
            providerAccountId,
            eventEid,
            recordAndMaybeClaim,
          });
          return { skipCommands };
        }

        if (chatType === 5001 && providerAccountId) {
          const skipCommands = await handleTrovoSubscribeRewards({
            st: params.st,
            channelCfg,
            providerAccountId,
            chatRec,
            eventEid,
            recordAndMaybeClaim,
          });
          return { skipCommands };
        }

        if ((chatType === 5005 || chatType === 5006) && providerAccountId) {
          const skipCommands = await handleTrovoGiftSubRewards({
            st: params.st,
            channelCfg,
            providerAccountId,
            chatRec,
            eventEid,
            recordAndMaybeClaim,
          });
          return { skipCommands };
        }

        if (chatType === 5008 && providerAccountId) {
          const skipCommands = await handleTrovoRaidRewards({
            st: params.st,
            channelCfg,
            providerAccountId,
            chatRec,
            eventEid,
            recordAndMaybeClaim,
          });
          return { skipCommands };
        }

        if (chatType === 0 && providerAccountId) {
          await handleTrovoChatRewards({
            st: params.st,
            channelCfg,
            providerAccountId,
            recordAndMaybeClaim,
          });
        }
      }
    } catch (e: unknown) {
      logger.warn('trovo_chatbot.auto_rewards_failed', {
        channelId: params.st.channelId,
        errorMessage: getErrorMessage(e),
      });
    }

    return { skipCommands: false };
  };

  return { handleAutoRewards };
}
