export function isValidEmail(value: string): boolean {
  const v = String(value ?? '').trim();
  if (!v) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export function isValidUrl(value: string): boolean {
  const v = String(value ?? '').trim();
  if (!v) return false;
  try {
    const url = new URL(v);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
