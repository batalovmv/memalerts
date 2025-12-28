import { prisma } from '../lib/prisma.js';
import { logger } from './logger.js';

function isExpired(expiresAt: Date | null | undefined, skewSeconds: number): boolean {
  if (!expiresAt) return true;
  const msLeft = expiresAt.getTime() - Date.now();
  return msLeft <= skewSeconds * 1000;
}

export async function getValidTwitchAccessTokenByExternalAccountId(externalAccountId: string): Promise<string | null> {
  const id = String(externalAccountId || '').trim();
  if (!id) return null;

  const row = await prisma.externalAccount.findUnique({
    where: { id },
    select: { id: true, provider: true, accessToken: true, refreshToken: true, tokenExpiresAt: true, scopes: true },
  });
  if (!row) return null;
  if (row.provider !== 'twitch') return null;

  if (row.accessToken && !isExpired(row.tokenExpiresAt, 60)) {
    return row.accessToken;
  }

  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  if (!row.refreshToken) return null;

  try {
    const response = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: row.refreshToken,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      logger.warn('twitch.token.refresh_failed', { externalAccountId: id, status: response.status, body: text || null });
      return null;
    }

    const tokenData = await response.json();
    const accessToken = String(tokenData?.access_token || '').trim();
    if (!accessToken) return null;

    const refreshTokenNext = String(tokenData?.refresh_token || '').trim() || null;
    const expiresIn = Number(tokenData?.expires_in || 0);
    const tokenExpiresAt = Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null;
    const scopes = Array.isArray(tokenData?.scope) ? tokenData.scope.join(' ') : tokenData?.scope ? String(tokenData.scope) : null;

    await prisma.externalAccount.update({
      where: { id },
      data: {
        accessToken,
        tokenExpiresAt,
        scopes: scopes ?? row.scopes ?? null,
        ...(refreshTokenNext ? { refreshToken: refreshTokenNext } : {}),
      },
    });

    return accessToken;
  } catch (error: any) {
    logger.warn('twitch.token.refresh_failed', { externalAccountId: id, errorMessage: error?.message || String(error) });
    return null;
  }
}

export async function getValidTwitchBotAccessToken(): Promise<{ accessToken: string; login: string } | null> {
  try {
    const cred = await (prisma as any).globalTwitchBotCredential.findFirst({
      where: { enabled: true },
      orderBy: { updatedAt: 'desc' },
      select: { externalAccountId: true },
    });
    const externalAccountId = String((cred as any)?.externalAccountId || '').trim();
    if (!externalAccountId) return null;

    const ext = await prisma.externalAccount.findUnique({
      where: { id: externalAccountId },
      select: { id: true, provider: true, login: true },
    });
    const login = String(ext?.login || '').trim().toLowerCase();
    if (!ext || ext.provider !== 'twitch' || !login) return null;

    const accessToken = await getValidTwitchAccessTokenByExternalAccountId(externalAccountId);
    if (!accessToken) return null;
    return { accessToken, login };
  } catch (e: any) {
    if (e?.code !== 'P2021') {
      logger.warn('twitch.bot_token.db_credential_lookup_failed', { errorMessage: e?.message || String(e) });
    }
    return null;
  }
}

/**
 * Get valid access token for a user, refreshing if necessary
 */
export async function getValidAccessToken(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { twitchAccessToken: true, twitchRefreshToken: true },
  });

  if (!user || !user.twitchAccessToken) {
    return null;
  }

  // Verify token is still valid (optional: can add token validation here)
  // For now, we'll just return the token. In production, you might want to validate it.
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
    logger.warn('twitch.token.refresh_failed', { userId });
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
 * Get Twitch user info for the current user token (who is logged in).
 * Useful to detect "account mismatch" (trying to manage rewards for a different broadcaster).
 */
