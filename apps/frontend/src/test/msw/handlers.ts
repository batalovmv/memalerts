import { http, HttpResponse } from 'msw';

import type { User } from '@/types';
import type { ModerationMemeAsset } from '@/shared/api/moderationMemeAssets';

export type BetaStatus = {
  hasAccess: boolean;
  request: {
    id: string;
    status: 'pending' | 'approved' | 'rejected' | 'revoked';
    requestedAt: string;
    approvedAt?: string;
  } | null;
};

export function mockMe(user: User | null) {
  return http.get('*/me', () => {
    if (!user) return new HttpResponse(null, { status: 401 });
    return HttpResponse.json(user);
  });
}

export function mockBetaStatus(value: BetaStatus) {
  return http.get('*/beta/status', () => HttpResponse.json(value));
}

export function mockBetaRequestOk() {
  return http.post('*/beta/request', () => HttpResponse.json({ ok: true }));
}

export function mockModerationMemeAssets(opts: {
  items: ModerationMemeAsset[];
  total?: number;
  limit?: number;
  offset?: number;
}) {
  return http.get('*/moderation/meme-assets*', ({ request }) => {
    // For most tests we don't need to enforce query parsing strictly,
    // but leaving request available helps future assertions.
    void request;
    const total = typeof opts.total === 'number' ? String(opts.total) : undefined;
    const limit = typeof opts.limit === 'number' ? String(opts.limit) : undefined;
    const offset = typeof opts.offset === 'number' ? String(opts.offset) : undefined;

    return HttpResponse.json(opts.items, {
      headers: {
        ...(total ? { 'x-total': total } : {}),
        ...(limit ? { 'x-limit': limit } : {}),
        ...(offset ? { 'x-offset': offset } : {}),
      },
    });
  });
}

export function mockModerationHideOk(onCall?: (data: { id: string }) => void) {
  return http.post('*/moderation/meme-assets/:id/hide', ({ params }) => {
    const id = String(params.id ?? '');
    onCall?.({ id });
    return HttpResponse.json({ ok: true });
  });
}

export function mockModerationUnhideOk(onCall?: (data: { id: string }) => void) {
  return http.post('*/moderation/meme-assets/:id/unhide', ({ params }) => {
    const id = String(params.id ?? '');
    onCall?.({ id });
    return HttpResponse.json({ ok: true });
  });
}

export function mockModerationQuarantineOk(assert?: (data: { id: string; reason: string }) => void) {
  return http.post('*/moderation/meme-assets/:id/delete', async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const reason = typeof body.reason === 'string' ? body.reason : '';
    const idRaw = String(params.id ?? '');
    // App uses encodeURIComponent(id) in URL; keep tests robust by asserting encoded id shape.
    const id = encodeURIComponent(idRaw);
    assert?.({ id, reason });
    return HttpResponse.json({ ok: true });
  });
}

export function mockChannel(slug: string, data: Record<string, unknown>) {
  // Match only `/channels/<slug>` with optional query string.
  // Important: do NOT match nested routes like `/channels/memes/search`.
  return http.get(/.*\/channels\/([^/]+)(\?.*)?$/, ({ request }) => {
    const url = new URL(request.url);
    const actual = String(url.pathname.split('/').pop() ?? '');
    if (actual !== slug) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json(data);
  });
}

export function mockPublicChannel(slug: string, data: Record<string, unknown>) {
  // Match only `/public/channels/<slug>` with optional query string.
  // Important: do NOT match nested routes like `/public/channels/<slug>/memes`.
  return http.get(/.*\/public\/channels\/([^/]+)(\?.*)?$/, ({ request }) => {
    const url = new URL(request.url);
    const actual = String(url.pathname.split('/').pop() ?? '');
    if (actual !== slug) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json(data);
  });
}

export function mockPublicChannelMemes(payload: unknown, onCall?: (url: URL) => void) {
  // NOTE: keep this exact (no wildcard) so it doesn't accidentally match `/memes/search`.
  return http.get('*/public/channels/:slug/memes', ({ request }) => {
    onCall?.(new URL(request.url));
    return HttpResponse.json(payload);
  });
}

export function mockPublicChannelMemesSearch(payload: unknown, onCall?: (url: URL) => void) {
  return http.get('*/public/channels/:slug/memes/search*', ({ request }) => {
    onCall?.(new URL(request.url));
    return HttpResponse.json(payload);
  });
}

export function mockChannelWallet(payload: unknown, onCall?: (url: URL) => void) {
  return http.get('*/channels/:slug/wallet', ({ request }) => {
    onCall?.(new URL(request.url));
    return HttpResponse.json(payload);
  });
}

