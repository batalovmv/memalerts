import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '@/test/test-utils';
import type { User } from '@/types';

import SettingsPage from './SettingsPage';

vi.mock('@/components/Header', () => ({
  default: function HeaderMock() {
    return <div data-testid="header" />;
  },
}));

vi.mock('@/features/settings/tabs/ChannelSettings', () => ({
  ChannelSettings: function ChannelSettingsMock() {
    return <div data-testid="tab-channel-settings">ChannelSettings</div>;
  },
}));

vi.mock('@/features/settings/tabs/RewardsSettings', () => ({
  RewardsSettings: function RewardsSettingsMock() {
    return <div data-testid="tab-rewards">RewardsSettings</div>;
  },
}));

vi.mock('@/features/settings/tabs/ObsLinksSettings', () => ({
  ObsLinksSettings: function ObsLinksSettingsMock() {
    return <div data-testid="tab-obs">ObsLinksSettings</div>;
  },
}));

vi.mock('@/features/settings/tabs/BotSettings', () => ({
  BotSettings: function BotSettingsMock() {
    return <div data-testid="tab-bot">BotSettings</div>;
  },
}));

vi.mock('@/features/settings/tabs/ChannelStatistics', () => ({
  ChannelStatistics: function ChannelStatisticsMock() {
    return <div data-testid="tab-statistics">ChannelStatistics</div>;
  },
}));

function makeVisible(el: HTMLElement) {
  (el as any).getClientRects = () => [{ x: 0, y: 0, width: 10, height: 10 }];
}

const streamerUser: User = {
  id: 'u1',
  displayName: 'Streamer',
  role: 'streamer',
  channelId: 'c1',
  channel: { id: 'c1', slug: 's1', name: 'S' },
};

describe('SettingsPage (integration)', () => {
  it('supports ArrowRight/ArrowLeft keyboard navigation on tabs (roving tabindex + focus follows selection)', async () => {
    const user = userEvent.setup();

    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

    renderWithProviders(<SettingsPage />, {
      route: '/settings',
      preloadedState: { auth: { user: streamerUser, loading: false, error: null } } as any,
    });

    const tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBeGreaterThanOrEqual(4);

    const firstTab = tabs[0]!;
    const secondTab = tabs[1]!;

    // Initial selection should be the first tab (default activeTab="settings")
    expect(firstTab).toHaveAttribute('aria-selected', 'true');

    // Focus explicitly for stability (initial render doesn't auto-focus tabs).
    (firstTab as HTMLElement).focus();
    expect(firstTab).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(secondTab).toHaveAttribute('aria-selected', 'true');
    expect(secondTab).toHaveFocus();

    await user.keyboard('{ArrowLeft}');
    expect(firstTab).toHaveAttribute('aria-selected', 'true');
    expect(firstTab).toHaveFocus();

    rafSpy.mockRestore();
  });

  it('opens More menu with keyboard and focuses first/last item depending on ArrowDown/ArrowUp', async () => {
    const user = userEvent.setup();

    const rafCbs: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCbs.push(cb);
      return rafCbs.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

    renderWithProviders(<SettingsPage />, {
      route: '/settings',
      preloadedState: { auth: { user: streamerUser, loading: false, error: null } } as any,
    });

    const moreBtn = screen.getByRole('button', { name: /more/i });
    moreBtn.focus();
    expect(moreBtn).toHaveFocus();

    // Open with ArrowDown -> focus first menu item.
    fireEvent.keyDown(moreBtn, { key: 'ArrowDown' });
    const menu = await screen.findByRole('menu');
    const items = screen.getAllByRole('menuitem') as HTMLElement[];
    items.forEach(makeVisible);
    makeVisible(menu as unknown as HTMLElement);

    // Flush focus RAF.
    rafCbs.splice(0).forEach((cb) => cb(0));

    expect(items[0]).toHaveFocus();

    // Close menu via Escape and re-open with ArrowUp -> focus last.
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(moreBtn).toHaveFocus();

    fireEvent.keyDown(moreBtn, { key: 'ArrowUp' });
    const menu2 = await screen.findByRole('menu');
    const items2 = screen.getAllByRole('menuitem') as HTMLElement[];
    items2.forEach(makeVisible);
    makeVisible(menu2 as unknown as HTMLElement);
    rafCbs.splice(0).forEach((cb) => cb(0));

    expect(items2[items2.length - 1]).toHaveFocus();

    // Also validate arrow navigation wraps inside the menu.
    await user.keyboard('{ArrowDown}');
    // After ArrowDown from last, it should wrap to first.
    expect(items2[0]).toHaveFocus();
  });

  it('selecting a More menu item activates it as a real tab (isMoreTabActive)', async () => {
    const user = userEvent.setup();

    const rafCbs: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCbs.push(cb);
      return rafCbs.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

    renderWithProviders(<SettingsPage />, {
      route: '/settings',
      preloadedState: { auth: { user: streamerUser, loading: false, error: null } } as any,
    });

    const moreBtn = screen.getByRole('button', { name: /more/i });
    moreBtn.focus();
    fireEvent.keyDown(moreBtn, { key: 'Enter' });

    const menu = await screen.findByRole('menu');
    const items = screen.getAllByRole('menuitem') as HTMLElement[];
    items.forEach(makeVisible);
    makeVisible(menu as unknown as HTMLElement);
    rafCbs.splice(0).forEach((cb) => cb(0));

    // First item in menu is statistics in the current implementation.
    await user.click(items[0]!);

    // Menu closes.
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    // Statistics should now appear as a selected tab (the "more tab active" extra tab).
    const selected = screen.getAllByRole('tab').find((t) => t.getAttribute('aria-selected') === 'true');
    expect(selected).toBeTruthy();
    expect(selected).toHaveTextContent(/statistics/i);

    // And its panel should render our mocked component.
    expect(await screen.findByTestId('tab-statistics')).toBeInTheDocument();
  });
});


