import {
  moderationScenarioConfig,
  moderationScenarioHandler,
} from './moderation-list.k6.js';
import {
  mySubmissionsScenarioConfig,
  mySubmissionsScenarioHandler,
} from './my-submissions.k6.js';
import {
  channelMemesScenarioConfig,
  channelMemesScenarioHandler,
} from './channel-memes.k6.js';

export const options = {
  scenarios: {
    moderation: {
      ...moderationScenarioConfig,
      exec: 'moderationScenario',
    },
    mySubmissions: {
      ...mySubmissionsScenarioConfig,
      exec: 'mySubmissionsScenario',
    },
    channelMemes: {
      ...channelMemesScenarioConfig,
      exec: 'channelMemesScenario',
    },
  },
  thresholds: {
    'http_req_failed{scenario:moderation}': ['rate<0.01'],
    'http_req_failed{scenario:mySubmissions}': ['rate<0.01'],
    'http_req_failed{scenario:channelMemes}': ['rate<0.01'],
    'http_req_duration{scenario:moderation}': ['p(95)<300'],
    'http_req_duration{scenario:mySubmissions}': ['p(95)<300'],
    'http_req_duration{scenario:channelMemes}': ['p(95)<200'],
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









