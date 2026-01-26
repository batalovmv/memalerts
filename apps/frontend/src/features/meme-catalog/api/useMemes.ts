import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ActivateMemeBody,
  ActivateMemeResponse,
  ActivateMemeResponseSchema,
  GetMemeResponse,
  GetMemeResponseSchema,
  ListChannelMemesQuery,
  ListChannelMemesResponse,
  ListChannelMemesResponseSchema,
} from '@memalerts/api-contracts';

import { apiClient } from '@/shared/api/client';

export const memeKeys = {
  all: ['memes'] as const,
  lists: () => [...memeKeys.all, 'list'] as const,
  list: (channelId: string, params: Partial<ListChannelMemesQuery>) =>
    [...memeKeys.lists(), channelId, params] as const,
  details: () => [...memeKeys.all, 'detail'] as const,
  detail: (id: string) => [...memeKeys.details(), id] as const,
};

export function useChannelMemes(
  channelId: string,
  params: Partial<ListChannelMemesQuery> = {},
) {
  return useQuery({
    queryKey: memeKeys.list(channelId, params),
    queryFn: async () => {
      const queryString = new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)]),
      ).toString();

      const url = queryString
        ? `/channels/${channelId}/memes?${queryString}`
        : `/channels/${channelId}/memes`;

      const response = await apiClient.get<ListChannelMemesResponse>(
        url,
        ListChannelMemesResponseSchema,
      );

      return response.data;
    },
    enabled: !!channelId,
    staleTime: 30_000,
  });
}

export function useMeme(memeId: string) {
  return useQuery({
    queryKey: memeKeys.detail(memeId),
    queryFn: async () => {
      const response = await apiClient.get<GetMemeResponse>(
        `/memes/${memeId}`,
        GetMemeResponseSchema,
      );
      return response.data;
    },
    enabled: !!memeId,
  });
}

export function useActivateMeme() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      memeId,
      channelId,
      volume = 1,
    }: {
      memeId: string;
      channelId: string;
      volume?: number;
    }) => {
      const body: ActivateMemeBody = { channelId, volume };

      const response = await apiClient.post<ActivateMemeResponse>(
        `/memes/${memeId}/activate`,
        body,
        ActivateMemeResponseSchema,
      );

      return response.data;
    },
    onSuccess: (_data, { memeId }) => {
      queryClient.invalidateQueries({ queryKey: memeKeys.detail(memeId) });
      queryClient.invalidateQueries({ queryKey: memeKeys.lists() });
    },
  });
}
