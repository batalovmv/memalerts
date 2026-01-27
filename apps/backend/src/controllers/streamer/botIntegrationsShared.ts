import type { Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import type { AuthRequest } from '../../middleware/auth.js';

type BotProvider = 'twitch' | 'vkplaylive' | 'youtube';
export type BotProviderV2 = BotProvider | 'vkvideo';
// NOTE: vkplaylive is deprecated (we use vkvideo instead) but may still exist in DB for legacy installs.
// Do not expose it to the frontend and do not allow enabling it via API.
type BotProviderDeprecated = 'vkplaylive';
export type BotProviderActive = Exclude<BotProviderV2, BotProviderDeprecated>;
export const PROVIDERS: BotProviderActive[] = ['twitch', 'vkvideo', 'youtube'];
const PROVIDERS_SET = new Set<string>(PROVIDERS);

const DEFAULT_LINK_REDIRECT = '/settings/accounts';
const REDIRECT_ALLOWLIST = new Set<string>([
  '/settings/accounts',
  '/settings/bot',
  '/settings/bot/twitch',
  '/settings/bot/youtube',
  '/settings/bot/vk',
  '/settings/bot/vkvideo',
  '/dashboard',
  '/',
]);

export function sanitizeRedirectTo(input: unknown): string {
  const redirectTo = typeof input === 'string' ? input.trim() : '';
  if (!redirectTo) return DEFAULT_LINK_REDIRECT;
  if (!redirectTo.startsWith('/')) return DEFAULT_LINK_REDIRECT;
  if (redirectTo.startsWith('//')) return DEFAULT_LINK_REDIRECT;
  if (redirectTo.includes('://')) return DEFAULT_LINK_REDIRECT;
  if (redirectTo.includes('\\')) return DEFAULT_LINK_REDIRECT;
  if (!REDIRECT_ALLOWLIST.has(redirectTo)) return DEFAULT_LINK_REDIRECT;
  return redirectTo;
}

export type BotIntegrationPatchBody = {
  enabled: boolean;
  vkvideoChannelId?: string;
  vkvideoChannelUrl?: string | null;
};

type VkVideoChannelCandidate = { url?: string };
type VkVideoCurrentUserRoot = {
  channel?: VkVideoChannelCandidate;
  channels?: VkVideoChannelCandidate[];
};

export function normalizeVkVideoCurrentUserRoot(raw: unknown): VkVideoCurrentUserRoot | null {
  if (!raw || typeof raw !== 'object') return null;
  const nested = (raw as { data?: unknown }).data;
  if (nested && typeof nested === 'object') {
    return nested as VkVideoCurrentUserRoot;
  }
  return raw as VkVideoCurrentUserRoot;
}

export function extractVkVideoChannelUrls(root: VkVideoCurrentUserRoot | null): string[] {
  if (!root) return [];
  const primary = String(root.channel?.url || '').trim();
  const channels =
    Array.isArray(root.channels) && root.channels.length
      ? root.channels.map((channel) => String(channel?.url || '').trim()).filter(Boolean)
      : [];
  return Array.from(new Set([primary, ...channels].filter(Boolean)));
}

export function requireChannelId(req: AuthRequest, res: Response): string | null {
  const channelId = String(req.channelId || '').trim();
  if (!channelId) {
    res.status(400).json({
      errorCode: 'MISSING_CHANNEL_ID',
      error: 'Missing channelId',
      details: {
        hint: 'Your auth token has no channelId. Re-login as streamer (or select channel) and retry.',
      },
    });
    return null;
  }
  return channelId;
}

export function normalizeProvider(raw: unknown): BotProviderActive | null {
  const p = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!p || !PROVIDERS_SET.has(p)) return null;
  return p as BotProviderActive;
}

type IntegrationStatusRow = {
  enabled: boolean | null;
  externalAccountId: string | null;
  updatedAt: Date | null;
};

export type IntegrationStatusResponse = {
  enabled: boolean;
  externalAccountId: string | null;
  updatedAt: string | null;
};

export function formatIntegrationStatus(row: IntegrationStatusRow): IntegrationStatusResponse {
  return {
    enabled: Boolean(row.enabled),
    externalAccountId: row.externalAccountId?.trim() || null,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

export const DEFAULT_INTEGRATION_STATUS: IntegrationStatusResponse = formatIntegrationStatus({
  enabled: false,
  externalAccountId: null,
  updatedAt: null,
});

export function isPrismaFeatureUnavailable(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2021';
}

export async function getTwitchEnabledFallback(channelId: string): Promise<boolean> {
  // Back-compat: if BotIntegrationSettings row is missing (older enable endpoint was used),
  // we still want GET /streamer/bots to reflect the actual Twitch bot subscription state.
  const sub = await prisma.chatBotSubscription.findUnique({ where: { channelId }, select: { enabled: true } });
  return Boolean(sub?.enabled);
}

export async function getVkVideoEnabledFallback(channelId: string): Promise<boolean> {
  try {
    const sub = await prisma.vkVideoChatBotSubscription.findUnique({
      where: { channelId },
      select: { enabled: true },
    });
    return Boolean(sub?.enabled);
  } catch {
    return false;
  }
}
