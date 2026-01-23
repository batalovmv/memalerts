import type { Meme } from '@/types';

import { resolveMediaUrl } from '@/lib/urls';

export function getMemeMediaUrl(meme: Meme): string {
  if (meme.previewUrl) return resolveMediaUrl(meme.previewUrl);
  const firstVariant = Array.isArray(meme.variants) && meme.variants.length > 0 ? meme.variants[0] : null;
  return resolveMediaUrl(firstVariant?.fileUrl || meme.playFileUrl || meme.fileUrl);
}
