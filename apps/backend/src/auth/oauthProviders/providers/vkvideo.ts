import crypto from 'crypto';
import { createOAuthState } from '../../oauthState.js';
import {
  exchangeVkVideoCodeForToken,
  fetchVkVideoUser,
  generatePkceVerifier,
  getVkVideoAuthorizeUrl,
  pkceChallengeS256,
} from '../../providers/vkvideo.js';
import { fetchVkVideoCurrentUser } from '../../../utils/vkvideoApi.js';
import { logger } from '../../../utils/logger.js';
import { OAuthProviderError } from '../errors.js';
import type { OAuthProvider } from '../types.js';
import { asRecord, decodeJwtPayloadNoVerify } from '../utils.js';

function parseScopes(raw: string): string[] {
  return String(raw || '')
    .split(/[ ,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function resolveScopes(kind: 'link' | 'bot_link' | 'login'): string[] {
  if (kind === 'bot_link') {
    return parseScopes(String(process.env.VKVIDEO_BOT_SCOPES || process.env.VKVIDEO_SCOPES || ''));
  }
  return parseScopes(String(process.env.VKVIDEO_SCOPES || ''));
}

export const vkVideoOAuthProvider: OAuthProvider = {
  id: 'vkvideo',
  supportsLogin: false,
  supportsLink: true,
  supportsBotLink: true,
  async buildAuthorizeUrl(params) {
    const clientId = process.env.VKVIDEO_CLIENT_ID;
    const callbackUrl = process.env.VKVIDEO_CALLBACK_URL;
    const authorizeUrl = process.env.VKVIDEO_AUTHORIZE_URL;
    const tokenUrl = process.env.VKVIDEO_TOKEN_URL;
    if (!clientId || !callbackUrl || !authorizeUrl || !tokenUrl) {
      throw new OAuthProviderError('VKVideo OAuth not configured', {
        reason: 'missing_oauth_env',
        provider: 'vkvideo',
        includeProviderParam: true,
      });
    }

    const codeVerifier = generatePkceVerifier();
    const codeChallenge = pkceChallengeS256(codeVerifier);

    const { state, expiresAt } = await createOAuthState({
      provider: 'vkvideo',
      kind: params.kind,
      userId: params.userId,
      channelId: params.channelId,
      redirectTo: params.redirectTo,
      origin: params.origin,
      codeVerifier,
    });

    const ttlMs = Math.max(0, expiresAt.getTime() - Date.now());
    const verifierHash = crypto.createHash('sha256').update(codeVerifier).digest('hex').slice(0, 12);
    logger.info('oauth.vkvideo.link.start', {
      provider: 'vkvideo',
      userId: params.userId,
      flow: params.kind,
      redirect_to: params.redirectTo,
      state: state.slice(0, 12),
      state_ttl_ms: ttlMs,
      state_storage: 'db:OAuthState',
      code_challenge_method: 'S256',
      code_verifier_saved: true,
      code_verifier_hash: verifierHash,
    });

    const scopes = resolveScopes(params.kind);
    const authUrl = getVkVideoAuthorizeUrl({
      authorizeUrl,
      clientId,
      redirectUri: callbackUrl,
      state,
      scopes,
      codeChallenge,
    });

    return { authUrl };
  },
  async exchangeCode(params) {
    const clientId = process.env.VKVIDEO_CLIENT_ID!;
    const callbackUrl = process.env.VKVIDEO_CALLBACK_URL!;
    const tokenUrl = process.env.VKVIDEO_TOKEN_URL!;
    const clientSecret = process.env.VKVIDEO_CLIENT_SECRET;
    if (!clientSecret) {
      throw new OAuthProviderError('VKVideo OAuth not configured', {
        reason: 'missing_oauth_env',
        provider: 'vkvideo',
      });
    }

    const tokenExchange = await exchangeVkVideoCodeForToken({
      tokenUrl,
      clientId,
      clientSecret,
      code: params.code,
      redirectUri: callbackUrl,
      codeVerifier: params.stateCodeVerifier || null,
    });

    logger.info('oauth.vkvideo.callback.token_exchange', {
      provider: 'vkvideo',
      status: tokenExchange.status,
      ok: tokenExchange.status >= 200 && tokenExchange.status < 300,
      has_access_token: !!tokenExchange.data?.access_token,
      error: tokenExchange.data?.error,
      error_description: tokenExchange.data?.error_description,
    });
    if (tokenExchange.status >= 400) {
      logger.error('oauth.vkvideo.callback.token_exchange_error', {
        provider: 'vkvideo',
        status: tokenExchange.status,
        body: tokenExchange.raw,
      });
    }

    if (!tokenExchange.data.access_token) {
      throw new OAuthProviderError('No access token received from VKVideo', {
        reason: 'no_token',
        provider: 'vkvideo',
      });
    }

    const accessToken = tokenExchange.data.access_token;
    const refreshToken = tokenExchange.data.refresh_token || null;
    const tokenExpiresAt = tokenExchange.data.expires_in
      ? new Date(Date.now() + tokenExchange.data.expires_in * 1000)
      : null;
    const scopes =
      (Array.isArray(tokenExchange.data.scope) ? tokenExchange.data.scope.join(' ') : tokenExchange.data.scope) || null;

    const userInfoUrl = process.env.VKVIDEO_USERINFO_URL || null;
    const userFetch = await fetchVkVideoUser({ userInfoUrl, accessToken: tokenExchange.data.access_token });
    const vkVideoUser = userFetch.user;

    logger.info('oauth.vkvideo.callback.userinfo', {
      provider: 'vkvideo',
      status: userFetch.status,
      ok: userFetch.status === 0 ? null : userFetch.status >= 200 && userFetch.status < 300,
      has_user: !!vkVideoUser,
    });
    if (userFetch.status >= 200 && userFetch.status < 300 && !vkVideoUser) {
      const raw = userFetch.raw;
      const topKeys = raw && typeof raw === 'object' ? Object.keys(raw).slice(0, 30) : null;
      const rawRec = asRecord(raw);
      const nestedKeys =
        raw && typeof raw === 'object'
          ? Object.keys(asRecord(rawRec.user ?? rawRec.data ?? rawRec.response ?? rawRec.result)).slice(0, 30)
          : null;
      logger.warn('oauth.vkvideo.callback.userinfo_unmapped', {
        provider: 'vkvideo',
        status: userFetch.status,
        top_keys: topKeys,
        nested_keys: nestedKeys,
      });
    }
    if (userFetch.status >= 400) {
      logger.error('oauth.vkvideo.callback.userinfo_error', {
        provider: 'vkvideo',
        status: userFetch.status,
        body: userFetch.raw,
      });
    }

    const tokenUserId = String(tokenExchange.data.sub ?? tokenExchange.data.user_id ?? '').trim();
    let providerAccountId = String(vkVideoUser?.id || tokenUserId).trim();

    if (!providerAccountId) {
      const jwtPayload = decodeJwtPayloadNoVerify(tokenExchange.data.access_token);
      const jwtSub = String(jwtPayload?.sub ?? '').trim();
      logger.info('oauth.vkvideo.callback.access_token_claims', {
        provider: 'vkvideo',
        has_jwt_payload: !!jwtPayload,
        jwt_sub_present: !!jwtSub,
        jwt_sub_preview: jwtSub ? jwtSub.slice(0, 24) : null,
        jwt_keys: jwtPayload && typeof jwtPayload === 'object' ? Object.keys(jwtPayload).slice(0, 12) : null,
      });
      if (jwtSub) providerAccountId = jwtSub;
    }

    if (!providerAccountId) {
      throw new OAuthProviderError('No user data received from VKVideo', { reason: 'no_user', provider: 'vkvideo' });
    }

    let displayName = vkVideoUser?.displayName || null;
    let login = vkVideoUser?.login || null;
    let avatarUrl = vkVideoUser?.avatarUrl || null;
    let profileUrl = vkVideoUser?.profileUrl || null;

    try {
      const normalizeProfileUrl = (raw: string | null | undefined): { slug: string | null; url: string | null } => {
        const s = String(raw || '').trim();
        if (!s) return { slug: null, url: null };
        if (/^https?:\/\//i.test(s)) {
          try {
            const u = new URL(s);
            const parts = u.pathname
              .split('/')
              .map((p) => p.trim())
              .filter(Boolean);
            const last = parts[parts.length - 1] || '';
            return { slug: last ? decodeURIComponent(last) : null, url: s };
          } catch {
            return { slug: null, url: s };
          }
        }
        const slug = s.replace(/^\/+/, '').replace(/^@/, '').trim();
        return { slug: slug || null, url: slug ? `https://live.vkvideo.ru/${slug}` : null };
      };

      const currentUser = await fetchVkVideoCurrentUser({ accessToken });
      if (currentUser.ok) {
        const currentUserData = asRecord(currentUser.data);
        const rootCandidate = asRecord(currentUserData.data ?? currentUserData);
        const root = Object.keys(rootCandidate).length > 0 ? rootCandidate : null;
        const fallbackRoot = root ?? asRecord(currentUserData);
        const uCandidate = asRecord(root?.user ?? root?.profile ?? fallbackRoot ?? {});
        const u = Object.keys(uCandidate).length > 0 ? uCandidate : null;
        const rootChannel = root ? asRecord(root.channel) : {};
        const uChannel = u ? asRecord(u.channel) : {};
        const channelUrlRaw = String(rootChannel.url || uChannel.url || u?.url || '').trim() || null;
        const normalized = normalizeProfileUrl(channelUrlRaw);

        if (!profileUrl && normalized.url) profileUrl = normalized.url;
        if (!login && normalized.slug) login = normalized.slug;

        const nameFromParts = String([u?.first_name, u?.last_name].filter(Boolean).join(' ')).trim() || null;
        const name =
          String(u?.display_name ?? u?.displayName ?? u?.name ?? u?.full_name ?? u?.nickname ?? u?.username ?? '').trim() ||
          nameFromParts ||
          null;
        if (!displayName && name) displayName = name;
      }
    } catch {
      // ignore
    }

    if (!displayName && login) displayName = login;

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
