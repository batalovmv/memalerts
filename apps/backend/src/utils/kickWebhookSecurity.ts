import { logger } from './logger.js';

const DEFAULT_TTL_MS = 10 * 60 * 1000;

let cachedPem: string | null = null;
let cachedExpiresAt = 0;
let inFlight: Promise<string | null> | null = null;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function normalizePem(pem: string): string {
  const s = String(pem || '').trim();
  if (!s) return '';
  // Kick returns a PEM already, but allow a raw key as well.
  if (s.includes('BEGIN PUBLIC KEY')) return s;
  return `-----BEGIN PUBLIC KEY-----\n${s}\n-----END PUBLIC KEY-----`;
}

export async function fetchKickPublicKeyPem(): Promise<string | null> {
  const override = String(process.env.KICK_WEBHOOK_PUBLIC_KEY_PEM || '').trim();
  if (override) return normalizePem(override);

  const now = Date.now();
  if (cachedPem && now < cachedExpiresAt) return cachedPem;
  if (inFlight) return await inFlight;

  const ttlMs = (() => {
    const raw = Number(process.env.KICK_WEBHOOK_PUBLIC_KEY_TTL_MS ?? DEFAULT_TTL_MS);
    return Number.isFinite(raw) && raw > 5_000 ? raw : DEFAULT_TTL_MS;
  })();

  inFlight = (async () => {
    try {
      const resp = await fetch('https://api.kick.com/public/v1/public-key', {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      const data = await resp.json().catch(() => null);
      const dataRecord = asRecord(data);
      const nested = asRecord(dataRecord.data);
      const keyRaw =
        nested.public_key ?? nested.publicKey ?? dataRecord.public_key ?? dataRecord.publicKey ?? null;
      const pem = normalizePem(String(keyRaw || ''));
      if (!resp.ok || !pem) {
        logger.warn('kick.webhook.public_key_fetch_failed', { status: resp.status });
        cachedPem = null;
        cachedExpiresAt = 0;
        return null;
      }
      cachedPem = pem;
      cachedExpiresAt = Date.now() + ttlMs;
      return pem;
    } catch (error) {
      const err = error as Error;
      logger.warn('kick.webhook.public_key_fetch_failed', { errorMessage: err.message || String(error) });
      cachedPem = null;
      cachedExpiresAt = 0;
      return null;
    } finally {
      inFlight = null;
    }
  })();

  return await inFlight;
}
