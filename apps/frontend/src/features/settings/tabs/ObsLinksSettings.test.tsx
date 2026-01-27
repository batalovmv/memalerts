import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';

import { ObsLinksSettings } from './ObsLinksSettings';
import { renderWithProviders } from '@/test/test-utils';
import { server } from '@/test/msw/server';
import {
  mockStreamerOverlayPresets,
  mockStreamerOverlayPresetsPut,
  mockStreamerOverlayPreviewMemes,
  mockStreamerOverlayToken,
  mockStreamerOverlayTokenRotate,
} from '@/test/msw/handlers';
import { makeStreamerUser } from '@/test/fixtures/user';

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Make URL visible and easy to assert (real component masks/copies).
vi.mock('@/shared/ui/SecretCopyField/SecretCopyField', () => ({
  default: function SecretCopyFieldMock(props: { label: string; value: string; description?: string; rightActions?: React.ReactNode }) {
    return (
      <div>
        <div>{props.label}</div>
        <div data-testid={`secret:${props.label}`}>{props.value}</div>
        {props.description ? <div>{props.description}</div> : null}
        {props.rightActions ? <div>{props.rightActions}</div> : null}
      </div>
    );
  },
}));

describe('ObsLinksSettings (integration)', () => {
  it('shows overlay URL from token and rotates it via /streamer/overlay/token/rotate', async () => {
    const user = userEvent.setup();
    const me = makeStreamerUser({ channel: { id: 'c1', slug: 's1', name: 'S', twitchChannelId: 't1' } });

    const rotateCalls = vi.fn();

    server.use(
      mockStreamerOverlayToken({ token: 'tok1', overlayMode: 'queue', overlayShowSender: false, overlayMaxConcurrent: 3, overlayStyleJson: null }),
      mockStreamerOverlayPresets({ presets: [] }),
      mockStreamerOverlayPresetsPut(() => {}),
      mockStreamerOverlayPreviewMemes([]),
      mockStreamerOverlayTokenRotate({ token: 'tok2' }, () => rotateCalls()),
    );

    renderWithProviders(<ObsLinksSettings />, {
      route: '/settings?tab=obs',
      preloadedState: { auth: { user: me, loading: false, error: null } },
    });

    await waitFor(() => {
      const val = screen.getByTestId('secret:Overlay URL (Browser Source)').textContent || '';
      expect(val).toContain('/overlay/t/tok1');
    });

    // Rotate
    await user.click(await screen.findByRole('button', { name: /update overlay link/i }));
    await waitFor(() => expect(rotateCalls).toHaveBeenCalled());

    await waitFor(() => {
      const val = screen.getByTestId('secret:Overlay URL (Browser Source)').textContent || '';
      expect(val).toContain('/overlay/t/tok2');
    });
  });

});
