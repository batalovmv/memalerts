import fs from 'node:fs';
import path from 'node:path';

type K6Submetric = {
  tags?: Record<string, string>;
  values?: Record<string, number>;
};

type K6Metric = {
  values?: Record<string, number>;
  submetrics?: K6Submetric[];
};

type K6Summary = {
  metrics?: Record<string, K6Metric>;
};

type LoadBaseline = {
  updated_at?: string;
  p95_ms?: Record<string, number>;
};

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function resolvePath(envKey: string, fallback: string): string {
  const raw = String(process.env[envKey] || '').trim();
  return raw.length > 0 ? raw : fallback;
}

function extractP95ByEndpoint(summary: K6Summary): Record<string, number> {
  const metrics = summary.metrics || {};
  const result: Record<string, number> = {};
  const durationMetric = metrics.http_req_duration;

  if (durationMetric?.submetrics) {
    for (const submetric of durationMetric.submetrics) {
      const endpoint = submetric.tags?.endpoint;
      const p95 = submetric.values?.['p(95)'];
      if (endpoint && Number.isFinite(p95)) {
        result[endpoint] = p95 as number;
      }
    }
  }

  for (const [name, metric] of Object.entries(metrics)) {
    if (!name.startsWith('http_req_duration{')) continue;
    const match = name.match(/endpoint:([^,}]+)/);
    if (!match) continue;
    const endpoint = match[1];
    const p95 = metric.values?.['p(95)'];
    if (endpoint && Number.isFinite(p95) && !(endpoint in result)) {
      result[endpoint] = p95 as number;
    }
  }

  return result;
}

const baselinePath = resolvePath(
  'LOAD_TEST_BASELINE_PATH',
  path.join(process.cwd(), 'tests', 'load', 'baseline.json')
);
const summaryPath = resolvePath(
  'LOAD_TEST_SUMMARY_PATH',
  path.join(process.cwd(), 'tests', 'load', 'summary.json')
);
const maxRegression = Number.parseFloat(String(process.env.LOAD_TEST_MAX_REGRESSION ?? '20'));

if (!fs.existsSync(summaryPath)) {
  console.error(`k6 summary not found: ${summaryPath}`);
  process.exit(1);
}

if (!fs.existsSync(baselinePath)) {
  console.error(`load-test baseline not found: ${baselinePath}`);
  process.exit(1);
}

const baseline = readJson<LoadBaseline>(baselinePath);
const baselineP95 = baseline.p95_ms || {};
const current = extractP95ByEndpoint(readJson<K6Summary>(summaryPath));

const failures: string[] = [];
const allowedFactor = 1 + maxRegression / 100;

for (const [endpoint, baselineValue] of Object.entries(baselineP95)) {
  if (!Number.isFinite(baselineValue)) {
    failures.push(`${endpoint}: baseline missing or invalid`);
    continue;
  }
  const currentValue = current[endpoint];
  if (!Number.isFinite(currentValue)) {
    failures.push(`${endpoint}: current p95 missing`);
    continue;
  }
  const allowed = (baselineValue as number) * allowedFactor;
  if ((currentValue as number) > allowed) {
    failures.push(
      `${endpoint}: ${currentValue.toFixed(2)}ms > ${allowed.toFixed(2)}ms (baseline ${baselineValue}ms)`
    );
  }
}

console.log('Load-test baseline:', baselineP95);
console.log('Load-test current:', current);
console.log(`Max regression: ${maxRegression}%`);

if (failures.length > 0) {
  console.error('Load-test regression exceeded threshold:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Load-test regression check passed.');
