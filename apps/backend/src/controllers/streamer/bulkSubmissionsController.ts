import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { ZodError } from 'zod';
import { adminController } from '../adminController.js';
import { bulkSubmissionsSchema } from '../../shared/schemas.js';

type HandlerResult = {
  statusCode: number;
  body: unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

type MockResponse = {
  statusCode: number;
  body: unknown;
  headersSent: boolean;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
};

function createMockRes(): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    body: undefined,
    headersSent: false,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      this.headersSent = true;
      return this;
    },
  };
  return res;
}

async function invokeHandler(
  handler: (req: AuthRequest, res: Response) => Promise<unknown> | unknown,
  reqBase: AuthRequest,
  params: Record<string, unknown>,
  body: unknown
): Promise<HandlerResult> {
  const reqMock = {
    app: reqBase.app,
    userId: reqBase.userId,
    userRole: reqBase.userRole,
    channelId: reqBase.channelId,
    params,
    body,
  } as AuthRequest;
  const resMock = createMockRes();

  try {
    await handler(reqMock, resMock as unknown as Response);
  } catch (error) {
    const err = error as Error;
    return {
      statusCode: 500,
      body: {
        error: 'Internal server error',
        message: err.message || 'Unhandled error',
      },
    };
  }

  if (!resMock.headersSent) {
    return {
      statusCode: resMock.statusCode || 500,
      body: resMock.body ?? { error: 'No response from handler' },
    };
  }

  return { statusCode: resMock.statusCode || 200, body: resMock.body };
}

export const bulkSubmissionsController = {
  bulk: async (req: AuthRequest, res: Response) => {
    if (!req.userId) {
      return res.status(401).json({ errorCode: 'UNAUTHORIZED', error: 'Unauthorized' });
    }
    if (!req.channelId) {
      return res.status(400).json({ errorCode: 'MISSING_CHANNEL_ID', error: 'Channel ID required' });
    }

    let payload: ReturnType<typeof bulkSubmissionsSchema.parse>;
    try {
      payload = bulkSubmissionsSchema.parse(req.body);
    } catch (error: unknown) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          error: 'Validation error',
          message: 'Validation failed',
          details: error.errors,
        });
      }
      throw error;
    }

    const { ids, action, moderatorNotes } = payload;
    const results: Array<{ id: string; success: boolean; error?: string }> = [];

    for (const id of ids) {
      let handler = adminController.approveSubmission;
      let body: Record<string, unknown> = {};

      if (action === 'reject') {
        handler = adminController.rejectSubmission;
        body = { moderatorNotes: moderatorNotes ?? null };
      } else if (action === 'needs_changes') {
        handler = adminController.needsChangesSubmission;
        body = { moderatorNotes };
      }

      const result = await invokeHandler(handler, req, { id }, body);
      const success = result.statusCode >= 200 && result.statusCode < 300;
      if (success) {
        results.push({ id, success: true });
      } else {
        const errorBody = asRecord(result.body);
        const errorCode = errorBody.errorCode;
        const errorMessage =
          (typeof errorBody.error === 'string' && errorBody.error) ||
          (typeof errorBody.message === 'string' && errorBody.message) ||
          'Unknown error';
        const errorLabel = typeof errorCode === 'string' && errorCode ? errorCode : errorMessage;
        results.push({ id, success: false, error: errorLabel });
      }
    }

    return res.json({ results });
  },
};
