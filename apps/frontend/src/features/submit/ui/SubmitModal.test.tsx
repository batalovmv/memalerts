import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';

import SubmitModal from './SubmitModal';
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

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/components/TagInput', () => ({
  default: function TagInputMock(props: { tags: string[]; onChange: (tags: string[]) => void }) {
    return (
      <div data-testid="tag-input">
        <button type="button" onClick={() => props.onChange(['t1', 't2'])}>
          Set tags
        </button>
        <div data-testid="tags-value">{props.tags.join(',')}</div>
      </div>
    );
  },
}));

function installVideoMetadataMocks(durationSeconds = 1) {
  const originalCreateElement = document.createElement.bind(document);
  const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tagName: any) => {
    if (String(tagName).toLowerCase() !== 'video') return originalCreateElement(tagName);

    const el = originalCreateElement('video') as HTMLVideoElement;
    // Ensure duration is readable and finite in jsdom.
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
    // Trigger onloadedmetadata as soon as src is set.
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
        // Use microtask to keep it deterministic and avoid leaking timers across tests.
        queueMicrotask(trigger);
      },
      get() {
        return (el as any)._src ?? '';
      },
      configurable: true,
    });

    return el;
  });

  // jsdom may not implement these; install if missing, otherwise spy.
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
      // Remove our shim.
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

