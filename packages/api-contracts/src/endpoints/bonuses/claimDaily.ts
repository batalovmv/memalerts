import { z } from 'zod';

import { EconomySchema } from '../../entities/economy';
import { WalletSchema } from '../../entities/user';

export const ClaimDailyBonusParamsSchema = z.object({
  slug: z.string(),
});

export const ClaimDailyBonusResponseSchema = z.object({
  wallet: WalletSchema,
  economy: EconomySchema,
  bonusCoins: z.number().optional(),
  startBonusCoins: z.number().optional(),
});

export type ClaimDailyBonusParams = z.infer<typeof ClaimDailyBonusParamsSchema>;
export type ClaimDailyBonusResponse = z.infer<typeof ClaimDailyBonusResponseSchema>;
