import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

type Finding = { file: string; rule: string; line: number; excerpt: string };

function rel(p: string): string {
  return path.relative(process.cwd(), p).replace(/\\/g, '/');
}

function isAllowed(): boolean {
  const v = String(process.env.ALLOW_DESTRUCTIVE_MIGRATIONS || '')
    .trim()
    .toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}


function tryExec(cmd: string): string | null {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8');
  } catch {
    return null;
  }
}

function getChangedMigrationFiles(): string[] | null {
  // Prefer explicit SHAs (CI can pass them).
  const base = String(process.env.MIGRATIONS_BASE_SHA || '').trim();
  const head = String(process.env.MIGRATIONS_HEAD_SHA || '').trim();
  const range = base && head ? `${base}...${head}` : base ? `${base}...HEAD` : '';
  const diffCmd = range ? `git diff --name-only --diff-filter=AMR ${range}` : 'git diff --name-only --diff-filter=AMR';
  const out = tryExec(diffCmd);
  if (!out) return null;
  const files = out
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((p) => p.startsWith('prisma/migrations/') && p.endsWith('/migration.sql'));
  return files;
}

// Only check migrations that are new/changed in the current diff.
// This avoids retroactively failing the repo on historical migrations.
const changed = getChangedMigrationFiles();
const sqlFiles = changed && changed.length > 0 ? changed.map((p) => path.resolve(process.cwd(), p)) : [];
if (sqlFiles.length === 0) {
   
  console.log('[migrations:check] OK (no changed migrations)');
  process.exit(0);
}

// Quick guard rails for shared DB with long-lived develop→main skew:
// disallow obviously destructive/irreversible operations unless explicitly overridden.
const rules: Array<{ name: string; re: RegExp }> = [
  { name: 'DROP TABLE', re: /\bdrop\s+table\b/i },
  { name: 'DROP COLUMN', re: /\bdrop\s+column\b/i },
  { name: 'ALTER COLUMN TYPE', re: /\balter\s+column\b[\s\S]{0,60}\btype\b/i },
  { name: 'RENAME COLUMN', re: /\brename\s+column\b/i },
  { name: 'RENAME TABLE', re: /\brename\s+to\b/i },
  // Tightening NOT NULL can break old code if backfill isn't guaranteed.
  { name: 'SET NOT NULL', re: /\bset\s+not\s+null\b/i },
];

const findings: Finding[] = [];

for (const file of sqlFiles) {
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    for (const r of rules) {
      if (r.re.test(line)) {
        findings.push({ file: rel(file), rule: r.name, line: i + 1, excerpt: line.trim().slice(0, 200) });
      }
    }
  }
}

if (findings.length > 0 && !isAllowed()) {
   
  console.error(
    [
      '[migrations:check] Potentially destructive SQL detected in prisma/migrations.',
      'This repo uses a shared DB between beta/prod, so destructive migrations can break production while develop is ahead.',
      '',
      'If you really intend to do a destructive change, you must use the expand/contract strategy.',
      'To bypass this check intentionally (rare), set ALLOW_DESTRUCTIVE_MIGRATIONS=1 for a manual run.',
      '',
      ...findings.map((f) => `- ${f.file}:${f.line} [${f.rule}] ${f.excerpt}`),
    ].join('\n')
  );
  process.exit(1);
}

 
console.log('[migrations:check] OK');
