import { setupServer } from 'msw/node';
import { openaiHandlers } from './openaiApi.mock.js';
import { twitchHandlers } from './twitchApi.mock.js';
import { vkHandlers } from './vkApi.mock.js';
import { vkvideoHandlers } from './vkvideoApi.mock.js';
import { youtubeHandlers } from './youtubeApi.mock.js';

export const mockServer = setupServer(
  ...twitchHandlers,
  ...youtubeHandlers,
  ...vkHandlers,
  ...vkvideoHandlers,
  ...openaiHandlers
);

export function startMockServer(options: { onUnhandledRequest?: 'bypass' | 'warn' | 'error' } = {}) {
  const strategy = options.onUnhandledRequest ?? 'warn';
  if (strategy !== 'error') {
    mockServer.listen({ onUnhandledRequest: strategy });
    return;
  }

  mockServer.listen({
    onUnhandledRequest(req, print) {
      const url = new URL(req.url);
      const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
      if (isLocal) return;
      print.error();
    },
  });
}

export function resetMockHandlers() {
  mockServer.resetHandlers();
}

export function stopMockServer() {
  mockServer.close();
}
