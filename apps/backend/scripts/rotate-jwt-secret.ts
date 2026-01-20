import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { signJwt, verifyJwtWithRotation } from '../src/utils/jwt.js';

type EnvMap = Record<string, string>;

function parseArgs(argv: string[]) {
  const args = new Set(argv);
  const envIndex = argv.indexOf('--env');
  const envPath = envIndex >= 0 ? argv[envIndex + 1] : null;
  return {
    envPath,
    dryRun: args.has('--dry-run'),
    help: args.has('--help') || args.has('-h'),
  };
}

function normalizeSecret(value: string | undefined | null): string | null {
  const trimmed = String(value ?? '').trim();
  return trimmed ? trimmed : null;
}

function upsertEnvLine(raw: string, key: string, value: string): string {
  const lines = raw.split(/\r?\n/);
  let replaced = false;
  const nextLines = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      replaced = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!replaced) {
    if (nextLines.length && nextLines[nextLines.length - 1] !== '') nextLines.push('');
    nextLines.push(`${key}=${value}`);
  }
  return nextLines.join('\n');
}

function previewSecret(secret: string): string {
  if (secret.length <= 8) return secret;
  return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
}

async function main() {
  const { envPath, dryRun, help } = parseArgs(process.argv.slice(2));
  if (help) {
    console.log('Usage: pnpm tsx scripts/rotate-jwt-secret.ts [--env path] [--dry-run]');
    process.exit(0);
  }

  const envFile = envPath ? path.resolve(envPath) : path.resolve(process.cwd(), '.env');
  const raw = await fs.readFile(envFile, 'utf8');
  const parsed = dotenv.parse(raw) as EnvMap;

  const currentSecret = normalizeSecret(parsed.JWT_SECRET ?? process.env.JWT_SECRET);
  if (!currentSecret) {
    throw new Error('JWT_SECRET is missing; cannot rotate without current secret.');
  }
  if (currentSecret.length < 16) {
    throw new Error('JWT_SECRET must be at least 16 characters.');
  }

  const newSecret = crypto.randomBytes(48).toString('base64');
  const updated = upsertEnvLine(raw, 'JWT_SECRET_PREVIOUS', currentSecret);
  const updatedWithNew = upsertEnvLine(updated, 'JWT_SECRET', newSecret);

  if (dryRun) {
    console.log(`[dry-run] Would rotate JWT secrets in ${envFile}`);
    console.log(`[dry-run] JWT_SECRET -> ${previewSecret(newSecret)}`);
    console.log(`[dry-run] JWT_SECRET_PREVIOUS -> ${previewSecret(currentSecret)}`);
    process.exit(0);
  }

  await fs.writeFile(envFile, updatedWithNew, 'utf8');

  process.env.JWT_SECRET = newSecret;
  process.env.JWT_SECRET_PREVIOUS = currentSecret;

  const oldToken = jwt.sign({ sub: 'rotation-test', v: 1 }, currentSecret, { expiresIn: '5m' });
  const newToken = signJwt({ sub: 'rotation-test', v: 2 }, { expiresIn: '5m' });
  verifyJwtWithRotation(oldToken, 'rotation_script');
  verifyJwtWithRotation(newToken, 'rotation_script');

  console.log(`Rotated JWT secrets in ${envFile}`);
  console.log(`JWT_SECRET -> ${previewSecret(newSecret)}`);
  console.log(`JWT_SECRET_PREVIOUS -> ${previewSecret(currentSecret)}`);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Rotation failed: ${message}`);
  process.exit(1);
});
