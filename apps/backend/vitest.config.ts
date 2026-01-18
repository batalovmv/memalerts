import { defineConfig } from 'vitest/config';
import { randomUUID } from 'crypto';
import 'dotenv/config';

function appendSchemaToPostgresUrl(baseUrl: string, schema: string): string {
  // Prisma supports ?schema=... for Postgres (sets search_path).
  // We keep everything else identical and only inject/override the schema param.
  const url = new URL(baseUrl);
  url.searchParams.set('schema', schema);
  return url.toString();
}

function stripSchemaParam(raw: string): string {
  const url = new URL(raw);
  url.searchParams.delete('schema');
  return url.toString();
}

function ensurePoolParams(raw: string): string {
  const url = new URL(raw);
  const currentLimit = parseInt(String(url.searchParams.get('connection_limit') || ''), 10);
  if (!Number.isFinite(currentLimit) || currentLimit < 10) {
    url.searchParams.set('connection_limit', '10');
  }
  const currentTimeout = parseInt(String(url.searchParams.get('pool_timeout') || ''), 10);
  if (!Number.isFinite(currentTimeout) || currentTimeout < 30) {
    url.searchParams.set('pool_timeout', '30');
  }
  return url.toString();
}

function isLocalhostHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function resolveTestDatabaseBase(): string {
  const explicit = process.env.TEST_DATABASE_URL_BASE;
  if (explicit) return ensurePoolParams(stripSchemaParam(explicit));

  const fallback = process.env.DATABASE_URL;
  if (fallback) {
    const url = new URL(fallback);
    if (!isLocalhostHostname(url.hostname)) {
      throw new Error(
        'Refusing to run tests against non-local DATABASE_URL; set TEST_DATABASE_URL_BASE explicitly to a local database'
      );
    }
    return ensurePoolParams(stripSchemaParam(url.toString()));
  }

  // Safe local default for developer machines without env configuration.
  // Default to local test container (memalerts-test-pg) on localhost:54329.
  return ensurePoolParams('postgresql://postgres:postgres@localhost:54329/memalerts_test');
}

const base = resolveTestDatabaseBase();
process.env.MEMALERTS_TEST = process.env.MEMALERTS_TEST || '1';
process.env.TEST_DATABASE_URL_BASE = base;

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
    setupFiles: ['./tests/setup.ts'],
    globalSetup: ['./tests/globalSetup.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    isolate: true,
    // Keep it deterministic on self-hosted runners where CPU contention can happen.
    pool: 'threads',
    poolOptions: {
      threads: { singleThread: true, minThreads: 1, maxThreads: 1 },
    },
    maxConcurrency: 1,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      reportsDirectory: './coverage',
      exclude: [
        'dist/**',
        'node_modules/**',
        'scripts/**',
        'tools/**',
        'prisma/seed.ts',
        'src/index.ts',
        'src/jobs/**',
        'src/bots/**',
      ],
    },
  },
});
