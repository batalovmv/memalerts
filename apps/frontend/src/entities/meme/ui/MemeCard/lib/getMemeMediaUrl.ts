import type { MemeDetail } from '@memalerts/api-contracts';

import { resolveMediaUrl } from '@/lib/urls';

function pushUrl(list: string[], raw?: string | null) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return;
  list.push(resolveMediaUrl(trimmed));
}

export function getMemeMediaCandidates(meme: MemeDetail): string[] {
  const urls: string[] = [];
  pushUrl(urls, meme.previewUrl);

  if (Array.isArray(meme.variants)) {
    for (const variant of meme.variants) {
      pushUrl(urls, variant?.fileUrl ?? null);
    }
  }

  pushUrl(urls, meme.playFileUrl);
  pushUrl(urls, meme.fileUrl);

  const seen = new Set<string>();
  return urls.filter((url) => {
    if (!url) return false;
    if (seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}

export function getMemeMediaUrl(meme: MemeDetail): string {
  const candidates = getMemeMediaCandidates(meme);
  return candidates[0] || '';
}


