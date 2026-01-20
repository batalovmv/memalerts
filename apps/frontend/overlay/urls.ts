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

export function resolveMediaUrl(src: string): string {
  const normalized = String(src || '').trim();
  if (!normalized) return '';
  if (normalized.startsWith('http://') || normalized.startsWith('https://')) return normalized;

  const path = ensureLeadingSlash(normalized);
  const isUploads = path.startsWith('/uploads/');
  if (!isUploads) return path;

  const runtime = getRuntimeConfig();
  const base = runtime?.uploadsBaseUrl;
  if (typeof base === 'string') {
    if (base === '') return path; // explicit same-origin
    if (base.trim()) return `${trimTrailingSlash(base.trim())}${path}`;
    return path;
  }

  if (import.meta.env.PROD) return path;
  return `${trimTrailingSlash(getDevApiBase())}${path}`;
}

export function getSocketBaseUrl(): string {
  const runtime = getRuntimeConfig();
  const v = runtime?.socketUrl;
  if (typeof v === 'string') {
    if (v === '') return window.location.origin;
    if (v.trim()) return trimTrailingSlash(v.trim());
  }

  if (import.meta.env.PROD) return window.location.origin;
  return getDevApiBase();
}



