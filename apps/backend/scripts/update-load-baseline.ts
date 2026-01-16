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
  updated_at: string;
  p95_ms: Record<string, number>;
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

const summaryPath = resolvePath('LOAD_TEST_SUMMARY_PATH', path.join(process.cwd(), 'tests', 'load', 'summary.json'));
const baselinePath = resolvePath('LOAD_TEST_BASELINE_PATH', path.join(process.cwd(), 'tests', 'load', 'baseline.json'));

if (!fs.existsSync(summaryPath)) {
  console.error(`k6 summary not found: ${summaryPath}`);
  process.exit(1);
}

const summary = readJson<K6Summary>(summaryPath);
const p95ByEndpoint = extractP95ByEndpoint(summary);

const baseline: LoadBaseline = {
  updated_at: new Date().toISOString(),
  p95_ms: p95ByEndpoint,
};

fs.writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + '\n', 'utf8');
console.log(`Updated load-test baseline at ${baselinePath}`);
console.log(baseline);
