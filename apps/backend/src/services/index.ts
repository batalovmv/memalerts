import type { RepositoryContext } from '../repositories/types.js';
import { repositories } from '../repositories/index.js';
import { createSubmissionService, type SubmissionService } from './SubmissionService.js';
import { createRewardService, type RewardService } from './RewardService.js';
import { createAiModerationService, type AiModerationService } from './AiModerationService.js';
import { createMemeService, type MemeService } from './MemeService.js';
import { createBotService, type BotService } from './BotService.js';

export type ServiceContext = {
  submissions: SubmissionService;
  rewards: RewardService;
  aiModeration: AiModerationService;
  memes: MemeService;
  bots: BotService;
};

export function createServiceContext(repos: RepositoryContext): ServiceContext {
  return {
    submissions: createSubmissionService(repos),
    rewards: createRewardService(),
    aiModeration: createAiModerationService(),
    memes: createMemeService(),
    bots: createBotService(),
  };
}

export const services = createServiceContext(repositories);
