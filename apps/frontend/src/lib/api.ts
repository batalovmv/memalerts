import axios, { AxiosError, AxiosResponse, AxiosInstance, AxiosRequestConfig } from 'axios';

export function getRequestIdFromError(error: unknown): string | null {
  const maybeAxios = error as AxiosError | null;
  const headers = (maybeAxios?.response?.headers ?? null) as Record<string, unknown> | null;
  const headerReqId =
    (headers?.['x-request-id'] as unknown) ||
    (headers?.['x-requestid'] as unknown) ||
    (headers?.['x-correlation-id'] as unknown);

  if (typeof headerReqId === 'string' && headerReqId.trim()) return headerReqId.trim();

  const dataObj =
    maybeAxios?.response?.data && typeof maybeAxios.response.data === 'object'
      ? (maybeAxios.response.data as Record<string, unknown>)
      : null;
  const dataReqId = dataObj?.requestId;
  if (typeof dataReqId === 'string' && dataReqId.trim()) return dataReqId.trim();

  const errObj = (error && typeof error === 'object' ? (error as Record<string, unknown>) : null) ?? null;
  const attached = errObj?.requestId;
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
    (error.response?.data && typeof error.response.data === 'object'
      ? ((error.response.data as Record<string, unknown>).error as unknown) ||
        ((error.response.data as Record<string, unknown>).message as unknown)
      : null) ||
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

// Response cache: allows serving cached JSON for conditional requests (304 Not Modified).
// This prevents thunks like fetchUser() from breaking when axios receives 304 with an empty body.
interface CachedResponse<T = unknown> {
  data: T;
  timestamp: number;
}

const responseCache = new Map<string, CachedResponse<unknown>>();
const RESPONSE_CACHE_TTL = 60_000; // 60 seconds

function looksLikeSpaHtml(data: unknown): boolean {
  if (typeof data !== 'string') return false;
  const head = data.slice(0, 256).toLowerCase();
  return head.includes('<!doctype html') || head.includes('<html');
}

function stripApiSuffix(baseUrl: string): string | null {
  const b = (baseUrl || '').trim();
  if (!b) return null;
  const normalized = b.endsWith('/') ? b.slice(0, -1) : b;
  if (!normalized.toLowerCase().endsWith('/api')) return null;
  return normalized.slice(0, -4) || '';
}

function shouldRetryPublicViaNoApiSuffix(config: AxiosRequestConfig): boolean {
  const url = config.url;
  if (typeof url !== 'string') return false;
  if (!url.startsWith('/public/')) return false;
  const base = (config.baseURL ?? axiosInstance.defaults.baseURL) as unknown;
  if (typeof base !== 'string') return false;
  const stripped = stripApiSuffix(base);
  return stripped !== null;
}

function shouldRetryPublicViaApiPrefix(config: AxiosRequestConfig): boolean {
  const url = config.url;
  if (typeof url !== 'string') return false;
  if (!url.startsWith('/public/')) return false;
  if (url.startsWith('/api/public/')) return false;
  // Only auto-retry when baseURL is same-origin (empty string).
  const base = axiosInstance.defaults.baseURL;
  if (typeof base === 'string' && base !== '') return false;
  return true;
}

function shouldRetrySpaFallbackViaApiPrefix(config: AxiosRequestConfig): boolean {
  const url = config.url;
  if (typeof url !== 'string') return false;
  // Don't double-prefix.
  if (url.startsWith('/api/')) return false;
  // Avoid retrying obvious non-API paths.
  if (url === '/config.json') return false;
  if (url.startsWith('/assets/')) return false;
  if (url.startsWith('/overlay/')) return false;
  // Only auto-retry when baseURL is effectively same-origin.
  // We allow:
  // - "" (recommended)
  // - "/" (some deployments set this)
  // - window.location.origin (or origin + "/")
  const base = (config.baseURL ?? axiosInstance.defaults.baseURL) as unknown;
  if (typeof base === 'string') {
    const b = base.trim();
    const origin = (() => {
      try {
        return window.location.origin;
      } catch {
        return '';
      }
    })();
    const ok =
      b === '' ||
      b === '/' ||
      (origin && (b === origin || b === `${origin}/`));
    if (!ok) return false;
  }
  // Only for absolute-path style URLs. (We don't want to touch relative 'foo/bar')
  if (!url.startsWith('/')) return false;
  return true;
}

function withApiPrefix(url: string): string {
  if (url.startsWith('/api/')) return url;
  return `/api${url}`;
}

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

function isBetaHost(hostname: string): boolean {
  return hostname.includes('beta.');
}

function shouldIgnoreEnvApiUrl(envUrl: string): boolean {
  if (!import.meta.env.PROD) return false;
  try {
    const envHost = new URL(envUrl).hostname;
    const pageHost = window.location.hostname;
    return isBetaHost(envHost) !== isBetaHost(pageHost);
  } catch {
    return false;
  }
}

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
    if (shouldIgnoreEnvApiUrl(envUrl)) {
      // Prevent accidental prod<->beta cross-calls when a stale VITE_API_URL leaks into the build env.
      return '';
    }
    return envUrl;
  }
  
  // If VITE_API_URL is not set at all, determine based on environment
  // In production, use same-origin relative URLs by default.
  // Nginx must proxy API routes (e.g. /me/*) to the backend; otherwise requests may hit SPA fallback.
  if (import.meta.env.PROD) {
    return '';
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
  // Avoid browser conditional caching (304 Not Modified) for API JSON calls.
  // 304 responses usually have an empty body which breaks data consumers.
  headers: {
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
  },
  // Axios default validateStatus rejects 304, which can happen for cached GETs.
  // Treat 304 as a successful response; we will serve cached JSON when possible.
  validateStatus: (status) => (status >= 200 && status < 300) || status === 304,
});

