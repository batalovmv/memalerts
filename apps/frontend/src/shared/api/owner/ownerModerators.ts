import { api } from '@/lib/api';

export type OwnerModeratorGrant = {
  id: string;
  userId: string;
  active: boolean;
  createdAt?: string | null;
  revokedAt?: string | null;
  revokedReason?: string | null;
  user?: {
    id: string;
    displayName?: string | null;
    profileImageUrl?: string | null;
  } | null;
  _raw?: unknown;
};

export async function getOwnerModerators(): Promise<OwnerModeratorGrant[]> {
  const res = await api.get<unknown>('/owner/moderators');
  const arr = Array.isArray(res) ? (res as unknown[]) : [];
  return arr.map((x) => {
    const r = x && typeof x === 'object' ? (x as Record<string, unknown>) : null;
    const userRaw = (r?.user && typeof r.user === 'object' ? (r.user as Record<string, unknown>) : null) ?? null;
    return {
      id: typeof r?.id === 'string' ? (r.id as string) : '',
      userId: typeof r?.userId === 'string' ? (r.userId as string) : '',
      active: r?.active === true,
      createdAt: typeof r?.createdAt === 'string' ? (r.createdAt as string) : r?.createdAt === null ? null : undefined,
      revokedAt: typeof r?.revokedAt === 'string' ? (r.revokedAt as string) : r?.revokedAt === null ? null : undefined,
      revokedReason:
        typeof r?.revokedReason === 'string' ? (r.revokedReason as string) : r?.revokedReason === null ? null : undefined,
      user: userRaw
        ? {
            id: typeof userRaw.id === 'string' ? userRaw.id : '',
            displayName: typeof userRaw.displayName === 'string' ? userRaw.displayName : userRaw.displayName === null ? null : undefined,
            profileImageUrl:
              typeof userRaw.profileImageUrl === 'string'
                ? userRaw.profileImageUrl
                : userRaw.profileImageUrl === null
                  ? null
                  : undefined,
          }
        : null,
      _raw: x,
    } satisfies OwnerModeratorGrant;
  });
}

export async function grantOwnerModerator(userId: string): Promise<void> {
  await api.post(`/owner/moderators/${encodeURIComponent(userId)}/grant`, {});
}

export async function revokeOwnerModerator(userId: string): Promise<void> {
  await api.post(`/owner/moderators/${encodeURIComponent(userId)}/revoke`, {});
}


