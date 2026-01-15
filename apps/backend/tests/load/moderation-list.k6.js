import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, STREAMER_COOKIE, authParams, logIfError } from './helpers.js';

const MODERATION_ENDPOINT = 'moderation-list';

export const moderationScenarioConfig = {
  executor: 'constant-arrival-rate',
  rate: 20,
  timeUnit: '1s',
  duration: '60s',
  preAllocatedVUs: 20,
  maxVUs: 200,
};

export const moderationThresholds = {
  [`http_req_failed{endpoint:${MODERATION_ENDPOINT}}`]: ['rate<0.01'],
  [`http_req_duration{endpoint:${MODERATION_ENDPOINT}}`]: ['p(95)<300'],
};

export function moderationScenarioHandler() {
  const res = http.get(
    `${BASE_URL}/streamer/submissions?status=pending&limit=50`,
    authParams(STREAMER_COOKIE, { endpoint: MODERATION_ENDPOINT })
  );
  logIfError(res, 'moderation');
  check(res, {
    'status 200': (r) => r.status === 200,
    'has items': (r) => Array.isArray(r.json()?.items),
  });
}

export const options = {
  scenarios: {
    moderation: {
      ...moderationScenarioConfig,
      exec: 'moderationScenarioHandler',
    },
  },
  thresholds: moderationThresholds,
};

export default function () {
  moderationScenarioHandler();
}









