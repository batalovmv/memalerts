import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { act, screen, waitFor } from '@testing-library/react';

import { OwnerEntitlements } from './OwnerEntitlements';
import { renderWithProviders } from '@/test/test-utils';
import { server } from '@/test/msw/server';
import {
  mockOwnerCustomBotEntitlementStatus,
  mockOwnerCustomBotRevokeOk,
  mockOwnerResolveChannel,
} from '@/test/msw/handlers';

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('OwnerEntitlements (integration)', () => {
  it('resolves channelId by Twitch externalId and renders status JSON', async () => {
    const user = userEvent.setup();

    const resolveCalls: URL[] = [];
    server.use(
      mockOwnerResolveChannel({ channelId: 'c_1', displayHint: { twitchChannelId: '12345' } }, (u) => resolveCalls.push(u)),
    );

    renderWithProviders(<OwnerEntitlements />, { route: '/settings?tab=entitlements' });

    // Enter Twitch externalId (digits only)
    await user.type(screen.getByPlaceholderText('12345'), '12345');
    await user.click(screen.getByRole('button', { name: /resolve/i }));

    await waitFor(() => expect(resolveCalls.length).toBe(1));
    expect(resolveCalls[0]!.searchParams.get('provider')).toBe('twitch');
    expect(resolveCalls[0]!.searchParams.get('externalId')).toBe('12345');

    // ChannelId input should be filled by resolved channelId
    expect(await screen.findByDisplayValue('c_1')).toBeInTheDocument();

    // Result JSON should contain channelId
    expect(screen.getByText(/"channelId": "c_1"/)).toBeInTheDocument();
  });

  it('revokes custom-bot entitlement (confirmed) and refreshes status', async () => {
    const user = userEvent.setup();

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    const revokeBodies: unknown[] = [];
    const statusCalls: URL[] = [];

    server.use(
      mockOwnerCustomBotEntitlementStatus({ channelId: 'c_1', active: true }, (u) => statusCalls.push(u)),
      mockOwnerCustomBotRevokeOk((b) => revokeBodies.push(b)),
    );

    renderWithProviders(<OwnerEntitlements />, { route: '/settings?tab=entitlements' });

    // Fill manual channelId
    const cidInput = screen.getAllByPlaceholderText('123')[0]!;
    await user.type(cidInput, 'c_1');

    // Click Revoke -> confirm -> POST then GET status
    await user.click(screen.getByRole('button', { name: /^revoke$/i }));

    await waitFor(() => expect(revokeBodies.length).toBe(1));
    expect(revokeBodies[0]).toEqual({ channelId: 'c_1' });

    // loadStatus should be called after revoke
    await waitFor(() => expect(statusCalls.length).toBeGreaterThanOrEqual(1));
    expect(statusCalls.at(-1)!.searchParams.get('channelId')).toBe('c_1');

    confirmSpy.mockRestore();

    // Allow the component's small 200ms UX delay to flush deterministically.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 220));
    });
  });
});















