export type RoleTag = 'OWNER' | 'MODERATOR' | 'SPONSOR' | 'VERIFIED';

export type RoleMode = 'ANY' | 'ALL';

export function getYouTubeRoleTags(m: {
  authorDetails?: {
    isChatOwner?: boolean;
    isChatModerator?: boolean;
    isChatSponsor?: boolean;
    isVerified?: boolean;
  };
}): Set<RoleTag> {
  const a = m?.authorDetails || {};
  const out = new Set<RoleTag>();
  if (a.isChatOwner) out.add('OWNER');
  if (a.isChatModerator) out.add('MODERATOR');
  if (a.isChatSponsor) out.add('SPONSOR');
  if (a.isVerified) out.add('VERIFIED');
  return out;
}

export function hasRoles(user: Set<RoleTag>, required: RoleTag[], mode: RoleMode): boolean {
  if (!required?.length) return true; // if not specified -> allowed for everyone
  return mode === 'ALL' ? required.every((r) => user.has(r)) : required.some((r) => user.has(r));
}

export function sanitizeRoleTags(v: unknown): RoleTag[] {
  if (!Array.isArray(v)) return [];
  const out: RoleTag[] = [];
  for (const item of v) {
    const tag = String(item || '')
      .trim()
      .toUpperCase();
    if (tag === 'OWNER' || tag === 'MODERATOR' || tag === 'SPONSOR' || tag === 'VERIFIED') {
      out.push(tag as RoleTag);
    }
  }
  return out;
}
