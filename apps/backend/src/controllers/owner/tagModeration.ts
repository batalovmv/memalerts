import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { auditLog, getRequestMetadata } from '../../utils/auditLogger.js';
import { invalidateTagCache, normalizeTagName } from '../../utils/ai/tagMapping.js';

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}

export const tagModerationController = {
  // GET /owner/tag-suggestions?status=pending|approved|rejected|mapped|all&q=...&limit=...&offset=...
  listSuggestions: async (req: AuthRequest, res: Response) => {
    const query = req.query as Record<string, unknown>;
    const status = String(query.status || 'pending').toLowerCase();
    const qRaw = String(query.q || '').trim();
    const q = qRaw.length > 100 ? qRaw.slice(0, 100) : qRaw;

    const limitRaw = parseInt(String(query.limit ?? ''), 10);
    const offsetRaw = parseInt(String(query.offset ?? ''), 10);
    const limit = clampInt(Number.isFinite(limitRaw) ? limitRaw : 50, 1, 500, 50);
    const offset = clampInt(Number.isFinite(offsetRaw) ? offsetRaw : 0, 0, 1_000_000, 0);

    const where: Prisma.TagSuggestionWhereInput = {};
    if (status !== 'all') {
      if (!['pending', 'approved', 'rejected', 'mapped'].includes(status)) {
        return res
          .status(400)
          .json({ errorCode: 'BAD_REQUEST', error: 'Invalid status filter', requestId: req.requestId });
      }
      where.status = status;
    }

    if (q) {
      where.OR = [
        { rawTag: { contains: q, mode: 'insensitive' } },
        { normalizedTag: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [total, rows] = await Promise.all([
      prisma.tagSuggestion.count({ where }),
      prisma.tagSuggestion.findMany({
        where,
        orderBy: [{ count: 'desc' }, { createdAt: 'desc' }],
        take: limit,
        skip: offset,
        select: {
          id: true,
          rawTag: true,
          normalizedTag: true,
          count: true,
          status: true,
          mappedToTagId: true,
          createdAt: true,
          reviewedAt: true,
          memeAssetId: true,
          mappedTo: { select: { id: true, name: true, displayName: true } },
          memeAsset: { select: { id: true, aiAutoTitle: true, fileUrl: true } },
        },
      }),
    ]);

    res.setHeader('X-Limit', String(limit));
    res.setHeader('X-Offset', String(offset));
    res.setHeader('X-Total', String(total));
    return res.json(rows);
  },

  // GET /owner/tags?status=active|pending|deprecated|all&q=...&limit=...&offset=...
  listTags: async (req: AuthRequest, res: Response) => {
    const query = req.query as Record<string, unknown>;
    const status = String(query.status || 'active').toLowerCase();
    const qRaw = String(query.q || '').trim();
    const q = qRaw.length > 100 ? qRaw.slice(0, 100) : qRaw;

    const limitRaw = parseInt(String(query.limit ?? ''), 10);
    const offsetRaw = parseInt(String(query.offset ?? ''), 10);
    const limit = clampInt(Number.isFinite(limitRaw) ? limitRaw : 100, 1, 500, 100);
    const offset = clampInt(Number.isFinite(offsetRaw) ? offsetRaw : 0, 0, 1_000_000, 0);

    const where: Prisma.TagWhereInput = {};
    if (status !== 'all') {
      if (!['active', 'pending', 'deprecated'].includes(status)) {
        return res
          .status(400)
          .json({ errorCode: 'BAD_REQUEST', error: 'Invalid status filter', requestId: req.requestId });
      }
      where.status = status;
    }

    if (q) {
      where.OR = [{ name: { contains: q, mode: 'insensitive' } }, { displayName: { contains: q, mode: 'insensitive' } }];
    }

    const [total, rows] = await Promise.all([
      prisma.tag.count({ where }),
      prisma.tag.findMany({
        where,
        orderBy: [{ usageCount: 'desc' }, { createdAt: 'desc' }],
        take: limit,
        skip: offset,
        select: {
          id: true,
          name: true,
          displayName: true,
          status: true,
          usageCount: true,
          category: { select: { id: true, slug: true, displayName: true } },
        },
      }),
    ]);

    res.setHeader('X-Limit', String(limit));
    res.setHeader('X-Offset', String(offset));
    res.setHeader('X-Total', String(total));
    return res.json(rows);
  },

  // GET /owner/tag-categories
  listCategories: async (_req: AuthRequest, res: Response) => {
    const rows = await prisma.tagCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { displayName: 'asc' }],
      select: { id: true, slug: true, displayName: true, sortOrder: true },
    });
    return res.json(rows);
  },

  // POST /owner/tag-suggestions/:id/approve
  approveSuggestion: async (req: AuthRequest, res: Response) => {
    const suggestionId = String(req.params.id || '');
    const body = req.body as Record<string, unknown>;
    const { ipAddress, userAgent } = getRequestMetadata(req);

    const suggestion = await prisma.tagSuggestion.findUnique({
      where: { id: suggestionId },
      select: { id: true, rawTag: true, normalizedTag: true, status: true },
    });
    if (!suggestion) {
      return res.status(404).json({ errorCode: 'NOT_FOUND', error: 'Not found', requestId: req.requestId });
    }

    const nameRaw =
      typeof body.name === 'string'
        ? body.name
        : typeof body.tagName === 'string'
          ? body.tagName
          : suggestion.normalizedTag || suggestion.rawTag;
    const canonicalName = normalizeTagName(nameRaw);
    if (!canonicalName) {
      return res
        .status(400)
        .json({ errorCode: 'BAD_REQUEST', error: 'Invalid tag name', requestId: req.requestId });
    }

    const displayNameRaw =
      typeof body.displayName === 'string' ? body.displayName : suggestion.rawTag || canonicalName;
    const displayName = String(displayNameRaw || '').trim().slice(0, 80) || null;

    const categoryIdRaw = typeof body.categoryId === 'string' ? body.categoryId : null;
    const categorySlugRaw = typeof body.categorySlug === 'string' ? body.categorySlug : null;
    let categoryId = categoryIdRaw;
    if (!categoryId && categorySlugRaw) {
      const category = await prisma.tagCategory.findUnique({
        where: { slug: String(categorySlugRaw).trim() },
        select: { id: true },
      });
      categoryId = category?.id ?? null;
    }

    try {
      const tag = await prisma.tag.upsert({
        where: { name: canonicalName },
        update: {
          ...(displayName ? { displayName } : {}),
          ...(categoryId ? { categoryId } : {}),
          status: 'active',
        },
        create: {
          name: canonicalName,
          ...(displayName ? { displayName } : {}),
          ...(categoryId ? { categoryId } : {}),
          status: 'active',
        },
        select: { id: true, name: true, displayName: true, categoryId: true },
      });

      const updated = await prisma.tagSuggestion.update({
        where: { id: suggestionId },
        data: {
          status: 'approved',
          mappedToTagId: tag.id,
          reviewedAt: new Date(),
          reviewedById: req.userId!,
        },
        select: { id: true, status: true, mappedToTagId: true },
      });

      invalidateTagCache();

      await auditLog({
        action: 'owner.tag_suggestion.approve',
        actorId: req.userId!,
        payload: { suggestionId, tagId: tag.id, name: canonicalName, categoryId },
        ipAddress,
        userAgent,
        success: true,
      });

      return res.json({ suggestion: updated, tag });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await auditLog({
        action: 'owner.tag_suggestion.approve',
        actorId: req.userId || null,
        payload: { suggestionId, name: canonicalName, categoryId },
        ipAddress,
        userAgent,
        success: false,
        error: errorMessage,
      });
      return res.status(400).json({ errorCode: 'BAD_REQUEST', error: 'Bad request', requestId: req.requestId });
    }
  },

  // POST /owner/tag-suggestions/:id/map
  mapSuggestion: async (req: AuthRequest, res: Response) => {
    const suggestionId = String(req.params.id || '');
    const body = req.body as Record<string, unknown>;
    const { ipAddress, userAgent } = getRequestMetadata(req);

    const suggestion = await prisma.tagSuggestion.findUnique({
      where: { id: suggestionId },
      select: { id: true, rawTag: true, normalizedTag: true },
    });
    if (!suggestion) {
      return res.status(404).json({ errorCode: 'NOT_FOUND', error: 'Not found', requestId: req.requestId });
    }

    const tagIdRaw = typeof body.tagId === 'string' ? body.tagId : null;
    const tagNameRaw = typeof body.tagName === 'string' ? body.tagName : null;
    let tag = null as { id: string; name: string } | null;

    if (tagIdRaw) {
      tag = await prisma.tag.findUnique({ where: { id: tagIdRaw }, select: { id: true, name: true } });
    } else if (tagNameRaw) {
      const normalized = normalizeTagName(tagNameRaw);
      if (normalized) {
        tag = await prisma.tag.findUnique({ where: { name: normalized }, select: { id: true, name: true } });
      }
    }

    if (!tag) {
      return res
        .status(404)
        .json({ errorCode: 'NOT_FOUND', error: 'Tag not found', requestId: req.requestId });
    }

    const alias = normalizeTagName(suggestion.normalizedTag || suggestion.rawTag);
    if (alias && alias !== tag.name) {
      await prisma.tagAlias.upsert({
        where: { alias },
        update: { tagId: tag.id },
        create: { alias, tagId: tag.id },
      });
    }

    const updated = await prisma.tagSuggestion.update({
      where: { id: suggestionId },
      data: {
        status: 'mapped',
        mappedToTagId: tag.id,
        reviewedAt: new Date(),
        reviewedById: req.userId!,
      },
      select: { id: true, status: true, mappedToTagId: true },
    });

    invalidateTagCache();

    await auditLog({
      action: 'owner.tag_suggestion.map',
      actorId: req.userId!,
      payload: { suggestionId, tagId: tag.id, alias },
      ipAddress,
      userAgent,
      success: true,
    });

    return res.json({ suggestion: updated, tag });
  },

  // POST /owner/tag-suggestions/:id/reject
  rejectSuggestion: async (req: AuthRequest, res: Response) => {
    const suggestionId = String(req.params.id || '');
    const { ipAddress, userAgent } = getRequestMetadata(req);

    try {
      const updated = await prisma.tagSuggestion.update({
        where: { id: suggestionId },
        data: {
          status: 'rejected',
          mappedToTagId: null,
          reviewedAt: new Date(),
          reviewedById: req.userId!,
        },
        select: { id: true, status: true },
      });

      await auditLog({
        action: 'owner.tag_suggestion.reject',
        actorId: req.userId!,
        payload: { suggestionId },
        ipAddress,
        userAgent,
        success: true,
      });

      return res.json(updated);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await auditLog({
        action: 'owner.tag_suggestion.reject',
        actorId: req.userId || null,
        payload: { suggestionId },
        ipAddress,
        userAgent,
        success: false,
        error: errorMessage,
      });
      return res.status(404).json({ errorCode: 'NOT_FOUND', error: 'Not found', requestId: req.requestId });
    }
  },
};
