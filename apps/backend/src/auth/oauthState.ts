import crypto from 'crypto';
import { prisma } from '../lib/prisma.js';
import type { ExternalAccountProvider, OAuthStateKind } from '@prisma/client';

export function generateStateId(bytes = 32): string {
  // base64url without padding
  return crypto.randomBytes(bytes).toString('base64url');
}

export async function createOAuthState(params: {
  provider: ExternalAccountProvider;
  kind: OAuthStateKind;
  userId?: string | null;
  channelId?: string | null;
  redirectTo?: string | null;
  origin?: string | null;
  codeVerifier?: string | null;
  ttlMs?: number;
}) {
  const ttlMs = params.ttlMs ?? 10 * 60 * 1000; // 10 minutes
  const state = generateStateId();
  const expiresAt = new Date(Date.now() + ttlMs);

  await prisma.oAuthState.create({
    data: {
      state,
      provider: params.provider,
      kind: params.kind,
      userId: params.userId ?? null,
      channelId: params.channelId ?? null,
      redirectTo: params.redirectTo ?? null,
      origin: params.origin ?? null,
      codeVerifier: params.codeVerifier ?? null,
      expiresAt,
    },
  });

  return { state, expiresAt };
}

export async function loadAndConsumeOAuthState(state: string) {
  const row = await prisma.oAuthState.findUnique({ where: { state } });
  if (!row) return { ok: false as const, reason: 'state_not_found' as const };
  if (row.consumedAt) return { ok: false as const, reason: 'state_already_used' as const, row };
  if (row.expiresAt.getTime() < Date.now()) return { ok: false as const, reason: 'state_expired' as const, row };

  const consumed = await prisma.oAuthState.update({
    where: { state },
    data: { consumedAt: new Date() },
  });

  return { ok: true as const, row: consumed };
}
