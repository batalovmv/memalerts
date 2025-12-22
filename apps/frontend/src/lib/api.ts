import axios, { AxiosError, AxiosResponse, AxiosInstance, AxiosRequestConfig } from 'axios';

export function getRequestIdFromError(error: unknown): string | null {
  const maybeAxios = error as AxiosError | null;
  const headerReqId =
    (maybeAxios?.response?.headers as any)?.['x-request-id'] ||
    (maybeAxios?.response?.headers as any)?.['x-requestid'] ||
    (maybeAxios?.response?.headers as any)?.['x-correlation-id'];

  if (typeof headerReqId === 'string' && headerReqId.trim()) return headerReqId.trim();

  const dataReqId = (maybeAxios?.response?.data as any)?.requestId;
  if (typeof dataReqId === 'string' && dataReqId.trim()) return dataReqId.trim();

  const anyErr = error as any;
  const attached = anyErr?.requestId;
  if (typeof attached === 'string' && attached.trim()) return attached.trim();

  return null;
}

function emitGlobalApiError(error: AxiosError) {
  // Don't spam global UI for auth churn or intentional cancellations.
  const status = error.response?.status ?? null;
  if (status === 401) return;

  const requestId = getRequestIdFromError(error);
  const path = (error.config?.url as string | undefined) || null;
  const method = (error.config?.method as string | undefined)?.toUpperCase?.() || null;
  const message =
    (error.response?.data as any)?.error ||
    (error.response?.data as any)?.message ||
    error.message ||
    'Request failed';

  window.dispatchEvent(
    new CustomEvent('memalerts:globalError', {
      detail: {
        kind: 'api',
        message,
        requestId,
        status,
        path,
        method,
        ts: new Date().toISOString(),
      },
    })
  );
}

// Custom API interface that returns data directly instead of AxiosResponse
interface CustomAxiosInstance {
  request: <T = unknown>(config: AxiosRequestConfig) => Promise<T>;
  get: <T = unknown>(url: string, config?: AxiosRequestConfig) => Promise<T>;
  delete: <T = unknown>(url: string, config?: AxiosRequestConfig) => Promise<T>;
  head: <T = unknown>(url: string, config?: AxiosRequestConfig) => Promise<T>;
  options: <T = unknown>(url: string, config?: AxiosRequestConfig) => Promise<T>;
  post: <T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig) => Promise<T>;
  put: <T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig) => Promise<T>;
  patch: <T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig) => Promise<T>;
  getUri: (config?: AxiosRequestConfig) => string;
  defaults: AxiosInstance['defaults'];
  interceptors: AxiosInstance['interceptors'];
}

// Request deduplication: track in-flight requests to prevent duplicate calls
interface PendingRequest<T = unknown> {
  promise: Promise<T>;
  timestamp: number;
}

const pendingRequests = new Map<string, PendingRequest<unknown>>();
const REQUEST_DEDUP_TTL = 5000; // 5 seconds - requests with same key within this time share the same promise

// Generate a unique key for a request
function getRequestKey(config: AxiosRequestConfig): string {
  const method = config.method?.toUpperCase() || 'GET';
  const url = config.url || '';
  const params = config.params ? JSON.stringify(config.params) : '';
  const data = config.data ? JSON.stringify(config.data) : '';
  return `${method}:${url}:${params}:${data}`;
}

// Clean up old pending requests
function cleanupPendingRequests(): void {
  const now = Date.now();
  for (const [key, request] of pendingRequests.entries()) {
    if (now - request.timestamp > REQUEST_DEDUP_TTL) {
      pendingRequests.delete(key);
    }
  }
}

// NOTE: We intentionally avoid a global setInterval here.
// Cleanup is done opportunistically per request to avoid unnecessary timers when the app is idle.

// Use relative URL in production (same domain), absolute in development
const getApiUrl = () => {
  const envUrl = import.meta.env.VITE_API_URL;
  
  // If VITE_API_URL is explicitly set (even if empty string), use it
  // Empty string means use relative URLs (same origin)
  if (envUrl !== undefined) {
    if (envUrl === '') {
      // Empty string means use relative URLs - return empty string for axios baseURL
      return '';
    }
    return envUrl;
  }
  
  // If VITE_API_URL is not set at all, determine based on environment
  // In production, use same origin (relative URL)
  // This ensures beta frontend uses beta API, production uses production API
  if (import.meta.env.PROD) {
    const relativeUrl = '';
    return relativeUrl;
  }
  
  // In development, use localhost
  const devUrl = 'http://localhost:3001';
  return devUrl;
};

const apiBaseUrl = getApiUrl();

// Create base axios instance
const axiosInstance: AxiosInstance = axios.create({
  baseURL: apiBaseUrl,
  withCredentials: true,
  timeout: 30000, // 30 seconds for regular requests (file uploads will override this)
});

/**
 * Override API baseURL at runtime (used for runtime config).
 * This avoids hard-binding API URL at build time and prevents beta/prod cross-calls.
 */
