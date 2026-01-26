import { getErrorMessage } from './errorMessages';

import type { ApiError } from '@memalerts/api-contracts';
import { ErrorCodeSchema } from '@memalerts/api-contracts';

function getStringField(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  return typeof value === 'string' ? value : undefined;
}

export function toApiError(error: unknown, fallbackMessage: string): ApiError {
  const errObj = (error && typeof error === 'object' ? (error as Record<string, unknown>) : null) ?? null;
  const response = (errObj?.response && typeof errObj.response === 'object' ? (errObj.response as Record<string, unknown>) : null) ?? null;
  const dataObj = (response?.data && typeof response.data === 'object' ? (response.data as Record<string, unknown>) : null) ?? null;

  const statusCode = typeof response?.status === 'number' ? response.status : undefined;

  let code: string | undefined;
  let message: string | undefined;
  let details: unknown;
  let requestId: string | undefined;
  let traceId: string | undefined;
  let hint: string | undefined;

  if (dataObj && dataObj.success === false && dataObj.error && typeof dataObj.error === 'object') {
    const errorObj = dataObj.error as Record<string, unknown>;
    code = getStringField(errorObj, 'code');
    message = getStringField(errorObj, 'message');
    details = errorObj.details;
    requestId = getStringField(errorObj, 'requestId');
    traceId = getStringField(errorObj, 'traceId');
    hint = getStringField(errorObj, 'hint');
  } else if (dataObj) {
    code = getStringField(dataObj, 'errorCode');
    message = getStringField(dataObj, 'message') || getStringField(dataObj, 'error');
    details = dataObj.details;
    requestId = getStringField(dataObj, 'requestId');
    traceId = getStringField(dataObj, 'traceId');
    hint = getStringField(dataObj, 'hint');
  }

  const parsedCode = ErrorCodeSchema.safeParse(code);
  const resolvedCode = parsedCode.success ? parsedCode.data : 'INTERNAL_ERROR';

  const mappedMessage = getErrorMessage(parsedCode.success ? parsedCode.data : undefined);
  const resolvedMessage =
    (typeof message === 'string' && message) ||
    (typeof errObj?.message === 'string' && errObj.message) ||
    mappedMessage ||
    fallbackMessage;

  return {
    code: resolvedCode,
    message: resolvedMessage,
    details,
    statusCode,
    requestId,
    traceId,
    hint,
  };
}

