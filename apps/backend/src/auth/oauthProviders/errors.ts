import type { ExternalAccountProvider } from '@prisma/client';

export class OAuthProviderError extends Error {
  readonly reason: string;
  readonly provider?: ExternalAccountProvider;
  readonly includeProviderParam: boolean;

  constructor(
    message: string,
    options: {
      reason: string;
      provider?: ExternalAccountProvider;
      includeProviderParam?: boolean;
    }
  ) {
    super(message);
    this.name = 'OAuthProviderError';
    this.reason = options.reason;
    this.provider = options.provider;
    this.includeProviderParam = Boolean(options.includeProviderParam);
  }
}
