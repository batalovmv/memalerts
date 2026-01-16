import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';

type Role = 'viewer' | 'streamer' | 'admin';

function makeJwt(payload: Record<string, unknown>): string {
  return signJwt(payload, { expiresIn: '10m' });
}

function cookieOptions() {
  // Test-only endpoint: keep it simple and local-friendly.
  return {
    httpOnly: true,
    secure: false,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 10 * 60 * 1000,
  };
}

export const testRoutes = Router();

/**
 * Test-only deterministic login helper.
 *
 * - NEVER mount outside NODE_ENV=test.
 * - Creates/fetches a user (viewer/streamer/admin).
 * - For streamer/admin, also creates/fetches a channel and links it to user.channelId.
 * - Sets auth cookie(s) compatible with our beta/prod cookie selection.
 */
testRoutes.post('/login', async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const roleRaw = String(body.role || 'viewer')
    .trim()
    .toLowerCase();
  const role: Role = roleRaw === 'streamer' || roleRaw === 'admin' ? (roleRaw as Role) : 'viewer';
  const slug = String(body.channelSlug || 'e2e-channel')
    .trim()
    .toLowerCase();

  const twitchUserId = `test_${role}`; // deterministic unique key
  const displayName = `Test ${role}`;

  let channelId: string | null = null;
  let channelSlug: string | null = null;

  if (role === 'streamer' || role === 'admin') {
    const channel = await prisma.channel.upsert({
      where: { slug },
      update: { name: `E2E ${slug}`, submissionsEnabled: true, submissionsOnlyWhenLive: false },
      create: { slug, name: `E2E ${slug}`, submissionsEnabled: true, submissionsOnlyWhenLive: false },
      select: { id: true, slug: true },
    });
    channelId = channel.id;
    channelSlug = channel.slug;
  }

  const user = await prisma.user.upsert({
    where: { twitchUserId },
    update: {
      displayName,
      role,
      channelId: channelId ?? null,
      hasBetaAccess: true,
    },
    create: {
      twitchUserId,
      displayName,
      role,
      channelId: channelId ?? null,
      hasBetaAccess: true,
    },
    select: { id: true, role: true, channelId: true, displayName: true, hasBetaAccess: true },
  });

  const token = makeJwt({ userId: user.id, role: user.role, channelId: user.channelId || undefined });

  // In tests we set both cookies so socket/auth selection works regardless of beta/prod hints.
  res.cookie('token', token, cookieOptions());
  res.cookie('token_beta', token, cookieOptions());

  return res.json({
    token,
    user,
    channel: channelId ? { id: channelId, slug: channelSlug } : null,
  });
});
