import { z } from 'zod';

import { EconomySchema } from '../../entities/economy';
import { WalletSchema } from '../../entities/user';

export const ClaimWatchBonusParamsSchema = z.object({
  slug: z.string(),
});

export const ClaimWatchBonusResponseSchema = z.object({
  wallet: WalletSchema,
  economy: EconomySchema,
  bonusCoins: z.number().optional(),
  startBonusCoins: z.number().optional(),
});

export type ClaimWatchBonusParams = z.infer<typeof ClaimWatchBonusParamsSchema>;
export type ClaimWatchBonusResponse = z.infer<typeof ClaimWatchBonusResponseSchema>;
