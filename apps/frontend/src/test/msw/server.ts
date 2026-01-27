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
  // Taste profile + personalized memes (used on StreamerProfilePage for authed viewers).
  http.get('*/me/taste-profile', () =>
    HttpResponse.json({
      totalActivations: 0,
      lastActivationAt: null,
      topTags: [],
      categoryWeights: {},
      profileReady: false,
    })
  ),
  http.get('*/channels/:slug/memes/personalized*', () =>
    HttpResponse.json({
      items: [],
      profileReady: false,
      totalActivations: 0,
      mode: 'fallback',
    })
  ),
  http.get('*/memes/stats*', () =>
    HttpResponse.json({
      period: 'week',
      startDate: new Date(0).toISOString(),
      endDate: new Date(0).toISOString(),
      stats: [],
    })
  ),
  http.get('*/channels/:slug/leaderboard*', () =>
    HttpResponse.json({
      period: 'week',
      startDate: new Date(0).toISOString(),
      endDate: new Date(0).toISOString(),
      stats: [],
    })
  ),
  http.get('*/streamer/starter-memes*', () => HttpResponse.json([])),
  http.get('*/streamer/stream-recap/latest', () => HttpResponse.json({ recap: null })),
  http.options('*/streamer/stream-recap/latest', () => new HttpResponse(null, { status: 204, headers: corsHeaders })),
  http.get('*/streamer/bots/:provider/bot', () =>
    HttpResponse.json({
      enabled: false,
      updatedAt: null,
      externalAccountId: null,
      lockedBySubscription: false,
    })
  ),
  http.options('*/streamer/bots/:provider/bot', () => new HttpResponse(null, { status: 204, headers: corsHeaders })),
  http.get('/public/events/active', () => HttpResponse.json({ events: [] })),
  http.options('/public/events/active', () => new HttpResponse(null, { status: 204, headers: corsHeaders })),
  http.get('*/public/events/active', () => HttpResponse.json({ events: [] })),
  http.options('*/public/events/active', () => new HttpResponse(null, { status: 204, headers: corsHeaders })),
  http.get('/channels/:slug/achievements/me', () =>
    HttpResponse.json({
      global: [],
      channel: [],
      events: [],
    })
  ),
  http.options('/channels/:slug/achievements/me', () => new HttpResponse(null, { status: 204, headers: corsHeaders })),
  http.get('*/channels/:slug/achievements/me', () =>
    HttpResponse.json({
      global: [],
      channel: [],
      events: [],
    })
  ),
  http.options('*/channels/:slug/achievements/me', () => new HttpResponse(null, { status: 204, headers: corsHeaders })),
  http.get('*/channels/:slug/votes/active', () => HttpResponse.json({ session: null })),
  http.options('*/channels/:slug/votes/active', () => new HttpResponse(null, { status: 204, headers: corsHeaders })),
  http.get('*/channels/:slug/wheel', () =>
    HttpResponse.json({
      enabled: false,
      paidSpinCostCoins: 0,
      freeSpinAvailable: false,
      freeSpinCooldownSeconds: 0,
      nextFreeSpinAt: null,
      prizeMultiplier: 1,
    })
  ),
  http.options('*/channels/:slug/wheel', () => new HttpResponse(null, { status: 204, headers: corsHeaders })),
  // Agent/debug telemetry (used by some integration tests for snapshots/logs).
  http.options(/http:\/\/127\.0\.0\.1:7245\/ingest\/.+/, () => new HttpResponse(null, { status: 204, headers: corsHeaders })),
  http.post(/http:\/\/127\.0\.0\.1:7245\/ingest\/.+/, () => HttpResponse.json({ ok: true }, { headers: corsHeaders })),
  http.options('*/ingest/:id', () => new HttpResponse(null, { status: 204, headers: corsHeaders })),
  http.post('*/ingest/:id', () => HttpResponse.json({ ok: true }, { headers: corsHeaders })),
  // Some API clients trigger CORS preflights even for GETs; keep tests strict without spurious unhandled OPTIONS.
  http.options(/\/channels\/[^/]+(\?.*)?$/, () => new HttpResponse(null, { status: 204, headers: corsHeaders })),
  http.options(/\/public\/channels\/[^/]+(\?.*)?$/, () => new HttpResponse(null, { status: 204, headers: corsHeaders }))
);









