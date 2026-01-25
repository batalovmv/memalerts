import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

type CompareResponse = { files?: Array<{ filename: string }> };

const SCHEMA_PATH = 'prisma/schema.prisma';
const MIGRATION_PREFIX = 'prisma/migrations/';
const MIGRATION_SUFFIX = '/migration.sql';

function tryExec(cmd: string): string | null {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8');
  } catch {
    return null;
  }
}

function getChangedFilesFromGit(): string[] | null {
  const out = tryExec('git diff --name-only --diff-filter=AMR HEAD~1..HEAD');
  if (!out) return null;
  return out
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function getChangedFilesFromGitHub(): Promise<string[] | null> {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!eventPath || !repo || !token) return null;
  if (!fs.existsSync(eventPath)) return null;

  const payload = JSON.parse(fs.readFileSync(eventPath, 'utf8')) as {
    before?: string;
    after?: string;
    pull_request?: { base?: { sha?: string }; head?: { sha?: string } };
  };

  const base = payload.pull_request?.base?.sha ?? payload.before;
  const head = payload.pull_request?.head?.sha ?? payload.after;
  if (!base || !head) return null;

  const url = `https://api.github.com/repos/${repo}/compare/${base}...${head}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'memalerts-ci',
    },
  });
  if (!res.ok) {
    throw new Error(`[migrationsSync] GitHub compare failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as CompareResponse;
  return (data.files || []).map((file) => file.filename);
}

function hasSchemaChange(files: string[]): boolean {
  return files.includes(SCHEMA_PATH);
}

function hasMigrationChange(files: string[]): boolean {
  return files.some(
    (file) => file.startsWith(MIGRATION_PREFIX) && file.endsWith(MIGRATION_SUFFIX)
  );
}

describe('prisma migrations', () => {
  it('tracks schema changes with migrations', async () => {
    const isCi = process.env.GITHUB_ACTIONS === 'true';
    const changed = isCi ? await getChangedFilesFromGitHub() : getChangedFilesFromGit();
    if (!changed || changed.length === 0) {
      console.log('[migrationsSync] Skipped (no diff info available)');
      return;
    }

    if (!hasSchemaChange(changed)) {
      return;
    }

    expect(
      hasMigrationChange(changed),
      `Schema changed (${SCHEMA_PATH}) without a new migration. Add a migration under prisma/migrations/ and re-run tests.`
    ).toBe(true);
  });
});
