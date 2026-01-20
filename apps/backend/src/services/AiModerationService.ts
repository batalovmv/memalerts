import { processOneSubmission } from './aiModeration/processOneSubmission.js';

export { processOneSubmission };

export type AiModerationService = {
  processOneSubmission: typeof processOneSubmission;
};

export const createAiModerationService = (): AiModerationService => ({
  processOneSubmission,
});
