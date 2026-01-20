import { PrismaClient } from '@prisma/client';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function appendSchemaToPostgresUrl(baseUrl: string, schema: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set('schema', schema);
  return url.toString();
}

function safeSchemaIdent(schema: string): string {
  // We generate schema names ourselves in vitest.config.ts, but validate anyway.
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) {
    throw new Error(`Invalid TEST_SCHEMA "${schema}" (expected [a-zA-Z_][a-zA-Z0-9_]*)`);
  }
  return schema;
}

export default async function globalSetup() {
  const base = process.env.TEST_DATABASE_URL_BASE;
  const schema = safeSchemaIdent(String(process.env.TEST_SCHEMA || ''));
  if (!base) throw new Error('TEST_DATABASE_URL_BASE must be set');
  if (!schema) throw new Error('TEST_SCHEMA must be set (it is normally set by vitest.config.ts)');

  // Admin connection: always use public schema for CREATE/DROP schema operations.
  const adminUrl = appendSchemaToPostgresUrl(base, 'public');
  const admin = new PrismaClient({
    datasources: {
      db: { url: adminUrl },
    },
  });

  // Create schema for this run.
  await admin.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);

  // Bootstrap schema for this run.
  //
  // IMPORTANT:
  // This repo's migration history is not guaranteed to be replayable from an empty database
  // (some migrations were created assuming pre-existing tables).
  // For CI tests we need a deterministic "create schema from current Prisma schema" step,
  // therefore we use `prisma db push`.
  const pnpmCmd = process.platform === 'win32' ? path.join(process.env.APPDATA || '', 'npm', 'pnpm.cmd') : 'pnpm';
  const pnpmExec = process.platform === 'win32' && fs.existsSync(pnpmCmd) ? pnpmCmd : 'pnpm';
  const bootstrap = spawnSync(pnpmExec, ['prisma', 'db', 'push', '--accept-data-loss'], {
    stdio: 'inherit',
    env: process.env as NodeJS.ProcessEnv,
    shell: process.platform === 'win32',
  });
  if (bootstrap.status !== 0) {
    throw new Error(`prisma db push failed with exit code ${bootstrap.status}`);
  }

  return async () => {
    try {
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await admin.$disconnect();
    }
  };
}
