export type OverlaySharePayload = {
  v: 1;
  overlayMode?: 'queue' | 'simultaneous';
  overlayShowSender?: boolean;
  overlayMaxConcurrent?: number;
  style?: Record<string, unknown>;
};

export const isHexColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.trim());

export const clampInt = (n: unknown, min: number, max: number, fallback: number): number => {
  const x = typeof n === 'number' ? n : typeof n === 'string' ? parseInt(n, 10) : NaN;
  if (!Number.isFinite(x)) return fallback;
  return Math.max(min, Math.min(max, Math.round(x)));
};

export const clampFloat = (n: unknown, min: number, max: number, fallback: number): number => {
  const x = typeof n === 'number' ? n : typeof n === 'string' ? parseFloat(n) : NaN;
  if (!Number.isFinite(x)) return fallback;
  return Math.max(min, Math.min(max, x));
};

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = window.btoa(bin);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(b64url: string): Uint8Array {
  const b64 = String(b64url || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const bin = window.atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function fnv1a32(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function encodeShareCode(payload: OverlaySharePayload): string {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  const b64 = base64UrlEncode(bytes);
  const sig = fnv1a32(b64).toString(36);
  return `MA1.${b64}.${sig}`;
}

export function decodeShareCode(raw: string): OverlaySharePayload {
  const input = String(raw || '').trim();
  if (!input) throw new Error('empty');

  const parts = input.split('.');
  const b64 = parts.length >= 2 && parts[0] === 'MA1' ? parts[1] : input;
  const sig = parts.length >= 3 && parts[0] === 'MA1' ? parts[2] : '';
  if (sig) {
    const expected = fnv1a32(b64).toString(36);
    if (expected !== sig) throw new Error('checksum');
  }
  const bytes = base64UrlDecode(b64);
  const json = new TextDecoder().decode(bytes);
  const obj = JSON.parse(json) as OverlaySharePayload;
  if (!obj || typeof obj !== 'object' || (obj as any).v !== 1) throw new Error('version');
  return obj;
}


