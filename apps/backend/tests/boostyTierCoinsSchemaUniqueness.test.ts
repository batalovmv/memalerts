import { describe, expect, it } from 'vitest';
import { updateChannelSettingsSchema } from '../src/shared/index.js';

describe('updateChannelSettingsSchema boostyTierCoins uniqueness (case-insensitive)', () => {
  it('rejects duplicate tierKey after normalization (Tier-2 vs tier-2)', () => {
    const res = updateChannelSettingsSchema.safeParse({
      boostyTierCoins: [
        { tierKey: 'Tier-2', coins: 100 },
        { tierKey: 'tier-2', coins: 250 },
      ],
    });

    expect(res.success).toBe(false);
    if (res.success) return;

    const issues = res.error.issues;

    // 1) Ошибка относится к boostyTierCoins
    expect(issues.some((it) => it.path.includes('boostyTierCoins'))).toBe(true);

    // 2) Сообщение содержит стабильный маркер
    expect(issues.some((it) => /duplicate/i.test(String(it.message ?? '')))).toBe(true);

    // 3) Опционально: содержит нормализованный ключ
    expect(issues.some((it) => String(it.message ?? '').includes('tier-2'))).toBe(true);
  });
});
