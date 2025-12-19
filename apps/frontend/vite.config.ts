import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => {
  // For beta builds, explicitly set VITE_API_URL using define
  // This takes precedence over all other environment variable sources
  const isBetaBuild = process.env.BETA_BUILD === 'true';
  const betaDomain = process.env.BETA_DOMAIN;
  
  const defineConfig: Record<string, string> = {};
  
  if (isBetaBuild && betaDomain) {
    // Explicitly define VITE_API_URL for beta builds
    // This will replace import.meta.env.VITE_API_URL with the beta URL
    const betaApiUrl = `https://beta.${betaDomain}`;
    defineConfig['import.meta.env.VITE_API_URL'] = JSON.stringify(betaApiUrl);
    console.log(`[Vite Config] Beta build detected, setting VITE_API_URL to: ${betaApiUrl}`);
  } else if (isBetaBuild && !betaDomain) {
    // Beta build but no domain - use empty string for relative URLs
    defineConfig['import.meta.env.VITE_API_URL'] = JSON.stringify('');
    console.log(`[Vite Config] Beta build detected, setting VITE_API_URL to empty string (relative URLs)`);
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


