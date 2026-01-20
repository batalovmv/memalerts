import { http, HttpResponse } from 'msw';
import tokenFixture from '../fixtures/trovo/token.json';
import userFixture from '../fixtures/trovo/user.json';

export const trovoHandlers = [
  http.post('https://open-api.trovo.live/openplatform/exchangetoken', () => HttpResponse.json(tokenFixture)),
  http.post('https://open-api.trovo.live/openplatform/getuserinfo', () => HttpResponse.json(userFixture)),
];
