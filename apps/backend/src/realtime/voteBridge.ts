export type VoteChatPayload = {
  channelId: string;
  channelSlug?: string | null;
  provider: 'twitch' | 'youtube' | 'vkvideo';
  platformUserId: string;
  optionIndex: number;
};

const INTERNAL_HEADER = 'x-memalerts-internal';
const INTERNAL_HEADER_VALUE = 'vote-chat';

export function buildVoteChatInternalHeaders(): Record<string, string> {
  return { [INTERNAL_HEADER]: INTERNAL_HEADER_VALUE };
}

export function isInternalVoteChatRequest(headers: Record<string, unknown>): boolean {
  const v = headers[INTERNAL_HEADER] || headers[INTERNAL_HEADER.toLowerCase()];
  return v === INTERNAL_HEADER_VALUE;
}
