import { z } from 'zod';
import { OpenAPIRegistry, OpenApiGeneratorV3, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { createOpenApiParameters, createResponseHelpers } from './components/index.js';
import { registerPaths } from './paths/index.js';
import { registerSchemas } from './schemas/index.js';

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();
const authSecurity: Array<Record<string, string[]>> = [{ cookieAuth: [] }, { bearerAuth: [] }];

registry.registerComponent('securitySchemes', 'cookieAuth', {
  type: 'apiKey',
  in: 'cookie',
  name: 'token',
  description: 'Session cookie (prod). Beta uses token_beta. For automation, use Authorization: Bearer <token>.',
});
registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
});

const schemas = registerSchemas(registry);
const params = createOpenApiParameters();
const responses = createResponseHelpers({ registry, errorResponse: schemas.ErrorResponse });

registerPaths({
  registry,
  authSecurity,
  schemas,
  params,
  responses,
});

let cachedDocument: ReturnType<OpenApiGeneratorV3['generateDocument']> | null = null;

export function getOpenApiDocument() {
  if (cachedDocument) return cachedDocument;

  const generator = new OpenApiGeneratorV3(registry.definitions);
  cachedDocument = generator.generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'MemAlerts API',
      version: '1.0.0',
      description:
        'API docs generated from code. Auth uses httpOnly cookies (token for prod, token_beta for beta). ' +
        'Bearer tokens are supported for scripts/testing. Prefer /api/v1 for new integrations.',
    },
    servers: [
      { url: '/api/v1', description: 'v1 (recommended)' },
      { url: '/v1', description: 'v1 (legacy alias)' },
      { url: '/', description: 'Legacy (unversioned)' },
    ],
    security: authSecurity,
  });

  return cachedDocument;
}

export const { ErrorResponse } = schemas;
