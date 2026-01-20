/**
 * Unified Chat Rewards — единая система наград за чат для всех платформ.
 *
 * Ключевые принципы:
 * 1. Награды только для залогиненных пользователей (без pending)
 * 2. Единая конфигурация через chatRewardsJson в Channel
 * 3. Расширяемая архитектура: легко добавлять новые типы наград
 * 4. Все платформы обрабатываются одинаково
 */

import type { Server } from 'socket.io';
import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { resolveMemalertsUserIdFromChatIdentity } from '../utils/chatIdentity.js';
import { getRedisClient } from '../utils/redisClient.js';
import { nsKey } from '../utils/redisCache.js';
import { getStreamSessionSnapshot } from '../realtime/streamDurationStore.js';
import { emitWalletUpdated, relayWalletUpdatedToPeer } from '../realtime/walletBridge.js';
import { WalletService } from '../services/WalletService.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ChatRewardPlatform = 'twitch' | 'kick' | 'trovo' | 'vkvideo' | 'youtube';

export type ChatMessageEvent = {
  platform: ChatRewardPlatform;
  channelSlug: string;
  platformUserId: string;
  displayName: string;
};

/** Configuration for first message reward */
type FirstMessageConfig = {
  enabled: boolean;
  coins: number;
  onlyWhenLive?: boolean; // default: true
};

/** Extensible rewards configuration stored in chatRewardsJson */
type ChatRewardsConfig = {
  firstMessage?: FirstMessageConfig;
  // Future rewards can be added here:
  // messageThresholds?: { enabled: boolean; thresholds: number[]; coinsByThreshold: Record<string, number>; onlyWhenLive?: boolean };
  // dailyStreak?: { enabled: boolean; coinsByStreak: Record<string, number> };
  // etc.
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseChatRewardsConfig(json: unknown): ChatRewardsConfig | null {
  if (!json || typeof json !== 'object') return null;
  const raw = asRecord(json);
  const config: ChatRewardsConfig = {};

  // Parse firstMessage
  const fm = asRecord(raw.firstMessage);
  if (fm.enabled === true) {
    config.firstMessage = {
      enabled: true,
      coins: typeof fm.coins === 'number' ? Math.floor(fm.coins) : 0,
      onlyWhenLive: fm.onlyWhenLive !== false, // default true
    };
  }

  // Future: parse other reward types here

  return Object.keys(config).length > 0 ? config : null;
}

function normalizeSlug(slug: string): string {
  return String(slug || '').trim().toLowerCase();
}

// Cache for channel config (avoid DB hits on every message)
const channelConfigCache = new Map<string, { ts: number; channelId: string; config: ChatRewardsConfig | null }>();
const CHANNEL_CONFIG_TTL_MS = 60_000; // 1 minute

async function getChannelConfig(slug: string): Promise<{ channelId: string; config: ChatRewardsConfig | null } | null> {
  const normalizedSlug = normalizeSlug(slug);
  const cached = channelConfigCache.get(normalizedSlug);
  if (cached && Date.now() - cached.ts < CHANNEL_CONFIG_TTL_MS) {
    return { channelId: cached.channelId, config: cached.config };
  }

  const channel = await prisma.channel.findFirst({
    where: { slug: normalizedSlug },
    select: { id: true, chatRewardsJson: true },
  });

  if (!channel) return null;

  const config = parseChatRewardsConfig(channel.chatRewardsJson);
  channelConfigCache.set(normalizedSlug, { ts: Date.now(), channelId: channel.id, config });

  return { channelId: channel.id, config };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reward Handlers
// ─────────────────────────────────────────────────────────────────────────────

async function handleFirstMessageReward(params: {
  io: Server | null;
  channelId: string;
  channelSlug: string;
  userId: string;
  platform: ChatRewardPlatform;
  platformUserId: string;
  config: FirstMessageConfig;
}): Promise<void> {
  const { io, channelId, channelSlug, userId, platform, platformUserId, config } = params;

  if (!config.enabled || config.coins <= 0) return;

  // Check if stream is live (if required)
  if (config.onlyWhenLive !== false) {
    const session = await getStreamSessionSnapshot(channelSlug);
    if (session.status !== 'online') return;
  }

  const redis = await getRedisClient();
  if (!redis) return;

  // Get current stream session ID
  const session = await getStreamSessionSnapshot(channelSlug);
  const sessionId = session.sessionId || 'no-session';

  // Check if first message in this session
  const key = nsKey('chat_rewards', `first:${channelId}:${sessionId}:${userId}`);
  const isFirst = await redis.set(key, '1', { NX: true, EX: 48 * 60 * 60 }); // 48h TTL

  if (isFirst !== 'OK') return; // Already claimed

  // Grant coins directly (no pending)
  try {
    const wallet = await prisma.$transaction(async (tx) => {
      return WalletService.incrementBalance(
        tx,
        { userId, channelId },
        config.coins
      );
    });

    logger.info('chat_rewards.first_message_granted', {
      channelId,
      userId,
      platform,
      platformUserId,
      coins: config.coins,
      sessionId,
    });

    // Emit wallet update
    if (io) {
      emitWalletUpdated(io, { userId, channelId, balance: wallet.balance });
      void relayWalletUpdatedToPeer({ userId, channelId, balance: wallet.balance });
    }
  } catch (error) {
    logger.error('chat_rewards.first_message_failed', {
      channelId,
      userId,
      platform,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Handler
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle incoming chat message and grant rewards if applicable.
 * Only grants rewards to logged-in users (no pending).
 */
export async function handleUnifiedChatReward(
  io: Server | null,
  event: ChatMessageEvent
): Promise<void> {
  try {
    // 1. Resolve memalerts user ID from platform identity
    const userId = await resolveMemalertsUserIdFromChatIdentity({
      provider: event.platform,
      platformUserId: event.platformUserId,
    });

    // 2. Not logged in? Exit (no pending)
    if (!userId) return;

    // 3. Get channel config
    const channelData = await getChannelConfig(event.channelSlug);
    if (!channelData || !channelData.config) return;

    const { channelId, config } = channelData;

    // 4. Handle each reward type
    if (config.firstMessage) {
      await handleFirstMessageReward({
        io,
        channelId,
        channelSlug: event.channelSlug,
        userId,
        platform: event.platform,
        platformUserId: event.platformUserId,
        config: config.firstMessage,
      });
    }

    // Future: handle other reward types here
    // if (config.messageThresholds) { ... }
    // if (config.dailyStreak) { ... }
  } catch (error) {
    logger.error('chat_rewards.handler_failed', {
      platform: event.platform,
      channelSlug: event.channelSlug,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Clear the channel config cache (useful after config updates).
 */
export function clearChannelConfigCache(slug?: string): void {
  if (slug) {
    channelConfigCache.delete(normalizeSlug(slug));
  } else {
    channelConfigCache.clear();
  }
}

