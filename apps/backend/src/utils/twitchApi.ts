import { prisma } from '../lib/prisma.js';

/**
 * Get valid access token for a user, refreshing if necessary
 */
export async function getValidAccessToken(userId: string): Promise<string | null> {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'twitchApi.ts:6',message:'getValidAccessToken called',data:{userId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { twitchAccessToken: true, twitchRefreshToken: true },
  });

  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'twitchApi.ts:12',message:'User fetched from DB',data:{userFound:!!user,hasAccessToken:!!user?.twitchAccessToken,hasRefreshToken:!!user?.twitchRefreshToken},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion

  if (!user || !user.twitchAccessToken) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'twitchApi.ts:18',message:'No valid token found',data:{userExists:!!user,hasToken:!!user?.twitchAccessToken},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    return null;
  }

  // Verify token is still valid (optional: can add token validation here)
  // For now, we'll just return the token. In production, you might want to validate it.
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'twitchApi.ts:24',message:'Returning valid token',data:{tokenLength:user.twitchAccessToken.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  return user.twitchAccessToken;
}

/**
 * Refresh access token using refresh token
 */
export async function refreshAccessToken(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { twitchRefreshToken: true },
  });

  if (!user || !user.twitchRefreshToken) {
    return null;
  }

  try {
    const response = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: process.env.TWITCH_CLIENT_ID!,
        client_secret: process.env.TWITCH_CLIENT_SECRET!,
        grant_type: 'refresh_token',
        refresh_token: user.twitchRefreshToken,
      }),
    });

    if (!response.ok) {
      return null;
    }

    const tokenData = await response.json();

    // Update user with new tokens
    await prisma.user.update({
      where: { id: userId },
      data: {
        twitchAccessToken: tokenData.access_token,
        twitchRefreshToken: tokenData.refresh_token || null,
      },
    });

    return tokenData.access_token;
  } catch (error) {
    console.error('Error refreshing token:', error);
    return null;
  }
}

/**
 * Make a request to Twitch API with automatic token refresh
 */
async function twitchApiRequest(
  endpoint: string,
  method: string,
  userId: string,
  body?: any
): Promise<any> {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'twitchApi.ts:72',message:'twitchApiRequest called',data:{endpoint,method,userId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
  // #endregion

  let accessToken = await getValidAccessToken(userId);
  if (!accessToken) {
    // Try to refresh
    accessToken = await refreshAccessToken(userId);
    if (!accessToken) {
      throw new Error('No valid access token available');
    }
  }

  const url = `https://api.twitch.tv/helix/${endpoint}`;
  const options: RequestInit = {
    method,
    headers: {
      'Client-ID': process.env.TWITCH_CLIENT_ID!,
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  };

  if (body && (method === 'POST' || method === 'PATCH' || method === 'PUT')) {
    options.body = JSON.stringify(body);
  }

  let response = await fetch(url, options);

  // If 401, try refreshing token once
  if (response.status === 401) {
    accessToken = await refreshAccessToken(userId);
    if (accessToken) {
      options.headers = {
        ...options.headers,
        'Authorization': `Bearer ${accessToken}`,
      };
      const retryResponse = await fetch(url, options);
      if (!retryResponse.ok) {
        throw new Error(`Twitch API error: ${retryResponse.status} ${retryResponse.statusText}`);
      }
      return retryResponse.json();
    }
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Twitch API error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  return response.json();
}

/**
 * Create a custom channel point reward
 */
export async function createChannelReward(
  userId: string,
  broadcasterId: string,
  title: string,
  cost: number,
  prompt?: string
): Promise<any> {
  return twitchApiRequest(
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

/**
 * Update a custom channel point reward
 */
export async function updateChannelReward(
  userId: string,
  broadcasterId: string,
  rewardId: string,
  updates: any
): Promise<any> {
  return twitchApiRequest(
    `channel_points/custom_rewards?broadcaster_id=${broadcasterId}&id=${rewardId}`,
    'PATCH',
    userId,
    updates
  );
}

/**
 * Delete a custom channel point reward
 */
export async function deleteChannelReward(
  userId: string,
  broadcasterId: string,
  rewardId: string
): Promise<void> {
  try {
    await twitchApiRequest(
      `channel_points/custom_rewards?broadcaster_id=${broadcasterId}&id=${rewardId}`,
      'DELETE',
      userId
    );
  } catch (error: any) {
    // DELETE returns 204 No Content, which might cause JSON parse error
    // Check if it's actually a success (204) or a real error
    if (error.message?.includes('Unexpected end of JSON input') || error.message?.includes('204')) {
      // This is expected for DELETE requests - 204 No Content means success
      return;
    }
    throw error;
  }
}

/**
 * Get custom channel point rewards
 */
export async function getChannelRewards(
  userId: string,
  broadcasterId: string,
  rewardId?: string
): Promise<any> {
  const endpoint = rewardId
    ? `channel_points/custom_rewards?broadcaster_id=${broadcasterId}&id=${rewardId}`
    : `channel_points/custom_rewards?broadcaster_id=${broadcasterId}`;
  return twitchApiRequest(endpoint, 'GET', userId);
}

/**
 * Get app access token for EventSub subscriptions
 */
async function getAppAccessToken(): Promise<string> {
  const response = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: process.env.TWITCH_CLIENT_ID!,
      client_secret: process.env.TWITCH_CLIENT_SECRET!,
      grant_type: 'client_credentials',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to get app access token: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  return data.access_token;
}

/**
 * Create EventSub subscription for channel point reward redemptions
 * Note: EventSub subscriptions require app access token, not user access token
 */
export async function createEventSubSubscription(
  userId: string,
  broadcasterId: string,
  webhookUrl: string,
  secret: string
): Promise<any> {
  // Use app access token for EventSub subscriptions
  const accessToken = await getAppAccessToken();

  const response = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
    method: 'POST',
    headers: {
      'Client-ID': process.env.TWITCH_CLIENT_ID!,
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'channel.channel_points_custom_reward_redemption.add',
      version: '1',
      condition: {
        broadcaster_user_id: broadcasterId,
      },
      transport: {
        method: 'webhook',
        callback: webhookUrl,
        secret: secret,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    // If subscription already exists, that's fine - return success
    if (response.status === 409 && errorText.includes('already exists')) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'twitchApi.ts:308',message:'Subscription already exists, treating as success',data:{broadcasterId,webhookUrl},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'M'})}).catch(()=>{});
      // #endregion
      return { data: [{ id: 'existing', status: 'enabled' }] };
    }
    throw new Error(`Twitch API error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  return response.json();
}

/**
 * Get existing EventSub subscriptions for a broadcaster
 */
export async function getEventSubSubscriptions(broadcasterId: string): Promise<any> {
  const accessToken = await getAppAccessToken();

  const response = await fetch(`https://api.twitch.tv/helix/eventsub/subscriptions?user_id=${broadcasterId}`, {
    method: 'GET',
    headers: {
      'Client-ID': process.env.TWITCH_CLIENT_ID!,
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Twitch API error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  return response.json();
}
