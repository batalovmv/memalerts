export const login = (): void => {
  const envUrl = import.meta.env.VITE_API_URL;
  let apiUrl: string;
  
  if (envUrl) {
    apiUrl = envUrl;
  } else if (import.meta.env.PROD) {
    // In production, use same origin
    apiUrl = window.location.origin;
  } else {
    // In development, use localhost
    apiUrl = 'http://localhost:3001';
  }
  
  window.location.href = `${apiUrl}/auth/twitch`;
};

