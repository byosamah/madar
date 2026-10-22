import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MadarApi } from '../../../api/calls';
import type { FileView } from '../../../api/contract/views';
import { RuntimeProvider, createQueryClient, type Runtime } from '../../../app/runtime';
import { ToastProvider } from '../../../app/toasts';
import { initI18n } from '../../../i18n';
import { phoneMedia } from '../../../test/phoneMedia';
import { PreviewSheet } from './PreviewSheet';

afterEach(() => vi.restoreAllMocks());

const view = (id: string, name: string, mimeType: string): FileView => ({
  file: { id, projectId: 'prj_001', stageId: null, taskId: null, name, versions: [] },
  latest: { letter: 'B', blobKey: 'k', mimeType, size: 10, uploadedBy: 'usr_001', uploadedAt: '2026-09-29T10:00:00.000+03:00' },
} as unknown as FileView);

/** One build as the sheet sees it: the real build signs links with files.link, the prototype reads the data with files.get. */
function renderSheet(
  files: FileView | FileView[],
  mode: Runtime['mode'],
  o: { index?: number; onIndex?: (index: number) => void; hold?: boolean } = {},
) {
  initI18n('en');
  const views = Array.isArray(files) ? files : [files];
  const file = views[o.index ?? 0];
  const calls: { name: string; input: unknown }[] = [];
  let n = 0;
  // With hold, a files.link answer waits until release() runs (a signed link that is still on its way).
  const waiting: (() => void)[] = [];
  const api = {
    call: async (name: string, input: unknown) => {
      calls.push({ name, input });
      if (name === 'files.link') {
        n += 1;
        if (o.hold) await new Promise<void>((resolve) => { waiting.push(resolve); });
        return { url: `https://store.test/link-${n}`, expiresAt: 'x', name: file.file.name, mimeType: file.latest.mimeType, size: 10 };
      }
      if (name === 'files.get') return { blob: new Blob(['<svg/>'], { type: file.latest.mimeType }), file };
      throw new Error(`unexpected ${name}`);
    },
    run: async () => { throw new Error('not used'); },
  } as unknown as MadarApi;
  const runtime: Runtime = { api, mode };
  const result = render(
    <RuntimeProvider runtime={runtime} queryClient={createQueryClient()}>
      <ToastProvider><PreviewSheet views={views} index={o.index ?? 0} onIndex={o.onIndex ?? (() => undefined)} onClose={() => undefined} /></ToastProvider>
    </RuntimeProvider>,
  );
  return { ...result, calls, release: () => { for (const resolve of waiting.splice(0)) resolve(); } };
}

describe('the file preview (F3 repair)', () => {
  it('shows an SVG in the real build as the file icon and a download, and asks for no inline link (the store keeps it as a download)', async () => {
    const clicks: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicks.push(this.href); });
    const { calls } = renderSheet(view('fil_902', 'Site plan.svg', 'image/svg+xml'), 'remote');
    const sheet = await screen.findByRole('dialog', { name: 'Site plan.svg' });
    expect(within(sheet).getByText('There is no preview for this file type.')).toBeInTheDocument();
    expect(sheet.querySelector('img')).toBeNull();
    expect(sheet.querySelector('[data-file-icon] svg')).not.toBeNull();
    expect(calls).toEqual([]);
    await userEvent.click(within(sheet).getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(clicks).toEqual(['https://store.test/link-1']));
    expect(calls).toEqual([{ name: 'files.link', input: { id: 'fil_902', letter: 'B', variant: 'full', disposition: 'attachment' } }]);
  });

  it('shows a PNG in the real build in an img tag from an inline link', async () => {
    const { calls } = renderSheet(view('fil_903', 'Plan.png', 'image/png'), 'remote');
    const sheet = await screen.findByRole('dialog', { name: 'Plan.png' });
    await waitFor(() => expect(within(sheet).getByRole('img', { name: 'Plan.png' })).toHaveAttribute('src', 'https://store.test/link-1'));
    expect(calls).toEqual([{ name: 'files.link', input: { id: 'fil_903', letter: 'B', variant: 'full', disposition: 'inline' } }]);
    expect(within(sheet).queryByRole('button', { name: 'Download' })).toBeNull();
  });

  it('keeps the prototype as it is: an SVG shows in an img tag from the stored data', async () => {
    const { calls } = renderSheet(view('fil_002', 'Massing view.svg', 'image/svg+xml'), 'prototype');
    const sheet = await screen.findByRole('dialog', { name: 'Massing view.svg' });
    await waitFor(() => expect(within(sheet).getByRole('img', { name: 'Massing view.svg' })).toHaveAttribute('src', 'blob:madar-test'));
    expect(calls.map((call) => call.name)).toEqual(['files.get']);
    expect(within(sheet).queryByRole('button', { name: 'Download' })).toBeNull();
  });

  it.each(['prototype', 'remote'] as const)('keeps a file that is not a picture or a PDF (a .docx) as the plain line in the %s build', async (mode) => {
    const { calls } = renderSheet(view('fil_904', 'Brief.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), mode);
    const sheet = await screen.findByRole('dialog', { name: 'Brief.docx' });
    expect(within(sheet).getByText('There is no preview for this file type.')).toBeInTheDocument();
    expect(sheet.querySelector('[data-file-icon]')).toBeNull();
    expect(within(sheet).queryByRole('button', { name: 'Download' })).toBeNull();
    expect(calls).toEqual([]);
  });
});

