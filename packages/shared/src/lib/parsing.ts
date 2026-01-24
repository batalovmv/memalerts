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
