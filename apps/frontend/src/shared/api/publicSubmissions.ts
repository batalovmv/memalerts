import { api } from '@/lib/api';

export type SubmissionsStatus = {
  enabled: boolean;
  channelSlug: string;
};

export async function getPublicSubmissionsStatus(token: string): Promise<SubmissionsStatus> {
  return api.get<SubmissionsStatus>('/public/submissions/status', {
    headers: { 'X-Control-Token': token, 'Cache-Control': 'no-store' },
    timeout: 12000,
  });
}

export async function enablePublicSubmissions(token: string): Promise<SubmissionsStatus> {
  return api.post<SubmissionsStatus>('/public/submissions/enable', null, {
    headers: { 'X-Control-Token': token },
  });
}

export async function disablePublicSubmissions(token: string): Promise<SubmissionsStatus> {
  return api.post<SubmissionsStatus>('/public/submissions/disable', null, {
    headers: { 'X-Control-Token': token },
  });
}

export async function togglePublicSubmissions(token: string): Promise<SubmissionsStatus> {
  return api.post<SubmissionsStatus>('/public/submissions/toggle', null, {
    headers: { 'X-Control-Token': token },
  });
}

export async function getSubmissionsControlLink(): Promise<{ token: string; url: string }> {
  return api.get<{ token: string; url: string }>('/streamer/submissions-control/link', { timeout: 12000 });
}

export async function rotateSubmissionsControlLink(): Promise<{ token: string; url: string }> {
  return api.post<{ token: string; url: string }>('/streamer/submissions-control/link/rotate', null, { timeout: 12000 });
}
