import { http, HttpResponse } from 'msw';
import subscriptionsFixture from '../fixtures/boosty/subscriptions.json';
import userFixture from '../fixtures/boosty/user.json';

export const boostyHandlers = [
  http.get('https://api.boosty.to/v1/user/subscriptions', () => HttpResponse.json(subscriptionsFixture)),
  http.get('https://api.boosty.to/v1/user', () => HttpResponse.json(userFixture)),
];
