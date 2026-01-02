import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '@/test/test-utils';
import { Modal } from './Modal';

function makeVisible(el: HTMLElement) {
  (el as any).getClientRects = () => [{ x: 0, y: 0, width: 10, height: 10 }];
}

describe('Modal', () => {
  it('closes on Escape when closeOnEsc=true', async () => {
    const onClose = vi.fn();
    renderWithProviders(
      <Modal isOpen onClose={onClose} ariaLabel="Test modal">
        <div className="p-4">Hello</div>
      </Modal>,
    );

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on backdrop click when closeOnBackdrop=true', async () => {
    const onClose = vi.fn();
    const { container } = renderWithProviders(
      <Modal isOpen onClose={onClose} ariaLabel="Test modal">
        <div className="p-4">Hello</div>
      </Modal>,
    );

    // Backdrop is the outer presentation div.
    const backdrop = container.querySelector('[role="presentation"]') as HTMLElement;
    fireEvent.mouseDown(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('restores focus to last active element on close', async () => {
    const user = userEvent.setup();

    // Queue RAF so we can patch visibility before it runs.
    const rafCbs: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCbs.push(cb);
      return rafCbs.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

    function Harness() {
      const [open, setOpen] = React.useState(false);
      return (
        <div>
          <button onClick={() => setOpen(true)}>Open</button>
          <Modal isOpen={open} onClose={() => setOpen(false)} ariaLabel="Test modal">
            <div className="p-4">
              <button>First</button>
              <button>Last</button>
            </div>
          </Modal>
        </div>
      );
    }

    renderWithProviders(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Make buttons visible before RAF focuses them.
    makeVisible(screen.getByRole('button', { name: 'First' }));
    makeVisible(screen.getByRole('button', { name: 'Last' }));
    makeVisible(screen.getByRole('dialog'));
    rafCbs.splice(0).forEach((cb) => cb(0));

    // Focus should be moved into the modal.
    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus();

    // Close via ESC and ensure focus returns to the trigger.
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus();
  });

  it('traps Tab within the modal when it has focusable elements', async () => {
    const user = userEvent.setup();

    const rafCbs: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCbs.push(cb);
      return rafCbs.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

    renderWithProviders(
      <Modal isOpen onClose={() => {}} ariaLabel="Trap modal">
        <div className="p-4">
          <button>First</button>
          <button>Last</button>
        </div>
      </Modal>,
    );

    const first = screen.getByRole('button', { name: 'First' });
    const last = screen.getByRole('button', { name: 'Last' });
    const dialog = screen.getByRole('dialog');

    makeVisible(first);
    makeVisible(last);
    makeVisible(dialog);
    rafCbs.splice(0).forEach((cb) => cb(0));

    expect(first).toHaveFocus();

    await user.tab();
    expect(last).toHaveFocus();

    await user.tab();
    expect(first).toHaveFocus();

    await user.tab({ shift: true });
    expect(last).toHaveFocus();
  });
});












