import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, PUBLIC_CHANNEL_SLUG, authParams, logIfError } from './helpers.js';

const CHANNEL_MEMES_ENDPOINT = 'channel-memes';

export const channelMemesScenarioConfig = {
  executor: 'constant-arrival-rate',
  rate: 50,
  timeUnit: '1s',
  duration: '60s',
  preAllocatedVUs: 40,
  maxVUs: 400,
};

export const channelMemesThresholds = {
  [`http_req_failed{endpoint:${CHANNEL_MEMES_ENDPOINT}}`]: ['rate<0.01'],
  [`http_req_duration{endpoint:${CHANNEL_MEMES_ENDPOINT}}`]: ['p(95)<200'],
};

export function channelMemesScenarioHandler() {
  const res = http.get(
    `${BASE_URL}/public/channels/${PUBLIC_CHANNEL_SLUG}/memes?limit=50&cursor=`,
    authParams('', { endpoint: CHANNEL_MEMES_ENDPOINT })
  );
  logIfError(res, 'channel-memes');
  const body = res.json();
  check(res, {
    'status 200': (r) => r.status === 200,
    'payload items': () => Array.isArray(body?.items),
  });
}

export const options = {
  scenarios: {
    channelMemes: {
      ...channelMemesScenarioConfig,
      exec: 'channelMemesScenarioHandler',
    },
  },
  thresholds: channelMemesThresholds,
};

export default function () {
  channelMemesScenarioHandler();
}










