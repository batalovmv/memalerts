import { describe, expect, it } from 'vitest';
import { updateChannelSettingsSchema } from '../src/shared/schemas.js';

describe('boostyDiscordTierRoles validation', () => {
  it('rejects duplicate tier', () => {
    const body = {
      boostyDiscordTierRoles: [
        { tier: 'Tier1', roleId: 'r1' },
        { tier: 'tier1', roleId: 'r2' },
      ],
    };
    const result = updateChannelSettingsSchema.safeParse(body);
    expect(result.success).toBe(false);
  });

  it('rejects duplicate roleId', () => {
    const body = {
      boostyDiscordTierRoles: [
        { tier: 'tier1', roleId: 'r1' },
        { tier: 'tier2', roleId: 'r1' },
      ],
    };
    const result = updateChannelSettingsSchema.safeParse(body);
    expect(result.success).toBe(false);
  });
});
