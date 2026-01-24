import fs from 'node:fs/promises';
import path from 'node:path';

import { logger } from '../utils/logger.js';

type SecretsRecord = Record<string, string>;

function parseBool(value: string | undefined): boolean {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function normalizeSecrets(input: unknown): SecretsRecord {
  if (!input || typeof input !== 'object') return {};
  const entries = Object.entries(input as Record<string, unknown>);
  return entries.reduce<SecretsRecord>((acc, [key, value]) => {
    if (value === null || value === undefined) return acc;
    if (typeof value === 'string') {
      acc[key] = value;
      return acc;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      acc[key] = String(value);
      return acc;
    }
    return acc;
  }, {});
}

function applySecrets(secrets: SecretsRecord, allowOverride: boolean): number {
  const keys = Object.keys(secrets);
  for (const key of keys) {
    if (!allowOverride && process.env[key] !== undefined) continue;
    process.env[key] = secrets[key];
  }
  return keys.length;
}

async function loadSecretsFromFile(filePath: string, allowOverride: boolean): Promise<void> {
  const resolved = path.resolve(filePath);
  const raw = await fs.readFile(resolved, 'utf8');
  const json = JSON.parse(raw) as unknown;
  const secrets = normalizeSecrets(json);
  const count = applySecrets(secrets, allowOverride);
  logger.info('secrets.file.loaded', { count, path: resolved });
}

async function loadSecretsFromVault(allowOverride: boolean): Promise<void> {
  const addr = process.env.VAULT_ADDR;
  const token = process.env.VAULT_TOKEN;
  const vaultPath = process.env.VAULT_PATH;
  if (!addr || !token || !vaultPath) {
    logger.warn('secrets.vault.missing_config', { hasAddr: !!addr, hasToken: !!token, hasPath: !!vaultPath });
    return;
  }

  const normalizedPath = vaultPath.replace(/^\/+/, '');
  const url = new URL(`/v1/${normalizedPath}`, addr);
  const headers: Record<string, string> = { 'X-Vault-Token': token };
  if (process.env.VAULT_NAMESPACE) {
    headers['X-Vault-Namespace'] = process.env.VAULT_NAMESPACE;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    logger.error('secrets.vault.fetch_failed', { status: res.status, statusText: res.statusText });
    return;
  }

  const json = (await res.json()) as { data?: { data?: unknown } };
  const payload = json?.data?.data ?? json?.data ?? null;
  const secrets = normalizeSecrets(payload);
  const count = applySecrets(secrets, allowOverride);
  logger.info('secrets.vault.loaded', { count, path: vaultPath });
}

export async function loadSecrets(): Promise<void> {
  const provider = String(process.env.SECRETS_PROVIDER || 'env').trim().toLowerCase();
  const allowOverride = parseBool(process.env.SECRETS_ALLOW_OVERRIDE);

  if (provider === 'env' || provider === '') return;

  try {
    if (provider === 'file') {
      const filePath = process.env.SECRETS_FILE;
      if (!filePath) {
        logger.warn('secrets.file.missing_path');
        return;
      }
      await loadSecretsFromFile(filePath, allowOverride);
      return;
    }

    if (provider === 'vault') {
      await loadSecretsFromVault(allowOverride);
      return;
    }

    logger.warn('secrets.provider.unknown', { provider });
  } catch (error) {
    const err = error as Error;
    logger.error('secrets.load_failed', { provider, errorMessage: err.message });
  }
}
