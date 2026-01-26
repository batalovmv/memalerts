import type { User } from '@memalerts/api-contracts';

export function makeViewerUser(overrides: Partial<User> = {}): User {
  return {
    id: 'u_viewer',
    displayName: 'Viewer',
    role: 'viewer',
    channelId: null,
    ...overrides,
  };
}

export function makeStreamerUser(overrides: Partial<User> = {}): User {
  return {
    id: 'u_streamer',
    displayName: 'Streamer',
    role: 'streamer',
    channelId: 'c1',
    channel: { id: 'c1', slug: 's1', name: 'S' },
    ...overrides,
  };
}

export function makeGlobalModeratorUser(overrides: Partial<User> = {}): User {
  return makeViewerUser({
    id: 'u_mod',
    displayName: 'Moderator',
    isGlobalModerator: true,
    ...overrides,
  });
}




















