import axios, { AxiosError, AxiosResponse } from 'axios';

// Use relative URL in production (same domain), absolute in development
const getApiUrl = () => {
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl) {
    return envUrl;
  }
  // In production, use same origin (relative URL)
  if (import.meta.env.PROD) {
    return '';
  }
  // In development, use localhost
  return 'http://localhost:3001';
};

export const api = axios.create({
  baseURL: getApiUrl(),
  withCredentials: true,
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