export function mockOwnerModerators(payload: unknown, onCall?: () => void) {
  return http.get('*/owner/moderators', () => {
    onCall?.();
    return HttpResponse.json(payload);
  });
}

export function mockOwnerModeratorGrantOk(assert?: (data: { userId: string }) => void) {
  return http.post('*/owner/moderators/:userId/grant', ({ params }) => {
    const userId = String(params.userId ?? '');
    assert?.({ userId });
    return HttpResponse.json({ ok: true });
  });
}

export function mockOwnerModeratorRevokeOk(assert?: (data: { userId: string }) => void) {
  return http.post('*/owner/moderators/:userId/revoke', ({ params }) => {
    const userId = String(params.userId ?? '');
    assert?.({ userId });
    return HttpResponse.json({ ok: true });
  });
}

export function mockTwitchRewardEligibility(payload: unknown, onCall?: () => void) {
  return http.get('*/streamer/twitch/reward/eligibility', () => {
    onCall?.();
    return HttpResponse.json(payload);
  });
}

export function mockStreamerChannelSettingsPatch(onCall?: (body: unknown) => void) {
  return http.patch('*/streamer/channel/settings', async ({ request }) => {
    const body = (await request.json().catch(() => null)) as unknown;
    onCall?.(body);
    return HttpResponse.json({ ok: true });
  });
}

export function mockStreamerChannelStats(payload: unknown, onCall?: () => void) {
  return http.get('*/streamer/stats/channel', () => {
    onCall?.();
    return HttpResponse.json(payload);
  });
}

export function mockOwnerBetaRequests(payload: unknown, onCall?: () => void) {
  return http.get('*/owner/beta/requests', () => {
    onCall?.();
    return HttpResponse.json(payload);
  });
}

export function mockOwnerBetaUsers(payload: unknown, onCall?: () => void) {
  return http.get('*/owner/beta/users', () => {
    onCall?.();
    return HttpResponse.json(payload);
  });
}

export function mockOwnerBetaRevokedUsers(payload: unknown, onCall?: () => void) {
  return http.get('*/owner/beta/users/revoked', () => {
    onCall?.();
    return HttpResponse.json(payload);
  });
}

export function mockOwnerBetaRequestApproveOk(assert?: (data: { requestId: string }) => void) {
  return http.post('*/owner/beta/requests/:requestId/approve', ({ params }) => {
    const requestId = String(params.requestId ?? '');
    assert?.({ requestId });
    return HttpResponse.json({ ok: true });
  });
}

export function mockOwnerBetaRequestRejectOk(assert?: (data: { requestId: string }) => void) {
  return http.post('*/owner/beta/requests/:requestId/reject', ({ params }) => {
    const requestId = String(params.requestId ?? '');
    assert?.({ requestId });
    return HttpResponse.json({ ok: true });
  });
}

export function mockOwnerBetaUserRevokeOk(assert?: (data: { userId: string }) => void) {
  return http.post('*/owner/beta/users/:userId/revoke', ({ params }) => {
    const userId = String(params.userId ?? '');
    assert?.({ userId });
    return HttpResponse.json({ ok: true });
  });
}

export function mockOwnerBetaUserRestoreOk(assert?: (data: { userId: string }) => void) {
  return http.post('*/owner/beta/users/:userId/restore', ({ params }) => {
    const userId = String(params.userId ?? '');
    assert?.({ userId });
    return HttpResponse.json({ ok: true });
  });
}

export function mockStreamerOverlayToken(payload: unknown) {
  return http.get('*/streamer/overlay/token', () => HttpResponse.json(payload));
}

export function mockStreamerOverlayTokenRotate(payload: unknown, onCall?: () => void) {
  return http.post('*/streamer/overlay/token/rotate', () => {
    onCall?.();
    return HttpResponse.json(payload);
  });
}

export function mockStreamerCreditsToken(payload: unknown) {
  return http.get('*/streamer/credits/token', () => HttpResponse.json(payload));
}

export function mockStreamerCreditsTokenRotate(payload: unknown, onCall?: () => void) {
  return http.post('*/streamer/credits/token/rotate', () => {
    onCall?.();
    return HttpResponse.json(payload);
  });
}

export function mockStreamerOverlayPresets(payload: unknown) {
  return http.get('*/streamer/overlay/presets', () => HttpResponse.json(payload));
}

export function mockStreamerOverlayPresetsPut(onCall?: (body: unknown) => void) {
  return http.put('*/streamer/overlay/presets', async ({ request }) => {
    const body = (await request.json().catch(() => null)) as unknown;
    onCall?.(body);
    return HttpResponse.json({ ok: true });
  });
}

