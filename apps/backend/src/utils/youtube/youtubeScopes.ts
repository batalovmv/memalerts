export const YOUTUBE_SCOPE_READONLY = 'https://www.googleapis.com/auth/youtube.readonly';
export const YOUTUBE_SCOPE_FORCE_SSL = 'https://www.googleapis.com/auth/youtube.force-ssl';
export const REQUIRED_YOUTUBE_SCOPES = [YOUTUBE_SCOPE_READONLY];

export function splitScopes(scopes: string | null | undefined): string[] {
  return String(scopes || '')
    .split(/[ ,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function getMissingRequiredScopes(scopes: string | null | undefined): string[] {
  const set = new Set(splitScopes(scopes));
  if (set.has(YOUTUBE_SCOPE_READONLY) || set.has(YOUTUBE_SCOPE_FORCE_SSL)) return [];
  return REQUIRED_YOUTUBE_SCOPES.filter((s) => !set.has(s));
}
