export const login = (): void => {
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
  window.location.href = `${apiUrl}/auth/twitch`;
};

