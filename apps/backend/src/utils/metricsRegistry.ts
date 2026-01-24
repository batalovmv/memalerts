import { createRequire } from 'node:module';
import type * as PromClient from 'prom-client';

export type CounterLabelValues = Record<string, string>;
export type MetricType = 'counter' | 'gauge' | 'histogram';

type MetricSeries = {
  labels: CounterLabelValues;
  value: number;
  bucketCounts?: number[];
  sum?: number;
  count?: number;
};

export type MetricsRegistry = {
  contentType: string;
  metrics: () => Promise<string>;
};

export type CounterLike = {
  name: string;
  inc: (labels?: CounterLabelValues, value?: number) => void;
};

export type GaugeLike = {
  name: string;
  set: (labelsOrValue: CounterLabelValues | number, value?: number) => void;
};

export type HistogramLike = {
  name: string;
  observe: (labels: CounterLabelValues, value: number) => void;
};

const PROM_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

const require = createRequire(import.meta.url);
type PromClientModule = typeof PromClient;
let promClient: PromClientModule | null = null;
try {
  promClient = require('prom-client');
} catch {
  promClient = null;
}

class MinimalMetric {
  public readonly name: string;
  private readonly help: string;
  private readonly type: MetricType;
  private readonly labelNames: string[];
  private readonly buckets: number[];
  private readonly series: Map<string, MetricSeries>;

  constructor(opts: { name: string; help: string; type: MetricType; labelNames?: string[]; buckets?: number[] }) {
    this.name = opts.name;
    this.help = opts.help;
    this.type = opts.type;
    this.labelNames = opts.labelNames || [];
    this.buckets = (opts.buckets || []).slice().sort((a, b) => a - b);
    this.series = new Map();
  }

  inc(labels: CounterLabelValues = {}, value = 1) {
    const key = JSON.stringify(labels);
    const entry = this.series.get(key) || { labels, value: 0 };
    entry.value += Math.max(0, value);
    this.series.set(key, entry);
  }

  set(labelsOrValue: CounterLabelValues | number, value?: number) {
    let labels: CounterLabelValues = {};
    let v = 0;
    if (typeof labelsOrValue === 'number') {
      v = labelsOrValue;
    } else {
      labels = labelsOrValue;
      v = Number.isFinite(value) ? (value as number) : 0;
    }
    const key = JSON.stringify(labels);
    this.series.set(key, { labels, value: v });
  }

  observe(labels: CounterLabelValues, value: number) {
    const key = JSON.stringify(labels);
    const entry = this.series.get(key) || {
      labels,
      value: 0,
      bucketCounts: Array(this.buckets.length).fill(0),
      sum: 0,
      count: 0,
    };
    const v = Math.max(0, value);
    entry.sum = (entry.sum || 0) + v;
    entry.count = (entry.count || 0) + 1;
    entry.bucketCounts = entry.bucketCounts || Array(this.buckets.length).fill(0);
    for (let i = 0; i < this.buckets.length; i += 1) {
      if (v <= this.buckets[i]!) entry.bucketCounts[i]! += 1;
    }
    this.series.set(key, entry);
  }

  render(): string {
    const lines: string[] = [];
    lines.push(`# HELP ${this.name} ${this.help}`);
    lines.push(`# TYPE ${this.name} ${this.type}`);

    for (const entry of this.series.values()) {
      if (this.type === 'histogram') {
        const buckets = this.buckets.length ? this.buckets : [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
        const counts = entry.bucketCounts || [];
        let cumulative = 0;
        for (let i = 0; i < buckets.length; i += 1) {
          cumulative += counts[i] || 0;
          const labels = { ...entry.labels, le: String(buckets[i]!) };
          lines.push(`${this.name}_bucket${renderLabels(labels)} ${cumulative}`);
        }
        const totalCount = entry.count || 0;
        lines.push(`${this.name}_bucket${renderLabels({ ...entry.labels, le: '+Inf' })} ${totalCount}`);
        lines.push(`${this.name}_sum${renderLabels(entry.labels)} ${entry.sum || 0}`);
        lines.push(`${this.name}_count${renderLabels(entry.labels)} ${totalCount}`);
      } else {
        lines.push(`${this.name}${renderLabels(entry.labels)} ${entry.value}`);
      }
    }

    return lines.join('\n');
  }

  getLabelNames(): string[] {
    return this.labelNames.slice();
  }
}

class MinimalRegistry {
  private readonly metricsList: MinimalMetric[] = [];
  public readonly contentType = PROM_CONTENT_TYPE;

  register(metric: MinimalMetric) {
    this.metricsList.push(metric);
  }

  async metrics(): Promise<string> {
    return this.metricsList.map((m) => m.render()).join('\n') + '\n';
  }
}

function renderLabels(labels: CounterLabelValues): string {
  const keys = Object.keys(labels || {});
  if (!keys.length) return '';
  const pairs = keys.sort().map(
    (k) =>
      `${k}="${String(labels[k] ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')}"`
  );
  return `{${pairs.join(',')}}`;
}

export function createRegistry(): {
  registry: MetricsRegistry;
  counter: (opts: { name: string; help: string; labelNames?: string[] }) => CounterLike;
  gauge: (opts: { name: string; help: string; labelNames?: string[] }) => GaugeLike;
  histogram: (opts: { name: string; help: string; labelNames?: string[]; buckets?: number[] }) => HistogramLike;
} {
  if (promClient) {
    const registry = new promClient.Registry();
    const wrapCounter = (metric: PromClient.Counter<string>, name: string): CounterLike => ({
      name,
      inc: (labels?: CounterLabelValues, value?: number) => {
        if (labels) {
          metric.inc(labels, value);
          return;
        }
        if (value !== undefined) {
          metric.inc(value);
        } else {
          metric.inc();
        }
      },
    });
    const wrapGauge = (metric: PromClient.Gauge<string>, name: string): GaugeLike => ({
      name,
      set: (labelsOrValue: CounterLabelValues | number, value?: number) => {
        if (typeof labelsOrValue === 'number') {
          metric.set(labelsOrValue);
        } else {
          metric.set(labelsOrValue, value ?? 0);
        }
      },
    });
    const wrapHistogram = (metric: PromClient.Histogram<string>, name: string): HistogramLike => ({
      name,
      observe: (labels: CounterLabelValues, value: number) => {
        metric.observe(labels, value);
      },
    });
    return {
      registry,
      counter: (opts) => wrapCounter(new promClient.Counter({ ...opts, registers: [registry] }), opts.name),
      gauge: (opts) => wrapGauge(new promClient.Gauge({ ...opts, registers: [registry] }), opts.name),
      histogram: (opts) => wrapHistogram(new promClient.Histogram({ ...opts, registers: [registry] }), opts.name),
    };
  }

  const registry = new MinimalRegistry();
  return {
    registry,
    counter: (opts) => {
      const metric = new MinimalMetric({
        name: opts.name,
        help: opts.help,
        type: 'counter',
        labelNames: opts.labelNames,
      });
      registry.register(metric);
      return metric;
    },
    gauge: (opts) => {
      const metric = new MinimalMetric({
        name: opts.name,
        help: opts.help,
        type: 'gauge',
        labelNames: opts.labelNames,
      });
      registry.register(metric);
      return metric;
    },
    histogram: (opts) => {
      const metric = new MinimalMetric({
        name: opts.name,
        help: opts.help,
        type: 'histogram',
        labelNames: opts.labelNames,
        buckets: opts.buckets,
      });
      registry.register(metric);
      return metric;
    },
  };
}
