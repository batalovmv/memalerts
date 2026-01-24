import type { OpenApiContext } from '../context.js';

export function registerSystemPaths(ctx: OpenApiContext) {
  const {
    registry,
    schemas: { HealthResponse, HealthzResponse, ReadyzResponse, HealthCircuitsResponse, HealthWorkersResponse },
    responses: { jsonResponse, textResponse },
  } = ctx;

  registry.registerPath({
    method: 'get',
    path: '/health',
    tags: ['Health'],
    security: [],
    responses: {
      200: jsonResponse(HealthResponse, 'OK', {
        status: 'ok',
        build: { name: '@memalerts/api', version: '1.0.0', deployTrigger: null },
        instance: { port: '3001', domain: null, instance: null, instanceId: null },
      }),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/healthz',
    tags: ['Health'],
    security: [],
    responses: {
      200: jsonResponse(HealthzResponse, 'OK', {
        status: 'ok',
        service: null,
        env: 'development',
        instanceId: null,
        version: '1.0.0',
        time: new Date().toISOString(),
      }),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/readyz',
    tags: ['Health'],
    security: [],
    responses: {
      200: jsonResponse(ReadyzResponse, 'OK', {
        status: 'ok',
        service: null,
        env: 'development',
        instanceId: null,
        version: '1.0.0',
        time: new Date().toISOString(),
        checks: { database: 'ok' },
      }),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/health/circuits',
    tags: ['Health'],
    security: [],
    responses: {
      200: jsonResponse(HealthCircuitsResponse),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/health/workers',
    tags: ['Health'],
    security: [],
    responses: {
      200: jsonResponse(HealthWorkersResponse),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/metrics',
    tags: ['Metrics'],
    security: [],
    responses: {
      200: textResponse('Prometheus metrics'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/csp-report',
    tags: ['Security'],
    security: [],
    responses: {
      204: { description: 'No Content' },
    },
  });
}
