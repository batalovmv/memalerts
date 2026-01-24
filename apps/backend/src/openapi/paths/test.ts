import type { OpenApiContext } from '../context.js';

export function registerTestPaths(ctx: OpenApiContext) {
  const { registerJsonPath, genericObjectSchema } = ctx.responses;

  registerJsonPath({
    method: 'post',
    path: '/test/login',
    tags: ['Test'],
    security: [],
    responseSchema: genericObjectSchema,
  });
}
