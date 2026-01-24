import type { Response } from 'express';
import { ZodError } from 'zod';
import { PrismaClientKnownRequestError, PrismaClientUnknownRequestError } from '@prisma/client/runtime/library';
import { logger } from '../../utils/logger.js';
import { debugError, debugLog } from '../../utils/debug.js';
import { decrementFileHashReference } from '../../utils/fileHash.js';
import { asRecord } from './submissionShared.js';
import type { ApprovalSubmission } from './submissionApproveFileOps.js';

export async function handleApproveSubmissionError(opts: {
  error: unknown;
  res: Response;
  submission: ApprovalSubmission | null;
  submissionId: string;
  fileHashRefAdded: boolean;
  fileHashForCleanup: string | null;
}): Promise<void> {
  const { error, res, submission, submissionId, fileHashRefAdded, fileHashForCleanup } = opts;
  debugError('[DEBUG] Error in approveSubmission', error);
  const err = error instanceof Error ? error : new Error(String(error));
  logger.error('admin.submissions.approve_failed', { errorMessage: err.message });
  const errorMessage = err.message;
  const submissionRec = asRecord(submission);

  if (fileHashRefAdded && fileHashForCleanup) {
    try {
      await decrementFileHashReference(fileHashForCleanup);
    } catch {
      // ignore
    }
  }

  if (res.headersSent) {
    logger.error('admin.submissions.approve_failed_after_response', { errorMessage });
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      error: 'Validation error',
      message: 'Validation failed',
      details: error.errors,
    });
    return;
  }

  if (error instanceof PrismaClientKnownRequestError || error instanceof PrismaClientUnknownRequestError) {
    const errorCode = error instanceof PrismaClientKnownRequestError ? error.code : undefined;
    const errorMeta = error instanceof PrismaClientKnownRequestError ? error.meta : undefined;
    const metaRecord = (errorMeta && typeof errorMeta === 'object' ? (errorMeta as Record<string, unknown>) : {}) as {
      target?: unknown;
    };
    const errorTarget = Array.isArray(metaRecord.target)
      ? metaRecord.target.map((t) => String(t)).join(',')
      : String(metaRecord.target ?? '');

    debugLog('[DEBUG] Prisma error in approveSubmission', {
      submissionId: submissionId,
      errorCode,
      errorMessage: error.message,
      meta: errorMeta,
    });
    logger.error('admin.submissions.approve_prisma_failed', {
      submissionId: submissionId,
      errorMessage: error.message,
      errorCode,
      errorMeta,
    });

    if (
      error.message?.includes('current transaction is aborted') ||
      error.message?.includes('25P02') ||
      errorCode === 'P2025'
    ) {
      res.status(500).json({
        error: 'Database transaction error',
        message: 'Transaction was aborted. Please try again.',
      });
      return;
    }

    if (errorCode === 'P2002' && errorTarget.includes('channelId') && errorTarget.includes('memeAssetId')) {
      res.status(409).json({
        errorCode: 'SUBMISSION_ALREADY_APPROVED',
        error: 'Submission already approved for this asset',
        details: { id: submissionId, target: errorTarget },
      });
      return;
    }

    if (errorCode === 'P2025') {
      res.status(404).json({
        error: 'Record not found',
        message: 'The requested record was not found in the database.',
      });
      return;
    }

    res.status(500).json({
      error: 'Database error',
      message:
        process.env.NODE_ENV === 'development'
          ? `Database error: ${error.message}${errorCode ? ` (code: ${errorCode})` : ''}`
          : 'An error occurred while processing the request. Please try again.',
    });
    return;
  }

  if (errorMessage === 'SUBMISSION_NOT_FOUND') {
    res.status(404).json({
      errorCode: 'SUBMISSION_NOT_FOUND',
      error: 'Submission not found',
      details: { entity: 'submission', id: submissionId },
    });
    return;
  }
  if (errorMessage === 'SUBMISSION_NOT_PENDING') {
    res.status(409).json({
      errorCode: 'SUBMISSION_NOT_PENDING',
      error: 'Submission is not pending',
      details: {
        entity: 'submission',
        id: submissionId,
        expectedStatus: 'pending',
        actualStatus: submissionRec.status ?? null,
      },
    });
    return;
  }

  if (err.message === 'MEME_ASSET_NOT_FOUND') {
    res.status(404).json({
      errorCode: 'MEME_ASSET_NOT_FOUND',
      error: 'Meme asset not found',
      details: { entity: 'memeAsset', id: submissionRec.memeAssetId ?? null },
    });
    return;
  }
  if (err.message === 'MEME_ASSET_DELETED') {
    res.status(410).json({
      errorCode: 'ASSET_PURGED_OR_QUARANTINED',
      error: 'This meme was deleted and cannot be approved',
      details: { legacyErrorCode: 'MEME_ASSET_DELETED', fileHash: null },
    });
    return;
  }
  if (err.message === 'MEDIA_NOT_AVAILABLE') {
    res.status(410).json({
      errorCode: 'MEDIA_NOT_AVAILABLE',
      error: 'Media not available',
      details: { entity: 'memeAsset', id: submissionRec.memeAssetId ?? null, reason: 'missing_fileUrl' },
    });
    return;
  }

  if (err.message === 'Uploaded file not found') {
    res.status(404).json({
      errorCode: 'MEDIA_NOT_AVAILABLE',
      error: 'Media not available',
      details: { entity: 'upload', id: submissionId, path: submissionRec.fileUrlTemp ?? null, reason: 'file_missing_on_disk' },
    });
    return;
  }

  if (
    err.message.includes('Hash calculation timeout') ||
    err.message.includes('file') ||
    err.message.includes('File') ||
    err.message.includes('Invalid file path') ||
    err.message.includes('Uploaded file not found')
  ) {
    logger.error('admin.submissions.file_operation_failed', {
      errorMessage: err.message,
      submissionId: submissionId,
      fileUrlTemp: submissionRec.fileUrlTemp,
      stack: err.stack,
    });
    res.status(500).json({
      error: 'File operation error',
      message: err.message.includes('not found')
        ? 'The uploaded file was not found. Please try uploading again.'
        : 'An error occurred while processing the file. Please try again.',
    });
    return;
  }

  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'An error occurred while processing the request',
  });
}
