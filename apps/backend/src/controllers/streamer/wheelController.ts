import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';

import { UpdateWheelSettingsBodySchema } from '@memalerts/api-contracts';

import { prisma } from '../../lib/prisma.js';
import { ERROR_CODES } from '../../shared/errors.js';
import { normalizePrizeMultiplier } from '../../services/wheel/wheelService.js';

export const getWheelSettings = async (req: AuthRequest, res: Response) => {
  const channelId = req.channelId;
  if (!channelId) {
    return res.status(400).json({ errorCode: ERROR_CODES.MISSING_CHANNEL_ID, error: 'Missing channelId' });
  }

  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { wheelEnabled: true, wheelPaidSpinCostCoins: true, wheelPrizeMultiplier: true },
  });
  if (!channel) {
    return res.status(404).json({ errorCode: ERROR_CODES.CHANNEL_NOT_FOUND, error: 'Channel not found' });
  }

  return res.json({
    enabled: channel.wheelEnabled !== false,
    paidSpinCostCoins: channel.wheelPaidSpinCostCoins ?? null,
    prizeMultiplier: normalizePrizeMultiplier(channel.wheelPrizeMultiplier),
  });
};

export const updateWheelSettings = async (req: AuthRequest, res: Response) => {
  const channelId = req.channelId;
  if (!channelId) {
    return res.status(400).json({ errorCode: ERROR_CODES.MISSING_CHANNEL_ID, error: 'Missing channelId' });
  }

  const body = UpdateWheelSettingsBodySchema.parse(req.body ?? {});
  const nextEnabled = body.enabled;
  const nextCost = body.paidSpinCostCoins;
  const nextMultiplier = body.prizeMultiplier;

  if (typeof nextCost === 'number' && nextCost < 0) {
    return res.status(400).json({ errorCode: ERROR_CODES.BAD_REQUEST, error: 'Invalid cost' });
  }

  const updated = await prisma.channel.update({
    where: { id: channelId },
    data: {
      wheelEnabled: typeof nextEnabled === 'boolean' ? nextEnabled : undefined,
      wheelPaidSpinCostCoins: typeof nextCost === 'number' ? Math.round(nextCost) : nextCost === null ? null : undefined,
      wheelPrizeMultiplier: typeof nextMultiplier === 'number' ? normalizePrizeMultiplier(nextMultiplier) : undefined,
    },
    select: { wheelEnabled: true, wheelPaidSpinCostCoins: true, wheelPrizeMultiplier: true },
  });

  return res.json({
    enabled: updated.wheelEnabled !== false,
    paidSpinCostCoins: updated.wheelPaidSpinCostCoins ?? null,
    prizeMultiplier: normalizePrizeMultiplier(updated.wheelPrizeMultiplier),
  });
};
