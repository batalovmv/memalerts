export type FeatureFlags = Record<string, boolean>;

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

export function parseFeatureFlags(input: unknown): FeatureFlags {
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
  if (!input || typeof input !== 'object') return {};
  return Object.entries(input as Record<string, unknown>).reduce<FeatureFlags>((acc, [key, value]) => {
    const coerced = coerceFlag(value);
    if (coerced !== undefined) acc[key] = coerced;
    return acc;
  }, {});
}

let cachedFlags: FeatureFlags | null = null;

function readFeatureFlagsJson(): unknown {
  const raw = process.env.FEATURE_FLAGS_JSON;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function getFeatureFlags(): FeatureFlags {
  if (cachedFlags) return cachedFlags;
  const fromEnv = parseFeatureFlags(process.env.FEATURE_FLAGS);
  const fromJson = parseFeatureFlags(readFeatureFlagsJson());
  cachedFlags = { ...fromEnv, ...fromJson };
  return cachedFlags;
}

export function isFeatureEnabled(flag: string, defaultValue = false): boolean {
  const flags = getFeatureFlags();
  return flag in flags ? flags[flag] : defaultValue;
}
