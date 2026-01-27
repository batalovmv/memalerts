import type { OpenApiContext } from '../context.js';
import { registerAdminPaths } from './admin.js';
import { registerAuthPaths } from './auth.js';
import { registerBetaPaths } from './beta.js';
import { registerDebugPaths } from './debug.js';
import { registerInternalPaths } from './internal.js';
import { registerModerationPaths } from './moderation.js';
import { registerOwnerPaths } from './owner.js';
import { registerPublicPaths } from './public.js';
import { registerStreamerPaths } from './streamer.js';
import { registerSubmissionsPaths } from './submissions.js';
import { registerSystemPaths } from './system.js';
import { registerTestPaths } from './test.js';
import { registerViewerPaths } from './viewer.js';
import { registerWebhookPaths } from './webhooks.js';

export function registerPaths(ctx: OpenApiContext) {
  registerSystemPaths(ctx);
  registerInternalPaths(ctx);
  registerDebugPaths(ctx);
  registerPublicPaths(ctx);
  registerAuthPaths(ctx);
  registerBetaPaths(ctx);
  registerViewerPaths(ctx);
  registerSubmissionsPaths(ctx);
  registerStreamerPaths(ctx);
  registerOwnerPaths(ctx);
  registerModerationPaths(ctx);
  registerWebhookPaths(ctx);
  registerAdminPaths(ctx);
  registerTestPaths(ctx);
}
