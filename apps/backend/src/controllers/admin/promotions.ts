import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { ERROR_CODES, ERROR_MESSAGES } from '../../shared/errors.js';
import { logger } from '../../utils/logger.js';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

// Promotion management
export const getPromotions = async (req: AuthRequest, res: Response) => {
  const channelId = req.channelId;
  if (!channelId) {
    return res
      .status(400)
      .json({ errorCode: ERROR_CODES.MISSING_CHANNEL_ID, error: ERROR_MESSAGES.MISSING_CHANNEL_ID });
  }

  try {
    // Add timeout protection for promotions query
    const promotionsPromise = prisma.promotion.findMany({
      where: { channelId },
      orderBy: { createdAt: 'desc' },
    });

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Promotions query timeout')), 5000); // 5 second timeout
    });

    const promotions = await Promise.race([promotionsPromise, timeoutPromise]);
    res.json(promotions);
  } catch (error: unknown) {
    const err = error as Error;
    logger.error('admin.promotions.fetch_failed', { errorMessage: err.message });
    if (!res.headersSent) {
      // If timeout or table doesn't exist, return empty array
      const errorRec = asRecord(error);
      const message = typeof errorRec.message === 'string' ? errorRec.message : '';
      const code = typeof errorRec.code === 'string' ? errorRec.code : '';
      if (message.includes('timeout') || message.includes('does not exist') || code === 'P2021') {
        return res.json([]);
      }
      return res.status(500).json({
        errorCode: ERROR_CODES.INTERNAL_ERROR,
        error: ERROR_MESSAGES.INTERNAL_ERROR,
      });
    }
  }
};

export const createPromotion = async (req: AuthRequest, res: Response) => {
  const channelId = req.channelId;
  if (!channelId) {
    return res
      .status(400)
      .json({ errorCode: ERROR_CODES.MISSING_CHANNEL_ID, error: ERROR_MESSAGES.MISSING_CHANNEL_ID });
  }

  try {
    const { createPromotionSchema } = await import('../../shared/schemas.js');
    const body = createPromotionSchema.parse(req.body);

    // Validate dates
    const startDate = new Date(body.startDate);
    const endDate = new Date(body.endDate);
    if (endDate <= startDate) {
      return res.status(400).json({ errorCode: ERROR_CODES.BAD_REQUEST, error: 'End date must be after start date' });
    }

    const promotion = await prisma.promotion.create({
      data: {
        channelId,
        name: body.name,
        discountPercent: body.discountPercent,
        startDate,
        endDate,
      },
    });

    res.status(201).json(promotion);
  } catch (error) {
    throw error;
  }
};

export const updatePromotion = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const channelId = req.channelId;
  if (!channelId) {
    return res
      .status(400)
      .json({ errorCode: ERROR_CODES.MISSING_CHANNEL_ID, error: ERROR_MESSAGES.MISSING_CHANNEL_ID });
  }

  try {
    const { updatePromotionSchema } = await import('../../shared/schemas.js');
    const body = updatePromotionSchema.parse(req.body);

    // Check promotion belongs to channel
    const promotion = await prisma.promotion.findUnique({
      where: { id },
    });

    if (!promotion || promotion.channelId !== channelId) {
      return res.status(404).json({ errorCode: ERROR_CODES.NOT_FOUND, error: 'Promotion not found' });
    }

    const updateData: Record<string, unknown> = {};
    const startDate = body.startDate !== undefined ? new Date(body.startDate) : undefined;
    const endDate = body.endDate !== undefined ? new Date(body.endDate) : undefined;
    if (body.name !== undefined) updateData.name = body.name;
    if (body.discountPercent !== undefined) updateData.discountPercent = body.discountPercent;
    if (startDate) updateData.startDate = startDate;
    if (endDate) updateData.endDate = endDate;
    if (body.isActive !== undefined) updateData.isActive = body.isActive;

    // Validate dates if both are provided
    if (startDate && endDate && endDate <= startDate) {
      return res.status(400).json({ errorCode: ERROR_CODES.BAD_REQUEST, error: 'End date must be after start date' });
    }

    const updated = await prisma.promotion.update({
      where: { id },
      data: updateData,
    });

    res.json(updated);
  } catch (error) {
    throw error;
  }
};

export const deletePromotion = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const channelId = req.channelId;
  if (!channelId) {
    return res
      .status(400)
      .json({ errorCode: ERROR_CODES.MISSING_CHANNEL_ID, error: ERROR_MESSAGES.MISSING_CHANNEL_ID });
  }

  try {
    const promotion = await prisma.promotion.findUnique({
      where: { id },
    });

    if (!promotion || promotion.channelId !== channelId) {
      return res.status(404).json({ errorCode: ERROR_CODES.NOT_FOUND, error: 'Promotion not found' });
    }

    await prisma.promotion.delete({
      where: { id },
    });

    res.json({ success: true });
  } catch (error) {
    throw error;
  }
};
