import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEffect, useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useTranslation } from 'react-i18next';
import type { MadarApi } from '../api/calls';
import { ApiError } from '../api/errors';
import { initI18n } from '../i18n';
import { renderWithRuntime } from '../test/render';
import { LINK_STALE_MS, downloadFile, isInlinePicture, limitText, remoteFileAdapters, uploadErrorMessage, useFileLimit, useFileLink, useFileUrl, useScreenshotLink } from './files';
import type { QueryClient } from '@tanstack/react-query';
import { RuntimeProvider, createQueryClient, useRuntime, type Runtime } from './runtime';
import { ToastProvider } from './toasts';

const MB = 1024 * 1024;

/** A remote API stub: files.link gives a new URL on each call, session.get gives the limit of the store. */
function remoteApi(o: { limit?: number } = {}) {
  const calls: { name: string; input: unknown }[] = [];
  let n = 0;
  const api = {
    call: async (name: string, input: unknown) => {
      calls.push({ name, input });
      if (name === 'files.link') {
        n += 1;
        return { url: `https://store.test/link-${n}`, expiresAt: 'x', name: 'Plan.png', mimeType: 'image/png', size: 1 };
      }
      if (name === 'session.get') return { limits: o.limit ? { maxFileBytes: o.limit } : undefined };
      throw new Error(`unexpected ${name}`);
    },
    run: async () => { throw new Error('not used'); },
  } as unknown as MadarApi;
  return { api, calls };
}

function renderRemote(ui: React.ReactElement, api: MadarApi, queryClient: QueryClient = createQueryClient()) {
  initI18n('en');
  const runtime: Runtime = { api, mode: 'remote' };
  return render(
    <RuntimeProvider runtime={runtime} queryClient={queryClient}>
      <ToastProvider>{ui}</ToastProvider>
    </RuntimeProvider>,
  );
}

function Picture({ variant }: { variant: 'full' | 'thumb' }) {
  const { url, onError } = useFileLink('fil_001', 'B', variant);
  return url ? <img src={url} alt="Plan" onError={onError} /> : <span>Loading</span>;
}

afterEach(() => vi.restoreAllMocks());

