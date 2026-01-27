import '@testing-library/jest-dom/vitest';
import { configure, prettyDOM } from '@testing-library/dom';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll } from 'vitest';

// Overlay tests are currently lightweight, but we still enforce "no real network".
const server = setupServer(
  http.get('/public/events/active', () => HttpResponse.json({ events: [] })),
  http.options('/public/events/active', () => new HttpResponse(null, { status: 204 })),
  http.get('*/public/events/active', () => HttpResponse.json({ events: [] })),
  http.options('*/public/events/active', () => new HttpResponse(null, { status: 204 }))
);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// Keep CI logs readable: truncate huge DOM dumps from Testing Library errors.
const TL_DOM_MAX_CHARS = 800;
configure({
  getElementError: (message, container) => {
    const dom = container ? prettyDOM(container, TL_DOM_MAX_CHARS, { highlight: false }) : '';
    const hint = dom ? `\n\nDOM (truncated to ${TL_DOM_MAX_CHARS} chars):\n${dom}` : '';
    return new Error(`${message}${hint}`);
  },
});







