import type { Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { ERROR_CODES, ERROR_MESSAGES, type ErrorCode } from '../shared/errors.js';

type NotFoundConfig = {
  errorCode?: ErrorCode;
  entity?: string;
  id?: string | null;
};

function respondNotFound(res: Response, cfg: NotFoundConfig) {
  const errorCode = cfg.errorCode ?? ERROR_CODES.NOT_FOUND;
  const error = ERROR_MESSAGES[errorCode] ?? 'Not found';
  return res.status(404).json({
    errorCode,
    error,
    ...(cfg.entity || cfg.id ? { details: { entity: cfg.entity ?? 'resource', id: cfg.id ?? null } } : {}),
  });
}

export function assertAdmin(userRole: string | undefined, res: Response): boolean {
  if (userRole === 'admin') return true;
  res.status(403).json({
    errorCode: ERROR_CODES.ROLE_REQUIRED,
    error: ERROR_MESSAGES.ROLE_REQUIRED,
    details: { requiredRoles: ['admin'], role: userRole ?? null },
  });
  return false;
}

export async function assertSubmissionOwner(userId: string | undefined, submissionId: string, res: Response) {
  if (!userId) {
    res.status(401).json({ errorCode: ERROR_CODES.UNAUTHORIZED, error: ERROR_MESSAGES.UNAUTHORIZED });
    return null;
  }

  const submission = await prisma.memeSubmission.findUnique({
    where: { id: submissionId },
    select: { id: true, channelId: true, submitterUserId: true, status: true, revision: true },
  });

  if (!submission || submission.submitterUserId !== userId) {
    respondNotFound(res, { errorCode: ERROR_CODES.SUBMISSION_NOT_FOUND, entity: 'submission', id: submissionId });
    return null;
  }

  return submission;
}

export async function assertChannelOwner(params: {
  userId?: string | null;
  requestChannelId?: string | null;
  channelId?: string | null;
  channelSlug?: string | null;
  res: Response;
  notFound?: NotFoundConfig;
}): Promise<string | null> {
  const { userId, requestChannelId, channelId, channelSlug, res, notFound } = params;
  let targetChannelId = channelId ? String(channelId).trim() : '';

  if (!targetChannelId && channelSlug) {
    const channel = await prisma.channel.findFirst({
      where: { slug: { equals: String(channelSlug).trim(), mode: 'insensitive' } },
      select: { id: true },
    });
    if (!channel) {
      respondNotFound(res, { errorCode: ERROR_CODES.CHANNEL_NOT_FOUND, entity: 'channel', id: String(channelSlug) });
      return null;
    }
    targetChannelId = channel.id;
  }

  if (!targetChannelId) {
    respondNotFound(res, notFound ?? { errorCode: ERROR_CODES.CHANNEL_NOT_FOUND, entity: 'channel', id: null });
    return null;
  }

  let ownerChannelId = requestChannelId ? String(requestChannelId).trim() : '';
  if (!ownerChannelId && userId) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { channelId: true } });
    ownerChannelId = user?.channelId ? String(user.channelId) : '';
  }

  if (!ownerChannelId) {
    res.status(400).json({ errorCode: ERROR_CODES.MISSING_CHANNEL_ID, error: ERROR_MESSAGES.MISSING_CHANNEL_ID });
    return null;
  }

  if (ownerChannelId !== targetChannelId) {
    respondNotFound(res, notFound ?? { errorCode: ERROR_CODES.NOT_FOUND, entity: 'channel', id: targetChannelId });
    return null;
  }

  return targetChannelId;
}
