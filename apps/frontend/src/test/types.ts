import type { RuntimeConfig } from '@/shared/config/runtimeConfig';

export type MockRuntimeConfig = RuntimeConfig;

export type MockApiError = {
  response?: {
    status?: number;
    headers?: Record<string, string>;
    data?: {
      error?: string;
      errorCode?: string;
    };
  };
  message?: string;
};

export type MockUploadProgress = {
  loaded: number;
  total?: number;
};
