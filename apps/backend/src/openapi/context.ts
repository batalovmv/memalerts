import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import type { OpenApiParameters } from './components/parameters.js';
import type { ResponseHelpers } from './components/responses.js';
import type { OpenApiSchemas } from './schemas/index.js';

export type OpenApiContext = {
  registry: OpenAPIRegistry;
  authSecurity: Array<Record<string, string[]>>;
  schemas: OpenApiSchemas;
  params: OpenApiParameters;
  responses: ResponseHelpers;
};