describe('SubmitModal (integration)', () => {
  it('uploads file and closes on success (status=pending)', async () => {
    const cleanupVideoMocks = installVideoMetadataMocks(1);
    const userEv = userEvent.setup();
    const onClose = vi.fn();
    const me = makeStreamerUser({ id: 'u1', channelId: 'c1' });

    const postSpy = vi.spyOn(api, 'post').mockResolvedValue({ status: 'pending' } as any);

    const { container } = renderWithProviders(
      <SubmitModal isOpen onClose={onClose} channelSlug={me.channel!.slug} channelId={me.channelId!} />,
      {
        route: '/dashboard',
        preloadedState: { auth: { user: me, loading: false, error: null } } as any,
      },
    );

    // Fill title
    const titleInput = container.querySelector('input[type="text"][required]') as HTMLInputElement;
    expect(titleInput).toBeTruthy();
    await userEv.type(titleInput, 'Test meme');

    // Upload file
    const fileInput = container.querySelector('input[type="file"][required]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();
    const file = new File([new Uint8Array([1, 2, 3])], 'test.webm', { type: 'video/webm' });
    await userEv.upload(fileInput, file);

    // Submit (use submit event directly: tooltip wrappers can prevent click-to-submit in jsdom).
    const form = container.querySelector('form') as HTMLFormElement;
    expect(form).toBeTruthy();
    await act(async () => {
      fireEvent.submit(form);
      // flush microtasks triggered by the video metadata mock
      await Promise.resolve();
    });

    const toast = (await import('react-hot-toast')).default as unknown as {
      success: ReturnType<typeof vi.fn>;
      error: ReturnType<typeof vi.fn>;
    };

    await waitFor(() => expect(postSpy).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);

    const { fetchSubmissions } = await import('@/store/slices/submissionsSlice');
    expect(fetchSubmissions).toHaveBeenCalled();

    postSpy.mockRestore();
    cleanupVideoMocks();
  });

  it('shows server error and does not close', async () => {
    const cleanupVideoMocks = installVideoMetadataMocks(1);
    const userEv = userEvent.setup();
    const onClose = vi.fn();
    const me = makeStreamerUser({ id: 'u1', channelId: 'c1' });

    const postSpy = vi.spyOn(api, 'post').mockRejectedValue({
      response: { status: 500, data: { error: 'Boom' } },
      message: 'Request failed',
    } as any);

    const { container } = renderWithProviders(
      <SubmitModal isOpen onClose={onClose} channelSlug={me.channel!.slug} channelId={me.channelId!} />,
      {
        route: '/dashboard',
        preloadedState: { auth: { user: me, loading: false, error: null } } as any,
      },
    );

    const titleInput = container.querySelector('input[type="text"][required]') as HTMLInputElement;
    await userEv.type(titleInput, 'Test meme');
    const fileInput = container.querySelector('input[type="file"][required]') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], 'test.webm', { type: 'video/webm' });
    await userEv.upload(fileInput, file);

    const form = container.querySelector('form') as HTMLFormElement;
    expect(form).toBeTruthy();
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    const toast = (await import('react-hot-toast')).default as unknown as {
      success: ReturnType<typeof vi.fn>;
      error: ReturnType<typeof vi.fn>;
    };

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();

    postSpy.mockRestore();
    cleanupVideoMocks();
  });

  it('import by URL: validates domain and does not call API for non-memealerts URLs', async () => {
    const userEv = userEvent.setup();
    const onClose = vi.fn();
    const me = makeStreamerUser({ id: 'u1', channelId: 'c1' });

    const postSpy = vi.spyOn(api, 'post').mockResolvedValue({ status: 'pending' } as any);

    const { container } = renderWithProviders(
      <SubmitModal isOpen onClose={onClose} channelSlug={me.channel!.slug} channelId={me.channelId!} />,
      {
        route: '/dashboard',
        preloadedState: { auth: { user: me, loading: false, error: null } } as any,
      },
    );

    // Switch to import mode.
    await userEv.click(screen.getByRole('tab', { name: /import/i }));

    const titleInput = container.querySelector('input[type="text"][required]') as HTMLInputElement;
    await userEv.type(titleInput, 'Import test');

    const urlInput = container.querySelector('input[type="url"][required]') as HTMLInputElement;
    expect(urlInput).toBeTruthy();
    await userEv.type(urlInput, 'https://example.com/not-allowed.webm');

    const form = container.querySelector('form') as HTMLFormElement;
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    const toast = (await import('react-hot-toast')).default as unknown as { error: ReturnType<typeof vi.fn> };
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(postSpy).not.toHaveBeenCalledWith('/submissions/import', expect.anything());
    expect(onClose).not.toHaveBeenCalled();

    postSpy.mockRestore();
  });

  it('import by URL: sends tags in payload and closes on success', async () => {
    const userEv = userEvent.setup();
    const onClose = vi.fn();
    const me = makeStreamerUser({ id: 'u1', channelId: 'c1' });

    const postSpy = vi.spyOn(api, 'post').mockResolvedValue({ status: 'approved', isDirectApproval: true } as any);

    const { container } = renderWithProviders(
      <SubmitModal isOpen onClose={onClose} channelSlug={me.channel!.slug} channelId={me.channelId!} />,
      {
        route: '/dashboard',
        preloadedState: { auth: { user: me, loading: false, error: null } } as any,
      },
    );

    await userEv.click(screen.getByRole('tab', { name: /import/i }));

    const titleInput = container.querySelector('input[type="text"][required]') as HTMLInputElement;
    await userEv.type(titleInput, 'Import test');

    const urlInput = container.querySelector('input[type="url"][required]') as HTMLInputElement;
    await userEv.type(urlInput, 'https://cdns.memealerts.com/p/x/alert_orig.webm');

    // Use TagInput mock to populate tags.
    await userEv.click(screen.getByRole('button', { name: /set tags/i }));
    expect(screen.getByTestId('tags-value')).toHaveTextContent('t1,t2');

    const form = container.querySelector('form') as HTMLFormElement;
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith('/submissions/import', expect.objectContaining({ title: 'Import test', sourceUrl: expect.any(String), tags: ['t1', 't2'], channelId: 'c1' })),
    );

    expect(onClose).toHaveBeenCalledTimes(1);
    postSpy.mockRestore();
  });

  it('import by URL: retry after error keeps user input (title/url/tags)', async () => {
    const userEv = userEvent.setup();
    const onClose = vi.fn();
    const me = makeStreamerUser({ id: 'u1', channelId: 'c1' });

    const postSpy = vi
      .spyOn(api, 'post')
      .mockRejectedValueOnce({ response: { status: 500, data: { error: 'Boom' } } } as any)
      .mockResolvedValueOnce({ status: 'pending' } as any);

    const { container } = renderWithProviders(
      <SubmitModal isOpen onClose={onClose} channelSlug={me.channel!.slug} channelId={me.channelId!} />,
      {
        route: '/dashboard',
        preloadedState: { auth: { user: me, loading: false, error: null } } as any,
      },
    );

    await userEv.click(screen.getByRole('tab', { name: /import/i }));

    const titleInput = container.querySelector('input[type="text"][required]') as HTMLInputElement;
    await userEv.type(titleInput, 'Retry title');

    const urlInput = container.querySelector('input[type="url"][required]') as HTMLInputElement;
    await userEv.type(urlInput, 'https://cdns.memealerts.com/p/x/alert_orig.webm');

    await userEv.click(screen.getByRole('button', { name: /set tags/i }));
    expect(screen.getByTestId('tags-value')).toHaveTextContent('t1,t2');

    const form = container.querySelector('form') as HTMLFormElement;

    // First attempt: server error
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    const toast = (await import('react-hot-toast')).default as unknown as { error: ReturnType<typeof vi.fn> };
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();

    // Inputs should remain.
    expect(titleInput.value).toBe('Retry title');
    expect(urlInput.value).toContain('cdns.memealerts.com');
    expect(screen.getByTestId('tags-value')).toHaveTextContent('t1,t2');

    // Second attempt: success
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(postSpy).toHaveBeenCalledTimes(2);
    postSpy.mockRestore();
  });
});


