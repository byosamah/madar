import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEffect, useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useTranslation } from 'react-i18next';
import type { MadarApi } from '../api/calls';
import { ApiError } from '../api/errors';
import { initI18n } from '../i18n';
import { renderWithRuntime } from '../test/render';
import { downloadFile, isInlinePicture, limitText, remoteFileAdapters, uploadErrorMessage, useFileLimit, useFileLink, useFileUrl } from './files';
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

function renderRemote(ui: React.ReactElement, api: MadarApi) {
  initI18n('en');
  const runtime: Runtime = { api, mode: 'remote' };
  return render(
    <RuntimeProvider runtime={runtime} queryClient={createQueryClient()}>
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
});

describe('the file limit (plan 2b, point 1)', () => {
  function Limit() {
    const { t } = useTranslation();
    const limit = useFileLimit();
    return <p>{limitText(limit, t, 'en')}</p>;
  }

  it('uses the limit of the active store from session.get', async () => {
    const { api } = remoteApi({ limit: 50 * MB });
    renderRemote(<Limit />, api);
    expect(await screen.findByText('50 MB')).toBeInTheDocument();
  });

  it('uses the 250 MB ceiling in the prototype, which names no limit', async () => {
    await renderWithRuntime(<Limit />);
    expect(await screen.findByText('250 MB')).toBeInTheDocument();
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
