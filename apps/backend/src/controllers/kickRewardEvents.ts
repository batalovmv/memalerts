import { handleKickAutoRewardEvents, AUTO_REWARD_EVENT_TYPES } from './kickRewardAutoEvents.js';
import { handleKickRewardRedemption } from './kickRewardRedemption.js';
import type { KickWebhookRequest } from './kickWebhookShared.js';

export async function handleKickRewardEvents(params: {
  req: KickWebhookRequest;
  payload: unknown;
  eventType: string;
  messageId: string;
}): Promise<{ httpStatus: number; body: Record<string, unknown> }> {
  if (AUTO_REWARD_EVENT_TYPES.has(params.eventType)) {
    return handleKickAutoRewardEvents(params);
  }
  return handleKickRewardRedemption({ payload: params.payload, messageId: params.messageId });
}
