import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ConfirmDialog from './ConfirmDialog';

describe('ConfirmDialog (integration)', () => {
  it('calls onClose on Escape when not loading', async () => {
    const userEv = userEvent.setup();
    const onClose = vi.fn();

    render(
      <ConfirmDialog
        isOpen
        onClose={onClose}
        onConfirm={vi.fn()}
        title="Confirm"
        message="Are you sure?"
        confirmText="Yes"
        cancelText="No"
      />,
    );

    // Modal focuses first focusable element on rAF; ensure focus is inside dialog.
    await new Promise((r) => setTimeout(r, 0));
    const cancelBtn = screen.getByRole('button', { name: 'No' });
    cancelBtn.focus();

    await userEv.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose on Escape when loading', async () => {
    const userEv = userEvent.setup();
    const onClose = vi.fn();

    render(
      <ConfirmDialog
        isOpen
        isLoading
        onClose={onClose}
        onConfirm={vi.fn()}
        title="Confirm"
        message="Are you sure?"
        confirmText="Yes"
        cancelText="No"
      />,
    );

    await userEv.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on backdrop click when not loading, and blocks backdrop close when loading', async () => {
    const onClose = vi.fn();

    const { rerender } = render(
      <ConfirmDialog
        isOpen
        onClose={onClose}
        onConfirm={vi.fn()}
        title="Confirm"
        message="Are you sure?"
      />,
    );

    const backdrop = screen.getByRole('presentation');
    fireEvent.mouseDown(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    rerender(
      <ConfirmDialog
        isOpen
        isLoading
        onClose={onClose}
        onConfirm={vi.fn()}
        title="Confirm"
        message="Are you sure?"
      />,
    );

    fireEvent.mouseDown(screen.getByRole('presentation'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onConfirm when confirm button is clicked, but disables buttons while loading', async () => {
    const userEv = userEvent.setup();
    const onConfirm = vi.fn();
    const onClose = vi.fn();

    const { rerender } = render(
      <ConfirmDialog isOpen onClose={onClose} onConfirm={onConfirm} title="Confirm" message="Are you sure?" confirmText="Delete" cancelText="Cancel" />,
    );

    await userEv.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    rerender(
      <ConfirmDialog isOpen isLoading onClose={onClose} onConfirm={onConfirm} title="Confirm" message="Are you sure?" confirmText="Delete" cancelText="Cancel" />,
    );

    expect(screen.getByRole('button', { name: /processing/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });
});


