import path from 'path';

import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const isBetaBuild = process.env.BETA_BUILD === 'true';
  const isAnalyze = mode === 'analyze';
  const monorepoRoot = path.resolve(__dirname, '../..');

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
    plugins: [
      react(),
      VitePWA({
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        injectRegister: 'auto',
        registerType: 'autoUpdate',
        manifest: {
          name: 'Memalerts',
          short_name: 'Memalerts',
          start_url: '/',
          display: 'standalone',
          theme_color: '#0a84ff',
          background_color: '#0b0f19',
        },
      }),
      isAnalyze &&
        visualizer({
          open: true,
          filename: 'dist/stats.html',
          gzipSize: true,
        }),
    ].filter(Boolean),
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 5173,
      fs: {
        allow: [monorepoRoot],
      },
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
            'redux-vendor': ['@reduxjs/toolkit', 'react-redux'],
            'i18n-vendor': ['i18next', 'react-i18next', 'i18next-browser-languagedetector'],
            'ui-vendor': ['react-hot-toast'],
          },
        },
      },
    },
    define: Object.keys(defineConfig).length > 0 ? defineConfig : undefined,
  };
});
