import type { TwitchHelixResponse, TwitchReward } from './twitchApiTypes.js';
import { twitchApiRequest } from './twitchApiRequest.js';

export async function createChannelReward(
  userId: string,
  broadcasterId: string,
  title: string,
  cost: number,
  prompt?: string
): Promise<TwitchHelixResponse<TwitchReward>> {
  return twitchApiRequest<TwitchHelixResponse<TwitchReward>>(
    `channel_points/custom_rewards?broadcaster_id=${broadcasterId}`,
    'POST',
    userId,
    {
      title,
      cost,
      prompt: prompt || title,
      is_enabled: true,
      is_user_input_required: false,
    }
  );
}

export async function updateChannelReward(
  userId: string,
  broadcasterId: string,
  rewardId: string,
  updates: Record<string, unknown>
): Promise<TwitchHelixResponse<TwitchReward>> {
  return twitchApiRequest<TwitchHelixResponse<TwitchReward>>(
    `channel_points/custom_rewards?broadcaster_id=${broadcasterId}&id=${rewardId}`,
    'PATCH',
    userId,
    updates
  );
}

export async function deleteChannelReward(userId: string, broadcasterId: string, rewardId: string): Promise<void> {
  try {
    await twitchApiRequest(
      `channel_points/custom_rewards?broadcaster_id=${broadcasterId}&id=${rewardId}`,
      'DELETE',
      userId
    );
  } catch (error) {
    const err = error as Error;
    if (err.message?.includes('Unexpected end of JSON input') || err.message?.includes('204')) {
      return;
    }
    throw error;
  }
}

export async function getChannelRewards(
  userId: string,
  broadcasterId: string,
  rewardId?: string
): Promise<TwitchHelixResponse<TwitchReward>> {
  const endpoint = rewardId
    ? `channel_points/custom_rewards?broadcaster_id=${broadcasterId}&id=${rewardId}`
    : `channel_points/custom_rewards?broadcaster_id=${broadcasterId}`;
  return twitchApiRequest<TwitchHelixResponse<TwitchReward>>(endpoint, 'GET', userId);
}
