import type { Client, ChatUserstate } from 'tmi.js';

import { logger } from '../utils/logger.js';
import { buildVoteChatInternalHeaders, type VoteChatPayload } from '../realtime/voteBridge.js';
import { normalizeLogin } from './twitchChatbotShared.js';

type VoteChatListenerParams = {
  client: Client;
  backendBaseUrls: string[];
  loginToChannelId: Map<string, string>;
  loginToSlug: Map<string, string>;
  stoppedRef: { value: boolean };
};

const CHAT_VOTE_THROTTLE_MS = 1000;

export function registerVoteChatListener(params: VoteChatListenerParams) {
  const { client, backendBaseUrls, loginToChannelId, loginToSlug, stoppedRef } = params;
  const headers = buildVoteChatInternalHeaders();
  const throttle = new Map<string, number>();

  const postVote = async (payload: VoteChatPayload) => {
    for (const base of backendBaseUrls) {
      try {
        const resp = await fetch(`${base}/internal/votes/chat`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...headers,
          },
          body: JSON.stringify(payload),
        });
        if (resp.ok) return true;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn('vote.chat.post_failed', { baseUrl: base, errorMessage: message });
      }
    }
    return false;
  };

  const onMessage = (_channel: string, tags: ChatUserstate, message: string, self: boolean) => {
    if (stoppedRef.value) return;
    if (self) return;

    const trimmed = String(message || '').trim();
    if (trimmed !== '1' && trimmed !== '2' && trimmed !== '3') return;

    const login = normalizeLogin(_channel);
    const channelId = loginToChannelId.get(login);
    if (!channelId) return;

    const channelSlug = loginToSlug.get(login) || login;
    const platformUserId = String((tags as { ['user-id']?: unknown })?.['user-id'] || '').trim();
    if (!platformUserId) return;

    const optionIndex = parseInt(trimmed, 10);
    if (!Number.isFinite(optionIndex)) return;

    const throttleKey = `${channelId}:${platformUserId}`;
    const lastAt = throttle.get(throttleKey) ?? 0;
    const now = Date.now();
    if (now - lastAt < CHAT_VOTE_THROTTLE_MS) return;
    throttle.set(throttleKey, now);

    void postVote({
      channelId,
      channelSlug,
      provider: 'twitch',
      platformUserId,
      optionIndex,
    });
  };

  client.on('message', onMessage);

  return () => {
    // tmi.js Client typings omit EventEmitter methods; runtime supports removeListener.
    const removeListener = (client as unknown as {
      removeListener: (event: string, listener: (...args: unknown[]) => void) => void;
    }).removeListener;
    // Cast listener to generic EventEmitter signature to satisfy tmi.js typings gap.
    removeListener('message', onMessage as (...args: unknown[]) => void);
  };
}
