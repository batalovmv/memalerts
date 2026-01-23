import { api } from '@/lib/api';

export type WalletListItem = {
  userId: string;
  channelId: string;
  balance: number;
  user: { displayName: string };
  channel: { name: string; slug: string };
};

export type WalletOptions = {
  channels: Array<{ id: string; name: string; slug: string }>;
};

export async function getWalletOptions(): Promise<WalletOptions> {
  return api.get<WalletOptions>('/owner/wallets/options');
}

export async function getWallets(query?: {
  channelId?: string;
  userId?: string;
  limit?: number;
  offset?: number;
}): Promise<{ wallets: WalletListItem[]; total: number }> {
  return api.get<{ wallets: WalletListItem[]; total: number }>('/owner/wallets', { params: query });
}

export async function adjustWallet(
  userId: string,
  channelId: string,
  adjustment: { delta: number; reason: string },
): Promise<{ balance: number }> {
  return api.post<{ balance: number }>(`/owner/wallets/${encodeURIComponent(userId)}/${encodeURIComponent(channelId)}/adjust`, adjustment);
}
