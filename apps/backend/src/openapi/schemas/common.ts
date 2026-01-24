import { z, type ZodTypeAny } from 'zod';
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { ERROR_CODES } from '../../shared/errors.js';

export type CommonSchemas = {
  ErrorResponse: ZodTypeAny;
  OkResponse: ZodTypeAny;
  HealthResponse: ZodTypeAny;
  HealthzResponse: ZodTypeAny;
  ReadyzResponse: ZodTypeAny;
  HealthCircuitsResponse: ZodTypeAny;
  HealthWorkersResponse: ZodTypeAny;
};

export function registerCommonSchemas(registry: OpenAPIRegistry): CommonSchemas {
  const errorCodeEnum = z.enum(Object.values(ERROR_CODES) as [string, ...string[]]);

  const ErrorResponse = registry.register(
    'ErrorResponse',
    z.object({
      errorCode: errorCodeEnum,
      error: z.string(),
      requestId: z.string().optional(),
      traceId: z.string().nullable().optional(),
      details: z.unknown().optional(),
      hint: z.string().optional(),
    })
  );

  const OkResponse = registry.register('OkResponse', z.object({ ok: z.boolean() }));

  const HealthResponse = registry.register(
    'HealthResponse',
    z.object({
      status: z.string(),
      build: z.object({
        name: z.string().nullable(),
        version: z.string().nullable(),
        deployTrigger: z.string().nullable(),
      }),
      instance: z.object({
        port: z.string().nullable(),
        domain: z.string().nullable(),
        instance: z.string().nullable(),
        instanceId: z.string().nullable(),
      }),
    })
  );

  const HealthzResponse = registry.register(
    'HealthzResponse',
    z.object({
      status: z.string(),
      service: z.string().nullable().optional(),
      env: z.string().nullable().optional(),
      instanceId: z.string().nullable().optional(),
      version: z.string().nullable().optional(),
      time: z.string(),
    })
  );

  const ReadyzResponse = registry.register(
    'ReadyzResponse',
    z.object({
      status: z.string(),
      service: z.string().nullable().optional(),
      env: z.string().nullable().optional(),
      instanceId: z.string().nullable().optional(),
      version: z.string().nullable().optional(),
      time: z.string(),
      checks: z.object({
        database: z.string(),
      }),
    })
  );

  const HealthCircuitsResponse = registry.register(
    'HealthCircuitsResponse',
    z.object({
      status: z.string(),
      circuits: z.array(z.record(z.unknown())),
    })
  );

  const HealthWorkersResponse = registry.register(
    'HealthWorkersResponse',
    z.object({
      workers: z.array(z.record(z.unknown())),
      queues: z.record(z.unknown()),
    })
  );

  return {
    ErrorResponse,
    OkResponse,
    HealthResponse,
    HealthzResponse,
    ReadyzResponse,
    HealthCircuitsResponse,
    HealthWorkersResponse,
  };
}
