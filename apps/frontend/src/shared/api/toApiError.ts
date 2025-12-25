import type { ApiError } from '@/types';

export function toApiError(error: unknown, fallbackMessage: string): ApiError {
  const errObj = (error && typeof error === 'object' ? (error as Record<string, unknown>) : null) ?? null;
  const response = (errObj?.response && typeof errObj.response === 'object' ? (errObj.response as Record<string, unknown>) : null) ?? null;

  const statusCode = typeof response?.status === 'number' ? response.status : undefined;
  const data = (response?.data && typeof response.data === 'object' ? (response.data as Partial<ApiError>) : undefined) ?? undefined;

  const message =
    (typeof data?.message === 'string' && data.message) ||
    (typeof errObj?.message === 'string' && errObj.message) ||
    fallbackMessage;
  const err = typeof data?.error === 'string' ? data.error : undefined;

  return { message, error: err, statusCode };
}


