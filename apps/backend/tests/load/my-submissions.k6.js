import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, VIEWER_COOKIE, authParams, logIfError } from './helpers.js';

export const mySubmissionsScenarioConfig = {
  executor: 'constant-arrival-rate',
  rate: 20,
  timeUnit: '1s',
  duration: '60s',
  preAllocatedVUs: 20,
  maxVUs: 200,
};

export const mySubmissionsThresholds = {
  http_req_failed: ['rate<0.01'],
  http_req_duration: ['p(95)<300'],
};

export function mySubmissionsScenarioHandler() {
  const res = http.get(`${BASE_URL}/submissions/mine?limit=50`, authParams(VIEWER_COOKIE));
  logIfError(res, 'my-submissions');
  check(res, {
    'status 200': (r) => r.status === 200,
    'items payload': (r) => Array.isArray(r.json()?.items),
  });
}

export const options = {
  scenarios: {
    mySubmissions: {
      ...mySubmissionsScenarioConfig,
      exec: 'mySubmissionsScenarioHandler',
    },
  },
  thresholds: mySubmissionsThresholds,
};

export default function () {
  mySubmissionsScenarioHandler();
}









