import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => {
  // Overlay is deployed under /overlay/ (nginx serves overlay/dist there),
  // so we must build assets with that base to avoid clashing with web /assets.
  const base = command === 'build' ? '/overlay/' : '/';

  return {
    base,
    plugins: [react()],
    server: {
      port: 5174,
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
  };
});


