import { readFileSync, readdirSync } from 'fs';
import path from 'path';

const repoRoot = path.resolve(process.cwd());
const baselinePath = path.join(repoRoot, 'tools', 'baselines.json');

const baselines = JSON.parse(readFileSync(baselinePath, 'utf-8')) as { any_count: number };

function listFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFiles(full));
      continue;
    }
    out.push(full);
  }
  return out;
}

function countPattern(pattern: string): number {
  const regex = new RegExp(pattern);
  const srcDir = path.join(repoRoot, 'src');
  let count = 0;
  for (const file of listFiles(srcDir)) {
    let content = '';
    try {
      content = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      if (regex.test(line)) count += 1;
    }
  }
  return count;
}

const anyCount = countPattern(': any');
const asAnyCount = countPattern('as any');

const total = anyCount + asAnyCount;
const baselineTotal = Number(baselines.any_count);

console.log(`Current \`: any\` count: ${anyCount}`);
console.log(`Current \`as any\` count: ${asAnyCount}`);
console.log(`Combined total: ${total}`);

if (total > baselineTotal) {
  console.error(`❌ any guard failed: ${total} > ${baselineTotal}`);
  process.exit(1);
}

console.log(`✅ any guard OK (${total} <= ${baselineTotal})`);
