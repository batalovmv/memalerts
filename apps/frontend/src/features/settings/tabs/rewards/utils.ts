import { parseIntSafe, toRecord } from '@/shared/lib/parsing';

export { parseIntSafe, toRecord };

export function getBoolean(obj: unknown, key: string): boolean | undefined {
  const r = toRecord(obj);
  if (!r) return undefined;
  const v = r[key];
  return typeof v === 'boolean' ? v : undefined;
}

