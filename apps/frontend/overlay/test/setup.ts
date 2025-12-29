import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll } from 'vitest';

import { setupServer } from 'msw/node';

// Overlay tests are currently lightweight, but we still enforce "no real network".
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// Keep Vitest output readable: truncate huge DOM dumps from Testing Library errors.
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








