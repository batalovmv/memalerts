import type { Prisma } from '@prisma/client';
import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { fetchDiscordGuildMember } from '../../utils/discordApi.js';
import { logger } from '../../utils/logger.js';

type BoostyAccessStatus = 'need_discord_link' | 'need_join_guild' | 'not_subscribed' | 'subscribed';
type BoostyTierRoleItem = { tier: string; roleId: string };
type RequiredGuildInfo = {
  guildId: string;
  name: string | null;
  inviteUrl: string | null;
  autoJoin: boolean;
};
type BoostyAccessPayload = {
  status: BoostyAccessStatus;
  requiredGuild: RequiredGuildInfo;
  tier: string | null;
  matchedTier: string | null;
  matchedRoleId: string | null;
};

function isTruthyEnv(v: unknown): boolean {
  const s = String(v ?? '')
    .trim()
    .toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function normalizeTierRoles(raw: Prisma.JsonValue | null | undefined): BoostyTierRoleItem[] {
  if (!Array.isArray(raw)) return [];
  const out: BoostyTierRoleItem[] = [];
  for (const it of raw) {
    if (!it || typeof it !== 'object') continue;
    const tier = String((it as Record<string, unknown>)?.tier ?? '').trim();
    const roleId = String((it as Record<string, unknown>)?.roleId ?? '').trim();
    if (!tier || !roleId) continue;
    out.push({ tier, roleId });
  }
  return out;
}

function pickMatchedTierRole(params: {
  memberRoles: string[];
  tierRoles: BoostyTierRoleItem[];
}): BoostyTierRoleItem | null {
  const roles = Array.isArray(params.memberRoles) ? params.memberRoles : [];
  for (const tr of params.tierRoles) {
    if (roles.includes(tr.roleId)) return tr;
  }
  return null;
}

export async function getBoostyAccessForChannel(req: AuthRequest, res: Response) {
  if (!req.userId)
    return res.status(401).json({ errorCode: 'UNAUTHORIZED', error: 'Unauthorized', requestId: req.requestId });

  const channelId = String((req.params as { channelId?: string }).channelId || '').trim();
  if (!channelId)
    return res.status(400).json({ errorCode: 'BAD_REQUEST', error: 'Bad Request', requestId: req.requestId });

  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: {
      id: true,
      slug: true,
      boostyCoinsPerSub: true,
      boostyDiscordTierRolesJson: true,
      discordSubscriptionsGuildId: true,
    },
  });

  if (!channel) return res.status(404).json({ errorCode: 'NOT_FOUND', error: 'Not Found', requestId: req.requestId });

  const tierRoles = normalizeTierRoles(channel.boostyDiscordTierRolesJson);
  const botToken = String(process.env.DISCORD_BOT_TOKEN || '').trim();
  const guildId =
    String(channel.discordSubscriptionsGuildId || '').trim() ||
    String(process.env.DISCORD_DEFAULT_SUBSCRIPTIONS_GUILD_ID || '').trim() ||
    // Legacy fallback (pre-multi-guild)
    String(process.env.DISCORD_SUBSCRIPTIONS_GUILD_ID || '').trim();

  const autoJoin = isTruthyEnv(process.env.DISCORD_AUTO_JOIN_GUILD);
  const requiredGuild = { guildId, name: null as string | null, inviteUrl: null as string | null, autoJoin };

  if (!botToken || !guildId) {
    return res.status(503).json({
      errorCode: 'DISCORD_INTEGRATION_NOT_CONFIGURED',
      error: 'Service Unavailable',
      requestId: req.requestId,
    });
  }

  // 1) need_discord_link
  const discordAccount = await prisma.externalAccount.findFirst({
    where: { userId: req.userId, provider: 'discord' },
    select: { providerAccountId: true },
  });
  const discordUserId = String(discordAccount?.providerAccountId || '').trim();
  if (!discordUserId) {
    const payload: BoostyAccessPayload = {
      status: 'need_discord_link',
      requiredGuild,
      tier: null,
      matchedTier: null,
      matchedRoleId: null,
    };
    logger.info('boosty.access.state', {
      requestId: req.requestId,
      channelId,
      userId: req.userId,
      status: payload.status,
    });
    return res.json(payload);
  }

  // 2) need_join_guild (not in guild)
  const member = await fetchDiscordGuildMember({ botToken, guildId, userId: discordUserId });
  if (member.status === 404 || member.status === 403) {
    const payload: BoostyAccessPayload = {
      status: 'need_join_guild',
      requiredGuild,
      tier: null,
      matchedTier: null,
      matchedRoleId: null,
    };
    logger.info('boosty.access.state', {
      requestId: req.requestId,
      channelId,
      userId: req.userId,
      discordUserId,
      status: payload.status,
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
  const payload: BoostyAccessPayload = matched
    ? {
        status: 'subscribed',
        requiredGuild,
        tier: matched.tier,
        matchedTier: matched.tier,
        matchedRoleId: matched.roleId,
      }
    : {
        status: 'not_subscribed',
        requiredGuild,
        tier: null,
        matchedTier: null,
        matchedRoleId: null,
      };

  logger.info('boosty.access.state', {
    requestId: req.requestId,
    channelId,
    userId: req.userId,
    discordUserId,
    status: payload.status,
    tier: payload.tier ?? null,
    configuredTiers: tierRoles.length,
  });

  return res.json(payload);
}
