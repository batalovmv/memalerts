export interface ApiError {
  message: string;
  error?: string;
  errorCode?: string;
  details?: unknown;
  statusCode?: number;
  requestId?: string;
  traceId?: string;
}

export interface ApiErrorResponse {
  errorCode: string;
  error: string;
  message: string;
  requestId?: string;
  traceId?: string;
  details?: unknown;
}
