import {
  moderationScenarioConfig,
  moderationScenarioHandler,
  moderationThresholds,
} from './moderation-list.k6.js';
import {
  mySubmissionsScenarioConfig,
  mySubmissionsScenarioHandler,
  mySubmissionsThresholds,
} from './my-submissions.k6.js';
import {
  channelMemesScenarioConfig,
  channelMemesScenarioHandler,
  channelMemesThresholds,
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
    ...moderationThresholds,
    ...mySubmissionsThresholds,
    ...channelMemesThresholds,
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









