import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['./vitest.web.config.ts', './overlay/vitest.config.ts'],
    coverage: {
      provider: 'v8',
      all: false,
      reportsDirectory: 'coverage',
      reporter: ['text', 'json-summary', 'lcov'],
      include: ['src/**/*.{ts,tsx}', 'overlay/**/*.{ts,tsx}'],
      exclude: [
        '**/*.d.ts',
        '**/*.{test,spec}.{ts,tsx}',
        '**/node_modules/**',
        '**/dist/**',
        'src/test/**',
        'overlay/test/**',
        'src/vite-env.d.ts',
        'overlay/vite-env.d.ts',
        'vite.config.ts',
        'vitest.config.ts',
        'vitest.web.config.ts',
        'overlay/vitest.config.ts',
        'tailwind.config.js',
        'postcss.config.js',
        'overlay/tailwind.config.js',
        'overlay/vite.config.ts',
      ],
    },
  },
});


