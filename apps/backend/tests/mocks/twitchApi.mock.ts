import { http, HttpResponse } from 'msw';
import tokenFixture from '../fixtures/twitch/token.json';
import userFixture from '../fixtures/twitch/user.json';

export const twitchHandlers = [
  http.post('https://id.twitch.tv/oauth2/token', () => HttpResponse.json(tokenFixture)),
  http.get('https://api.twitch.tv/helix/users', () => HttpResponse.json(userFixture)),
];
