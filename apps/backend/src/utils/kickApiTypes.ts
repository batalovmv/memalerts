export type KickEventSubscriptionResponse = {
  data?: {
    subscription_id?: string | number | null;
    id?: string | number | null;
  } | null;
  subscription_id?: string | number | null;
  id?: string | number | null;
};

export type KickEventSubscriptionsResponse = {
  data?: {
    subscriptions?: unknown;
  } | null;
  subscriptions?: unknown;
};
