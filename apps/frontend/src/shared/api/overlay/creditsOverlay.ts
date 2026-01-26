import type { CreditsEntry } from '@memalerts/api-contracts';

import { api } from '@/lib/api';

export type CreditsSettings = {
  styleJson?: string;
  reconnectWindowSeconds?: number;
  ignoredChatters?: string[];
};

export type CreditsState = {
  donors: CreditsEntry[];
  chatters: Array<CreditsEntry & { messageCount?: number }>;
};

export async function getCreditsToken(): Promise<{ token: string; url: string; styleJson?: string | null; creditsStyleJson?: string | null }> {
  return api.get<{ token: string; url: string; styleJson?: string | null; creditsStyleJson?: string | null }>('/streamer/credits/token', {
    timeout: 12000,
  });
}

export async function rotateCreditsToken(): Promise<{ token: string; url: string }> {
  return api.post<{ token: string; url: string }>('/streamer/credits/token/rotate', null, { timeout: 12000 });
}

export async function getCreditsState(): Promise<CreditsState> {
  return api.get<CreditsState>('/streamer/credits/state', {
    headers: { 'Cache-Control': 'no-store' },
    timeout: 12000,
  });
}

export async function resetCreditsSession(): Promise<void> {
  await api.post('/streamer/credits/reset');
}

export async function getReconnectWindow(): Promise<{ seconds: number }> {
  return api.get<{ seconds: number }>('/streamer/credits/reconnect-window', {
    headers: { 'Cache-Control': 'no-store' },
    timeout: 12000,
  });
}

export async function setReconnectWindow(seconds: number): Promise<void> {
  await api.post('/streamer/credits/reconnect-window', { seconds });
}

export async function getIgnoredChatters(): Promise<{ chatters: string[] }> {
  return api.get<{ chatters: string[] }>('/streamer/credits/ignored-chatters', {
    headers: { 'Cache-Control': 'no-store' },
    timeout: 12000,
  });
}

export async function setIgnoredChatters(chatters: string[]): Promise<void> {
  await api.post('/streamer/credits/ignored-chatters', { chatters });
}

export async function saveCreditsSettings(settings: CreditsSettings): Promise<void> {
  await api.post('/streamer/credits/settings', settings);
}

