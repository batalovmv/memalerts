import { moderationScenarioHandler } from './moderation-list.k6.js';
import { mySubmissionsScenarioHandler } from './my-submissions.k6.js';
import { channelMemesScenarioHandler } from './channel-memes.k6.js';

const spikeStages = [
  { target: 10, duration: '30s' },
  { target: 80, duration: '30s' },
  { target: 10, duration: '30s' },
  { target: 0, duration: '30s' },
];

const spikeScenarioConfig = {
  executor: 'ramping-arrival-rate',
  startRate: 5,
  timeUnit: '1s',
  stages: spikeStages,
  preAllocatedVUs: 30,
  maxVUs: 300,
};

export const options = {
  scenarios: {
    moderation: {
      ...spikeScenarioConfig,
      exec: 'moderationScenario',
    },
    mySubmissions: {
      ...spikeScenarioConfig,
      exec: 'mySubmissionsScenario',
    },
    channelMemes: {
      ...spikeScenarioConfig,
      exec: 'channelMemesScenario',
    },
  },
  thresholds: {
    'http_req_failed{endpoint:moderation-list}': ['rate<0.03'],
    'http_req_duration{endpoint:moderation-list}': ['p(95)<1000'],
    'http_req_failed{endpoint:my-submissions}': ['rate<0.03'],
    'http_req_duration{endpoint:my-submissions}': ['p(95)<1000'],
    'http_req_failed{endpoint:channel-memes}': ['rate<0.03'],
    'http_req_duration{endpoint:channel-memes}': ['p(95)<800'],
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
