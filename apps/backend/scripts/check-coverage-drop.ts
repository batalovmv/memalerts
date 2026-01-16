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

function readBaseline(filePath: string): CoverageBaseline {
  if (!fs.existsSync(filePath)) {
    return { lines: 0, statements: 0, functions: 0, branches: 0 };
  }
  const baseline = readJson<CoverageBaseline>(filePath);
  return {
    lines: Number.isFinite(baseline.lines) ? baseline.lines : 0,
    statements: Number.isFinite(baseline.statements) ? baseline.statements : 0,
    functions: Number.isFinite(baseline.functions) ? baseline.functions : 0,
    branches: Number.isFinite(baseline.branches) ? baseline.branches : 0,
  };
}

function readCurrentTotals(filePath: string): CoverageBaseline {
  const summary = readJson<CoverageSummary>(filePath);
  const totals = summary.total || {};
  const pick = (value: CoverageTotals[keyof CoverageTotals]) =>
    Number.isFinite(value?.pct) ? (value?.pct as number) : 0;
  return {
    lines: pick(totals.lines),
    statements: pick(totals.statements),
    functions: pick(totals.functions),
    branches: pick(totals.branches),
  };
}

const baselinePath = resolvePath('COVERAGE_BASELINE_PATH', path.join(process.cwd(), 'coverage-baseline.json'));
const summaryPath = resolvePath('COVERAGE_SUMMARY_PATH', path.join(process.cwd(), 'coverage', 'coverage-summary.json'));
const maxDrop = Number.parseFloat(String(process.env.COVERAGE_MAX_DROP ?? '2'));

if (!fs.existsSync(summaryPath)) {
  console.error(`coverage summary not found: ${summaryPath}`);
  process.exit(1);
}

const baseline = readBaseline(baselinePath);
const current = readCurrentTotals(summaryPath);

const failures: string[] = [];
const metrics: Array<keyof CoverageBaseline> = ['lines', 'statements', 'functions', 'branches'];

for (const metric of metrics) {
  const baselineValue = baseline[metric] ?? 0;
  const currentValue = current[metric] ?? 0;
  const allowed = baselineValue - maxDrop;
  if (currentValue + 1e-6 < allowed) {
    failures.push(`${metric}: ${currentValue.toFixed(2)}% < ${baselineValue.toFixed(2)}% - ${maxDrop.toFixed(2)}%`);
  }
}

console.log('Coverage baseline:', baseline);
console.log('Coverage current:', current);
console.log(`Coverage max drop: ${maxDrop}%`);

if (failures.length > 0) {
  console.error('Coverage drop exceeded threshold:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Coverage check passed.');
