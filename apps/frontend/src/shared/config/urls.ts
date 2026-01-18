import { getRuntimeConfig } from './runtimeConfig';

function trimTrailingSlash(v: string): string {
  return v.endsWith('/') ? v.slice(0, -1) : v;
}

function ensureLeadingSlash(v: string): string {
  if (!v) return '/';
  return v.startsWith('/') ? v : `/${v}`;
}

function getDevApiBase(): string {
  return import.meta.env.VITE_API_URL || 'http://localhost:3001';
}

export function getPublicBaseUrl(): string {
  const runtime = getRuntimeConfig();
  const v = runtime?.publicBaseUrl;
  if (typeof v === 'string') {
    if (v === '') return window.location.origin;
    if (v.trim()) return trimTrailingSlash(v.trim());
  }
  return window.location.origin;
}

export function resolvePublicUrl(pathname: string): string {
  const base = getPublicBaseUrl();
  const p = ensureLeadingSlash(String(pathname || '').trim());
  return `${base}${p}`;
}

export function getUploadsBaseUrl(): string | null {
  const runtime = getRuntimeConfig();
  const v = runtime?.uploadsBaseUrl;
  if (typeof v === 'string') {
    if (v === '') return ''; // explicit same-origin
    if (v.trim()) return trimTrailingSlash(v.trim());
    return '';
  }
  const s3 = runtime?.s3PublicBaseUrl;
  if (typeof s3 === 'string') {
    if (s3 === '') return '';
    if (s3.trim()) return trimTrailingSlash(s3.trim());
    return '';
  }
  return null;
}

/**
 * Resolve media URL for <img>/<video>/<audio>.
 *
 * Rules:
 * - Absolute URLs are returned as-is.
 * - In prod: default is same-origin relative paths.
 * - /uploads/* can be redirected to a separate host via runtime config uploadsBaseUrl.
 * - In dev: if uploadsBaseUrl is not configured, fall back to VITE_API_URL or localhost backend.
 */
export function resolveMediaUrl(src: string): string {
  const normalized = String(src || '').trim();
  if (!normalized) return '';
  if (normalized.startsWith('http://') || normalized.startsWith('https://')) return normalized;

  const path = ensureLeadingSlash(normalized);
  const isUploads = path.startsWith('/uploads/');

  if (!isUploads) return path;

  const uploadsBase = getUploadsBaseUrl();
  if (uploadsBase === '') {
    // Explicit same-origin
    return path;
  }
  if (uploadsBase) {
    return `${uploadsBase}${path}`;
  }

  // No runtime config: keep prod same-origin; dev falls back to backend base.
  if (import.meta.env.PROD) return path;

  return `${trimTrailingSlash(getDevApiBase())}${path}`;
}

