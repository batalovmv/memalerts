import { http, HttpResponse } from 'msw';
import tokenFixture from '../fixtures/kick/token.json';
import userFixture from '../fixtures/kick/user.json';

export const kickHandlers = [
  http.post('https://kick.example.com/oauth/token', () => HttpResponse.json(tokenFixture)),
  http.get('https://kick.example.com/userinfo', () => HttpResponse.json(userFixture)),
];
