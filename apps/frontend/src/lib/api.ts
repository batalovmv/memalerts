import axios, { AxiosError, AxiosResponse, AxiosInstance, AxiosRequestConfig } from 'axios';

// Request deduplication: track in-flight requests to prevent duplicate calls
interface PendingRequest {
  promise: Promise<any>;
  timestamp: number;
}

const pendingRequests = new Map<string, PendingRequest>();
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

// Clean up old requests periodically
setInterval(cleanupPendingRequests, 10000); // Every 10 seconds

// Use relative URL in production (same domain), absolute in development
const getApiUrl = () => {
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl) {
    console.log('[API] Using VITE_API_URL from env:', envUrl);
    return envUrl;
  }
  // In production, use same origin (relative URL)
  // This ensures beta frontend uses beta API, production uses production API
  if (import.meta.env.PROD) {
    const relativeUrl = '';
    console.log('[API] Using relative URL (same origin):', relativeUrl, 'Current origin:', window.location.origin);
    return relativeUrl;
  }
  // In development, use localhost
  const devUrl = 'http://localhost:3001';
  console.log('[API] Using dev URL:', devUrl);
  return devUrl;
};

const apiBaseUrl = getApiUrl();
console.log('[API] Final baseURL:', apiBaseUrl, 'Current origin:', window.location.origin);

// Create base axios instance
const axiosInstance: AxiosInstance = axios.create({
  baseURL: apiBaseUrl,
  withCredentials: true,
  timeout: 300000, // 5 minutes timeout for file uploads
});

// Wrap axios instance with request deduplication
export const api: AxiosInstance = {
  ...axiosInstance,
  request: <T = any>(config: AxiosRequestConfig): Promise<T> => {
    // Only deduplicate GET requests to avoid issues with POST/PUT/DELETE
    if (config.method?.toLowerCase() === 'get' || !config.method) {
      const requestKey = getRequestKey(config);
      const pending = pendingRequests.get(requestKey);
      
      if (pending) {
        // Return existing promise if request is still pending
        return pending.promise;
      }
      
      // Create new request
      const promise = axiosInstance.request<T>(config)
        .then((response) => {
          // Remove from pending after a short delay to allow for rapid successive calls
          setTimeout(() => {
            pendingRequests.delete(requestKey);
          }, 100);
          return response;
        })
        .catch((error) => {
          // Remove from pending on error
          pendingRequests.delete(requestKey);
          throw error;
        });
      
      pendingRequests.set(requestKey, {
        promise,
        timestamp: Date.now(),
      });
      
      return promise;
    }
    
    // For non-GET requests, use original axios instance
    return axiosInstance.request<T>(config);
  },
  get: <T = any>(url: string, config?: AxiosRequestConfig): Promise<T> => {
    return api.request<T>({ ...config, method: 'GET', url });
  },
  delete: <T = any>(url: string, config?: AxiosRequestConfig): Promise<T> => {
    return axiosInstance.delete<T>(url, config);
  },
  head: <T = any>(url: string, config?: AxiosRequestConfig): Promise<T> => {
    return axiosInstance.head<T>(url, config);
  },
  options: <T = any>(url: string, config?: AxiosRequestConfig): Promise<T> => {
    return axiosInstance.options<T>(url, config);
  },
  post: <T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> => {
    return axiosInstance.post<T>(url, data, config);
  },
  put: <T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> => {
    return axiosInstance.put<T>(url, data, config);
  },
  patch: <T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> => {
    return axiosInstance.patch<T>(url, data, config);
  },
  getUri: (config?: AxiosRequestConfig): string => {
    return axiosInstance.getUri(config);
  },
  defaults: axiosInstance.defaults,
  interceptors: axiosInstance.interceptors,
} as AxiosInstance;

axiosInstance.interceptors.response.use(
  (response: AxiosResponse) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      // Handle unauthorized - could dispatch logout action here if needed
    }
    
    // Ensure error object has proper structure
    if (error.response?.data && typeof error.response.data === 'object') {
      // Normalize error response
      const errorData = error.response.data as any;
      if (!errorData.error && !errorData.message) {
        errorData.error = 'An error occurred';
      }
    }
    
    return Promise.reject(error);
  }
);


