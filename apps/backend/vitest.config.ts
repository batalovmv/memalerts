import { defineConfig } from 'vitest/config';
import { randomUUID } from 'crypto';

function appendSchemaToPostgresUrl(baseUrl: string, schema: string): string {
  // Prisma supports ?schema=... for Postgres (sets search_path).
  // We keep everything else identical and only inject/override the schema param.
  const url = new URL(baseUrl);
  url.searchParams.set('schema', schema);
  return url.toString();
}

const base = process.env.TEST_DATABASE_URL_BASE || process.env.DATABASE_URL;
if (!base) {
  throw new Error('TEST_DATABASE_URL_BASE (preferred) or DATABASE_URL must be set for tests');
}

// Unique schema per vitest run: isolation without needing to drop/recreate the whole DB.
const schema = process.env.TEST_SCHEMA || `test_${randomUUID().replace(/-/g, '')}`;
process.env.TEST_SCHEMA = schema;
process.env.DATABASE_URL = appendSchemaToPostgresUrl(base, schema);

// Provide safe defaults for modules that expect these envs to exist (but tests shouldn’t depend on real secrets).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    globalSetup: ['./tests/globalSetup.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    isolate: true,
    // Keep it deterministic on self-hosted runners where CPU contention can happen.
    pool: 'threads',
    poolOptions: {
      threads: { singleThread: true },
    },
  },
});


