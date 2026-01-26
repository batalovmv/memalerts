import type { Request, Response, NextFunction } from 'express';
import type {
  ActivateMemeBody,
  ActivateMemeParams,
  ActivateMemeResponse,
  ErrorResponse,
  GetMemeParams,
  GetMemeResponse,
  ListChannelMemesParams,
  ListChannelMemesQuery,
  ListChannelMemesResponse,
} from '@memalerts/api-contracts';
import type { AuthRequest } from '../../middleware/auth.js';
import { MemeService } from '../../../domain/meme/MemeService.js';
import { toMemeDetail, toMemeListItem } from './mappers.js';

const memeService = new MemeService();

export async function listChannelMemes(
  req: Request<ListChannelMemesParams, ListChannelMemesResponse, unknown, ListChannelMemesQuery>,
  res: Response<ListChannelMemesResponse>,
  next: NextFunction
) {
  try {
    const { channelId } = req.params;
    const { limit, offset, sortBy, sortOrder, tags, search } = req.query;

    const parsedTags = tags
      ? tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean)
      : undefined;

    const result = await memeService.listChannelMemes({
      channelId,
      limit,
      offset,
      sortBy,
      sortOrder,
      tags: parsedTags,
      search,
    });

    const response: ListChannelMemesResponse = {
      success: true,
      data: {
        items: result.items.map(toMemeListItem),
        pagination: {
          total: result.total,
          limit,
          offset,
          hasMore: offset + result.items.length < result.total,
        },
      },
    };

    res.json(response);
  } catch (error) {
    next(error as Error);
  }
}

export async function getMeme(
  req: Request<GetMemeParams, GetMemeResponse>,
  res: Response<GetMemeResponse | ErrorResponse>,
  next: NextFunction
) {
  try {
    const { memeId } = req.params;
    const meme = await memeService.getMemeById(memeId);

    if (!meme) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Meme not found',
        },
      });
    }

    const response: GetMemeResponse = {
      success: true,
      data: toMemeDetail(meme),
    };

    res.json(response);
  } catch (error) {
    next(error as Error);
  }
}

export async function activateMeme(
  req: Request<ActivateMemeParams, ActivateMemeResponse, ActivateMemeBody>,
  res: Response<ActivateMemeResponse | ErrorResponse>,
  next: NextFunction
) {
  try {
    const { memeId } = req.params;
    const { channelId, volume } = req.body;
    const userId = (req as AuthRequest).userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Unauthorized',
        },
      });
    }

    const result = await memeService.activateMeme({
      memeId,
      channelId,
      userId,
      volume,
    });

    const response: ActivateMemeResponse = {
      success: true,
      data: {
        activationId: result.activationId,
        balanceAfter: result.balanceAfter,
        cooldownUntil: result.cooldownUntil?.toISOString() ?? null,
      },
    };

    res.json(response);
  } catch (error) {
    next(error as Error);
  }
}
