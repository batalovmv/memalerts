import { prisma } from '../lib/prisma.js';

type IgnoredCacheEntry = {
  ignoredUserIds: Set<string>;
  ignoredNames: Set<string>;
  ts: number;
};

const cacheByChannelId = new Map<string, IgnoredCacheEntry>();
const CACHE_TTL_MS = 60_000;

function normalizeName(s: string): string {
  return String(s || '').trim().toLowerCase();
}

function splitNames(raw: any): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    const n = normalizeName(String(v ?? ''));
    if (!n) continue;
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

async function getBotCredentialUserIds(channelId: string): Promise<Set<string>> {
  const out = new Set<string>();

  // Global bot credentials (all channels).
  try {
    const [gYt, gVk, gTw] = await Promise.all([
      (prisma as any).globalYouTubeBotCredential?.findFirst?.({ where: { enabled: true }, select: { externalAccountId: true } }).catch(() => null),
      (prisma as any).globalVkVideoBotCredential?.findFirst?.({ where: { enabled: true }, select: { externalAccountId: true } }).catch(() => null),
      (prisma as any).globalTwitchBotCredential?.findFirst?.({ where: { enabled: true }, select: { externalAccountId: true } }).catch(() => null),
    ]);

    const globalIds = [gYt?.externalAccountId, gVk?.externalAccountId, gTw?.externalAccountId]
      .map((x) => String(x || '').trim())
      .filter(Boolean);

    if (globalIds.length) {
      const rows = await prisma.externalAccount.findMany({
        where: { id: { in: globalIds } },
        select: { userId: true },
      });
      for (const r of rows) {
        const uid = String(r.userId || '').trim();
        if (uid) out.add(uid);
      }
    }
  } catch {
    // ignore
  }

  // Per-channel overrides.
  try {
    const [yt, vk, tw] = await Promise.all([
      (prisma as any).youTubeBotIntegration?.findUnique?.({ where: { channelId }, select: { enabled: true, externalAccountId: true } }).catch(() => null),
      (prisma as any).vkVideoBotIntegration?.findUnique?.({ where: { channelId }, select: { enabled: true, externalAccountId: true } }).catch(() => null),
      (prisma as any).twitchBotIntegration?.findUnique?.({ where: { channelId }, select: { enabled: true, externalAccountId: true } }).catch(() => null),
    ]);

    const ids = [yt, vk, tw]
      .filter((r: any) => r && r.enabled)
      .map((r: any) => String(r.externalAccountId || '').trim())
      .filter(Boolean);

    if (ids.length) {
      const rows = await prisma.externalAccount.findMany({
        where: { id: { in: ids } },
        select: { userId: true },
      });
      for (const r of rows) {
        const uid = String(r.userId || '').trim();
        if (uid) out.add(uid);
      }
    }
  } catch {
    // ignore
  }

  return out;
}

export async function getCreditsIgnoreRules(channelId: string): Promise<{ ignoredUserIds: Set<string>; ignoredNames: Set<string> }> {
  const id = String(channelId || '').trim();
  if (!id) return { ignoredUserIds: new Set(), ignoredNames: new Set() };

  const cached = cacheByChannelId.get(id);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return { ignoredUserIds: cached.ignoredUserIds, ignoredNames: cached.ignoredNames };
  }

  const channel = await prisma.channel.findUnique({
    where: { id },
    select: { creditsIgnoredChattersJson: true },
  });
  const ignoredNames = new Set(splitNames((channel as any)?.creditsIgnoredChattersJson));
  const ignoredUserIds = await getBotCredentialUserIds(id);

  const entry: IgnoredCacheEntry = { ignoredNames, ignoredUserIds, ts: Date.now() };
  cacheByChannelId.set(id, entry);
  return { ignoredNames, ignoredUserIds };
}

export async function shouldIgnoreCreditsChatter(params: {
  channelId: string;
  creditsUserId: string;
  displayName: string;
}): Promise<boolean> {
  const channelId = String(params.channelId || '').trim();
  const creditsUserId = String(params.creditsUserId || '').trim();
  const displayName = String(params.displayName || '').trim();
  if (!channelId || !creditsUserId || !displayName) return false;

  const rules = await getCreditsIgnoreRules(channelId);
  if (rules.ignoredUserIds.has(creditsUserId)) return true;
  const nameKey = normalizeName(displayName);
  if (nameKey && rules.ignoredNames.has(nameKey)) return true;
  return false;
}


