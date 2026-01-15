import fs from 'node:fs';
import path from 'node:path';

type CoverageTotals = {
  lines?: { pct?: number };
  statements?: { pct?: number };
  functions?: { pct?: number };
  branches?: { pct?: number };
};

type CoverageSummary = {
  total?: CoverageTotals;
};

type CoverageBaseline = {
  lines: number;
  statements: number;
  functions: number;
  branches: number;
};

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function resolvePath(envKey: string, fallback: string): string {
  const raw = String(process.env[envKey] || '').trim();
  return raw.length > 0 ? raw : fallback;
}

const summaryPath = resolvePath(
  'COVERAGE_SUMMARY_PATH',
  path.join(process.cwd(), 'coverage', 'coverage-summary.json')
);
const baselinePath = resolvePath(
  'COVERAGE_BASELINE_PATH',
  path.join(process.cwd(), 'coverage-baseline.json')
);

if (!fs.existsSync(summaryPath)) {
  console.error(`coverage summary not found: ${summaryPath}`);
  process.exit(1);
}

const summary = readJson<CoverageSummary>(summaryPath);
const totals = summary.total || {};

const baseline: CoverageBaseline = {
  lines: Number.isFinite(totals.lines?.pct) ? (totals.lines?.pct as number) : 0,
  statements: Number.isFinite(totals.statements?.pct) ? (totals.statements?.pct as number) : 0,
  functions: Number.isFinite(totals.functions?.pct) ? (totals.functions?.pct as number) : 0,
  branches: Number.isFinite(totals.branches?.pct) ? (totals.branches?.pct as number) : 0,
};

fs.writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + '\n', 'utf8');
console.log(`Updated coverage baseline at ${baselinePath}`);
console.log(baseline);
