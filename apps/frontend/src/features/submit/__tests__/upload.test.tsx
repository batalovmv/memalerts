import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { act, screen, waitFor } from '@testing-library/react';

import SubmitModal from '../ui/SubmitModal';
import { renderWithProviders } from '@/test/test-utils';
import { makeStreamerUser } from '@/test/fixtures/user';
import { api } from '@/lib/api';

vi.mock('@/features/submit/lib/validation', () => ({
  validateFile: vi.fn().mockResolvedValue({ valid: true, errors: [] }),
}));

describe('Upload flow', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows progress during upload', async () => {
    const userEv = userEvent.setup();
    const onClose = vi.fn();
    const me = makeStreamerUser({ id: 'u1', channelId: 'c1' });

    let resolvePost: ((value: unknown) => void) | null = null;
    const postPromise = new Promise((resolve) => {
      resolvePost = resolve;
    });

    const postSpy = vi.spyOn(api, 'post').mockImplementation((_url, _data, config) => {
      config?.onUploadProgress?.({ loaded: 50, total: 100 } as any);
      return postPromise as Promise<any>;
    });

    const { container } = renderWithProviders(
      <SubmitModal isOpen onClose={onClose} channelSlug={me.channel!.slug} channelId={me.channelId!} />,
      {
        route: '/dashboard',
        preloadedState: { auth: { user: me, loading: false, error: null } } as any,
      },
    );

    const fileInput = container.querySelector('input[type="file"][required]') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], 'test.webm', { type: 'video/webm' });
    await userEv.upload(fileInput, file);

    const submitButton = screen.getByRole('button', { name: /add/i });
    await waitFor(() => expect(submitButton).toBeEnabled());

    await userEv.click(submitButton);
    await waitFor(() => expect(screen.getByText(/uploading/i)).toBeInTheDocument());
    expect(screen.getByText(/50%/i)).toBeInTheDocument();

    await act(async () => {
      resolvePost?.({ status: 'pending' });
    });

    postSpy.mockRestore();
  });

  it('cancels upload on cancel click', async () => {
    const userEv = userEvent.setup();
    const onClose = vi.fn();
    const me = makeStreamerUser({ id: 'u1', channelId: 'c1' });
    const abortSpy = vi.fn();

    const originalAbort = globalThis.AbortController;
    class MockAbortController {
      signal = {} as AbortSignal;
      abort = abortSpy;
    }
    globalThis.AbortController = MockAbortController as any;

    const postSpy = vi.spyOn(api, 'post').mockImplementation(() => new Promise(() => {}));

    const { container } = renderWithProviders(
      <SubmitModal isOpen onClose={onClose} channelSlug={me.channel!.slug} channelId={me.channelId!} />,
      {
        route: '/dashboard',
        preloadedState: { auth: { user: me, loading: false, error: null } } as any,
      },
    );

    const fileInput = container.querySelector('input[type="file"][required]') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], 'test.webm', { type: 'video/webm' });
    await userEv.upload(fileInput, file);

    const submitButton = screen.getByRole('button', { name: /add/i });
    await waitFor(() => expect(submitButton).toBeEnabled());
    await userEv.click(submitButton);

    const cancelButton = await screen.findByRole('button', { name: /cancel/i });
    await userEv.click(cancelButton);
    expect(abortSpy).toHaveBeenCalled();

    postSpy.mockRestore();
    globalThis.AbortController = originalAbort;
  });

  it('shows retry after 429 error', async () => {
    const userEv = userEvent.setup();
    const onClose = vi.fn();
    const me = makeStreamerUser({ id: 'u1', channelId: 'c1' });

    const postSpy = vi.spyOn(api, 'post').mockRejectedValue({
      response: {
        status: 429,
        headers: { 'retry-after': '30' },
        data: { errorCode: 'RATE_LIMITED' },
      },
    } as any);

    const { container } = renderWithProviders(
      <SubmitModal isOpen onClose={onClose} channelSlug={me.channel!.slug} channelId={me.channelId!} />,
      {
        route: '/dashboard',
        preloadedState: { auth: { user: me, loading: false, error: null } } as any,
      },
    );

    const fileInput = container.querySelector('input[type="file"][required]') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], 'test.webm', { type: 'video/webm' });
    await userEv.upload(fileInput, file);

    const submitButton = screen.getByRole('button', { name: /add/i });
    await waitFor(() => expect(submitButton).toBeEnabled());
    await userEv.click(submitButton);

    await waitFor(() => expect(screen.getByRole('button', { name: /try again in/i })).toBeDisabled());

    postSpy.mockRestore();
  });
});
