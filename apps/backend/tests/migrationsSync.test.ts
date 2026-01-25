import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

function prismaBin(): string {
  const bin = process.platform === 'win32' ? 'prisma.cmd' : 'prisma';
  return path.resolve(process.cwd(), 'node_modules', '.bin', bin);
}

function appendSchemaToPostgresUrl(baseUrl: string, schema: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set('schema', schema);
  return url.toString();
}

describe('prisma migrations', () => {
  it('are in sync with schema.prisma', () => {
    const base = process.env.TEST_DATABASE_URL_BASE || process.env.DATABASE_URL;
    expect(base).toBeTruthy();

    const shadowSchema = `shadow_migrations_${Date.now()}`;
    const shadowUrl = appendSchemaToPostgresUrl(String(base), shadowSchema);

    execFileSync(
      prismaBin(),
      [
        'migrate',
        'diff',
        '--from-migrations',
        'prisma/migrations',
        '--to-schema-datamodel',
        'prisma/schema.prisma',
        '--shadow-database-url',
        shadowUrl,
        '--exit-code',
      ],
      {
        stdio: 'inherit',
        env: { ...process.env, SHADOW_DATABASE_URL: shadowUrl },
      },
    );
  });
});
