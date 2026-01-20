import { http, HttpResponse } from 'msw';
import tokenFixture from '../fixtures/vk/token.json';
import userFixture from '../fixtures/vk/user.json';

export const vkHandlers = [
  http.get('https://oauth.vk.com/access_token', () => HttpResponse.json(tokenFixture)),
  http.get('https://api.vk.com/method/users.get', () => HttpResponse.json(userFixture)),
];
