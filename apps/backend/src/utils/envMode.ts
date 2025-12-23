/**
 * Environment helpers for runtime behavior (beta vs production).
 *
 * We intentionally do NOT rely solely on NODE_ENV because both beta and prod run with NODE_ENV=production.
 */

export function isBetaBackend(): boolean {
  const domain = String(process.env.DOMAIN || '').toLowerCase();
  const port = String(process.env.PORT || '');
  return domain.includes('beta.') || port === '3002';
}

export function isProdStrictDto(): boolean {
  const port = String(process.env.PORT || '');
  // Production instance is expected on 3001; beta is 3002.
  return !isBetaBackend() && port === '3001';
}