describe('file links in the real build (plan 5.2)', () => {
  it('asks files.link for an inline link of the variant, and shows it', async () => {
    const { api, calls } = remoteApi();
    renderRemote(<Picture variant="thumb" />, api);
    expect(await screen.findByRole('img', { name: 'Plan' })).toHaveAttribute('src', 'https://store.test/link-1');
    expect(calls).toEqual([{ name: 'files.link', input: { id: 'fil_001', letter: 'B', variant: 'thumb', disposition: 'inline' } }]);
  });

  it('asks for a new link once when the picture breaks, and not again', async () => {
    const { api, calls } = remoteApi();
    renderRemote(<Picture variant="full" />, api);
    const img = await screen.findByRole('img', { name: 'Plan' });
    fireEvent.error(img);
    await waitFor(() => expect(screen.getByRole('img', { name: 'Plan' })).toHaveAttribute('src', 'https://store.test/link-2'));
    fireEvent.error(screen.getByRole('img', { name: 'Plan' }));
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(calls.filter((c) => c.name === 'files.link')).toHaveLength(2);
  });

  it('gives up on a picture that breaks again after the new link, so the screen shows its fallback', async () => {
    const { api, calls } = remoteApi();
    renderRemote(<Picture variant="thumb" />, api);
    fireEvent.error(await screen.findByRole('img', { name: 'Plan' }));
    await waitFor(() => expect(screen.getByRole('img', { name: 'Plan' })).toHaveAttribute('src', 'https://store.test/link-2'));
    fireEvent.error(screen.getByRole('img', { name: 'Plan' }));
    expect(await screen.findByText('Loading')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Plan' })).toBeNull();
    expect(calls.filter((c) => c.name === 'files.link')).toHaveLength(2);
  });

  it('keeps a signed link for LINK_STALE_MS after the picture goes, so a screen that opens again shows it and asks nothing (performance audit BGR-4)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { api, calls } = remoteApi();
      const queryClient = createQueryClient({ remote: true });
      const first = renderRemote(<Picture variant="thumb" />, api, queryClient);
      expect(await screen.findByRole('img', { name: 'Plan' })).toHaveAttribute('src', 'https://store.test/link-1');
      first.unmount();
      // Six minutes away: past the 5-minute default of the query cache, within the 8 minutes of the link.
      await act(() => vi.advanceTimersByTimeAsync(6 * 60 * 1000));
      const second = renderRemote(<Picture variant="thumb" />, api, queryClient);
      expect(screen.getByRole('img', { name: 'Plan' })).toHaveAttribute('src', 'https://store.test/link-1');
      expect(calls.filter((c) => c.name === 'files.link')).toHaveLength(1);
      second.unmount();
      // Past LINK_STALE_MS the cache lets the link go, so the next screen asks for a new one.
      await act(() => vi.advanceTimersByTimeAsync(LINK_STALE_MS + 1000));
      renderRemote(<Picture variant="thumb" />, api, queryClient);
      expect(await screen.findByRole('img', { name: 'Plan' })).toHaveAttribute('src', 'https://store.test/link-2');
      expect(calls.filter((c) => c.name === 'files.link')).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('isInlinePicture takes only the pictures that the server shows inline (isPictureType in server/files/links.ts)', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'IMAGE/PNG', ' image/png; charset=x ']) expect(isInlinePicture(type), type).toBe(true);
    for (const type of ['image/svg+xml', 'image/x-icon', 'image/heic', 'image/bmp', 'image/png, image/svg+xml', 'application/pdf', '']) expect(isInlinePicture(type), type).toBe(false);
  });

  it('downloadFile asks for a download link (attachment) and opens it', async () => {
    const { api, calls } = remoteApi();
    const clicks: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicks.push(this.href); });
    await downloadFile(api, 'fil_001', 'A', { remote: true });
    expect(calls).toEqual([{ name: 'files.link', input: { id: 'fil_001', letter: 'A', variant: 'full', disposition: 'attachment' } }]);
    expect(clicks).toEqual(['https://store.test/link-1']);
  });

  it('gives the screens the two adapters of the real build', () => {
    const adapters = remoteFileAdapters();
    expect(Object.keys(adapters).sort()).toEqual(['feedback.send', 'files.upload']);
  });
});

describe('file URLs in the prototype', () => {
  function Stored() {
    const { api } = useRuntime();
    const [fileId, setFileId] = useState<string | null>(null);
    useEffect(() => {
      void api.call('files.upload', { projectId: 'prj_001', name: 'Note.png', blob: new Blob(['x'], { type: 'image/png' }) })
        .then((view) => setFileId(view.file.id));
    }, [api]);
    const url = useFileUrl(fileId);
    return url ? <img src={url} alt="Stored" /> : <span>Loading</span>;
  }

  it('reads the stored data with files.get and releases the URL when the picture goes', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const view = await renderWithRuntime(<Stored />, (state) => { state.session.currentUserId = 'usr_002'; });
    expect(await screen.findByRole('img', { name: 'Stored' })).toHaveAttribute('src', 'blob:madar-test');
    view.unmount();
    expect(revoke).toHaveBeenCalledWith('blob:madar-test');
  });

  it('keeps the 5-minute default of the query cache for the stored data (only signed links stay for LINK_STALE_MS)', async () => {
    const api = {
      call: async (name: string) => {
        if (name === 'files.get') return { blob: new Blob(['x'], { type: 'image/png' }) };
        throw new Error(`unexpected ${name}`);
      },
      run: async () => { throw new Error('not used'); },
    } as unknown as MadarApi;
    const queryClient = createQueryClient();
    initI18n('en');
    render(
      <RuntimeProvider runtime={{ api, mode: 'prototype' }} queryClient={queryClient}>
        <Picture variant="thumb" />
      </RuntimeProvider>,
    );
    expect(await screen.findByRole('img', { name: 'Plan' })).toHaveAttribute('src', 'blob:madar-test');
    expect(queryClient.getQueryCache().find({ queryKey: ['file-blob', 'fil_001', 'B'] })?.gcTime).toBe(5 * 60 * 1000);
  });
});

