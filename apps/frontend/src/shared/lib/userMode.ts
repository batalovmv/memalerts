export type UserMode = 'streamer' | 'viewer';

const STORAGE_KEY = 'memalerts:lastMode';

export function getStoredUserMode(): UserMode | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'streamer' || v === 'viewer' ? v : null;
  } catch {
    return null;
  }
}

export function setStoredUserMode(mode: UserMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // ignore
  }
}


