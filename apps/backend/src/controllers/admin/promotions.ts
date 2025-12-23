import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';

// Promotion management
export const getPromotions = async (req: AuthRequest, res: Response) => {
  const channelId = req.channelId;
  if (!channelId) {
    return res.status(400).json({ error: 'Channel ID required' });
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
  } catch (error: any) {
    console.error('Error in getPromotions:', error);
    if (!res.headersSent) {
      // If timeout or table doesn't exist, return empty array
      if (error.message?.includes('timeout') || error.message?.includes('does not exist') || error.code === 'P2021') {
        return res.json([]);
      }
      return res.status(500).json({
        error: 'Failed to load promotions',
        message: 'An error occurred while loading promotions',
      });
    }
  }
};

export const createPromotion = async (req: AuthRequest, res: Response) => {
  const channelId = req.channelId;
  if (!channelId) {
    return res.status(400).json({ error: 'Channel ID required' });
  }

  try {
    const { createPromotionSchema } = await import('../../shared/index.js');
    const body = createPromotionSchema.parse(req.body);

    // Validate dates
    const startDate = new Date(body.startDate);
    const endDate = new Date(body.endDate);
    if (endDate <= startDate) {
      return res.status(400).json({ error: 'End date must be after start date' });
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
    return res.status(400).json({ error: 'Channel ID required' });
  }

  try {
    const { updatePromotionSchema } = await import('../../shared/index.js');
    const body = updatePromotionSchema.parse(req.body);

    // Check promotion belongs to channel
    const promotion = await prisma.promotion.findUnique({
      where: { id },
    });

    if (!promotion || promotion.channelId !== channelId) {
      return res.status(404).json({ error: 'Promotion not found' });
    }

    const updateData: any = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.discountPercent !== undefined) updateData.discountPercent = body.discountPercent;
    if (body.startDate !== undefined) updateData.startDate = new Date(body.startDate);
    if (body.endDate !== undefined) updateData.endDate = new Date(body.endDate);
    if (body.isActive !== undefined) updateData.isActive = body.isActive;

    // Validate dates if both are provided
    if (updateData.startDate && updateData.endDate && updateData.endDate <= updateData.startDate) {
      return res.status(400).json({ error: 'End date must be after start date' });
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
    return res.status(400).json({ error: 'Channel ID required' });
  }

  try {
    const promotion = await prisma.promotion.findUnique({
      where: { id },
    });

    if (!promotion || promotion.channelId !== channelId) {
      return res.status(404).json({ error: 'Promotion not found' });
    }

    await prisma.promotion.delete({
      where: { id },
    });

    res.json({ success: true });
  } catch (error) {
    throw error;
  }
};


