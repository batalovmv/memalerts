import type { AuthRequest } from '../../middleware/auth.js';
import type { ExternalAccountProvider, OAuthStateKind } from '@prisma/client';

export type OAuthAuthorizeParams = {
  kind: OAuthStateKind;
  userId?: string | null;
  channelId?: string | null;
  redirectTo?: string | null;
  origin?: string | null;
  scopeHint?: 'force_ssl';
  req?: AuthRequest;
};

export type OAuthAuthorizeResult = {
  authUrl: string;
};

export type OAuthProfile = {
  providerAccountId: string;
  displayName: string | null;
  login: string | null;
  avatarUrl: string | null;
  profileUrl: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  scopes: string | null;
};

export type OAuthCallbackParams = {
  code: string;
  req: AuthRequest;
  stateKind?: OAuthStateKind;
  statePreview?: string;
  stateCodeVerifier?: string | null;
  stateUserId?: string;
  stateOrigin?: string;
};

export interface OAuthProvider {
  id: ExternalAccountProvider;
  aliases?: string[];
  supportsLogin: boolean;
  supportsLink: boolean;
  supportsBotLink: boolean;
  buildAuthorizeUrl(params: OAuthAuthorizeParams): Promise<OAuthAuthorizeResult>;
  exchangeCode(params: OAuthCallbackParams): Promise<OAuthProfile>;
}
