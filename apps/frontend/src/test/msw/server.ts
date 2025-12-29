import { setupServer } from 'msw/node';

/**
 * MSW server for Node/Vitest.
 *
 * Add handlers in individual tests via `server.use(...)` or export common handlers
 * from `src/test/msw/handlers.ts` when they appear.
 */
export const server = setupServer();








