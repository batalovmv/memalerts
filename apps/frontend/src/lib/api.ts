import axios, { AxiosError, AxiosResponse } from 'axios';

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

export const api = axios.create({
  baseURL: apiBaseUrl,
  withCredentials: true,
  timeout: 300000, // 5 minutes timeout for file uploads
});

api.interceptors.response.use(
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