describe('report screenshot links (spec 4.3)', () => {
  function Shot({ id }: { id: string }) {
    const { url, onError, broken } = useScreenshotLink(id, 0);
    if (broken) return <span>Broken</span>;
    return url ? <img src={url} alt="Shot" onError={onError} /> : <span>Loading</span>;
  }

  /** A remote stub: feedback.screenshot answers as the real build does, with a signed link (wire.output). */
  function shotApi() {
    const calls: { name: string; input: unknown }[] = [];
    const api = {
      call: async (name: string, input: unknown) => {
        calls.push({ name, input });
        if (name === 'feedback.screenshot') return { url: `https://store.test/shot-${calls.length}`, expiresAt: 'x' };
        throw new Error(`unexpected ${name}`);
      },
      run: async () => { throw new Error('not used'); },
    } as unknown as MadarApi;
    return { api, calls };
  }

  it('asks feedback.screenshot for a signed link in the real build, and keeps it for LINK_STALE_MS', async () => {
    const { api, calls } = shotApi();
    const queryClient = createQueryClient({ remote: true });
    renderRemote(<Shot id="fbk_001" />, api, queryClient);
    expect(await screen.findByRole('img', { name: 'Shot' })).toHaveAttribute('src', 'https://store.test/shot-1');
    expect(calls).toEqual([{ name: 'feedback.screenshot', input: { id: 'fbk_001', index: 0 } }]);
    const query = queryClient.getQueryCache().find({ queryKey: ['feedback-shot-link', 'fbk_001', 0] });
    expect(query?.observers[0]?.options.staleTime).toBe(LINK_STALE_MS);
  });

  it('keeps a screenshot link in the cache for LINK_STALE_MS after the picture goes, as a file link (performance audit BGR-4)', async () => {
    const { api } = shotApi();
    const queryClient = createQueryClient({ remote: true });
    const view = renderRemote(<Shot id="fbk_001" />, api, queryClient);
    expect(await screen.findByRole('img', { name: 'Shot' })).toHaveAttribute('src', 'https://store.test/shot-1');
    view.unmount();
    expect(queryClient.getQueryCache().find({ queryKey: ['feedback-shot-link', 'fbk_001', 0] })?.gcTime).toBe(LINK_STALE_MS);
  });

  it('asks for one new link when the picture breaks, then gives up', async () => {
    const { api, calls } = shotApi();
    renderRemote(<Shot id="fbk_001" />, api);
    fireEvent.error(await screen.findByRole('img', { name: 'Shot' }));
    await waitFor(() => expect(screen.getByRole('img', { name: 'Shot' })).toHaveAttribute('src', 'https://store.test/shot-2'));
    fireEvent.error(screen.getByRole('img', { name: 'Shot' }));
    expect(await screen.findByText('Broken')).toBeInTheDocument();
    expect(calls).toHaveLength(2);
  });

  it('counts a strike against a link: two pictures of one bad link ask once and show the new link (review, 2026-10-07, S3)', async () => {
    // One hook feeds two pictures, as the thumbnail and the sheet of a screenshot.
    function TwoPictures() {
      const { url, onError, broken } = useScreenshotLink('fbk_001', 0);
      if (broken) return <span>Broken</span>;
      return url ? <><img src={url} alt="Shot" onError={onError} /><img src={url} alt="Shot" onError={onError} /></> : <span>Loading</span>;
    }
    const { api, calls } = shotApi();
    renderRemote(<TwoPictures />, api);
    await waitFor(() => expect(screen.getAllByRole('img', { name: 'Shot' })).toHaveLength(2));
    for (const img of screen.getAllByRole('img', { name: 'Shot' })) fireEvent.error(img);
    await waitFor(() => expect(screen.getAllByRole('img', { name: 'Shot' }).map((img) => img.getAttribute('src'))).toEqual(['https://store.test/shot-2', 'https://store.test/shot-2']));
    expect(screen.queryByText('Broken')).toBeNull();
    expect(calls).toHaveLength(2);
  });

  it('is broken when the sign fails', async () => {
    const api = {
      call: async () => { throw new ApiError('forbidden', 'You cannot do this.'); },
      run: async () => { throw new Error('not used'); },
    } as unknown as MadarApi;
    renderRemote(<Shot id="fbk_001" />, api);
    expect(await screen.findByText('Broken')).toBeInTheDocument();
  });

  it('reads the stored picture in the prototype and releases the URL when the picture goes', async () => {
    function Sent() {
      const { api } = useRuntime();
      const [id, setId] = useState<string | null>(null);
      useEffect(() => {
        void api.call('feedback.send', { kind: 'bug', message: 'The board does not scroll.', page: '/projects', screenshots: [new Blob(['x'], { type: 'image/png' })] })
          .then((report) => setId(report.id));
      }, [api]);
      return id ? <Shot id={id} /> : <span>Sending</span>;
    }
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const view = await renderWithRuntime(<Sent />);
    expect(await screen.findByRole('img', { name: 'Shot' })).toHaveAttribute('src', 'blob:madar-test');
    view.unmount();
    expect(revoke).toHaveBeenCalledWith('blob:madar-test');
  });
});

