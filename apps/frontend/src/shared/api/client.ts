import { ErrorResponse, ErrorResponseSchema } from '@memalerts/api-contracts';
import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios';
import { z } from 'zod';

import { getRuntimeConfig } from '@/shared/config/runtimeConfig';

function normalizeApiBaseUrl(raw: string | null | undefined): string {
  const fallback = '/api/v1';
  if (raw === undefined || raw === null) return fallback;

  const trimmed = raw.trim();
  if (!trimmed) return fallback;

  const normalized = trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
  if (normalized.endsWith('/api/v1')) return normalized;
  if (normalized.endsWith('/api')) return `${normalized}/v1`;
  if (normalized.endsWith('/v1')) return normalized;
  return `${normalized}/api/v1`;
}

function getApiBaseUrl(): string {
  const runtimeUrl = getRuntimeConfig()?.apiBaseUrl;
  const envUrl = runtimeUrl ?? import.meta.env.VITE_API_URL;
  return normalizeApiBaseUrl(envUrl);
}

class ApiClient {
  private instance: AxiosInstance;

  constructor() {
    this.instance = axios.create({
      baseURL: getApiBaseUrl(),
      withCredentials: true,
    });

    this.instance.interceptors.response.use(
      response => response,
      this.handleError,
    );
  }

  private syncBaseUrl() {
    const next = getApiBaseUrl();
    if (this.instance.defaults.baseURL !== next) {
      this.instance.defaults.baseURL = next;
    }
  }

  private handleError = (error: AxiosError) => {
    if (error.response?.data) {
      const parsed = ErrorResponseSchema.safeParse(error.response.data);
      if (parsed.success) {
        throw new ApiError(parsed.data.error);
      }
    }

    throw new ApiError({
      code: 'INTERNAL_ERROR',
      message: error.message,
    });
  };

  async get<T>(
    url: string,
    schema: z.ZodSchema<T>,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    this.syncBaseUrl();
    const response = await this.instance.get(url, config);
    return schema.parse(response.data);
  }

  async post<T>(
    url: string,
    data: unknown,
    schema: z.ZodSchema<T>,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    this.syncBaseUrl();
    const response = await this.instance.post(url, data, config);
    return schema.parse(response.data);
  }
}

export class ApiError extends Error {
  code: string;
  details?: unknown;
  field?: string;

  constructor(error: ErrorResponse['error']) {
    super(error.message);
    this.name = 'ApiError';
    this.code = error.code;
    this.details = error.details;
    this.field = error.field;
  }
}

export const apiClient = new ApiClient();
