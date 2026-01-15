export type TwitchTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string[] | string;
};

export type TwitchHelixResponse<T> = {
  data?: T[];
  pagination?: { cursor?: string };
  [key: string]: unknown;
};

export type TwitchReward = {
  id?: string;
  title?: string;
  cost?: number;
  is_enabled?: boolean;
  image?: {
    url_1x?: string;
    url_2x?: string;
    url_4x?: string;
  } | null;
  [key: string]: unknown;
};

export type TwitchUser = {
  id?: string;
  display_name?: string;
  broadcaster_type?: string;
  login?: string;
  [key: string]: unknown;
};

export type TwitchRequestError = Error & { status?: number; body?: string };
