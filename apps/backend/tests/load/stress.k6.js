import { moderationScenarioHandler } from './moderation-list.k6.js';
import {
  mySubmissionsScenarioHandler,
} from './my-submissions.k6.js';
import {
  channelMemesScenarioHandler,
} from './channel-memes.k6.js';

const stressStages = [
  { target: 20, duration: '2m' },
  { target: 40, duration: '3m' },
  { target: 60, duration: '3m' },
  { target: 60, duration: '2m' },
  { target: 0, duration: '1m' },
];

const stressScenarioConfig = {
  executor: 'ramping-arrival-rate',
  startRate: 5,
  timeUnit: '1s',
  stages: stressStages,
  preAllocatedVUs: 40,
  maxVUs: 400,
};

export const options = {
  scenarios: {
    moderation: {
      ...stressScenarioConfig,
      exec: 'moderationScenario',
    },
    mySubmissions: {
      ...stressScenarioConfig,
      exec: 'mySubmissionsScenario',
    },
    channelMemes: {
      ...stressScenarioConfig,
      exec: 'channelMemesScenario',
    },
  },
  thresholds: {
    'http_req_failed{endpoint:moderation-list}': ['rate<0.02'],
    'http_req_duration{endpoint:moderation-list}': ['p(95)<800'],
    'http_req_failed{endpoint:my-submissions}': ['rate<0.02'],
    'http_req_duration{endpoint:my-submissions}': ['p(95)<800'],
    'http_req_failed{endpoint:channel-memes}': ['rate<0.02'],
    'http_req_duration{endpoint:channel-memes}': ['p(95)<600'],
  },
};

export function moderationScenario() {
  moderationScenarioHandler();
}

export function mySubmissionsScenario() {
  mySubmissionsScenarioHandler();
}

export function channelMemesScenario() {
  channelMemesScenarioHandler();
}

export default function () {
  // scenarios drive execution; no-op default to satisfy k6.
}
