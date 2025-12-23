import type { ApiError } from '@/types';

export function toApiError(error: unknown, fallbackMessage: string): ApiError {
  const anyErr = error as any;
  const statusCode = anyErr?.response?.status as number | undefined;
  const data = anyErr?.response?.data as Partial<ApiError> | undefined;
  const message =
    (typeof data?.message === 'string' && data.message) ||
    (typeof anyErr?.message === 'string' && anyErr.message) ||
    fallbackMessage;
  const err = typeof data?.error === 'string' ? data.error : undefined;

  return { message, error: err, statusCode };
}


