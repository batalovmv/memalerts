import type { ReadableSpan, SpanProcessor, SpanExporter } from '@opentelemetry/sdk-trace-base';
import { SpanStatusCode, type Context, type Span } from '@opentelemetry/api';

type TraceBucket = {
  spans: ReadableSpan[];
  decision?: boolean;
  seenError: boolean;
  rootEnded: boolean;
  lastSeen: number;
};

type ErrorAwareSamplingOptions = {
  successSampleRate: number;
  maxTraceDurationMs: number;
  decisionTtlMs: number;
};

function parseStatusCode(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function spanHasError(span: ReadableSpan): boolean {
  if (span.status.code === SpanStatusCode.ERROR) return true;
  if (span.events.some((event) => event.name === 'exception')) return true;

  const httpStatus =
    parseStatusCode(span.attributes['http.status_code']) ??
    parseStatusCode(span.attributes['http.response.status_code']) ??
    parseStatusCode(span.attributes['rpc.grpc.status_code']);

  if (httpStatus !== null && httpStatus >= 500) return true;
  return false;
}

export class ErrorAwareSpanProcessor implements SpanProcessor {
  private readonly exporter: SpanExporter;
  private readonly successSampleRate: number;
  private readonly maxTraceDurationMs: number;
  private readonly decisionTtlMs: number;
  private readonly buckets = new Map<string, TraceBucket>();
  private shutdownRequested = false;

  constructor(exporter: SpanExporter, options: ErrorAwareSamplingOptions) {
    this.exporter = exporter;
    this.successSampleRate = options.successSampleRate;
    this.maxTraceDurationMs = options.maxTraceDurationMs;
    this.decisionTtlMs = options.decisionTtlMs;
  }

  onStart(_span: Span, _parentContext: Context): void {
    // no-op
  }

  onEnd(span: ReadableSpan): void {
    if (this.shutdownRequested) return;

    const traceId = span.spanContext().traceId;
    const now = Date.now();
    const bucket =
      this.buckets.get(traceId) ??
      ({
        spans: [],
        seenError: false,
        rootEnded: false,
        lastSeen: now,
      } satisfies TraceBucket);

    bucket.lastSeen = now;
    if (spanHasError(span)) bucket.seenError = true;

    const isRoot = !span.parentSpanContext;
    if (bucket.decision !== undefined) {
      if (bucket.decision) this.exportSpans([span]);
      this.cleanupStale(now);
      this.buckets.set(traceId, bucket);
      return;
    }

    bucket.spans.push(span);

    if (isRoot) {
      const decision = bucket.seenError ? true : Math.random() < this.successSampleRate;
      bucket.decision = decision;
      bucket.rootEnded = true;
      if (decision) this.exportSpans(bucket.spans);
      bucket.spans = [];
    }

    this.buckets.set(traceId, bucket);
    this.cleanupStale(now);
  }

  forceFlush(): Promise<void> {
    const now = Date.now();
    for (const [traceId, bucket] of this.buckets.entries()) {
      if (bucket.decision === undefined) {
        const decision = bucket.seenError ? true : Math.random() < this.successSampleRate;
        bucket.decision = decision;
        if (decision && bucket.spans.length > 0) this.exportSpans(bucket.spans);
        bucket.spans = [];
      } else if (bucket.decision && bucket.spans.length > 0) {
        this.exportSpans(bucket.spans);
        bucket.spans = [];
      }
      bucket.lastSeen = now;
      this.buckets.set(traceId, bucket);
    }
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    this.shutdownRequested = true;
    return this.forceFlush()
      .catch(() => undefined)
      .then(() => this.exporter.shutdown());
  }

  private cleanupStale(now: number): void {
    for (const [traceId, bucket] of this.buckets.entries()) {
      const age = now - bucket.lastSeen;
      if (bucket.decision === undefined) {
        if (age < this.maxTraceDurationMs) continue;
        const decision = bucket.seenError ? true : Math.random() < this.successSampleRate;
        bucket.decision = decision;
        if (decision && bucket.spans.length > 0) this.exportSpans(bucket.spans);
        bucket.spans = [];
        bucket.lastSeen = now;
        this.buckets.set(traceId, bucket);
        continue;
      }
      if (age < this.decisionTtlMs) continue;
      this.buckets.delete(traceId);
    }
  }

  private exportSpans(spans: ReadableSpan[]): void {
    if (spans.length === 0) return;
    this.exporter.export(spans, () => undefined);
  }
}
