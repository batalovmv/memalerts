import type { Response } from 'express';
import type { AuthRequest } from '../src/middleware/auth.js';
import { randomUUID } from 'node:crypto';
import { bulkSubmissionsController } from '../src/controllers/streamer/bulkSubmissionsController.js';
import { adminController } from '../src/controllers/adminController.js';

vi.mock('../src/controllers/adminController.js', () => ({
  adminController: {
    approveSubmission: vi.fn(),
    rejectSubmission: vi.fn(),
    needsChangesSubmission: vi.fn(),
  },
}));

type TestResponse = {
  statusCode: number;
  body: unknown;
  headersSent: boolean;
  status: (code: number) => TestResponse;
  json: (payload: unknown) => TestResponse;
};

function createRes(): TestResponse {
  return {
    statusCode: 200,
    body: null,
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
}

function buildReq(params: { userId?: string; channelId?: string; body: Record<string, unknown> }): AuthRequest {
  const { userId, channelId, body } = params;
  return {
    userId,
    userRole: 'streamer',
    channelId,
    body,
    params: {},
    query: {},
    headers: {},
  } as AuthRequest;
}

describe('bulk submissions controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('approves submissions in bulk', async () => {
    const ids = [randomUUID(), randomUUID()];
    vi.mocked(adminController.approveSubmission).mockImplementation(async (_req, res) => {
      res.status(200).json({ ok: true });
    });

    const req = buildReq({ userId: 'user-1', channelId: 'channel-1', body: { ids, action: 'approve' } });
    const res = createRes();

    await bulkSubmissionsController.bulk(req, res as unknown as Response);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      results: [
        { id: ids[0], success: true },
        { id: ids[1], success: true },
      ],
    });
    expect(vi.mocked(adminController.approveSubmission)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(adminController.approveSubmission).mock.calls[0][0].params).toEqual({ id: ids[0] });
    expect(vi.mocked(adminController.approveSubmission).mock.calls[1][0].params).toEqual({ id: ids[1] });
  });

  it('rejects submissions in bulk with moderator notes', async () => {
    const ids = [randomUUID(), randomUUID()];
    vi.mocked(adminController.rejectSubmission).mockImplementation(async (_req, res) => {
      res.status(200).json({ ok: true });
    });

    const req = buildReq({
      userId: 'user-1',
      channelId: 'channel-1',
      body: { ids, action: 'reject', moderatorNotes: 'Nope' },
    });
    const res = createRes();

    await bulkSubmissionsController.bulk(req, res as unknown as Response);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      results: [
        { id: ids[0], success: true },
        { id: ids[1], success: true },
      ],
    });
    const calls = vi.mocked(adminController.rejectSubmission).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0].body).toEqual({ moderatorNotes: 'Nope' });
    expect(calls[1][0].body).toEqual({ moderatorNotes: 'Nope' });
  });

  it('returns partial success when some actions fail', async () => {
    const okId = randomUUID();
    const failId = randomUUID();
    vi.mocked(adminController.approveSubmission).mockImplementation(async (req, res) => {
      if (req.params.id === failId) {
        res.status(404).json({ errorCode: 'SUBMISSION_NOT_FOUND' });
        return;
      }
      res.status(200).json({ ok: true });
    });

    const req = buildReq({ userId: 'user-1', channelId: 'channel-1', body: { ids: [okId, failId], action: 'approve' } });
    const res = createRes();

    await bulkSubmissionsController.bulk(req, res as unknown as Response);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      results: [
        { id: okId, success: true },
        { id: failId, success: false, error: 'SUBMISSION_NOT_FOUND' },
      ],
    });
  });

  it('validates the ids payload', async () => {
    const req = buildReq({ userId: 'user-1', channelId: 'channel-1', body: { ids: ['bad-id'], action: 'approve' } });
    const res = createRes();

    await bulkSubmissionsController.bulk(req, res as unknown as Response);

    expect(res.statusCode).toBe(400);
    expect((res.body as { error?: string })?.error).toBe('Validation error');
  });

  it('requires auth and channel context', async () => {
    const res = createRes();
    const reqNoUser = buildReq({ channelId: 'channel-1', body: { ids: [randomUUID()], action: 'approve' } });
    await bulkSubmissionsController.bulk(reqNoUser, res as unknown as Response);
    expect(res.statusCode).toBe(401);

    const res2 = createRes();
    const reqNoChannel = buildReq({ userId: 'user-1', body: { ids: [randomUUID()], action: 'approve' } });
    await bulkSubmissionsController.bulk(reqNoChannel, res2 as unknown as Response);
    expect(res2.statusCode).toBe(400);
  });
});
