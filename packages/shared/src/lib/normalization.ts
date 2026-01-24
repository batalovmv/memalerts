export function normalizeSlug(v: unknown): string {
  return String(v ?? '')
    .trim()
    .toLowerCase();
}

export function normalizeMessage(v: unknown): string {
  return String(v ?? '')
    .replace(/\r\n/g, '\n')
    .trim();
}
