export function extractVkVideoChannelIdFromUrl(rawUrl: string): string | null {
  const s = String(rawUrl || '').trim();
  if (!s) return null;

  try {
    const u = new URL(s);
    const parts = u.pathname
      .split('/')
      .map((p) => p.trim())
      .filter(Boolean);
    const last = parts[parts.length - 1] || '';
    return last ? decodeURIComponent(last) : null;
  } catch {
    const parts = s
      .split('/')
      .map((p) => p.trim())
      .filter(Boolean);
    const last = parts[parts.length - 1] || '';
    return last || null;
  }
}
