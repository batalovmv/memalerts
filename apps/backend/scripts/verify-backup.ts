import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

function readEnv(name: string): string | null {
  const raw = String(process.env[name] ?? '').trim();
  return raw.length > 0 ? raw : null;
}

function parseNumber(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function globToRegex(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function findLatestBackup(dir: string, glob: string): { filePath: string; mtimeMs: number; size: number } | null {
  if (!fs.existsSync(dir)) return null;
  const matcher = globToRegex(glob);
  const entries = fs.readdirSync(dir);
  let best: { filePath: string; mtimeMs: number; size: number } | null = null;

  for (const entry of entries) {
    if (!matcher.test(entry)) continue;
    const filePath = path.join(dir, entry);
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) continue;
    if (!best || stat.mtimeMs > best.mtimeMs) {
      best = { filePath, mtimeMs: stat.mtimeMs, size: stat.size };
    }
  }

  return best;
}

const argPath = process.argv[2];
const backupFile = argPath || readEnv('BACKUP_FILE');
const backupDir = readEnv('BACKUP_DIR') || '/backups';
const backupGlob = readEnv('BACKUP_GLOB') || 'memalerts-*.dump';
const maxAgeHours = parseNumber(readEnv('BACKUP_MAX_AGE_HOURS'), 2);

let target: { filePath: string; mtimeMs: number; size: number } | null = null;

if (backupFile) {
  if (!fs.existsSync(backupFile)) {
    console.error(`[backup:verify] Backup file not found: ${backupFile}`);
    process.exit(1);
  }
  const stat = fs.statSync(backupFile);
  if (!stat.isFile()) {
    console.error(`[backup:verify] Not a file: ${backupFile}`);
    process.exit(1);
  }
  target = { filePath: backupFile, mtimeMs: stat.mtimeMs, size: stat.size };
} else {
  target = findLatestBackup(backupDir, backupGlob);
  if (!target) {
    console.error(`[backup:verify] No backup files matching ${backupGlob} in ${backupDir}`);
    process.exit(1);
  }
}

if (target.size <= 0) {
  console.error(`[backup:verify] Backup file is empty: ${target.filePath}`);
  process.exit(1);
}

const ageHours = (Date.now() - target.mtimeMs) / (1000 * 60 * 60);
if (maxAgeHours > 0 && ageHours > maxAgeHours) {
  console.error(
    `[backup:verify] Backup file is too old (${ageHours.toFixed(2)}h > ${maxAgeHours}h): ${target.filePath}`
  );
  process.exit(1);
}

try {
  execFileSync('pg_restore', ['--list', target.filePath], { stdio: 'ignore' });
} catch (error) {
  const err = error as Error;
  console.error(`[backup:verify] pg_restore --list failed: ${err.message}`);
  process.exit(1);
}

console.log(
  `[backup:verify] OK file=${target.filePath} ageHours=${ageHours.toFixed(2)} sizeBytes=${target.size}`
);
