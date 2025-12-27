import { getStoredUserMode, type UserMode } from './userMode';

import type { User } from '@/types';

export function canUseStreamerUi(user: User | null | undefined): boolean {
  return Boolean(user && (user.role === 'streamer' || user.role === 'admin') && user.channelId);
}

/**
 * Effective UI mode for users that can be streamers.
 * - Users that cannot be streamers are always "viewer".
 * - Streamer/admin users default to "streamer" unless explicitly set to "viewer".
 */
export function getEffectiveUserMode(user: User | null | undefined): UserMode {
  if (!canUseStreamerUi(user)) return 'viewer';
  return getStoredUserMode() ?? 'streamer';
}


