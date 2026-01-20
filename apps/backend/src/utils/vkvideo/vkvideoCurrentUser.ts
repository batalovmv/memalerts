import { guessVkVideoApiBaseUrl, vkvideoGetJson, type VkVideoApiResult } from './vkvideoCore.js';

export async function fetchVkVideoCurrentUser(params: {
  accessToken: string;
  apiBaseUrl?: string | null;
}): Promise<VkVideoApiResult> {
  const apiBaseUrl = (params.apiBaseUrl ?? guessVkVideoApiBaseUrl())?.replace(/\/+$/g, '') || null;
  if (!apiBaseUrl) {
    return { ok: false, status: 0, data: null, error: 'VKVIDEO_API_BASE_URL is not configured' };
  }

  const url = `${apiBaseUrl}/v1/current_user`;
  return await vkvideoGetJson({ accessToken: params.accessToken, url });
}