describe('the file limit (plan 2b, point 1)', () => {
  function Limit({ place }: { place?: { projectId?: string | null; conversationId?: string } }) {
    const { t } = useTranslation();
    const limit = useFileLimit(place);
    return <p>{limitText(limit, t, 'en')}</p>;
  }

  it('uses the limit of the active store from session.get', async () => {
    const { api } = remoteApi({ limit: 50 * MB });
    renderRemote(<Limit />, api);
    expect(await screen.findByText('50 MB')).toBeInTheDocument();
  });

  it('uses the 500 MB ceiling in the prototype, which names no limit', async () => {
    await renderWithRuntime(<Limit />);
    expect(await screen.findByText('500 MB')).toBeInTheDocument();
  });

  it('gives 500 MB for the files of a project and 250 MB for a chat, also when the store takes 500 MB (fbk_070)', async () => {
    const { api } = remoteApi({ limit: 500 * MB });
    const project = renderRemote(<Limit place={{ projectId: 'prj_001' }} />, api);
    expect(await screen.findByText('500 MB')).toBeInTheDocument();
    project.unmount();
    renderRemote(<Limit place={{ projectId: null, conversationId: 'cnv_001' }} />, api);
    expect(await screen.findByText('250 MB')).toBeInTheDocument();
  });

  it('keeps a lower store limit for every place', async () => {
    const { api } = remoteApi({ limit: 50 * MB });
    renderRemote(<Limit place={{ projectId: 'prj_001' }} />, api);
    expect(await screen.findByText('50 MB')).toBeInTheDocument();
  });

  it('names the limit in plain words in English and in Arabic', () => {
    const en = initI18n('en');
    expect(uploadErrorMessage(new ApiError('invalid_input', 'x', { reason: 'file_too_large', limit: 50 * MB }), 'Model.rvt', en.t, 'en')).toBe('Model.rvt is larger than 50 MB.');
    expect(uploadErrorMessage(new ApiError('failed', 'x', { reason: 'upload_failed' }), 'Model.rvt', en.t, 'en')).toBe('The file did not upload. Try again.');
    const ar = initI18n('ar');
    expect(uploadErrorMessage(new ApiError('invalid_input', 'x', { reason: 'file_too_large', limit: 50 * MB }), 'Model.rvt', ar.t, 'ar')).toBe('حجم Model.rvt أكبر من 50 ميغابايت.');
    initI18n('en');
  });
});
