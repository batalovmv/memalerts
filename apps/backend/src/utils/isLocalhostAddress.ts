/**
 * True if a remote address should be considered localhost for internal-only endpoints.
 *
 * IMPORTANT:
 * We intentionally rely on the TCP remoteAddress (NOT x-forwarded-for),
 * because /internal/* must never be exposed via nginx/public internet.
 */
export function isLocalhostAddress(remoteAddress: string | null | undefined): boolean {
  const remote = String(remoteAddress || '').trim();
  if (!remote) return false;
  if (remote === '127.0.0.1') return true;
  if (remote === '::1') return true;
  // Common IPv6-mapped IPv4 form from Node: ::ffff:127.0.0.1
  if (remote.endsWith('127.0.0.1')) return true;
  return false;
}