export function mockStreamerOverlayPreviewMemes(payload: unknown, onCall?: (url: URL) => void) {
  return http.get('*/streamer/overlay/preview-memes*', ({ request }) => {
    onCall?.(new URL(request.url));
    return HttpResponse.json(payload);
  });
}

export function mockOwnerResolveChannel(payload: unknown, onCall?: (url: URL) => void) {
  return http.get('*/owner/channels/resolve*', ({ request }) => {
    onCall?.(new URL(request.url));
    return HttpResponse.json(payload);
  });
}

export function mockOwnerCustomBotEntitlementStatus(payload: unknown, onCall?: (url: URL) => void) {
  return http.get('*/owner/entitlements/custom-bot*', ({ request }) => {
    onCall?.(new URL(request.url));
    return HttpResponse.json(payload);
  });
}

export function mockOwnerCustomBotGrantByProvider(payload: unknown, onCall?: (body: unknown) => void) {
  return http.post('*/owner/entitlements/custom-bot/grant-by-provider', async ({ request }) => {
    const body = (await request.json().catch(() => null)) as unknown;
    onCall?.(body);
    return HttpResponse.json(payload);
  });
}

export function mockOwnerCustomBotGrantOk(onCall?: (body: unknown) => void) {
  return http.post('*/owner/entitlements/custom-bot/grant', async ({ request }) => {
    const body = (await request.json().catch(() => null)) as unknown;
    onCall?.(body);
    return HttpResponse.json({ ok: true });
  });
}

export function mockOwnerCustomBotRevokeOk(onCall?: (body: unknown) => void) {
  return http.post('*/owner/entitlements/custom-bot/revoke', async ({ request }) => {
    const body = (await request.json().catch(() => null)) as unknown;
    onCall?.(body);
    return HttpResponse.json({ ok: true });
  });
}

export function mockOwnerMemeAssets(payload: unknown, onCall?: (url: URL) => void) {
  return http.get('*/owner/meme-assets*', ({ request }) => {
    onCall?.(new URL(request.url));
    return HttpResponse.json(payload);
  });
}

export function mockOwnerMemeAssetRestoreOk(assert?: (data: { id: string }) => void) {
  return http.post('*/owner/meme-assets/:id/restore', ({ params }) => {
    const id = String(params.id ?? '');
    assert?.({ id });
    return HttpResponse.json({ ok: true });
  });
}

export function mockOwnerWalletOptions(payload: unknown, onCall?: () => void) {
  return http.get('*/owner/wallets/options', () => {
    onCall?.();
    return HttpResponse.json(payload);
  });
}

export function mockOwnerWallets(payload: unknown, onCall?: (url: URL) => void) {
  return http.get('*/owner/wallets*', ({ request }) => {
    onCall?.(new URL(request.url));
    return HttpResponse.json(payload);
  });
}

export function mockOwnerWalletAdjustOk(assert?: (data: { userId: string; channelId: string; amount: number }) => void) {
  return http.post('*/owner/wallets/:userId/:channelId/adjust', async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const amount = typeof body.amount === 'number' ? body.amount : Number(body.amount);
    const userId = String(params.userId ?? '');
    const channelId = String(params.channelId ?? '');
    assert?.({ userId, channelId, amount: Number.isFinite(amount) ? amount : NaN });
    return HttpResponse.json({ ok: true });
  });
}

export function mockStreamerPromotions(payload: unknown, onCall?: () => void) {
  return http.get('*/streamer/promotions', () => {
    onCall?.();
    return HttpResponse.json(payload);
  });
}

export function mockStreamerPromotionCreateOk(assert?: (body: unknown) => void) {
  return http.post('*/streamer/promotions', async ({ request }) => {
    const body = (await request.json().catch(() => null)) as unknown;
    assert?.(body);
    return HttpResponse.json({ ok: true });
  });
}

export function mockStreamerPromotionPatchOk(assert?: (data: { id: string; body: unknown }) => void) {
  return http.patch('*/streamer/promotions/:id', async ({ params, request }) => {
    const body = (await request.json().catch(() => null)) as unknown;
    const id = String(params.id ?? '');
    assert?.({ id, body });
    return HttpResponse.json({ ok: true });
  });
}

export function mockStreamerPromotionDeleteOk(assert?: (data: { id: string }) => void) {
  return http.delete('*/streamer/promotions/:id', ({ params }) => {
    const id = String(params.id ?? '');
    assert?.({ id });
    return HttpResponse.json({ ok: true });
  });
}

