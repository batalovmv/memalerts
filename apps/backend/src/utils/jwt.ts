import crypto from 'node:crypto';
import jwt, { type SignOptions, type VerifyOptions } from 'jsonwebtoken';
import { recordJwtPreviousKeyVerification } from './metrics.js';

type JwtConfig = {
  currentSecret: string;
  previousSecret: string | null;
  currentKid: string;
  previousKid: string | null;
};

function normalizeSecret(value: string | undefined | null): string | null {
  const trimmed = String(value ?? '').trim();
  return trimmed ? trimmed : null;
}

function base64Url(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function buildKid(secret: string): string {
  const hash = crypto.createHash('sha256').update(secret).digest();
  return base64Url(hash).slice(0, 12);
}

function getJwtConfig(): JwtConfig {
  const currentSecret = normalizeSecret(process.env.JWT_SECRET);
  if (!currentSecret) {
    throw new Error('JWT_SECRET is not configured');
  }
  const previousSecret = normalizeSecret(process.env.JWT_SECRET_PREVIOUS);
  return {
    currentSecret,
    previousSecret,
    currentKid: buildKid(currentSecret),
    previousKid: previousSecret ? buildKid(previousSecret) : null,
  };
}

export function signJwt(payload: string | Buffer | object, options?: SignOptions): string {
  const { currentSecret, currentKid } = getJwtConfig();
  const algorithm = options?.algorithm ?? 'HS256';
  const header: jwt.JwtHeader = { ...(options?.header ?? {}), kid: currentKid, alg: algorithm };
  return jwt.sign(payload, currentSecret, { ...options, algorithm, header });
}

export function verifyJwtWithRotation<T = jwt.JwtPayload>(token: string, context: string, options?: VerifyOptions): T {
  const { currentSecret, previousSecret } = getJwtConfig();
  try {
    return jwt.verify(token, currentSecret, options) as T;
  } catch (error) {
    if (previousSecret) {
      try {
        const payload = jwt.verify(token, previousSecret, options) as T;
        recordJwtPreviousKeyVerification(context);
        return payload;
      } catch {
        // fall through to throw original error
      }
    }
    throw error;
  }
}
