import http from 'k6/http';
import { check } from 'k6';
import {
  BASE_URL,
  STREAMER_COOKIE,
  VIEWER_COOKIE,
  PUBLIC_CHANNEL_SLUG,
  authParams,
  logIfError,
} from './helpers.js';

export const options = {
  vus: 5,
  duration: '10s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500'],
  },
};

export default function () {
  const health = http.get(`${BASE_URL}/health`);
  logIfError(health, 'health');
  check(health, { 'health ok': (r) => r.status === 200 });

  const submissions = http.get(`${BASE_URL}/submissions/mine?limit=5`, authParams(VIEWER_COOKIE));
  logIfError(submissions, 'smoke-submissions');
  check(submissions, { 'subs ok': (r) => r.status < 500 });

  const moderation = http.get(
    `${BASE_URL}/streamer/submissions?status=pending&limit=5`,
    authParams(STREAMER_COOKIE)
  );
  logIfError(moderation, 'smoke-moderation');
  check(moderation, { 'moderation ok': (r) => r.status < 500 });

  const channel = http.get(
    `${BASE_URL}/public/channels/${PUBLIC_CHANNEL_SLUG}/memes?limit=5&cursor=`,
    authParams('')
  );
  logIfError(channel, 'smoke-channel');
  check(channel, { 'channel ok': (r) => r.status < 500 });
}










