import { context, trace } from '@opentelemetry/api';

export function getActiveTraceId(): string | null {
  const span = trace.getSpan(context.active());
  const traceId = span?.spanContext().traceId;
  if (!traceId) return null;
  if (traceId === '00000000000000000000000000000000') return null;
  return traceId;
}
