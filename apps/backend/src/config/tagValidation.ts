function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  if (value < min) return min;
  if (value > max) return max;
  return Math.floor(value);
}

function clampFloat(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function envInt(name: string, fallback: number): number {
  const raw = parseInt(String(process.env[name] || ''), 10);
  return clampInt(raw, 0, 1_000_000, fallback);
}

function envFloat(name: string, fallback: number): number {
  const raw = parseFloat(String(process.env[name] || ''));
  return clampFloat(raw, 0, 1, fallback);
}

export const TAG_VALIDATION_CONFIG = {
  AI_VALIDATION_THRESHOLD: envInt('TAG_VALIDATION_THRESHOLD', 30),
  MIN_UNIQUE_USERS: envInt('TAG_VALIDATION_MIN_UNIQUE_USERS', 5),
  MIN_CONFIDENCE: envFloat('TAG_VALIDATION_MIN_CONFIDENCE', 0.8),
  AI_VALIDATION_RATE_LIMIT: envInt('TAG_VALIDATION_RATE_LIMIT', 100),
  DEPRECATE_AFTER_DAYS: envInt('TAG_DEPRECATE_AFTER_DAYS', 30),
  DEPRECATE_MIN_USAGE: envInt('TAG_DEPRECATE_MIN_USAGE', 10),
};
