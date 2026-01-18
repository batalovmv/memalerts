import type { Response } from 'express';
import { describe, expect, it } from 'vitest';

import { prisma } from '../src/lib/prisma.js';
import type { AuthRequest } from '../src/middleware/auth.js';
import {
  approveRequest,
  getAllRequests,
  getGrantedUsers,
  getRevokedUsers,
  rejectRequest,
  restoreUserAccess,
  revokeUserAccess,
} from '../src/controllers/betaAccess/betaAccessAdmin.js';
import { createBetaAccess, createUser } from './factories/index.js';

type TestResponse = {
  statusCode: number;
  body?: unknown;
  status: (code: number) => TestResponse;
  json: (body: unknown) => TestResponse;
};

function makeRes(): TestResponse {
  const res: TestResponse = {
    statusCode: 200,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return res;
}

function makeReq(overrides: Partial<AuthRequest> = {}): AuthRequest {
  return {
    userRole: 'admin',
    userId: null,
    params: {},
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  } as AuthRequest;
}

describe('beta access admin controllers', () => {
  it('rejects non-admin requests for admin endpoints', async () => {
    const req = makeReq({ userRole: 'viewer' });

    const endpoints = [
      getAllRequests,
      approveRequest,
      rejectRequest,
      getGrantedUsers,
      getRevokedUsers,
      revokeUserAccess,
      restoreUserAccess,
    ];

    for (const handler of endpoints) {
      const res = makeRes();
      await handler(req, res as unknown as Response);
      expect(res.statusCode).toBe(403);
    }
  });

  it('lists pending/approved/rejected requests for admin', async () => {
    const admin = await createUser({ role: 'admin', hasBetaAccess: true });
    const userA = await createUser({ role: 'viewer', hasBetaAccess: false });
    const userB = await createUser({ role: 'viewer', hasBetaAccess: true });

    await createBetaAccess({ userId: userA.id, status: 'pending' });
    await createBetaAccess({ userId: userB.id, status: 'approved', approvedAt: new Date(), approvedBy: admin.id });

    const res = makeRes();
    await getAllRequests(makeReq({ userRole: 'admin', userId: admin.id }), res as unknown as Response);

    expect(res.statusCode).toBe(200);
    const rows = res.body as Array<{ status?: string }>;
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.some((r) => r.status === 'pending')).toBe(true);
    expect(rows.some((r) => r.status === 'approved')).toBe(true);
  });

  it('approves and rejects beta access requests', async () => {
    const admin = await createUser({ role: 'admin', hasBetaAccess: true });
    const pending = await createUser({ role: 'viewer', hasBetaAccess: false });
    const pendingRequest = await createBetaAccess({ userId: pending.id, status: 'pending' });

    const approveRes = makeRes();
    await approveRequest(
      makeReq({ userRole: 'admin', userId: admin.id, params: { id: pendingRequest.id } }),
      approveRes as unknown as Response
    );

    expect(approveRes.statusCode).toBe(200);
    const refreshed = await prisma.betaAccess.findUnique({
      where: { id: pendingRequest.id },
      select: { status: true },
    });
    const updatedUser = await prisma.user.findUnique({
      where: { id: pending.id },
      select: { hasBetaAccess: true },
    });
    expect(refreshed?.status).toBe('approved');
    expect(updatedUser?.hasBetaAccess).toBe(true);

    const second = await createUser({ role: 'viewer', hasBetaAccess: false });
    const rejectRequestRow = await createBetaAccess({ userId: second.id, status: 'pending' });
    const rejectRes = makeRes();
    await rejectRequest(
      makeReq({ userRole: 'admin', userId: admin.id, params: { id: rejectRequestRow.id } }),
      rejectRes as unknown as Response
    );
    expect(rejectRes.statusCode).toBe(200);
    const rejected = await prisma.betaAccess.findUnique({
      where: { id: rejectRequestRow.id },
      select: { status: true },
    });
    expect(rejected?.status).toBe('rejected');
  });

  it('returns granted and revoked users lists for admin', async () => {
    const admin = await createUser({ role: 'admin', hasBetaAccess: true });
    const granted = await createUser({ role: 'viewer', hasBetaAccess: true });
    const revoked = await createUser({ role: 'viewer', hasBetaAccess: false });

    await createBetaAccess({ userId: granted.id, status: 'approved', approvedAt: new Date(), approvedBy: admin.id });
    await createBetaAccess({ userId: revoked.id, status: 'revoked', approvedAt: new Date(), approvedBy: admin.id });

    const grantedRes = makeRes();
    await getGrantedUsers(makeReq({ userRole: 'admin', userId: admin.id }), grantedRes as unknown as Response);
    const grantedRows = grantedRes.body as Array<{ id?: string }>;
    expect(grantedRows.some((row) => row.id === granted.id)).toBe(true);

    const revokedRes = makeRes();
    await getRevokedUsers(makeReq({ userRole: 'admin', userId: admin.id }), revokedRes as unknown as Response);
    const revokedRows = revokedRes.body as Array<{ user?: { id?: string } }>;
    expect(revokedRows.some((row) => row.user?.id === revoked.id)).toBe(true);
  });

  it('revokes and restores beta access', async () => {
    const admin = await createUser({ role: 'admin', hasBetaAccess: true });
    const target = await createUser({ role: 'viewer', hasBetaAccess: true });

    const revokeRes = makeRes();
    await revokeUserAccess(
      makeReq({ userRole: 'admin', userId: admin.id, params: { userId: target.id } }),
      revokeRes as unknown as Response
    );
    expect(revokeRes.statusCode).toBe(200);

    const revokedUser = await prisma.user.findUnique({
      where: { id: target.id },
      select: { hasBetaAccess: true },
    });
    const revokedRequest = await prisma.betaAccess.findUnique({
      where: { userId: target.id },
      select: { status: true },
    });
    expect(revokedUser?.hasBetaAccess).toBe(false);
    expect(revokedRequest?.status).toBe('revoked');

    const restoreRes = makeRes();
    await restoreUserAccess(
      makeReq({ userRole: 'admin', userId: admin.id, params: { userId: target.id } }),
      restoreRes as unknown as Response
    );
    expect(restoreRes.statusCode).toBe(200);

    const restoredUser = await prisma.user.findUnique({
      where: { id: target.id },
      select: { hasBetaAccess: true },
    });
    const restoredRequest = await prisma.betaAccess.findUnique({
      where: { userId: target.id },
      select: { status: true },
    });
    expect(restoredUser?.hasBetaAccess).toBe(true);
    expect(restoredRequest?.status).toBe('approved');
  });

  it('handles revoke/restore guardrails', async () => {
    const admin = await createUser({ role: 'admin', hasBetaAccess: true });

    const missingId = makeRes();
    await revokeUserAccess(makeReq({ userRole: 'admin', userId: admin.id }), missingId as unknown as Response);
    expect(missingId.statusCode).toBe(400);

    const notFound = makeRes();
    await revokeUserAccess(
      makeReq({ userRole: 'admin', userId: admin.id, params: { userId: 'missing-user' } }),
      notFound as unknown as Response
    );
    expect(notFound.statusCode).toBe(404);

    const noAccessUser = await createUser({ role: 'viewer', hasBetaAccess: false });
    const already = makeRes();
    await revokeUserAccess(
      makeReq({ userRole: 'admin', userId: admin.id, params: { userId: noAccessUser.id } }),
      already as unknown as Response
    );
    expect(already.statusCode).toBe(200);

    const restoreMissing = makeRes();
    await restoreUserAccess(makeReq({ userRole: 'admin', userId: admin.id }), restoreMissing as unknown as Response);
    expect(restoreMissing.statusCode).toBe(400);

    const restoreNotFound = makeRes();
    await restoreUserAccess(
      makeReq({ userRole: 'admin', userId: admin.id, params: { userId: 'missing-user' } }),
      restoreNotFound as unknown as Response
    );
    expect(restoreNotFound.statusCode).toBe(404);
  });
});
