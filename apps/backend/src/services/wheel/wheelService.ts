export type WheelTier = 'small' | 'medium' | 'good' | 'big' | 'jackpot' | 'super';

const FREE_SPIN_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const TIERS: Array<{ tier: WheelTier; chance: number; multiplier: number; label: string }> = [
  { tier: 'small', chance: 0.4, multiplier: 0.05, label: 'Small prize' },
  { tier: 'medium', chance: 0.3, multiplier: 0.2, label: 'Medium prize' },
  { tier: 'good', chance: 0.15, multiplier: 0.5, label: 'Good prize' },
  { tier: 'big', chance: 0.1, multiplier: 1.0, label: 'Big prize' },
  { tier: 'jackpot', chance: 0.04, multiplier: 2.0, label: 'Jackpot' },
  { tier: 'super', chance: 0.01, multiplier: 5.0, label: 'Super jackpot' },
];

export function normalizePrizeMultiplier(value: number | null | undefined): number {
  const v = typeof value === 'number' && Number.isFinite(value) ? value : 1;
  if (v < 0.5) return 0.5;
  if (v > 2.0) return 2.0;
  return v;
}

export function computePaidSpinCost(avgPriceCoins: number, override: number | null | undefined): number {
  if (typeof override === 'number' && Number.isFinite(override) && override > 0) {
    return Math.max(1, Math.round(override));
  }
  return Math.max(1, Math.round(avgPriceCoins * 0.5));
}

export function pickPrize(avgPriceCoins: number, multiplier: number) {
  const roll = Math.random();
  let acc = 0;
  let picked = TIERS[TIERS.length - 1];
  for (const tier of TIERS) {
    acc += tier.chance;
    if (roll <= acc) {
      picked = tier;
      break;
    }
  }

  const coins = Math.max(0, Math.round(avgPriceCoins * picked.multiplier * multiplier));
  return {
    tier: picked.tier,
    coins,
    label: picked.label,
  };
}

export function computeFreeSpinState(lastFreeSpinAt: Date | null, now: Date) {
  if (!lastFreeSpinAt) {
    return { freeSpinAvailable: true, nextFreeSpinAt: null, cooldownSecondsRemaining: 0 };
  }
  const next = new Date(lastFreeSpinAt.getTime() + FREE_SPIN_COOLDOWN_MS);
  const remaining = Math.max(0, Math.ceil((next.getTime() - now.getTime()) / 1000));
  return {
    freeSpinAvailable: now >= next,
    nextFreeSpinAt: next,
    cooldownSecondsRemaining: remaining,
  };
}
