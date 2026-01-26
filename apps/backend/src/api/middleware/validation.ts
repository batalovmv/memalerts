import type { Request, Response, NextFunction } from 'express';
import { ZodError, type ZodTypeAny } from 'zod';
import type { ErrorResponse } from '@memalerts/api-contracts';

interface ValidationSchemas {
  params?: ZodTypeAny;
  query?: ZodTypeAny;
  body?: ZodTypeAny;
}

export function validateRequest<
  TParams = Request['params'],
  TQuery = Request['query'],
  TBody = Request['body']
>(schemas: ValidationSchemas) {
  return async (req: Request<TParams, any, TBody, TQuery>, res: Response, next: NextFunction) => {
    try {
      if (schemas.params) {
        req.params = schemas.params.parse(req.params) as TParams;
      }
      if (schemas.query) {
        req.query = schemas.query.parse(req.query) as TQuery;
      }
      if (schemas.body) {
        req.body = schemas.body.parse(req.body) as TBody;
      }
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const response: ErrorResponse = {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request data',
            details: {
              issues: error.issues.map((issue) => ({
                path: issue.path.join('.'),
                message: issue.message,
              })),
            },
          },
        };
        return res.status(400).json(response);
      }
      next(error as Error);
    }
  };
}
