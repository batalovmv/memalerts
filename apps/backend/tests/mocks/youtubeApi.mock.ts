import { http, HttpResponse } from 'msw';
import tokenFixture from '../fixtures/youtube/token.json';
import tokenInfoFixture from '../fixtures/youtube/tokeninfo.json';
import userInfoFixture from '../fixtures/youtube/userinfo.json';
import channelsIdFixture from '../fixtures/youtube/channels_id.json';
import channelsSnippetFixture from '../fixtures/youtube/channels_snippet.json';
import oembedFixture from '../fixtures/youtube/oembed.json';

export const youtubeHandlers = [
  http.post('https://oauth2.googleapis.com/token', () => HttpResponse.json(tokenFixture)),
  http.get('https://oauth2.googleapis.com/tokeninfo', () => HttpResponse.json(tokenInfoFixture)),
  http.get('https://openidconnect.googleapis.com/v1/userinfo', () => HttpResponse.json(userInfoFixture)),
  http.get('https://www.googleapis.com/youtube/v3/channels', ({ request }) => {
    const url = new URL(request.url);
    const part = String(url.searchParams.get('part') || '');
    if (part.includes('snippet')) {
      return HttpResponse.json(channelsSnippetFixture);
    }
    return HttpResponse.json(channelsIdFixture);
  }),
  http.get('https://www.youtube.com/oembed', () => HttpResponse.json(oembedFixture)),
];
