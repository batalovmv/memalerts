import type { Meme } from '@/types';

/**
 * Canonical meme identifier for channel listings.
 * Backend may return legacy `meme.id` for compatibility, but provides `channelMemeId`.
 */
export function getMemePrimaryId(meme: Pick<Meme, 'id' | 'channelMemeId'>): string {
  return meme.channelMemeId ?? meme.id;
}

/**
 * Id to send to activation endpoint: backend accepts both legacy Meme.id and ChannelMeme.id.
 */
export function getMemeIdForActivation(meme: Pick<Meme, 'id' | 'channelMemeId'>): string {
  return meme.channelMemeId ?? meme.id;
}


