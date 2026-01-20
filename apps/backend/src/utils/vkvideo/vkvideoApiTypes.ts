export type VkVideoChannelResponse = {
  data?: {
    stream?: {
      id?: string | number | null;
    } | null;
    channel?: {
      web_socket_channels?: unknown;
    } | null;
  } | null;
};

export type VkVideoWebsocketTokenResponse = {
  data?: {
    token?: string | null;
  } | null;
};

export type VkVideoWebsocketSubscriptionTokensResponse = {
  data?: {
    channel_tokens?: Array<{
      channel?: string | null;
      token?: string | null;
    }> | null;
  } | null;
};
