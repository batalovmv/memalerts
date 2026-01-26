import { Router, type Request, type RequestHandler } from 'express';
import {
  type ActivateMemeBody,
  type ActivateMemeParams,
  type ActivateMemeResponse,
  type ErrorResponse,
  ActivateMemeBodySchema,
  ActivateMemeParamsSchema,
  type GetMemeParams,
  type GetMemeResponse,
  GetMemeParamsSchema,
  type ListChannelMemesParams,
  type ListChannelMemesQuery,
  type ListChannelMemesResponse,
  ListChannelMemesParamsSchema,
  ListChannelMemesQuerySchema,
} from '@memalerts/api-contracts';
import { optionalAuth, requireAuth } from '../../middleware/auth.js';
import { apiErrorHandler } from '../../middleware/apiErrorHandler.js';
import { validateRequest } from '../../middleware/validation.js';
import * as handlers from './handlers.js';

const router = Router();
const uuidPattern = '[0-9a-fA-F-]{36}';

router.get<ListChannelMemesParams, ListChannelMemesResponse | ErrorResponse, unknown, ListChannelMemesQuery>(
  `/channels/:channelId(${uuidPattern})/memes`,
  optionalAuth as unknown as RequestHandler<
    ListChannelMemesParams,
    ListChannelMemesResponse | ErrorResponse,
    unknown,
    ListChannelMemesQuery
  >,
  validateRequest<ListChannelMemesParams, ListChannelMemesQuery>({
    params: ListChannelMemesParamsSchema,
    query: ListChannelMemesQuerySchema,
  }),
  handlers.listChannelMemes
);

router.get<GetMemeParams, GetMemeResponse | ErrorResponse>(
  `/memes/:memeId(${uuidPattern})`,
  optionalAuth as unknown as RequestHandler<GetMemeParams, GetMemeResponse | ErrorResponse>,
  validateRequest<GetMemeParams>({
    params: GetMemeParamsSchema,
  }),
  handlers.getMeme
);

router.post<ActivateMemeParams, ActivateMemeResponse | ErrorResponse, ActivateMemeBody>(
  `/memes/:memeId(${uuidPattern})/activate`,
  requireAuth as unknown as RequestHandler<ActivateMemeParams, ActivateMemeResponse | ErrorResponse, ActivateMemeBody>,
  validateRequest<ActivateMemeParams, Request['query'], ActivateMemeBody>({
    params: ActivateMemeParamsSchema,
    body: ActivateMemeBodySchema,
  }),
  handlers.activateMeme
);

router.use(apiErrorHandler);

export { router as memesRouter };
