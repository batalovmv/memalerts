import { prisma } from '../lib/prisma.js';
import { recordExternalRewardEventTx, stableProviderEventId } from '../rewards/externalRewardEvents.js';
import { logger } from '../utils/logger.js';
import { asRecord, getErrorMessage, type TrovoChannelState } from './trovoChatbotShared.js';
import { createTrovoAutoRewards } from './trovoAutoRewards.js';

function extractTrovoSpellFromChat(params: { envelope: unknown; chat: unknown }): {
  providerAccountId: string | null;
  amount: number;
  currency: 'trovo_mana' | 'trovo_elixir';
  providerEventId: string | null;
  eventAt: Date | null;
} | null {
  const chatRec = asRecord(params.chat);
  const envelopeRec = asRecord(params.envelope);
  const envelopeData = asRecord(envelopeRec.data);
  const chatType = Number.isFinite(Number(chatRec.type)) ? Number(chatRec.type) : null;
  const isSpell = chatType === 5 || chatType === 5009;
  if (!isSpell) return null;

  const providerAccountId = String(chatRec.uid ?? chatRec.sender_id ?? '').trim() || null;

  let amount = 1;
  try {
    const parsed = JSON.parse(String(chatRec.content ?? '')) as unknown;
    const parsedRec = asRecord(parsed);
    const num = parsedRec.num;
    if (Number.isFinite(Number(num))) amount = Math.max(1, Math.floor(Number(num)));
  } catch {
    // keep default=1
  }

  const contentDataStr = (() => {
    try {
      return JSON.stringify(chatRec.content_data ?? chatRec.contentData ?? chatRec.data ?? null) || '';
    } catch {
      return '';
    }
  })()
    .toLowerCase()
    .trim();
  const currency: 'trovo_mana' | 'trovo_elixir' = contentDataStr.includes('elixir') ? 'trovo_elixir' : 'trovo_mana';

  const providerEventId = String(chatRec.eid ?? chatRec.id ?? chatRec.msg_id ?? envelopeData.eid ?? '').trim() || null;

  const eventAt = (() => {
    const ts = chatRec.send_time ?? chatRec.sendTime ?? chatRec.timestamp ?? null;
    const n = Number(ts);
    if (Number.isFinite(n)) {
      const ms = n < 1e12 ? n * 1000 : n;
      return new Date(ms);
    }
    const parsed = Date.parse(String(ts || ''));
    return Number.isFinite(parsed) ? new Date(parsed) : null;
  })();

  return { providerAccountId, amount, currency, providerEventId, eventAt };
}

export function createTrovoRewardProcessor(params?: { autoRewardsCacheMs?: number }) {
  const autoRewards = createTrovoAutoRewards({ autoRewardsCacheMs: params?.autoRewardsCacheMs });

  const handleChatRewards = async (params: {
    st: TrovoChannelState;
    envelope: unknown;
    chat: unknown;
  }): Promise<{ skipCommands: boolean }> => {
    try {
      const spell = extractTrovoSpellFromChat({ envelope: params.envelope, chat: params.chat });
      if (spell?.providerAccountId && spell.amount > 0) {
        const rawPayloadJson = JSON.stringify({ envelope: params.envelope ?? {}, chat: params.chat ?? {} });
        const providerEventId =
          spell.providerEventId ||
          stableProviderEventId({
            provider: 'trovo',
            rawPayloadJson,
            fallbackParts: [params.st.trovoChannelId, spell.providerAccountId, String(spell.amount), spell.currency],
          });

        const channel = await prisma.channel.findUnique({
          where: { id: params.st.channelId },
          select: { id: true, slug: true, trovoManaCoinsPerUnit: true, trovoElixirCoinsPerUnit: true },
        });
        if (channel) {
          const perUnit =
            spell.currency === 'trovo_elixir'
              ? Number(channel.trovoElixirCoinsPerUnit ?? 0)
              : Number(channel.trovoManaCoinsPerUnit ?? 0);
          const coinsToGrant = Number.isFinite(perUnit) && perUnit > 0 ? Math.floor(spell.amount * perUnit) : 0;

          await prisma.$transaction(async (tx: Parameters<typeof recordExternalRewardEventTx>[0]['tx']) => {
            await recordExternalRewardEventTx({
              tx,
              provider: 'trovo',
              providerEventId,
              channelId: String(channel.id),
              providerAccountId: spell.providerAccountId!,
              eventType: 'trovo_spell',
              currency: spell.currency,
              amount: spell.amount,
              coinsToGrant,
              status: coinsToGrant > 0 ? 'eligible' : 'ignored',
              reason: coinsToGrant > 0 ? null : 'trovo_spell_unconfigured',
              eventAt: spell.eventAt,
              rawPayloadJson,
            });
          });
        }
        return { skipCommands: true };
      }
    } catch (e: unknown) {
      logger.warn('trovo_chatbot.spell_ingest_failed', {
        channelId: params.st.channelId,
        errorMessage: getErrorMessage(e),
      });
      return { skipCommands: true };
    }

    return autoRewards.handleAutoRewards(params);
  };

  return { handleChatRewards };
}
