import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';

import SubmitModal from '../ui/SubmitModal';
import { renderWithProviders } from '@/test/test-utils';
import { makeStreamerUser } from '@/test/fixtures/user';
import { api } from '@/lib/api';

vi.mock('@/store/slices/submissionsSlice', async () => {
  const actual = await vi.importActual<any>('@/store/slices/submissionsSlice');
  return {
    ...actual,
    fetchSubmissions: vi.fn(() => ({ type: 'submissions/fetchSubmissions/mock' })),
  };
});

vi.mock('@/store/slices/memesSlice', async () => {
  const actual = await vi.importActual<any>('@/store/slices/memesSlice');
  return {
    ...actual,
    fetchMemes: vi.fn(() => ({ type: 'memes/fetchMemes/mock' })),
  };
});

function installVideoMetadataMocks(durationSeconds = 1) {
  const originalCreateElement = document.createElement.bind(document);
  const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tagName: any) => {
    if (String(tagName).toLowerCase() !== 'video') return originalCreateElement(tagName);

    const el = originalCreateElement('video') as HTMLVideoElement;
    try {
      Object.defineProperty(el, 'duration', {
        get() {
          return durationSeconds;
        },
        configurable: true,
      });
    } catch {
      // ignore
    }
    Object.defineProperty(el, 'src', {
      set(_v) {
        (el as any)._src = _v;
        const trigger = () => {
          try {
            el.onloadedmetadata?.(new Event('loadedmetadata') as any);
          } catch {
            // ignore
          }
          try {
            el.onerror?.(new Event('error') as any);
          } catch {
            // ignore
          }
        };
        queueMicrotask(trigger);
      },
      get() {
        return (el as any)._src ?? '';
      },
      configurable: true,
    });

    return el;
  });

  const hadCreateObjectURL = typeof (URL as any).createObjectURL === 'function';
  const hadRevokeObjectURL = typeof (URL as any).revokeObjectURL === 'function';

  let createObjectURLSpy: ReturnType<typeof vi.spyOn> | null = null;
  let revokeObjectURLSpy: ReturnType<typeof vi.spyOn> | null = null;

  if (hadCreateObjectURL) {
    createObjectURLSpy = vi.spyOn(URL as any, 'createObjectURL').mockReturnValue('blob:mock');
  } else {
    Object.defineProperty(URL, 'createObjectURL', {
      value: () => 'blob:mock',
      configurable: true,
      writable: true,
    });
  }

  if (hadRevokeObjectURL) {
    revokeObjectURLSpy = vi.spyOn(URL as any, 'revokeObjectURL').mockImplementation(() => {});
  } else {
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: () => {},
      configurable: true,
      writable: true,
    });
  }

  return () => {
    createElementSpy.mockRestore();
    if (createObjectURLSpy) createObjectURLSpy.mockRestore();
    else {
      try {
        // @ts-expect-error runtime delete
        delete (URL as any).createObjectURL;
      } catch {
        // ignore
      }
    }
    if (revokeObjectURLSpy) revokeObjectURLSpy.mockRestore();
    else {
      try {
        // @ts-expect-error runtime delete
        delete (URL as any).revokeObjectURL;
      } catch {
        // ignore
      }
    }
  };
}

const renderSubmitModal = (channelSlug: string, channelId: string, onClose: () => void, preloadedState: unknown) => {
  return renderWithProviders(<SubmitModal isOpen onClose={onClose} channelSlug={channelSlug} channelId={channelId} />, {
    route: '/dashboard',
    preloadedState,
  });
};

describe('Upload flow', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows progress during upload', async () => {
    const cleanupVideoMocks = installVideoMetadataMocks(1);
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

    try {
      const { container } = renderSubmitModal(me.channel!.slug, me.channelId!, onClose, {
        auth: { user: me, loading: false, error: null },
      } as any);

      const fileInput = container.querySelector('input[type="file"][required]') as HTMLInputElement;
      const file = new File([new Uint8Array([1, 2, 3])], 'test.webm', { type: 'video/webm' });
      await userEv.upload(fileInput, file);

      await waitFor(() => expect(screen.getByRole('button', { name: /add/i })).toBeEnabled());

      const form = container.querySelector('form') as HTMLFormElement;
      expect(form).toBeTruthy();
      await act(async () => {
        fireEvent.submit(form);
        await Promise.resolve();
      });

      await waitFor(() => expect(screen.getByText(/uploading/i)).toBeInTheDocument());
      expect(screen.getByText(/50%/i)).toBeInTheDocument();

      await act(async () => {
        resolvePost?.({ status: 'pending' });
      });
    } finally {
      postSpy.mockRestore();
      cleanupVideoMocks();
    }
  });

  it('cancels upload on cancel click', async () => {
    const cleanupVideoMocks = installVideoMetadataMocks(1);
    const userEv = userEvent.setup();
    const onClose = vi.fn();
    const me = makeStreamerUser({ id: 'u1', channelId: 'c1' });
    const abortSpy = vi.fn();

    const originalAbort = globalThis.AbortController;
    class MockAbortController {
      signal = {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as unknown as AbortSignal;
      abort = abortSpy;
    }
    globalThis.AbortController = MockAbortController as any;

    const postSpy = vi.spyOn(api, 'post').mockImplementation(() => new Promise(() => {}));

    try {
      const { container } = renderSubmitModal(me.channel!.slug, me.channelId!, onClose, {
        auth: { user: me, loading: false, error: null },
      } as any);

      const fileInput = container.querySelector('input[type="file"][required]') as HTMLInputElement;
      const file = new File([new Uint8Array([1, 2, 3])], 'test.webm', { type: 'video/webm' });
      await userEv.upload(fileInput, file);

      await waitFor(() => expect(screen.getByRole('button', { name: /add/i })).toBeEnabled());

      const form = container.querySelector('form') as HTMLFormElement;
      expect(form).toBeTruthy();
      await act(async () => {
        fireEvent.submit(form);
        await Promise.resolve();
      });

      await waitFor(() => expect(screen.getByText(/uploading/i)).toBeInTheDocument());
      const cancelButtons = screen.getAllByRole('button', { name: /cancel/i });
      const uploadCancelButton = cancelButtons[cancelButtons.length - 1];
      await userEv.click(uploadCancelButton);
      expect(abortSpy).toHaveBeenCalled();
    } finally {
      postSpy.mockRestore();
      globalThis.AbortController = originalAbort;
      cleanupVideoMocks();
    }
  });

  it('shows retry after 429 error', async () => {
    const cleanupVideoMocks = installVideoMetadataMocks(1);
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

    try {
      const { container } = renderSubmitModal(me.channel!.slug, me.channelId!, onClose, {
        auth: { user: me, loading: false, error: null },
      } as any);

      const fileInput = container.querySelector('input[type="file"][required]') as HTMLInputElement;
      const file = new File([new Uint8Array([1, 2, 3])], 'test.webm', { type: 'video/webm' });
      await userEv.upload(fileInput, file);

      await waitFor(() => expect(screen.getByRole('button', { name: /add/i })).toBeEnabled());

      const form = container.querySelector('form') as HTMLFormElement;
      expect(form).toBeTruthy();
      await act(async () => {
        fireEvent.submit(form);
        await Promise.resolve();
      });

      await waitFor(() => expect(screen.getByRole('button', { name: /try again in/i })).toBeDisabled());
    } finally {
      postSpy.mockRestore();
      cleanupVideoMocks();
    }
  });
});
