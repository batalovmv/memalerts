import { resolveMediaUrl } from '@/lib/urls';
import type { Meme } from '@/types';

export function getMemeMediaUrl(meme: Meme): string {
  return resolveMediaUrl(meme.fileUrl);
}


