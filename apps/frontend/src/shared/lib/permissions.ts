import type { User } from '@/types';

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