export async function getAuthenticatedTwitchUser(
  userId: string
): Promise<{ id: string; display_name?: string | null } | null> {
  const resp = await twitchApiRequest('users', 'GET', userId);
  const item = resp?.data?.[0];
  if (!item) return null;
  return { id: String(item.id), display_name: item.display_name ?? null };
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
 * Get broadcaster/channel information (used to detect affiliate/partner status).
 * Helix: GET /channels?broadcaster_id=...
 */
export async function getChannelInformation(
  userId: string,
  broadcasterId: string
): Promise<
  | {
      broadcaster_type?: string | null;
      _meta?: {
        tokenMode: 'user' | 'app';
        itemKeys?: string[];
        rawBroadcasterType?: unknown;
      };
    }
  | null
> {
  // NOTE:
  // Twitch affiliate/partner status is represented as `broadcaster_type` on Helix `users` endpoint.
  // The `channels` endpoint may not include this field (as observed on beta diagnostics).
  //
  // We keep the function name for backward-compat, but it now queries `users?id=...`.
  // Prefer user token (keeps behavior consistent), but fall back to app token when user token
  // is missing scopes/invalid. Eligibility should not depend on user scopes.
  try {
    const resp = await twitchApiRequest(`users?id=${broadcasterId}`, 'GET', userId);
    const item = resp?.data?.[0];
    if (!item) return null;
    return {
      broadcaster_type: item.broadcaster_type ?? null,
      _meta: {
        tokenMode: 'user',
        itemKeys: typeof item === 'object' && item ? Object.keys(item) : undefined,
        rawBroadcasterType: (item as any)?.broadcaster_type,
      },
    };
  } catch (e: any) {
    // Fall back to app access token
    const accessToken = await getAppAccessToken();
    const response = await fetch(`https://api.twitch.tv/helix/users?id=${broadcasterId}`, {
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
    const resp = await response.json();
    const item = resp?.data?.[0];
    if (!item) return null;
    return {
      broadcaster_type: item.broadcaster_type ?? null,
      _meta: {
        tokenMode: 'app',
        itemKeys: typeof item === 'object' && item ? Object.keys(item) : undefined,
        rawBroadcasterType: (item as any)?.broadcaster_type,
      },
    };
  }
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
 * Resolve Twitch channel login (lowercase) by broadcaster/user id.
 * Uses app access token (client_credentials), so it doesn't depend on user scopes.
 */
export async function getTwitchLoginByUserId(twitchUserId: string): Promise<string | null> {
  const id = String(twitchUserId || '').trim();
  if (!id) return null;
  const accessToken = await getAppAccessToken();
  const response = await fetch(`https://api.twitch.tv/helix/users?id=${encodeURIComponent(id)}`, {
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
  const resp = await response.json();
  const item = resp?.data?.[0];
  const login = String(item?.login || '').trim().toLowerCase();
  return login || null;
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
    const err = new Error(`Twitch API error: ${response.status} ${response.statusText} - ${errorText}`);
    (err as any).status = response.status;
    (err as any).body = errorText;
    throw err;
  }

  return response.json();
}

/**
 * Create EventSub subscription (generic).
 * Note: EventSub subscriptions require app access token, not user access token.
 */
export async function createEventSubSubscriptionOfType(opts: {
  type: string;
  version?: string;
  broadcasterId: string;
  webhookUrl: string;
  secret: string;
}): Promise<any> {
  const accessToken = await getAppAccessToken();
  const version = String(opts.version || '1');

  const response = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
    method: 'POST',
    headers: {
      'Client-ID': process.env.TWITCH_CLIENT_ID!,
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: opts.type,
      version,
      condition: {
        broadcaster_user_id: opts.broadcasterId,
      },
      transport: {
        method: 'webhook',
        callback: opts.webhookUrl,
        secret: opts.secret,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const err = new Error(`Twitch API error: ${response.status} ${response.statusText} - ${errorText}`);
    (err as any).status = response.status;
    (err as any).body = errorText;
    throw err;
  }

  return response.json();
}

export async function createStreamOnlineEventSubSubscription(opts: {
  broadcasterId: string;
  webhookUrl: string;
  secret: string;
}): Promise<any> {
  return createEventSubSubscriptionOfType({
    type: 'stream.online',
    version: '1',
    broadcasterId: opts.broadcasterId,
    webhookUrl: opts.webhookUrl,
    secret: opts.secret,
  });
}

export async function createStreamOfflineEventSubSubscription(opts: {
  broadcasterId: string;
  webhookUrl: string;
  secret: string;
}): Promise<any> {
  return createEventSubSubscriptionOfType({
    type: 'stream.offline',
    version: '1',
    broadcasterId: opts.broadcasterId,
    webhookUrl: opts.webhookUrl,
    secret: opts.secret,
  });
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

/**
 * Delete an EventSub subscription by id (requires app access token)
 */
export async function deleteEventSubSubscription(subscriptionId: string): Promise<void> {
  const accessToken = await getAppAccessToken();

  const url = new URL('https://api.twitch.tv/helix/eventsub/subscriptions');
  url.searchParams.set('id', subscriptionId);

  const response = await fetch(url.toString(), {
    method: 'DELETE',
    headers: {
      'Client-ID': process.env.TWITCH_CLIENT_ID!,
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  // Twitch returns 204 No Content on success
  if (!response.ok && response.status !== 204) {
    const errorText = await response.text();
    throw new Error(`Twitch API error: ${response.status} ${response.statusText} - ${errorText}`);
  }
}
