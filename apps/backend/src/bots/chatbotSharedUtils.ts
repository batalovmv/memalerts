export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function getErrorCode(err: unknown): string | undefined {
  const rec = err && typeof err === 'object' ? (err as Record<string, unknown>) : null;
  const code = rec?.['code'];
  return typeof code === 'string' ? code : undefined;
}

export function parseIntSafe(v: unknown, def: number): number {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : def;
}

export function parseBool(raw: unknown): boolean {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}

export function normalizeSlug(v: string): string {
  return String(v || '')
    .trim()
    .toLowerCase();
}

export function normalizeMessage(v: unknown): string {
  return String(v ?? '')
    .replace(/\r\n/g, '\n')
    .trim();
}

export function normalizeLogin(v: unknown): string {
  return String(v ?? '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '');
}

export function utcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

export function utcDayKeyYesterday(d: Date): string {
  const x = new Date(d.getTime() - 24 * 60 * 60 * 1000);
  return utcDayKey(x);
}
