import { z } from 'zod';
import type { AnyZodObject, ZodTypeAny } from 'zod';
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

export type RequestSpec = {
  params?: AnyZodObject;
  query?: AnyZodObject;
  body?: {
    content: Record<string, { schema: ZodTypeAny; example?: unknown }>;
  };
};

export type RegisterJsonPathParams = {
  method: 'get' | 'post' | 'patch' | 'put' | 'delete';
  path: string;
  tags: string[];
  description?: string;
  security?: Array<Record<string, string[]>>;
  request?: RequestSpec;
  responseSchema?: ZodTypeAny;
  responseDescription?: string;
  responseExample?: unknown;
};

export type ResponseHelpers = {
  jsonResponse: (schema: ZodTypeAny, description?: string, example?: unknown) => {
    description: string;
    content: {
      'application/json': {
        schema: ZodTypeAny;
        example?: unknown;
      };
    };
  };
  textResponse: (description: string) => {
    description: string;
    content: {
      'text/plain': {
        schema: ZodTypeAny;
      };
    };
  };
  htmlResponse: (description: string) => {
    description: string;
    content: {
      'text/html': {
        schema: ZodTypeAny;
      };
    };
  };
  registerJsonPath: (params: RegisterJsonPathParams) => void;
  genericObjectSchema: ZodTypeAny;
  genericArraySchema: ZodTypeAny;
};

export function createResponseHelpers(params: {
  registry: OpenAPIRegistry;
  errorResponse: ZodTypeAny;
}): ResponseHelpers {
  const { registry, errorResponse } = params;
  const genericObjectSchema = z.record(z.unknown());
  const genericArraySchema = z.array(genericObjectSchema);

  const jsonResponse = (schema: ZodTypeAny, description = 'OK', example?: unknown) => ({
    description,
    content: {
      'application/json': {
        schema,
        ...(example !== undefined ? { example } : {}),
      },
    },
  });

  const textResponse = (description: string) => ({
    description,
    content: {
      'text/plain': {
        schema: z.string(),
      },
    },
  });

  const htmlResponse = (description: string) => ({
    description,
    content: {
      'text/html': {
        schema: z.string(),
      },
    },
  });

  function buildErrorResponses(params: { security?: Array<Record<string, string[]>>; hasParams: boolean }) {
    const isSecured = params.security === undefined ? true : params.security.length > 0;
    const responses: Record<string, ReturnType<typeof jsonResponse>> = {
      400: jsonResponse(errorResponse, 'Bad Request'),
      429: jsonResponse(errorResponse, 'Too Many Requests'),
      500: jsonResponse(errorResponse, 'Internal Server Error'),
    };

    if (isSecured) {
      responses[401] = jsonResponse(errorResponse, 'Unauthorized');
      responses[403] = jsonResponse(errorResponse, 'Forbidden');
    }

    if (params.hasParams) {
      responses[404] = jsonResponse(errorResponse, 'Not Found');
    }

    return responses;
  }

  function registerJsonPath(params: RegisterJsonPathParams) {
    const {
      method,
      path,
      tags,
      description,
      security,
      request,
      responseSchema = genericObjectSchema,
      responseDescription = 'OK',
      responseExample,
    } = params;

    const hasParams = Boolean(request?.params);
    registry.registerPath({
      method,
      path,
      tags,
      description,
      ...(security ? { security } : {}),
      ...(request ? { request } : {}),
      responses: {
        200: jsonResponse(responseSchema, responseDescription, responseExample),
        ...buildErrorResponses({ security, hasParams }),
      },
    });
  }

  return {
    jsonResponse,
    textResponse,
    htmlResponse,
    registerJsonPath,
    genericObjectSchema,
    genericArraySchema,
  };
}
