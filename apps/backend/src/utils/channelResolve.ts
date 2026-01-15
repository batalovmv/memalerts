import { prisma } from '../lib/prisma.js';

export type ChannelResolveProvider = 'twitch';

export type ChannelResolveResult = {
  channelId: string;
  provider: ChannelResolveProvider;
  externalId: string;
  displayHint: {
    twitchChannelId: string;
  };
} | null;

export function normalizeProvider(v: unknown): string {
  return String(v ?? '')
    .trim()
    .toLowerCase();
}

export function normalizeExternalId(v: unknown): string {
  return String(v ?? '').trim();
}

export function isValidTwitchExternalId(externalId: string): boolean {
  // Twitch broadcaster_id is numeric string. Keep bounds tight to avoid log/DB abuse.
  // Typical values fit well within 1..30 digits.
  if (!externalId) return false;
  if (externalId.length > 32) return false;
  return /^[0-9]+$/.test(externalId);
}

export async function resolveChannelByProviderExternalId(
  provider: string,
  externalId: string
): Promise<ChannelResolveResult> {
  if (!provider || !externalId) return null;

  if (provider === 'twitch') {
    if (!isValidTwitchExternalId(externalId)) return null;
    const row = await prisma.channel.findUnique({
      where: { twitchChannelId: externalId },
      select: { id: true, twitchChannelId: true },
    });
    if (!row?.id) return null;
    return {
      channelId: row.id,
      provider: 'twitch',
      externalId,
      displayHint: {
        // Important: do NOT expose login/email/name; only confirm the externalId itself.
        twitchChannelId: externalId,
      },
    };
  }

  return null;
}
