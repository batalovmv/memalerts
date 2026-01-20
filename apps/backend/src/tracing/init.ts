import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { ErrorAwareSpanProcessor } from './sampling.js';

function parseBool(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return undefined;
}

function clampRate(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(String(value ?? ''));
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed <= 0) return 0;
  if (parsed >= 1) return 1;
  return parsed;
}

function parseIntEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const diagEnabled = parseBool(process.env.OTEL_DIAG_LOGS);
if (diagEnabled) {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);
}

const enabledEnv = parseBool(process.env.OTEL_ENABLED);
const hasExporterConfig = Boolean(
  process.env.OTEL_EXPORTER_JAEGER_ENDPOINT ||
  process.env.JAEGER_ENDPOINT ||
  process.env.OTEL_EXPORTER_JAEGER_AGENT_HOST ||
  process.env.JAEGER_AGENT_HOST
);
const otelEnabled = enabledEnv ?? hasExporterConfig;

if (!otelEnabled) {
  // Skip tracing when not configured.
} else {
  if (!process.env.OTEL_SERVICE_NAME) {
    const instance = String(process.env.INSTANCE || '').trim();
    const service = instance ? `memalerts-api-${instance}` : 'memalerts-api';
    process.env.OTEL_SERVICE_NAME = service;
  }

  const instanceId = String(process.env.INSTANCE_ID || process.env.HOSTNAME || '').trim();
  if (instanceId) {
    const existing = String(process.env.OTEL_RESOURCE_ATTRIBUTES || '').trim();
    const addition = `service.instance.id=${instanceId}`;
    process.env.OTEL_RESOURCE_ATTRIBUTES = existing ? `${existing},${addition}` : addition;
  }

  const jaegerEndpoint =
    process.env.OTEL_EXPORTER_JAEGER_ENDPOINT ||
    process.env.JAEGER_ENDPOINT ||
    (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:14268/api/traces');

  const jaegerHost = process.env.OTEL_EXPORTER_JAEGER_AGENT_HOST || process.env.JAEGER_AGENT_HOST;
  const jaegerPortRaw = process.env.OTEL_EXPORTER_JAEGER_AGENT_PORT || process.env.JAEGER_AGENT_PORT;
  const jaegerPort = jaegerPortRaw ? Number.parseInt(jaegerPortRaw, 10) : undefined;

  if (!jaegerEndpoint && !jaegerHost) {
    console.warn('[otel] tracing enabled but no Jaeger endpoint/agent configured');
  } else {
    const exporter = new JaegerExporter({
      endpoint: jaegerEndpoint || undefined,
      host: jaegerHost || undefined,
      port: Number.isFinite(jaegerPort ?? NaN) ? jaegerPort : undefined,
    });

    const successSampleRate = clampRate(process.env.OTEL_SUCCESS_SAMPLE_RATE, 0.1);
    // Reduced defaults: 30s max trace, 30s TTL (was 5 min each - caused memory issues)
    const maxTraceDurationMs = parseIntEnv(process.env.OTEL_TRACE_MAX_MS, 30_000);
    const decisionTtlMs = parseIntEnv(process.env.OTEL_TRACE_DECISION_TTL_MS, 30_000);

    const sdk = new NodeSDK({
      spanProcessor: new ErrorAwareSpanProcessor(exporter, {
        successSampleRate,
        maxTraceDurationMs,
        decisionTtlMs,
      }),
      instrumentations: [
        getNodeAutoInstrumentations({
          // === HTTP: Only trace actual API requests ===
          '@opentelemetry/instrumentation-http': {
            ignoreIncomingRequestHook: (req) => {
              const url = String(req.url || '');
              // Ignore health checks, metrics, and socket.io polling
              return (
                url.startsWith('/health') ||
                url.startsWith('/readyz') ||
                url.startsWith('/metrics') ||
                url.startsWith('/socket.io')
              );
            },
            ignoreOutgoingRequestHook: () => true, // Ignore ALL outgoing HTTP (reduces span count significantly)
          },
          '@opentelemetry/instrumentation-express': { enabled: true },
          // === DISABLE EVERYTHING ELSE ===
          '@opentelemetry/instrumentation-undici': { enabled: false },
          '@opentelemetry/instrumentation-fs': { enabled: false },
          '@opentelemetry/instrumentation-dns': { enabled: false },
          '@opentelemetry/instrumentation-net': { enabled: false },
          '@opentelemetry/instrumentation-generic-pool': { enabled: false },
          '@opentelemetry/instrumentation-connect': { enabled: false },
          '@opentelemetry/instrumentation-bunyan': { enabled: false },
          '@opentelemetry/instrumentation-pino': { enabled: false },
          '@opentelemetry/instrumentation-winston': { enabled: false },
          '@opentelemetry/instrumentation-socket.io': { enabled: false },
          '@opentelemetry/instrumentation-redis': { enabled: false },
          '@opentelemetry/instrumentation-ioredis': { enabled: false },
          '@opentelemetry/instrumentation-pg': { enabled: false },
          '@opentelemetry/instrumentation-mysql': { enabled: false },
          '@opentelemetry/instrumentation-mysql2': { enabled: false },
          '@opentelemetry/instrumentation-mongodb': { enabled: false },
          '@opentelemetry/instrumentation-grpc': { enabled: false },
          '@opentelemetry/instrumentation-aws-sdk': { enabled: false },
          '@opentelemetry/instrumentation-knex': { enabled: false },
          '@opentelemetry/instrumentation-koa': { enabled: false },
          '@opentelemetry/instrumentation-hapi': { enabled: false },
          '@opentelemetry/instrumentation-fastify': { enabled: false },
          '@opentelemetry/instrumentation-restify': { enabled: false },
          '@opentelemetry/instrumentation-nestjs-core': { enabled: false },
          '@opentelemetry/instrumentation-graphql': { enabled: false },
          '@opentelemetry/instrumentation-amqplib': { enabled: false },
          '@opentelemetry/instrumentation-aws-lambda': { enabled: false },
          '@opentelemetry/instrumentation-cassandra-driver': { enabled: false },
          '@opentelemetry/instrumentation-cucumber': { enabled: false },
          '@opentelemetry/instrumentation-dataloader': { enabled: false },
          '@opentelemetry/instrumentation-lru-memoizer': { enabled: false },
          '@opentelemetry/instrumentation-memcached': { enabled: false },
          '@opentelemetry/instrumentation-mongoose': { enabled: false },
          '@opentelemetry/instrumentation-tedious': { enabled: false },
          '@opentelemetry/instrumentation-router': { enabled: false },
        }),
      ],
    });

    const startResult = sdk.start();
    void Promise.resolve(startResult).catch((error: unknown) => {
      console.error('[otel] failed to start tracing', error);
    });

    const shutdown = () => {
      const shutdownResult = sdk.shutdown();
      void Promise.resolve(shutdownResult).catch(() => undefined);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  }
}
