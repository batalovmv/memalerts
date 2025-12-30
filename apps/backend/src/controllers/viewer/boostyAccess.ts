import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { fetchDiscordGuildMember } from '../../utils/discordApi.js';
import { logger } from '../../utils/logger.js';

type BoostyAccessState = 'need_discord_link' | 'need_join_guild' | 'not_subscribed' | 'subscribed';

function normalizeTierRoles(raw: any): Array<{ tier: string; roleId: string }> {
  const items = Array.isArray(raw) ? raw : [];
  const out: Array<{ tier: string; roleId: string }> = [];
  for (const it of items) {
    const tier = String(it?.tier ?? '').trim();
    const roleId = String(it?.roleId ?? '').trim();
    if (!tier || !roleId) continue;
    out.push({ tier, roleId });
  }
  return out;
}

function pickMatchedTierRole(params: {
  memberRoles: string[];
  tierRoles: Array<{ tier: string; roleId: string }>;
}): { tier: string; roleId: string } | null {
  const roles = Array.isArray(params.memberRoles) ? params.memberRoles : [];
  for (const tr of params.tierRoles) {
    if (roles.includes(tr.roleId)) return tr;
  }
  return null;
}

export async function getBoostyAccessForChannel(req: AuthRequest, res: Response) {
  if (!req.userId) return res.status(401).json({ errorCode: 'UNAUTHORIZED', error: 'Unauthorized', requestId: req.requestId });

  const channelId = String((req.params as any)?.channelId || '').trim();
  if (!channelId) return res.status(400).json({ errorCode: 'BAD_REQUEST', error: 'Bad Request', requestId: req.requestId });

  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: {
      id: true,
      slug: true,
      boostyCoinsPerSub: true,
      boostyDiscordTierRolesJson: true as any,
    } as any,
  });

  if (!channel) return res.status(404).json({ errorCode: 'NOT_FOUND', error: 'Not Found', requestId: req.requestId });

  const tierRoles = normalizeTierRoles((channel as any).boostyDiscordTierRolesJson);
  const botToken = String(process.env.DISCORD_BOT_TOKEN || '').trim();
  const guildId = String(process.env.DISCORD_SUBSCRIPTIONS_GUILD_ID || '').trim();
  if (!botToken || !guildId) {
    return res.status(503).json({
      errorCode: 'DISCORD_INTEGRATION_NOT_CONFIGURED',
      error: 'Service Unavailable',
      requestId: req.requestId,
    });
  }

  // 1) need_discord_link
  const discordAccount = await prisma.externalAccount.findFirst({
    where: { userId: req.userId, provider: 'discord' } as any,
    select: { providerAccountId: true },
  });
  const discordUserId = String((discordAccount as any)?.providerAccountId || '').trim();
  if (!discordUserId) {
    const payload = { state: 'need_discord_link' as BoostyAccessState };
    logger.info('boosty.access.state', { requestId: req.requestId, channelId, userId: req.userId, state: payload.state });
    return res.json(payload);
  }

  // 2) need_join_guild (not in guild)
  const member = await fetchDiscordGuildMember({ botToken, guildId, userId: discordUserId });
  if (member.status === 404 || member.status === 403) {
    const payload = { state: 'need_join_guild' as BoostyAccessState };
    logger.info('boosty.access.state', {
      requestId: req.requestId,
      channelId,
      userId: req.userId,
      discordUserId,
      state: payload.state,
      discordStatus: member.status,
    });
    return res.json(payload);
  }
  if (!member.member) {
    return res.status(503).json({
      errorCode: 'DISCORD_LOOKUP_FAILED',
      error: 'Service Unavailable',
      requestId: req.requestId,
    });
  }

  // 3) not_subscribed / subscribed
  const matched = pickMatchedTierRole({ memberRoles: member.member.roles, tierRoles });
  const payload = matched
    ? ({ state: 'subscribed' as BoostyAccessState, matchedTier: matched.tier } as const)
    : ({ state: 'not_subscribed' as BoostyAccessState } as const);

  logger.info('boosty.access.state', {
    requestId: req.requestId,
    channelId,
    userId: req.userId,
    discordUserId,
    state: payload.state,
    matchedTier: (payload as any).matchedTier ?? null,
    configuredTiers: tierRoles.length,
  });

  return res.json(payload);
}


