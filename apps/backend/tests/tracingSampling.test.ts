import { describe, expect, it, vi } from 'vitest';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import { SpanStatusCode } from '@opentelemetry/api';

import { ErrorAwareSpanProcessor } from '../src/tracing/sampling.js';

type SpanParams = {
  traceId: string;
  statusCode?: SpanStatusCode;
  events?: Array<{ name: string }>;
  attributes?: Record<string, unknown>;
  parentSpanContext?: { traceId: string } | null;
};

function makeSpan(params: SpanParams): ReadableSpan {
  return {
    spanContext: () => ({ traceId: params.traceId }),
    status: { code: params.statusCode ?? SpanStatusCode.OK },
    events: params.events ?? [],
    attributes: params.attributes ?? {},
    parentSpanContext: params.parentSpanContext ?? null,
  } as unknown as ReadableSpan;
}

function makeExporter() {
  return {
    export: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  } satisfies SpanExporter;
}

describe('ErrorAwareSpanProcessor', () => {
  it('exports error traces even when success sample rate is zero', () => {
    const exporter = makeExporter();
    const processor = new ErrorAwareSpanProcessor(exporter, {
      successSampleRate: 0,
      maxTraceDurationMs: 1000,
      decisionTtlMs: 1000,
    });

    const span = makeSpan({
      traceId: 't1',
      attributes: { 'http.status_code': '500' },
    });

    processor.onEnd(span);

    expect(exporter.export).toHaveBeenCalledTimes(1);
    expect(exporter.export.mock.calls[0]?.[0]).toEqual([span]);
  });

  it('buffers spans until root ends and samples success traces', () => {
    const exporter = makeExporter();
    const processor = new ErrorAwareSpanProcessor(exporter, {
      successSampleRate: 1,
      maxTraceDurationMs: 1000,
      decisionTtlMs: 1000,
    });

    const child = makeSpan({ traceId: 't2', parentSpanContext: { traceId: 't2' } });
    const root = makeSpan({ traceId: 't2', parentSpanContext: null });

    processor.onEnd(child);
    expect(exporter.export).not.toHaveBeenCalled();

    processor.onEnd(root);
    expect(exporter.export).toHaveBeenCalledTimes(1);
    expect(exporter.export.mock.calls[0]?.[0]).toEqual([child, root]);
  });

  it('flushes pending spans when forceFlush is called', async () => {
    const exporter = makeExporter();
    const processor = new ErrorAwareSpanProcessor(exporter, {
      successSampleRate: 1,
      maxTraceDurationMs: 1000,
      decisionTtlMs: 1000,
    });

    const child = makeSpan({ traceId: 't3', parentSpanContext: { traceId: 't3' } });
    processor.onEnd(child);

    await processor.forceFlush();

    expect(exporter.export).toHaveBeenCalledTimes(1);
    expect(exporter.export.mock.calls[0]?.[0]).toEqual([child]);
  });

  it('shutdown flushes and calls exporter shutdown', async () => {
    const exporter = makeExporter();
    const processor = new ErrorAwareSpanProcessor(exporter, {
      successSampleRate: 1,
      maxTraceDurationMs: 1000,
      decisionTtlMs: 1000,
    });

    const root = makeSpan({ traceId: 't4' });
    processor.onEnd(root);

    await processor.shutdown();

    expect(exporter.shutdown).toHaveBeenCalled();
  });
});
