import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '@/test/test-utils';
import { BulkModerationBar } from './BulkModerationBar';

describe('BulkModerationBar', () => {
  it('disables actions when no selection', () => {
    renderWithProviders(
      <BulkModerationBar
        selectAllRef={React.createRef<HTMLInputElement>()}
        allVisibleSelected={false}
        selectedIds={[]}
        onToggleAllVisible={() => {}}
        onBulkAction={() => {}}
        onClearSelection={() => {}}
      />,
    );

    expect(screen.getByRole('button', { name: /approve selected/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /needs changes/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /reject selected/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /clear selection/i })).toBeDisabled();
  });

  it('fires bulk actions and selection callbacks', async () => {
    const user = userEvent.setup();
    const onToggleAllVisible = vi.fn();
    const onBulkAction = vi.fn();
    const onClearSelection = vi.fn();

    renderWithProviders(
      <BulkModerationBar
        selectAllRef={React.createRef<HTMLInputElement>()}
        allVisibleSelected={false}
        selectedIds={['s1', 's2']}
        onToggleAllVisible={onToggleAllVisible}
        onBulkAction={onBulkAction}
        onClearSelection={onClearSelection}
      />,
    );

    await user.click(screen.getByRole('checkbox', { name: /select all/i }));
    expect(onToggleAllVisible).toHaveBeenCalledWith(true);

    await user.click(screen.getByRole('button', { name: /approve selected/i }));
    expect(onBulkAction).toHaveBeenCalledWith('approve', ['s1', 's2']);

    await user.click(screen.getByRole('button', { name: /needs changes/i }));
    expect(onBulkAction).toHaveBeenCalledWith('needs_changes', ['s1', 's2']);

    await user.click(screen.getByRole('button', { name: /reject selected/i }));
    expect(onBulkAction).toHaveBeenCalledWith('reject', ['s1', 's2']);

    await user.click(screen.getByRole('button', { name: /clear selection/i }));
    expect(onClearSelection).toHaveBeenCalled();
  });
});