export type ApiResponseMeta = {
  status: number;
  /**
   * Axios normalizes header keys to lowercase in browsers.
   */
  headers: Record<string, unknown>;
};

/**
 * Make a request and return both data and response metadata (status + headers).
 *
 * This is intentionally separate from the `api` wrapper to avoid breaking existing call sites
 * that expect `api.get<T>() => Promise<T>`.
 */
export async function apiRequestWithMeta<T = unknown>(
  config: AxiosRequestConfig,
): Promise<{ data: T; meta: ApiResponseMeta }> {
  const resp = await axiosInstance.request<T>(config);
  return {
    data: resp.data as T,
    meta: {
      status: resp.status,
      headers: (resp.headers ?? {}) as Record<string, unknown>,
    },
  };
}

export async function apiGetWithMeta<T = unknown>(
  url: string,
  config?: AxiosRequestConfig,
): Promise<{ data: T; meta: ApiResponseMeta }> {
  return await apiRequestWithMeta<T>({ ...(config || {}), method: 'GET', url });
}

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
          // Handle conditional GET with 304 by serving cached JSON when available.
          if (response.status === 304) {
            const cached = responseCache.get(requestKey);
            if (cached && Date.now() - cached.timestamp < RESPONSE_CACHE_TTL) {
              return cached.data as T;
            }

            // No cached body to serve — retry once with explicit no-cache headers.
            const retryConfig: AxiosRequestConfig = {
              ...config,
              headers: {
                ...(config.headers || {}),
                'Cache-Control': 'no-cache',
                Pragma: 'no-cache',
              },
            };
            return axiosInstance.request<unknown>(retryConfig).then((r) => {
              responseCache.set(requestKey, { data: r.data as T, timestamp: Date.now() });
              return r.data as T;
            });
          } else {
            // If API proxy is misconfigured, /public/* may hit SPA fallback and return HTML.
            // Retry once via /api prefix (common nginx convention) to reach backend.
            if (looksLikeSpaHtml(response.data) && shouldRetryPublicViaNoApiSuffix(config)) {
              const base = String((config.baseURL ?? axiosInstance.defaults.baseURL) || '');
              const stripped = stripApiSuffix(base);
              if (stripped !== null) {
                const retryConfig: AxiosRequestConfig = { ...config, baseURL: stripped, url: String(config.url) };
                return axiosInstance.request<unknown>(retryConfig).then((r) => {
                  responseCache.set(requestKey, { data: r.data as T, timestamp: Date.now() });
                  return r.data as T;
                });
              }
            }
            if (looksLikeSpaHtml(response.data) && shouldRetryPublicViaApiPrefix(config)) {
              const retryConfig: AxiosRequestConfig = { ...config, url: withApiPrefix(String(config.url)) };
              return axiosInstance.request<unknown>(retryConfig).then((r) => {
                responseCache.set(requestKey, { data: r.data as T, timestamp: Date.now() });
                return r.data as T;
              });
            }
            // More general case: some deployments proxy backend under /api/* and serve SPA for unknown routes.
            // If we received HTML for an API call, retry once via /api prefix (same-origin only).
            if (looksLikeSpaHtml(response.data) && shouldRetrySpaFallbackViaApiPrefix(config)) {
              const retryConfig: AxiosRequestConfig = { ...config, url: withApiPrefix(String(config.url)) };
              return axiosInstance.request<unknown>(retryConfig).then((r) => {
                responseCache.set(requestKey, { data: r.data as T, timestamp: Date.now() });
                return r.data as T;
              });
            }
            responseCache.set(requestKey, { data: response.data as T, timestamp: Date.now() });
          }

          return response.data as T;
        })
        .catch((error: unknown) => {
          throw error;
        })
        .finally(() => {
          // Remove from pending immediately after completion.
          // Dedup is meant only for in-flight requests; keeping resolved entries causes stale reuse.
          pendingRequests.delete(requestKey);
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
        if (response.status === 304) {
          const cached = responseCache.get(requestKey);
          if (cached && Date.now() - cached.timestamp < RESPONSE_CACHE_TTL) {
            return cached.data as T;
          }

          const retryConfig: AxiosRequestConfig = {
            ...requestConfig,
            headers: {
              ...(requestConfig.headers || {}),
              'Cache-Control': 'no-cache',
              Pragma: 'no-cache',
            },
          };
          return axiosInstance.request<unknown>(retryConfig).then((r) => {
            responseCache.set(requestKey, { data: r.data as T, timestamp: Date.now() });
            return r.data as T;
          });
        } else {
          if (looksLikeSpaHtml(response.data) && shouldRetryPublicViaNoApiSuffix(requestConfig)) {
            const base = String((requestConfig.baseURL ?? axiosInstance.defaults.baseURL) || '');
            const stripped = stripApiSuffix(base);
            if (stripped !== null) {
              const retryConfig: AxiosRequestConfig = { ...requestConfig, baseURL: stripped, url };
              return axiosInstance.request<unknown>(retryConfig).then((r) => {
                responseCache.set(requestKey, { data: r.data as T, timestamp: Date.now() });
                return r.data as T;
              });
            }
          }
          if (looksLikeSpaHtml(response.data) && shouldRetryPublicViaApiPrefix(requestConfig)) {
            const retryConfig: AxiosRequestConfig = { ...requestConfig, url: withApiPrefix(url) };
            return axiosInstance.request<unknown>(retryConfig).then((r) => {
              responseCache.set(requestKey, { data: r.data as T, timestamp: Date.now() });
              return r.data as T;
            });
          }
          if (looksLikeSpaHtml(response.data) && shouldRetrySpaFallbackViaApiPrefix(requestConfig)) {
            const retryConfig: AxiosRequestConfig = { ...requestConfig, url: withApiPrefix(url) };
            return axiosInstance.request<unknown>(retryConfig).then((r) => {
              responseCache.set(requestKey, { data: r.data as T, timestamp: Date.now() });
              return r.data as T;
            });
          }
          responseCache.set(requestKey, { data: response.data as T, timestamp: Date.now() });
        }

        return response.data as T;
      })
      .catch((error: unknown) => {
        throw error;
      })
      .finally(() => {
        pendingRequests.delete(requestKey);
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

let lastUnauthorizedAt = 0;

function emitUnauthorizedOnce() {
  const now = Date.now();
  if (now - lastUnauthorizedAt < 800) return;
  lastUnauthorizedAt = now;
  try {
    window.dispatchEvent(
      new CustomEvent('memalerts:auth:unauthorized', { detail: { ts: new Date().toISOString() } }),
    );
  } catch {
    // ignore
  }
}

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
      emitUnauthorizedOnce();
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
      (error as AxiosError & { requestId?: string | null }).requestId = requestId;
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
