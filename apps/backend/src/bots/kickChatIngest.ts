import { getKickExternalAccount, getValidKickAccessTokenByExternalAccountId } from '../utils/kickApi.js';
import { logger } from '../utils/logger.js';
import { asRecord, getErrorMessage, normalizeLogin, normalizeMessage, type KickChannelState } from './kickChatbotShared.js';

type IncomingChat = {
  userId: string;
  displayName: string;
  login: string | null;
  text: string;
  cursor: string | null;
};

type KickChatIngestConfig = {
  chatPollUrlTemplate: string | null;
  stoppedRef: { value: boolean };
};

function interpolateTemplate(tpl: string, vars: Record<string, string>): string {
  let out = tpl;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replaceAll(`{${k}}`, encodeURIComponent(v));
  }
  return out;
}

function extractKickChatItems(raw: unknown): IncomingChat[] {
  const rawRec = asRecord(raw);
  const dataCandidate = rawRec.data ?? rawRec.messages ?? rawRec.items ?? raw ?? null;
  const dataRec = asRecord(dataCandidate);
  const list = Array.isArray(dataCandidate)
    ? dataCandidate
    : Array.isArray(dataRec.data)
      ? dataRec.data
      : Array.isArray(dataRec.items)
        ? dataRec.items
        : [];
  const cursor =
    String(rawRec.cursor ?? rawRec.next_cursor ?? rawRec.nextCursor ?? dataRec.cursor ?? dataRec.next_cursor ?? '').trim() ||
    null;

  const out: IncomingChat[] = [];
  for (const m of list) {
    const msg = asRecord(m);
    const sender = asRecord(msg.sender ?? msg.user ?? msg.author ?? msg.identity ?? msg.from ?? null);
    const userId = String(sender.id ?? sender.user_id ?? sender.userId ?? msg.user_id ?? msg.userId ?? '').trim();
    const displayName =
      String(
        sender.display_name ??
          sender.displayName ??
          sender.name ??
          sender.username ??
          sender.user_name ??
          msg.display_name ??
          ''
      ).trim() || null;
    const loginRaw = String(sender.username ?? sender.user_name ?? sender.login ?? '').trim() || null;
    const text = normalizeMessage(msg.content ?? msg.message ?? msg.text ?? msg.body ?? '');
    if (!userId || !text) continue;
    out.push({
      userId,
      displayName: displayName || loginRaw || userId,
      login: loginRaw ? normalizeLogin(loginRaw) : null,
      text,
      cursor,
    });
  }
  return out;
}

export function createKickChatIngest(
  states: Map<string, KickChannelState>,
  commands: { handleIncomingChat: (st: KickChannelState, incoming: IncomingChat) => Promise<void> },
  config: KickChatIngestConfig
) {
  const { chatPollUrlTemplate, stoppedRef } = config;
  let ingestInFlight = false;

  const ingestChatOnce = async () => {
    if (stoppedRef.value) return;
    if (ingestInFlight) return;
    if (!chatPollUrlTemplate) return;
    ingestInFlight = true;
    try {
      for (const st of states.values()) {
        const acc = await getKickExternalAccount(st.userId);
        if (!acc?.id) continue;
        const token = await getValidKickAccessTokenByExternalAccountId(acc.id);
        if (!token) continue;

        const url = interpolateTemplate(chatPollUrlTemplate, {
          channelId: st.kickChannelId,
          cursor: st.chatCursor || '',
        });

        const resp = await fetch(url, { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } });
        const raw = await resp.json().catch(() => null);
        if (!resp.ok) continue;

        const items = extractKickChatItems(raw);
        if (items.length === 0) {
          const cursor = String(raw?.cursor ?? raw?.next_cursor ?? raw?.nextCursor ?? '').trim() || null;
          if (cursor) st.chatCursor = cursor;
          continue;
        }

        const cursor = items[0]?.cursor || null;
        if (cursor) st.chatCursor = cursor;

        for (const incoming of items) {
          await commands.handleIncomingChat(st, incoming);
        }
      }
    } catch (e: unknown) {
      logger.warn('kick_chatbot.ingest_failed', { errorMessage: getErrorMessage(e) });
    } finally {
      ingestInFlight = false;
    }
  };

  return { ingestChatOnce };
}