describe('the file preview on a phone (phone D, P9)', () => {
  it('opens a picture in the full screen viewer, with no Previous or Next for one view', async () => {
    phoneMedia(true);
    const { calls } = renderSheet(view('fil_903', 'Plan.png', 'image/png'), 'remote');
    const viewer = await screen.findByRole('dialog', { name: 'Plan.png' });
    await waitFor(() => expect(viewer.querySelector('img[src="https://store.test/link-2"]')).not.toBeNull());
    expect(within(viewer).queryByRole('button', { name: 'Next picture' })).toBeNull();
    expect(within(viewer).queryByRole('button', { name: 'Previous picture' })).toBeNull();
    expect(calls.map((call) => (call.input as { variant: string }).variant).sort()).toEqual(['full', 'thumb']);
  });

  it('moves between several pictures with Next picture', async () => {
    phoneMedia(true);
    const moves: number[] = [];
    renderSheet([view('fil_903', 'Plan.png', 'image/png'), view('fil_905', 'Section.png', 'image/png')], 'remote', { onIndex: (index) => moves.push(index) });
    const viewer = await screen.findByRole('dialog', { name: 'Plan.png' });
    await userEvent.click(within(viewer).getByRole('button', { name: 'Next picture' }));
    expect(moves).toEqual([1]);
  });

  it('shows a PDF as a sheet with one real link, made after the signed link loaded', async () => {
    phoneMedia(true);
    const { release } = renderSheet(view('fil_906', 'Spec.pdf', 'application/pdf'), 'remote', { hold: true });
    const sheet = await screen.findByRole('dialog', { name: 'Spec.pdf' });
    const wait = within(sheet).getByRole('button', { name: 'Open the PDF' });
    expect(wait).toBeDisabled();
    expect(sheet.querySelector('iframe')).toBeNull();
    await act(async () => { release(); });
    const link = await within(sheet).findByRole('link', { name: 'Open the PDF' });
    expect(link).toHaveAttribute('href', 'https://store.test/link-1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('keeps the icon and the download for an SVG in the real build, as on a desk', async () => {
    phoneMedia(true);
    renderSheet(view('fil_902', 'Site plan.svg', 'image/svg+xml'), 'remote');
    const sheet = await screen.findByRole('dialog', { name: 'Site plan.svg' });
    expect(sheet.querySelector('[data-file-icon] svg')).not.toBeNull();
    expect(within(sheet).getByRole('button', { name: 'Download' })).toBeInTheDocument();
  });

  it('moves from a picture to a PDF in a mixed list', async () => {
    phoneMedia(true);
    renderSheet([view('fil_903', 'Plan.png', 'image/png'), view('fil_906', 'Spec.pdf', 'application/pdf')], 'remote', { index: 1 });
    const sheet = await screen.findByRole('dialog', { name: 'Spec.pdf' });
    expect(await within(sheet).findByRole('link', { name: 'Open the PDF' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Previous drawing' })).toBeEnabled();
  });

  it('asks for one new link when the viewer picture fails, and for no more', async () => {
    phoneMedia(true);
    const { calls } = renderSheet(view('fil_903', 'Plan.png', 'image/png'), 'remote');
    const viewer = await screen.findByRole('dialog', { name: 'Plan.png' });
    const fullAsked = () => calls.filter((call) => (call.input as { variant?: string }).variant === 'full').length;
    await waitFor(() => expect(viewer.querySelector('img[src="https://store.test/link-2"]')).not.toBeNull());
    fireEvent.error(viewer.querySelector('img[src="https://store.test/link-2"]') as HTMLImageElement);
    await waitFor(() => expect(fullAsked()).toBe(2));
    await waitFor(() => expect(viewer.querySelector('img[src="https://store.test/link-3"]')).not.toBeNull());
    fireEvent.error(viewer.querySelector('img[src="https://store.test/link-3"]') as HTMLImageElement);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(fullAsked()).toBe(2);
    // The small picture still shows, so the viewer does not say that the picture failed.
    expect(within(viewer).queryByText(/did not load/)).toBeNull();
  });
});
