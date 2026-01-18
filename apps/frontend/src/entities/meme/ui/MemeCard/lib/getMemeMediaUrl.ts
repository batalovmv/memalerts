import type { Meme } from '@/types';

import { resolveMediaUrl } from '@/lib/urls';

export function getMemeMediaUrl(meme: Meme): string {
  return resolveMediaUrl(meme.playFileUrl || meme.fileUrl);
}