export function setApiBaseUrl(baseURL: string): void {
  axiosInstance.defaults.baseURL = baseURL;
}

// Wrap axios instance with request deduplication
export const api: CustomAxiosInstance = {
  ...axiosInstance,
  request: <T = unknown>(config: AxiosRequestConfig): Promise<T> => {
    // Only deduplicate GET requests to avoid issues with POST/PUT/DELETE
    if (config.method?.toLowerCase() === 'get' || !config.method) {
      if (pendingRequests.size > 0) cleanupPendingRequests();
      const requestKey = getRequestKey(config);
      const pending = pendingRequests.get(requestKey);
      
      if (pending) {
        // Return existing promise if request is still pending
        return pending.promise as Promise<T>;
      }
      
      // Create new request
      const promise: Promise<T> = axiosInstance.request<unknown>(config)
        .then((response: AxiosResponse<unknown>) => {
          // Remove from pending after a short delay to allow for rapid successive calls
          setTimeout(() => {
            pendingRequests.delete(requestKey);
          }, 100);
          return response.data as T;
        })
        .catch((error: unknown) => {
          // Remove from pending on error
          pendingRequests.delete(requestKey);
          throw error;
        });
      
      pendingRequests.set(requestKey, {
        promise: promise as Promise<unknown>,
        timestamp: Date.now(),
      });
      
      return promise;
    }
    
    // For non-GET requests, use original axios instance
    // For file uploads (FormData), use longer timeout
    const requestConfig = { ...config };
    if (config.data instanceof FormData && !requestConfig.timeout) {
      requestConfig.timeout = 300000; // 5 minutes for file uploads
    }
    return axiosInstance.request<unknown>(requestConfig)
      .then((response: AxiosResponse<unknown>) => response.data as T)
      .catch((error: unknown) => {
        throw error;
      });
  },
  get: <T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> => {
    // Use request deduplication directly for GET requests
    const requestConfig = { ...config, method: 'GET' as const, url };
    if (pendingRequests.size > 0) cleanupPendingRequests();
    const requestKey = getRequestKey(requestConfig);
    const pending = pendingRequests.get(requestKey);
    
    if (pending) {
      return pending.promise as Promise<T>;
    }
    
    const promise: Promise<T> = axiosInstance.request<unknown>(requestConfig)
      .then((response: AxiosResponse<unknown>) => {
        setTimeout(() => {
          pendingRequests.delete(requestKey);
        }, 100);
        return response.data as T;
      })
      .catch((error: unknown) => {
        pendingRequests.delete(requestKey);
        throw error;
      });
    
    pendingRequests.set(requestKey, {
      promise: promise as Promise<unknown>,
      timestamp: Date.now(),
    });
    
    return promise;
  },
  delete: <T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> => {
    return axiosInstance.delete<T>(url, config).then(response => response.data as T);
  },
  head: <T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> => {
    return axiosInstance.head<T>(url, config).then(response => response.data as T);
  },
  options: <T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> => {
    return axiosInstance.options<T>(url, config).then(response => response.data as T);
  },
  post: <T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> => {
    // For file uploads (FormData), use longer timeout
    const requestConfig = { ...config };
    if (data instanceof FormData && !requestConfig.timeout) {
      requestConfig.timeout = 300000; // 5 minutes for file uploads
    }
    return axiosInstance.post<T>(url, data, requestConfig)
      .then(response => response.data as T)
      .catch((error: unknown) => {
        throw error;
      });
  },
  put: <T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> => {
    return axiosInstance.put<T>(url, data, config).then(response => response.data as T);
  },
  patch: <T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> => {
    return axiosInstance.patch<T>(url, data, config).then(response => response.data as T);
  },
  getUri: (config?: AxiosRequestConfig): string => {
    return axiosInstance.getUri(config);
  },
  defaults: axiosInstance.defaults,
  interceptors: axiosInstance.interceptors,
};

axiosInstance.interceptors.response.use(
  (response: AxiosResponse) => response,
  (error: AxiosError) => {
    // Handle timeout errors
    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      const timeoutError: Error & { isTimeout?: boolean; config?: AxiosRequestConfig } =
        new Error('Request timeout - the server took too long to respond');
      timeoutError.isTimeout = true;
      timeoutError.config = error.config;
      return Promise.reject(timeoutError);
    }
    
    if (error.response?.status === 401) {
      // Handle unauthorized - could dispatch logout action here if needed
    }
    
    // Ensure error object has proper structure
    if (error.response?.data && typeof error.response.data === 'object') {
      // Normalize error response
      const errorData = error.response.data as Record<string, unknown>;
      if (!errorData.error && !errorData.message) {
        errorData.error = 'An error occurred';
      }
    }

    // Attach requestId for easier UI diagnostics (also available in headers).
    try {
      const requestId = getRequestIdFromError(error);
      (error as any).requestId = requestId;
    } catch {
      // ignore
    }

    try {
      emitGlobalApiError(error);
    } catch {
      // ignore
    }
    
    return Promise.reject(error);
  }
);


