import type { MemeDetail } from '@memalerts/api-contracts';

/**
 * Canonical meme identifier for channel listings.
 * Backend may return legacy `meme.id` for compatibility, but provides `channelMemeId`.
 */
export function getMemePrimaryId(meme: Pick<MemeDetail, 'id' | 'channelMemeId'>): string {
  return meme.channelMemeId ?? meme.id;
}

/**
 * Id to send to activation endpoint: backend accepts both legacy Meme id and ChannelMeme id.
 */
export function getMemeIdForActivation(meme: Pick<MemeDetail, 'id' | 'channelMemeId'>): string {
  return meme.channelMemeId ?? meme.id;
}




