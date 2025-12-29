import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';

import '@/i18n/config';
import i18n from '@/i18n/config';
import { server } from '@/test/msw/server';

// Shorten huge Testing Library errors in CI by truncating pretty-printed DOM.
// Keep it dependency-free: do NOT import `@testing-library/dom` directly (pnpm strict).
const TL_DEBUG_PRINT_LIMIT = 2000;
try {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process as any).env = (process as any).env || {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process as any).env.DEBUG_PRINT_LIMIT = String(TL_DEBUG_PRINT_LIMIT);
} catch {
  // ignore
}

// Keep test output clean: React Router v6 prints migration warnings in console.warn.
// We filter only that specific warning category so real warnings still surface.
const originalWarn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  const first = args[0];
  if (typeof first === 'string' && first.includes('React Router Future Flag Warning')) return;
  originalWarn(...args);
};

// Ensure deterministic language in tests.
try {
  // i18next init is sync-ish here, but we still guard just in case.
  void i18n.changeLanguage('en');
} catch {
  // ignore
}

// MSW: intercept network calls in tests (opt-in per test via server.use()).
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// In unit tests we usually want real console.error (to see React errors),
// but console.warn often becomes noise. Keep it visible in CI when needed.
// You can override per-test with vi.spyOn(console, ...).
vi.stubGlobal('IS_TEST', true);

// JSDOM does not implement HTMLMediaElement playback APIs; some components call play/pause in effects.
// Stub them globally to prevent noisy "Not implemented" errors in tests.
try {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proto = (globalThis as any).HTMLMediaElement?.prototype as Record<string, unknown> | undefined;
  if (proto) {
    if (!('play' in proto)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (proto as any).play = vi.fn().mockResolvedValue(undefined);
    } else {
      Object.defineProperty(proto, 'play', { configurable: true, value: vi.fn().mockResolvedValue(undefined) });
    }
    if (!('pause' in proto)) {
      (proto as any).pause = vi.fn();
    } else {
      Object.defineProperty(proto, 'pause', { configurable: true, value: vi.fn() });
    }
  }
} catch {
  // ignore
}


