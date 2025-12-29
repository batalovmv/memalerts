import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';

import { NeedsChangesSubmissionCard } from './NeedsChangesSubmissionCard';
import { renderWithProviders } from '@/test/test-utils';
import { server } from '@/test/msw/server';
import { mockResubmitSubmission } from '@/test/msw/handlers';
import { makeMySubmission } from '@/test/fixtures/submissions';

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Replace complex TagInput with a simple input for tests.
vi.mock('@/components/TagInput', () => ({
  default: function TagInputMock(props: { tags: string[]; onChange: (tags: string[]) => void }) {
    return (
      <div>
        <div data-testid="tags">{(props.tags || []).join(',')}</div>
        <button type="button" onClick={() => props.onChange([...(props.tags || []), 'tag1'])}>
          AddTag
        </button>
      </div>
    );
  },
}));

describe('NeedsChangesSubmissionCard (integration)', () => {
  it('submits resubmit payload, calls onUpdated, and dispatches global event', async () => {
    const userEv = userEvent.setup();
    const onUpdated = vi.fn();
    const onGlobalUpdated = vi.fn();
    window.addEventListener('my-submissions:updated', onGlobalUpdated);

    try {
      const submission = makeMySubmission({ id: 'sub_123', title: 'Old', notes: 'old', tags: [] });

      const assert = vi.fn();
      server.use(
        mockResubmitSubmission((d) => assert(d)),
      );

      renderWithProviders(<NeedsChangesSubmissionCard submission={submission} onUpdated={onUpdated} />, {
        preloadedState: { auth: { user: { id: 'u1', displayName: 'U', role: 'viewer', channelId: null }, loading: false, error: null } } as any,
      });

      // Update fields
      const titleInput = screen.getByDisplayValue('Old') as HTMLInputElement;
      await userEv.clear(titleInput);
      await userEv.type(titleInput, 'New title');
      const notesArea = screen.getByDisplayValue('old') as HTMLTextAreaElement;
      await userEv.clear(notesArea);
      await userEv.type(notesArea, 'note');
      await userEv.click(screen.getByRole('button', { name: 'AddTag' }));

      await userEv.click(screen.getByRole('button', { name: /fix & resubmit/i }));

      await waitFor(() =>
        expect(assert).toHaveBeenCalledWith({ id: 'sub_123', title: 'New title', notes: 'note', tags: ['tag1'] }),
      );

      const toast = (await import('react-hot-toast')).default as unknown as { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
      expect(toast.success).toHaveBeenCalled();
      expect(onUpdated).toHaveBeenCalled();
      expect(onGlobalUpdated).toHaveBeenCalled();
    } finally {
      window.removeEventListener('my-submissions:updated', onGlobalUpdated);
    }
  });

  it('does not submit when title is empty (canResubmit=false)', async () => {
    const userEv = userEvent.setup();
    const onUpdated = vi.fn();
    const submission = makeMySubmission({ id: 'sub_1', title: 'X', revision: 0 });

    const assert = vi.fn();
    server.use(mockResubmitSubmission((d) => assert(d)));

    renderWithProviders(<NeedsChangesSubmissionCard submission={submission} onUpdated={onUpdated} />, {
      preloadedState: { auth: { user: { id: 'u1', displayName: 'U', role: 'viewer', channelId: null }, loading: false, error: null } } as any,
    });

    // Clear title -> button should be disabled
    await userEv.clear(screen.getByDisplayValue('X'));
    const btn = screen.getByRole('button', { name: /fix & resubmit/i });
    expect(btn).toBeDisabled();

    fireEvent.click(btn);
    expect(assert).not.toHaveBeenCalled();
    expect(onUpdated).not.toHaveBeenCalled();
  });

  it('shows toast error on server failure', async () => {
    const userEv = userEvent.setup();
    const onUpdated = vi.fn();
    const submission = makeMySubmission({ id: 'sub_1', title: 'Ok', revision: 0 });

    server.use(
      http.post('*/submissions/:id/resubmit', () => HttpResponse.json({ error: 'fail' }, { status: 500 })),
    );

    renderWithProviders(<NeedsChangesSubmissionCard submission={submission} onUpdated={onUpdated} />, {
      preloadedState: { auth: { user: { id: 'u1', displayName: 'U', role: 'viewer', channelId: null }, loading: false, error: null } } as any,
    });

    await userEv.click(screen.getByRole('button', { name: /fix & resubmit/i }));

    const toast = (await import('react-hot-toast')).default as unknown as { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(onUpdated).not.toHaveBeenCalled();
  });
});


