import { api } from '@/lib/api';

export type TasteProfileTopTag = {
  name: string;
  weight: number;
};

export type TasteProfileResponse = {
  totalActivations: number;
  lastActivationAt: string | null;
  topTags: TasteProfileTopTag[];
  categoryWeights: Record<string, number>;
  profileReady: boolean;
};

export async function getTasteProfile(): Promise<TasteProfileResponse> {
  return await api.get<TasteProfileResponse>('/me/taste-profile', {
    headers: { 'Cache-Control': 'no-store' },
  });
}
