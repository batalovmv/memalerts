import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

/**
 * MSW server for Node/Vitest.
 *
 * Add handlers in individual tests via `server.use(...)` or export common handlers
 * from `src/test/msw/handlers.ts` when they appear.
 */
const corsHeaders = {
  'access-control-allow-origin': 'http://localhost:3000',
  'access-control-allow-credentials': 'true',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization',
};

/**
 * Default handlers for endpoints that may be called from effects during mount/unmount.
 * Keeping them in `setupServer(...)` makes them survive `server.resetHandlers()`.
 */
export const server = setupServer(
  // Agent/debug telemetry (used by some integration tests for snapshots/logs).
  http.options(/http:\/\/127\.0\.0\.1:7245\/ingest\/.+/, () => new HttpResponse(null, { status: 204, headers: corsHeaders })),
  http.post(/http:\/\/127\.0\.0\.1:7245\/ingest\/.+/, () => HttpResponse.json({ ok: true }, { headers: corsHeaders })),
  http.options('*/ingest/:id', () => new HttpResponse(null, { status: 204, headers: corsHeaders })),
  http.post('*/ingest/:id', () => HttpResponse.json({ ok: true }, { headers: corsHeaders })),
  http.options('*/channels/:channelId/boosty-access', () => new HttpResponse(null, { status: 204, headers: corsHeaders })),
  http.get('*/channels/:channelId/boosty-access', () =>
    HttpResponse.json(
      { status: 'need_discord_link', requiredGuild: { id: 'g1', autoJoin: true, name: null, inviteUrl: null } },
      { headers: corsHeaders }
    )
  ),
  // Some API clients trigger CORS preflights even for GETs; keep tests strict without spurious unhandled OPTIONS.
  http.options(/\/channels\/[^/]+(\?.*)?$/, () => new HttpResponse(null, { status: 204, headers: corsHeaders })),
  http.options(/\/public\/channels\/[^/]+(\?.*)?$/, () => new HttpResponse(null, { status: 204, headers: corsHeaders }))
);









