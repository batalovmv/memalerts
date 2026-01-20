import { createOAuthState } from '../../oauthState.js';
import { exchangeDiscordCodeForToken, fetchDiscordUser, getDiscordAuthorizeUrl } from '../../providers/discord.js';
import { addDiscordGuildMember } from '../../../utils/discordApi.js';
import { OAuthProviderError } from '../errors.js';
import type { OAuthProvider } from '../types.js';
import { asRecord } from '../utils.js';

function parseScopes(raw: string): string[] {
  return String(raw || '')
    .split(/[ ,+]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export const discordOAuthProvider: OAuthProvider = {
  id: 'discord',
  supportsLogin: false,
  supportsLink: true,
  supportsBotLink: false,
  async buildAuthorizeUrl(params) {
    const clientId = process.env.DISCORD_CLIENT_ID;
    const callbackUrl = process.env.DISCORD_CALLBACK_URL;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;
    if (!clientId || !callbackUrl || !clientSecret) {
      throw new OAuthProviderError('Discord OAuth not configured', {
        reason: 'missing_oauth_env',
        provider: 'discord',
        includeProviderParam: true,
      });
    }

    const { state } = await createOAuthState({
      provider: 'discord',
      kind: params.kind,
      userId: params.userId,
      channelId: params.channelId,
      redirectTo: params.redirectTo,
      origin: params.origin,
    });

    const scopes = parseScopes(String(process.env.DISCORD_JOIN_SCOPES || ''));
    if (!scopes.includes('identify')) scopes.unshift('identify');
    const autoJoinEnabledRaw = String(process.env.DISCORD_AUTO_JOIN_GUILD || '').toLowerCase();
    const autoJoinEnabled = autoJoinEnabledRaw === '1' || autoJoinEnabledRaw === 'true' || autoJoinEnabledRaw === 'yes';
    const defaultGuildId =
      String(process.env.DISCORD_DEFAULT_SUBSCRIPTIONS_GUILD_ID || '').trim() ||
      String(process.env.DISCORD_SUBSCRIPTIONS_GUILD_ID || '').trim();
    if (autoJoinEnabled && defaultGuildId && process.env.DISCORD_BOT_TOKEN) {
      if (!scopes.includes('guilds.join')) scopes.push('guilds.join');
    }

    const authUrl = getDiscordAuthorizeUrl({
      clientId,
      redirectUri: callbackUrl,
      state,
      scopes,
    });

    return { authUrl };
  },
  async exchangeCode(params) {
    const clientId = process.env.DISCORD_CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;
    const callbackUrl = process.env.DISCORD_CALLBACK_URL;
    if (!clientId || !clientSecret || !callbackUrl) {
      throw new OAuthProviderError('Discord OAuth not configured', {
        reason: 'missing_oauth_env',
        provider: 'discord',
        includeProviderParam: true,
      });
    }

    const tokenExchange = await exchangeDiscordCodeForToken({
      clientId,
      clientSecret,
      code: params.code,
      redirectUri: callbackUrl,
      tokenUrl: process.env.DISCORD_TOKEN_URL || undefined,
    });

    if (!tokenExchange.data?.access_token) {
      throw new OAuthProviderError('No access token received from Discord', {
        reason: 'no_token',
        provider: 'discord',
        includeProviderParam: true,
      });
    }

    const accessToken = String(tokenExchange.data.access_token || '').trim() || null;
    const refreshToken = String(tokenExchange.data.refresh_token || '').trim() || null;
    const expiresIn = Number(tokenExchange.data.expires_in || 0);
    const tokenExpiresAt = Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null;
    const scopes = tokenExchange.data.scope ? String(tokenExchange.data.scope) : null;

    const userFetch = await fetchDiscordUser({
      accessToken: String(tokenExchange.data.access_token),
      userInfoUrl: process.env.DISCORD_USERINFO_URL || undefined,
    });

    const u = userFetch.user;
    const providerAccountId = String(u?.id ?? '').trim();
    if (!providerAccountId) {
      throw new OAuthProviderError('No user data received from Discord', {
        reason: 'no_user',
        provider: 'discord',
        includeProviderParam: true,
      });
    }

    const uRec = asRecord(u);
    const username = String(uRec.username ?? '').trim() || null;
    const globalName = String(uRec.global_name ?? '').trim() || null;
    const displayName = globalName || username || null;
    const login = username;

    const avatar = String(uRec.avatar ?? '').trim() || null;
    const avatarUrl = avatar ? `https://cdn.discordapp.com/avatars/${providerAccountId}/${avatar}.png?size=256` : null;
    const profileUrl = `https://discord.com/users/${encodeURIComponent(providerAccountId)}`;

    const autoJoinEnabledRaw = String(process.env.DISCORD_AUTO_JOIN_GUILD || '').toLowerCase();
    const autoJoinEnabled = autoJoinEnabledRaw === '1' || autoJoinEnabledRaw === 'true' || autoJoinEnabledRaw === 'yes';
    const guildId =
      String(process.env.DISCORD_DEFAULT_SUBSCRIPTIONS_GUILD_ID || '').trim() ||
      String(process.env.DISCORD_SUBSCRIPTIONS_GUILD_ID || '').trim();
    const botToken = String(process.env.DISCORD_BOT_TOKEN || '').trim();
    if (autoJoinEnabled && guildId && botToken && accessToken) {
      try {
        await addDiscordGuildMember({
          botToken,
          guildId,
          userId: providerAccountId,
          userAccessToken: accessToken,
        });
      } catch {
        // ignore best-effort
      }
    }

    return {
      providerAccountId,
      displayName,
      login,
      avatarUrl,
      profileUrl,
      accessToken,
      refreshToken,
      tokenExpiresAt,
      scopes,
    };
  },
};