export function mockAuthAccounts(payload: unknown, onCall?: () => void) {
  return http.get('*/auth/accounts', () => {
    onCall?.();
    return HttpResponse.json(payload);
  });
}

export function mockAuthAccountDeleteOk(assert?: (data: { id: string }) => void) {
  return http.delete('*/auth/accounts/:id', ({ params }) => {
    const id = String(params.id ?? '');
    assert?.({ id });
    return HttpResponse.json({ ok: true });
  });
}

export function mockOwnerDefaultBotStatus(provider: 'twitch' | 'youtube' | 'vkvideo' | 'trovo' | 'kick', payload: unknown) {
  return http.get(`*/owner/bots/${provider}/default/status`, () => HttpResponse.json(payload));
}

export function mockOwnerDefaultBotDisconnect(provider: 'twitch' | 'youtube' | 'vkvideo' | 'trovo' | 'kick', onCall?: () => void) {
  return http.delete(`*/owner/bots/${provider}/default`, () => {
    onCall?.();
    return HttpResponse.json({ ok: true });
  });
}

export function mockStreamerBotSubscription(payload: unknown) {
  return http.get('*/streamer/bot/subscription', () => HttpResponse.json(payload));
}

export function mockStreamerCustomBotEntitlement(payload: unknown) {
  return http.get('*/streamer/entitlements/custom-bot', () => HttpResponse.json(payload));
}

export function mockStreamerFollowGreetings(payload: unknown) {
  return http.get('*/streamer/bot/follow-greetings', () => HttpResponse.json(payload));
}

export function mockStreamerBotOverrideStatus(provider: 'twitch' | 'youtube' | 'vkvideo' | 'trovo' | 'kick', payload: unknown) {
  return http.get(`*/streamer/bots/${provider}/bot`, () => HttpResponse.json(payload));
}

export function mockStreamerBots(items: Array<{ provider: string; enabled?: boolean | null }>) {
  return http.get('*/streamer/bots', () => HttpResponse.json({ items }));
}

export function mockStreamerSubmissions(payload: unknown) {
  // Dashboard fetchSubmissions() uses /streamer/submissions
  return http.get('*/streamer/submissions*', () => HttpResponse.json(payload));
}

export function mockMySubmissions(payload: unknown, onCall?: () => void) {
  // Dashboard "my submissions" tab loads /submissions (viewer-side)
  return http.get('*/submissions*', () => {
    onCall?.();
    return HttpResponse.json(payload);
  });
}

export function mockMemesPool(payload: unknown, onCall?: (url: URL) => void) {
  return http.get('*/memes/pool*', ({ request }) => {
    onCall?.(new URL(request.url));
    return HttpResponse.json(payload);
  });
}

export function mockChannelMemesSearch(payload: unknown, onCall?: (url: URL) => void) {
  return http.get('*/channels/memes/search*', ({ request }) => {
    onCall?.(new URL(request.url));
    return HttpResponse.json(payload);
  });
}

export function mockStreamerMemes(opts: {
  items: unknown;
  hasMore?: boolean;
  totalCount?: number;
  onCall?: (url: URL) => void;
}) {
  return http.get('*/streamer/memes*', ({ request }) => {
    const url = new URL(request.url);
    opts.onCall?.(url);
    return HttpResponse.json(opts.items, {
      headers: {
        ...(typeof opts.hasMore === 'boolean' ? { 'x-has-more': String(opts.hasMore) } : {}),
        ...(typeof opts.totalCount === 'number' ? { 'x-total-count': String(opts.totalCount) } : {}),
      },
    });
  });
}

export function mockCreateSubmission(response: Record<string, unknown>, onCall?: () => void) {
  return http.post('*/submissions', async () => {
    onCall?.();
    return HttpResponse.json(response);
  });
}

export function mockImportSubmission(response: Record<string, unknown>, onCall?: () => void) {
  return http.post('*/submissions/import', async () => {
    onCall?.();
    return HttpResponse.json(response);
  });
}

export function mockResubmitSubmission(assert?: (data: { id: string; title: string; notes: string | null; tags: string[] }) => void) {
  return http.post('*/submissions/:id/resubmit', async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const id = String(params.id ?? '');
    const title = typeof body.title === 'string' ? body.title : '';
    const notes = typeof body.notes === 'string' ? body.notes : body.notes === null ? null : null;
    const tags = Array.isArray(body.tags) ? (body.tags.filter((x) => typeof x === 'string') as string[]) : [];
    assert?.({ id, title, notes, tags });
    return HttpResponse.json({ ok: true });
  });
}


