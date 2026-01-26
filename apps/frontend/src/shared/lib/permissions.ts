import type { User } from '@memalerts/api-contracts';

/**
 * Global pool moderation permission.
 *
 * Backend enforcement is the source of truth; this is only for UI gating.
 */
export function canModerateGlobalPool(user: User | null | undefined): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return user.isGlobalModerator === true;
}

/**
 * Submission AI description can contain sensitive / noisy content.
 * Show it only to privileged users (owner/admin/moderators).
 *
 * NOTE: We don't currently have a dedicated "channel moderator" flag on User;
 * `isGlobalModerator` is used as the best available UI hint.
 * Backend enforcement is the source of truth.
 */
export function canViewSubmissionAiDescription(user: User | null | undefined): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'streamer') return true; // owner
  return user.isGlobalModerator === true;
}



