import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

type Finding = { file: string; ruleId: string; line: number; excerpt: string };
type Statement = { text: string; lines: string[]; startLine: number; endLine: number };

const FEATURE_FLAG_RE = /feature[-_\s]?flag\s*:\s*([a-z0-9_.-]+)/i;
const LINT_ALLOW_RE = /memalerts-lint:\s*allow(?:\s+([a-z0-9_,\s-]+))?/i;

const RULE_IDS = {
  dropTable: 'drop-table',
  dropColumn: 'drop-column',
  alterColumnType: 'alter-column-type',
  renameColumn: 'rename-column',
  renameTable: 'rename-table',
  notNullNoDefault: 'not-null-no-default',
  noWhere: 'no-where',
} as const;

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
  const diffCmd = range
    ? `git diff --name-only --diff-filter=AMR ${range}`
    : 'git diff --name-only --diff-filter=AMR';
  const out = tryExec(diffCmd);
  if (!out) return null;
  const files = out
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((p) => p.startsWith('prisma/migrations/') && p.endsWith('/migration.sql'));
  return files;
}

function stripLineComment(line: string): string {
  return line.replace(/--.*$/, '');
}

function stripSqlComments(sql: string): string {
  const withoutBlock = sql.replace(/\/\*[\s\S]*?\*\//g, ' ');
  return withoutBlock
    .split(/\r?\n/)
    .map((line) => stripLineComment(line))
    .join('\n');
}

function parseAllowList(line: string): string[] | null {
  const match = line.match(LINT_ALLOW_RE);
  if (!match) return null;
  const raw = String(match[1] || '').trim().toLowerCase();
  if (!raw) return ['all'];
  return raw
    .split(/[, ]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function statementAllows(lines: string[], ruleId: string): boolean {
  for (const line of lines) {
    const list = parseAllowList(line);
    if (!list) continue;
    if (list.includes('all') || list.includes('*')) return true;
    if (list.includes(ruleId)) return true;
  }
  return false;
}

function statementHasFeatureFlag(lines: string[]): boolean {
  return lines.some((line) => FEATURE_FLAG_RE.test(line));
}

function splitStatements(lines: string[]): Statement[] {
  const statements: Statement[] = [];
  let buffer: string[] = [];
  let startLine = 1;
  let open = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (!open) {
      if (!line.trim()) continue;
      open = true;
      startLine = i + 1;
      buffer = [];
    }
    buffer.push(line);
    if (line.includes(';')) {
      statements.push({
        text: buffer.join('\n'),
        lines: buffer.slice(),
        startLine,
        endLine: i + 1,
      });
      buffer = [];
      open = false;
    }
  }

  if (open && buffer.length > 0) {
    statements.push({
      text: buffer.join('\n'),
      lines: buffer.slice(),
      startLine,
      endLine: lines.length,
    });
  }

  return statements;
}

function findLineIndex(lines: string[], re: RegExp): number {
  for (let i = 0; i < lines.length; i += 1) {
    if (re.test(stripLineComment(lines[i] ?? ''))) return i;
  }
  return 0;
}

function addFinding(findings: Finding[], params: { file: string; ruleId: string; line: number; excerpt: string }) {
  findings.push({
    file: params.file,
    ruleId: params.ruleId,
    line: params.line,
    excerpt: params.excerpt,
  });
}

function emitGitHubWarnings(findings: Finding[]) {
  if (process.env.GITHUB_ACTIONS !== 'true') return;
  for (const f of findings) {
    const msg = `${f.ruleId}: ${f.excerpt}`;
    const safe = msg.replace(/\r?\n/g, ' ').slice(0, 1000);
    console.log(`::warning file=${f.file},line=${f.line},title=${f.ruleId}::${safe}`);
  }
}

// Only check migrations that are new/changed in the current diff.
// This avoids retroactively failing the repo on historical migrations.
const changed = getChangedMigrationFiles();
const sqlFiles = changed && changed.length > 0 ? changed.map((p) => path.resolve(process.cwd(), p)) : [];
if (sqlFiles.length === 0) {
  console.log('[migrations:check] OK (no changed migrations)');
  process.exit(0);
}

const findings: Finding[] = [];

for (const file of sqlFiles) {
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split(/\r?\n/);
  const statements = splitStatements(lines);

  for (const stmt of statements) {
    const allowDropTable = statementAllows(stmt.lines, RULE_IDS.dropTable);
    const allowDropColumn = statementAllows(stmt.lines, RULE_IDS.dropColumn);
    const allowAlterType = statementAllows(stmt.lines, RULE_IDS.alterColumnType);
    const allowRenameColumn = statementAllows(stmt.lines, RULE_IDS.renameColumn);
    const allowRenameTable = statementAllows(stmt.lines, RULE_IDS.renameTable);
    const allowNotNull = statementAllows(stmt.lines, RULE_IDS.notNullNoDefault);
    const allowNoWhere = statementAllows(stmt.lines, RULE_IDS.noWhere);
    const hasFeatureFlag = statementHasFeatureFlag(stmt.lines);

    const stmtSql = stripSqlComments(stmt.text);
    const stmtLower = stmtSql.toLowerCase();

    for (let i = 0; i < stmt.lines.length; i += 1) {
      const line = stmt.lines[i] ?? '';
      const stripped = stripLineComment(line);
      if (!allowDropTable && !hasFeatureFlag && /\bdrop\s+table\b/i.test(stripped)) {
        addFinding(findings, {
          file: rel(file),
          ruleId: RULE_IDS.dropTable,
          line: stmt.startLine + i,
          excerpt: line.trim().slice(0, 200),
        });
      }
      if (!allowDropColumn && !hasFeatureFlag && /\bdrop\s+column\b/i.test(stripped)) {
        addFinding(findings, {
          file: rel(file),
          ruleId: RULE_IDS.dropColumn,
          line: stmt.startLine + i,
          excerpt: line.trim().slice(0, 200),
        });
      }
    }

    if (!allowAlterType && /\balter\s+column\b[\s\S]{0,120}\btype\b/i.test(stmtLower)) {
      const lineIndex = findLineIndex(stmt.lines, /\balter\s+column\b/i);
      addFinding(findings, {
        file: rel(file),
        ruleId: RULE_IDS.alterColumnType,
        line: stmt.startLine + lineIndex,
        excerpt: (stmt.lines[lineIndex] ?? '').trim().slice(0, 200),
      });
    }

    if (!allowRenameColumn && /\brename\s+column\b/i.test(stmtLower)) {
      const lineIndex = findLineIndex(stmt.lines, /\brename\s+column\b/i);
      addFinding(findings, {
        file: rel(file),
        ruleId: RULE_IDS.renameColumn,
        line: stmt.startLine + lineIndex,
        excerpt: (stmt.lines[lineIndex] ?? '').trim().slice(0, 200),
      });
    }

    if (!allowRenameTable && /\brename\s+to\b/i.test(stmtLower)) {
      const lineIndex = findLineIndex(stmt.lines, /\brename\s+to\b/i);
      addFinding(findings, {
        file: rel(file),
        ruleId: RULE_IDS.renameTable,
        line: stmt.startLine + lineIndex,
        excerpt: (stmt.lines[lineIndex] ?? '').trim().slice(0, 200),
      });
    }

    const addColumnNotNull = /\badd\s+column\b/i.test(stmtLower) && /\bnot\s+null\b/i.test(stmtLower);
    const setNotNull = /\bset\s+not\s+null\b/i.test(stmtLower);
    const hasDefault = /\bdefault\b/i.test(stmtLower);
    if (!allowNotNull && (addColumnNotNull || setNotNull) && !hasDefault) {
      const lineIndex = findLineIndex(stmt.lines, addColumnNotNull ? /\badd\s+column\b/i : /\bset\s+not\s+null\b/i);
      addFinding(findings, {
        file: rel(file),
        ruleId: RULE_IDS.notNullNoDefault,
        line: stmt.startLine + lineIndex,
        excerpt: (stmt.lines[lineIndex] ?? '').trim().slice(0, 200),
      });
    }

    const trimmed = stmtLower.trim();
    const hasWhere = /\bwhere\b/i.test(stmtLower);
    const isUpdate = /^\s*update\b/i.test(trimmed) || (/^\s*with\b/i.test(trimmed) && /\bupdate\b/i.test(trimmed));
    const isDelete =
      /^\s*delete\b/i.test(trimmed) || (/^\s*with\b/i.test(trimmed) && /\bdelete\b/i.test(trimmed));
    if (!allowNoWhere && (isUpdate || isDelete) && !hasWhere) {
      const lineIndex = findLineIndex(stmt.lines, isUpdate ? /\bupdate\b/i : /\bdelete\b/i);
      addFinding(findings, {
        file: rel(file),
        ruleId: RULE_IDS.noWhere,
        line: stmt.startLine + lineIndex,
        excerpt: (stmt.lines[lineIndex] ?? '').trim().slice(0, 200),
      });
    }
  }
}

if (findings.length > 0 && !isAllowed()) {
  emitGitHubWarnings(findings);
  console.warn(
    [
      '[migrations:check] Potentially dangerous SQL detected in prisma/migrations (warning only).',
      'Add a feature-flag annotation for DROP TABLE/COLUMN, or suppress a specific rule with:',
      '  -- memalerts-lint: allow <rule-id>',
      '',
      ...findings.map((f) => `- ${f.file}:${f.line} [${f.ruleId}] ${f.excerpt}`),
    ].join('\n')
  );
  process.exit(0);
}

if (findings.length > 0 && isAllowed()) {
  console.log('[migrations:check] Warnings suppressed via ALLOW_DESTRUCTIVE_MIGRATIONS=1');
  process.exit(0);
}

console.log('[migrations:check] OK');
