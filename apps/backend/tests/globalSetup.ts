import { PrismaClient } from '@prisma/client';
import { spawnSync } from 'node:child_process';

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
  const base = process.env.TEST_DATABASE_URL_BASE || process.env.DATABASE_URL;
  const schema = safeSchemaIdent(String(process.env.TEST_SCHEMA || ''));
  if (!base) throw new Error('TEST_DATABASE_URL_BASE or DATABASE_URL must be set');
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

  // Apply migrations to the per-run schema (DATABASE_URL already points to it).
  const migrate = spawnSync('pnpm', ['prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    env: process.env as NodeJS.ProcessEnv,
  });
  if (migrate.status !== 0) {
    throw new Error(`prisma migrate deploy failed with exit code ${migrate.status}`);
  }

  return async () => {
    try {
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await admin.$disconnect();
    }
  };
}


