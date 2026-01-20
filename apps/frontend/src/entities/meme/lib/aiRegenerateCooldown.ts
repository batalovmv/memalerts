const cooldownMap = new Map<string, number>(); // key -> epochMs

export function getAiRegenerateCooldownUntilMs(key: string): number | null {
  const v = cooldownMap.get(key);
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return v;
}

export function setAiRegenerateCooldownUntilMs(key: string, untilMs: number): void {
  if (!Number.isFinite(untilMs)) return;
  cooldownMap.set(key, untilMs);
}


