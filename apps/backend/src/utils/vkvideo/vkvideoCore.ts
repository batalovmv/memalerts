import { logger } from '../logger.js';

export type VkVideoApiResult<T = unknown> = { ok: boolean; status: number; data: T | null; error: string | null };

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

export function extractErrorReason(json: unknown, fallback: string): string {
  if (json && typeof json === 'object') {
    const rec = json as Record<string, unknown>;
    if (typeof rec.error_description === 'string') return rec.error_description;
    if (typeof rec.error === 'string') return rec.error;
  }
  return fallback;
}

export function guessVkVideoApiBaseUrl(): string | null {
  const base = String(process.env.VKVIDEO_API_BASE_URL || '').trim();
  if (base) return base.replace(/\/+$/g, '');

  const userInfoUrl = String(process.env.VKVIDEO_USERINFO_URL || '').trim();
  if (!userInfoUrl) return null;
  try {
    const u = new URL(userInfoUrl);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

export async function vkvideoGetJson<T = unknown>(params: {
  accessToken: string;
  url: string;
}): Promise<VkVideoApiResult<T>> {
  try {
    const resp = await fetch(params.url, {
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        Accept: 'application/json',
      },
    });
    const text = await resp.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!resp.ok) {
      const reason = extractErrorReason(json, text || resp.statusText);
      return {
        ok: false,
        status: resp.status,
        data: json as T | null,
        error: `VKVideo API error: ${resp.status} ${reason}`,
      };
    }
    return { ok: true, status: resp.status, data: json as T, error: null };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('vkvideo.request_failed', { errorMessage: message });
    return { ok: false, status: 0, data: null, error: message };
  }
}

export async function vkvideoPostJson<T = unknown>(params: {
  accessToken: string;
  url: string;
  body: unknown;
}): Promise<VkVideoApiResult<T>> {
  try {
    const resp = await fetch(params.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params.body ?? {}),
    });
    const text = await resp.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!resp.ok) {
      const reason = extractErrorReason(json, text || resp.statusText);
      return {
        ok: false,
        status: resp.status,
        data: json as T | null,
        error: `VKVideo API error: ${resp.status} ${reason}`,
      };
    }
    return { ok: true, status: resp.status, data: json as T, error: null };
  } catch (error: unknown) {
    return { ok: false, status: 0, data: null, error: error instanceof Error ? error.message : String(error) };
  }
}
