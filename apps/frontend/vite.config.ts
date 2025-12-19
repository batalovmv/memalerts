import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => {
  const isBetaBuild = process.env.BETA_BUILD === 'true';

  const betaApiUrl = process.env.VITE_API_URL_BETA?.trim();
  const domain = process.env.DOMAIN?.trim();

  const defineConfig: Record<string, string> = {};

  if (isBetaBuild) {
    let finalBetaUrl = '';

    if (betaApiUrl) {
      finalBetaUrl = betaApiUrl;
      console.log(`[Vite Config] Beta build: using VITE_API_URL_BETA = ${finalBetaUrl}`);
    } else if (domain) {
      finalBetaUrl = `https://beta.${domain}`;
      console.log(`[Vite Config] Beta build: using DOMAIN -> VITE_API_URL = ${finalBetaUrl}`);
    } else {
      finalBetaUrl = '';
      console.log(`[Vite Config] Beta build: no VITE_API_URL_BETA and no DOMAIN, using relative URLs`);
    }

    defineConfig['import.meta.env.VITE_API_URL'] = JSON.stringify(finalBetaUrl);
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


