import { getRuntimeConfig } from '@/shared/config/runtimeConfig';
import { toRecord } from '@/shared/lib/parsing';

export type FeatureFlags = Record<string, boolean>;

declare global {
  interface Window {
    __MEMALERTS_FEATURE_FLAGS__?: Record<string, boolean | number | string>;
  }
}

const truthySet = new Set(['1', 'true', 'yes', 'on', 'enabled']);

function coerceFlag(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value > 0 : undefined;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return undefined;
    return truthySet.has(normalized);
  }
  return undefined;
}

function parseFeatureFlags(input: unknown): FeatureFlags {
  if (!input) return {};
  if (Array.isArray(input)) {
    return input.reduce<FeatureFlags>((acc, key) => {
      const flagKey = typeof key === 'string' ? key.trim() : '';
      if (flagKey) acc[flagKey] = true;
      return acc;
    }, {});
  }
  if (typeof input === 'string') {
    return input
      .split(/[,\s]+/g)
      .map((token) => token.trim())
      .filter(Boolean)
      .reduce<FeatureFlags>((acc, token) => {
        acc[token] = true;
        return acc;
      }, {});
  }
  const record = toRecord(input);
  if (!record) return {};
  return Object.entries(record).reduce<FeatureFlags>((acc, [key, value]) => {
    const coerced = coerceFlag(value);
    if (coerced !== undefined) acc[key] = coerced;
    return acc;
  }, {});
}

export function getFeatureFlags(): FeatureFlags {
  const runtime = getRuntimeConfig();
  const runtimeRecord = toRecord(runtime);
  const runtimeFlags = parseFeatureFlags(runtimeRecord?.featureFlags ?? runtimeRecord?.features ?? runtimeRecord?.flags);
  const globalFlags = parseFeatureFlags(window.__MEMALERTS_FEATURE_FLAGS__);
  return { ...runtimeFlags, ...globalFlags };
}

export function isFeatureEnabled(flag: string, defaultValue = false): boolean {
  const flags = getFeatureFlags();
  return flag in flags ? flags[flag] : defaultValue;
}
