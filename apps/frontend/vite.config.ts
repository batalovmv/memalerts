import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => {
  // For beta builds, use VITE_API_URL_BETA secret if available
  // This takes precedence over all other environment variable sources via define
  const isBetaBuild = process.env.BETA_BUILD === 'true';
  const betaApiUrl = process.env.VITE_API_URL_BETA;
  
  const defineConfig: Record<string, string> = {};
  
  if (isBetaBuild && betaApiUrl) {
    // Explicitly define VITE_API_URL for beta builds using VITE_API_URL_BETA secret
    // This will replace import.meta.env.VITE_API_URL with the beta URL from secret
    defineConfig['import.meta.env.VITE_API_URL'] = JSON.stringify(betaApiUrl);
    console.log(`[Vite Config] Beta build detected, setting VITE_API_URL to: ${betaApiUrl}`);
  } else if (isBetaBuild && !betaApiUrl) {
    // Beta build but no VITE_API_URL_BETA secret - use empty string for relative URLs
    defineConfig['import.meta.env.VITE_API_URL'] = JSON.stringify('');
    console.log(`[Vite Config] Beta build detected, but VITE_API_URL_BETA not set, using empty string (relative URLs)`);
  }

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          },
        },
      },
    },
    define: Object.keys(defineConfig).length > 0 ? defineConfig : undefined,
  };
});


