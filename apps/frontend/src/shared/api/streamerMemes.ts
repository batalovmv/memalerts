import type { ApiResponseMeta } from '@/lib/api';

import { apiRequestWithMeta } from '@/lib/api';

export type AiRegenerateErrorResponse = {
  error?: string;
  message?: string;
  errorCode?: string;
  retryAfterSeconds?: number;
};

export async function regenerateMemeAi(
  channelMemeId: string,
): Promise<{ data: unknown; meta: ApiResponseMeta }> {
  const { data, meta } = await apiRequestWithMeta<unknown>({
    method: 'POST',
    url: `/streamer/memes/${encodeURIComponent(channelMemeId)}/ai/regenerate`,
  });
  return { data, meta };
}

export function getRetryAfterSecondsFromError(error: unknown): number | null {
  const maybeAxios = error as { response?: { data?: unknown; headers?: unknown } } | null;
  const data = maybeAxios?.response?.data;
  const obj = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
  const v = obj?.retryAfterSeconds;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

export function getErrorCodeFromError(error: unknown): string | null {
  const maybeAxios = error as { response?: { data?: unknown } } | null;
  const data = maybeAxios?.response?.data;
  const obj = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
  const code = obj?.errorCode;
  return typeof code === 'string' && code.trim() ? code.trim() : null;
}


