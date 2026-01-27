import { asRecord, vkvideoGetJson } from './vkvideoCore.js';

type VkVideoUserRolesResult = {
  ok: boolean;
  roleIds: string[];
  error?: string | null;
  status?: number;
};

function buildRolesUrl(template: string, channelId: string, userId: string): string | null {
  if (!template.includes('{channelId}') || !template.includes('{userId}')) return null;
  const url = template
    .replace('{channelId}', encodeURIComponent(channelId))
    .replace('{userId}', encodeURIComponent(userId));
  try {
    new URL(url);
    return url;
  } catch {
    return null;
  }
}

export async function fetchVkVideoUserRolesOnChannel(params: {
  accessToken: string;
  vkvideoChannelId: string;
  vkvideoUserId: string;
}): Promise<VkVideoUserRolesResult> {
  const template = String(process.env.VKVIDEO_CHANNEL_ROLES_USER_URL_TEMPLATE || '').trim();
  if (!template) {
    return {
      ok: false,
      roleIds: [],
      error: 'VKVIDEO_CHANNEL_ROLES_USER_URL_TEMPLATE is not set',
      status: 0,
    };
  }

  const url = buildRolesUrl(template, params.vkvideoChannelId, params.vkvideoUserId);
  if (!url) {
    return {
      ok: false,
      roleIds: [],
      error: 'VKVIDEO_CHANNEL_ROLES_USER_URL_TEMPLATE is invalid',
      status: 0,
    };
  }

  const result = await vkvideoGetJson<{ data?: { roles?: Array<{ id?: unknown }> } }>({
    accessToken: params.accessToken,
    url,
  });
  if (!result.ok) {
    return { ok: false, roleIds: [], error: result.error, status: result.status };
  }

  const dataRec = asRecord(result.data);
  const inner = dataRec ? asRecord(dataRec.data) : null;
  const roles = Array.isArray(inner?.roles) ? inner.roles : [];
  const roleIds: string[] = [];
  const seen = new Set<string>();
  for (const role of roles) {
    const roleRec = asRecord(role);
    const rawId = roleRec?.id;
    if (rawId === null || rawId === undefined) continue;
    const id = String(rawId);
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    roleIds.push(id);
  }

  return { ok: true, roleIds, status: result.status };
}
