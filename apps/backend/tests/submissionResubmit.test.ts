import type { Response } from 'express';
import type { AuthRequest } from '../src/middleware/auth.js';
import { prisma } from '../src/lib/prisma.js';
import { resubmitSubmission } from '../src/controllers/submission/resubmitSubmission.js';
import { createChannel, createSubmission, createUser } from './factories/index.js';
import { emitSubmissionEvent, relaySubmissionEventToPeer } from '../src/realtime/submissionBridge.js';

vi.mock('../src/realtime/submissionBridge.js', () => ({
  emitSubmissionEvent: vi.fn(),
  relaySubmissionEventToPeer: vi.fn(),
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

function buildReq(params: {
  userId: string;
  submissionId: string;
  body: Record<string, unknown>;
}): AuthRequest {
  const { userId, submissionId, body } = params;
  const app = {
    get(key: string) {
      if (key === 'io') return {};
      return undefined;
    },
  };

  return {
    userId,
    userRole: 'viewer',
    channelId: undefined,
    params: { id: submissionId },
    body,
    query: {},
    headers: { 'user-agent': 'vitest' },
    socket: { remoteAddress: '127.0.0.1' } as unknown as AuthRequest['socket'],
    app,
  } as AuthRequest;
}

describe('submission resubmit flow', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'development';
    process.env.SUBMISSION_MAX_RESUBMITS = '2';
    vi.clearAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('resubmits a needs_changes submission and resets status', async () => {
    const channel = await createChannel();
    const submitter = await createUser({ role: 'viewer', channelId: null });
    const submission = await createSubmission({
      channelId: channel.id,
      submitterUserId: submitter.id,
      status: 'needs_changes',
      revision: 0,
      title: 'Old title',
      notes: 'old notes',
      moderatorNotes: 'please fix',
    });

    const req = buildReq({
      userId: submitter.id,
      submissionId: submission.id,
      body: { title: 'New title', notes: 'new notes', tags: ['fresh', 'clip'] },
    });
    const res = createRes();

    await resubmitSubmission(req, res as unknown as Response);

    expect(res.statusCode).toBe(200);
    const updated = await prisma.memeSubmission.findUnique({
      where: { id: submission.id },
      include: { tags: { include: { tag: true } } },
    });
    expect(updated?.status).toBe('pending');
    expect(updated?.revision).toBe(1);
    expect(updated?.title).toBe('New title');
    expect(updated?.notes).toBe('new notes');
    expect(updated?.moderatorNotes).toBeNull();
    const tagNames = updated?.tags.map((t) => t.tag.name).sort();
    expect(tagNames).toEqual(['clip', 'fresh']);

    const calls = vi.mocked(emitSubmissionEvent).mock.calls;
    expect(calls.some((call) => (call[1] as { event?: string }).event === 'submission:resubmitted')).toBe(true);
    expect(vi.mocked(relaySubmissionEventToPeer)).toHaveBeenCalled();
  });

  it('rejects resubmits when not in needs_changes', async () => {
    const channel = await createChannel();
    const submitter = await createUser({ role: 'viewer', channelId: null });
    const submission = await createSubmission({
      channelId: channel.id,
      submitterUserId: submitter.id,
      status: 'pending',
    });

    const req = buildReq({
      userId: submitter.id,
      submissionId: submission.id,
      body: { title: 'Updated title', tags: [] },
    });
    const res = createRes();

    await resubmitSubmission(req, res as unknown as Response);

    expect(res.statusCode).toBe(400);
    expect((res.body as { error?: string })?.error).toBe('Submission is not awaiting changes');
  });

  it('blocks resubmits from non-owners', async () => {
    const channel = await createChannel();
    const submitter = await createUser({ role: 'viewer', channelId: null });
    const otherUser = await createUser({ role: 'viewer', channelId: null });
    const submission = await createSubmission({
      channelId: channel.id,
      submitterUserId: submitter.id,
      status: 'needs_changes',
    });

    const req = buildReq({
      userId: otherUser.id,
      submissionId: submission.id,
      body: { title: 'New title', tags: ['tag'] },
    });
    const res = createRes();

    await resubmitSubmission(req, res as unknown as Response);

    expect(res.statusCode).toBe(404);
    expect((res.body as { errorCode?: string })?.errorCode).toBe('SUBMISSION_NOT_FOUND');
  });

  it('rejects resubmits when retry budget is exhausted', async () => {
    const channel = await createChannel();
    const submitter = await createUser({ role: 'viewer', channelId: null });
    const submission = await createSubmission({
      channelId: channel.id,
      submitterUserId: submitter.id,
      status: 'needs_changes',
      revision: 2,
    });

    const req = buildReq({
      userId: submitter.id,
      submissionId: submission.id,
      body: { title: 'New title', tags: [] },
    });
    const res = createRes();

    await resubmitSubmission(req, res as unknown as Response);

    expect(res.statusCode).toBe(400);
    expect((res.body as { error?: string })?.error).toBe('No resubmits remaining');
  });
});
