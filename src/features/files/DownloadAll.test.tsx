import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MadarApi } from '../../api/calls';
import type { Attachment } from '../../api/contract/views';
import { RuntimeProvider, createQueryClient, type Runtime } from '../../app/runtime';
import { ToastProvider } from '../../app/toasts';
import { initI18n } from '../../i18n';
import { setNow } from '../../lib/dates';
import { parseZip } from '../../test/zipRead';
import { AttachmentList } from './PictureAttachments';
import { ZipTitleContext } from './zipTitle';

const file = (id: string, name: string | null, mimeType?: string): Attachment => ({ id, name, ...(mimeType ? { mimeType } : {}) });
const PLAN_A = file('fil_001', 'SITE PLAN.pdf', 'application/pdf');
const PLAN_B = file('fil_002', 'ANNEX FLOOR.pdf', 'application/pdf');
const PHOTO = file('fil_003', 'Site photo.jpg', 'image/jpeg');

type Call = { name: string; input: Record<string, unknown> };

let saved: { blob: Blob; name: string }[] = [];

/** `hold` keeps the fetch of the named file until the test lets it go. `status` makes a file answer with an error code. */
function renderList(files: Attachment[], o: { title?: string | null; mode?: 'remote' | 'prototype'; status?: Record<string, number>; hold?: string } = {}) {
  const calls: Call[] = [];
  const asked: string[] = [];
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const mode = o.mode ?? 'remote';
  const api = {
    call: async (name: string, input: Record<string, unknown>) => {
      calls.push({ name, input });
      if (name === 'files.link') return { url: `https://store.test/${String(input.id)}`, expiresAt: 'x', name: 'x.png', mimeType: 'image/png', size: 1 };
      if (name === 'files.get') return { blob: new Blob([`data of ${String(input.id)}`]), file: { file: { name: 'x' } } };
      throw new Error(`unexpected ${name}`);
    },
    run: async () => { throw new Error('not used'); },
  } as unknown as MadarApi;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const id = url.split('/').pop() as string;
    asked.push(id);
    if (id === o.hold) await gate;
    const code = o.status?.[id] ?? 200;
    return { ok: code === 200, status: code, blob: async () => new Blob([`body of ${id}`]) };
  }));
  initI18n('en');
  const runtime: Runtime = { api, mode };
  const list = <AttachmentList files={files} />;
  const view = render(
    <RuntimeProvider runtime={runtime} queryClient={createQueryClient({ remote: mode === 'remote' })}>
      <ToastProvider>{o.title === null ? list : <ZipTitleContext.Provider value={o.title ?? 'Corniche Tower'}>{list}</ZipTitleContext.Provider>}</ToastProvider>
    </RuntimeProvider>,
  );
  return { ...view, calls, asked, release };
}

beforeEach(() => {
  saved = [];
  setNow(new Date('2026-10-22T09:00:00Z'));
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    saved.push({ blob: blob as Blob, name: '' });
    return 'blob:zip';
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
    saved[saved.length - 1].name = this.download;
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('Download all under the files of a message or a comment (fbk_050)', () => {
  it('shows one quiet button with the count under two files or more', () => {
    renderList([PLAN_A, PLAN_B]);
    expect(screen.getByRole('button', { name: 'Download all (2)' })).toBeInTheDocument();
  });

  it('counts a picture, and shows the button for a picture and a file', () => {
    renderList([PHOTO, PLAN_A, PLAN_B]);
    expect(screen.getByRole('button', { name: 'Download all (3)' })).toBeInTheDocument();
  });

  it('shows no button under one file', () => {
    renderList([PLAN_A]);
    expect(screen.queryByRole('button', { name: /Download all/ })).toBeNull();
  });

  it('leaves out a deleted file, and shows no button when fewer than two files can be downloaded', () => {
    renderList([PLAN_A, file('fil_009', null)]);
    expect(screen.queryByRole('button', { name: /Download all/ })).toBeNull();
  });

  it('counts only the files that can be downloaded', () => {
    renderList([PLAN_A, PLAN_B, file('fil_009', null)]);
    expect(screen.getByRole('button', { name: 'Download all (2)' })).toBeInTheDocument();
  });

  it('saves one ZIP file named with the title and the day, with the files in order', async () => {
    const user = userEvent.setup();
    const { calls } = renderList([PLAN_A, PLAN_B]);
    await user.click(screen.getByRole('button', { name: 'Download all (2)' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].name).toBe('Corniche Tower 2026-10-22.zip');
    expect(calls.filter((c) => c.name === 'files.link').map((c) => c.input)).toEqual([
      { id: 'fil_001', variant: 'full', disposition: 'attachment' },
      { id: 'fil_002', variant: 'full', disposition: 'attachment' },
    ]);
    const zip = await parseZip(saved[0].blob);
    expect(zip.entries.map((entry) => entry.name)).toEqual(['SITE PLAN.pdf', 'ANNEX FLOOR.pdf']);
    expect(zip.entries.map((entry) => new TextDecoder().decode(entry.bytes))).toEqual(['body of fil_001', 'body of fil_002']);
    // The button goes back to its first words.
    expect(await screen.findByRole('button', { name: 'Download all (2)' })).toBeInTheDocument();
  });

  it('names the ZIP file with a safe title and the word Files when no title is given', async () => {
    const user = userEvent.setup();
    renderList([PLAN_A, PLAN_B], { title: 'Villa A/B: Phase 2' });
    await user.click(screen.getByRole('button', { name: 'Download all (2)' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].name).toBe('Villa A-B- Phase 2 2026-10-22.zip');
  });

  it('uses the word Files for the ZIP name where the screen gives no title', async () => {
    const user = userEvent.setup();
    renderList([PLAN_A, PLAN_B], { title: null });
    await user.click(screen.getByRole('button', { name: 'Download all (2)' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].name).toBe('Files 2026-10-22.zip');
  });

  it('shows "Preparing 1 of 2..." while it runs, takes no second press, and goes back after', async () => {
    const user = userEvent.setup();
    const { asked, release } = renderList([PLAN_A, PLAN_B], { hold: 'fil_001' });
    await user.click(screen.getByRole('button', { name: 'Download all (2)' }));
    const busy = await screen.findByRole('button', { name: 'Preparing 1 of 2...' });
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    await user.click(busy);
    await user.click(busy);
    release();
    await waitFor(() => expect(saved).toHaveLength(1));
    // One run only: each file was read once.
    expect(asked).toEqual(['fil_001', 'fil_002']);
    expect(await screen.findByRole('button', { name: 'Download all (2)' })).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('shows "Preparing 2 of 2..." when it reads the last file', async () => {
    const user = userEvent.setup();
    const { release } = renderList([PLAN_A, PLAN_B], { hold: 'fil_002' });
    await user.click(screen.getByRole('button', { name: 'Download all (2)' }));
    expect(await screen.findByRole('button', { name: 'Preparing 2 of 2...' })).toBeInTheDocument();
    release();
    await waitFor(() => expect(saved).toHaveLength(1));
  });

  it('reads the stored data in the prototype', async () => {
    const user = userEvent.setup();
    const { calls } = renderList([PLAN_A, PLAN_B], { mode: 'prototype' });
    await user.click(screen.getByRole('button', { name: 'Download all (2)' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(calls.map((c) => c.name)).toEqual(['files.get', 'files.get']);
  });

  it('names the file that failed in a toast with Retry, and Retry runs it again', async () => {
    const user = userEvent.setup();
    const { asked } = renderList([PLAN_A, PLAN_B], { status: { fil_002: 403 } });
    await user.click(screen.getByRole('button', { name: 'Download all (2)' }));
    expect(await screen.findByText('Madar could not read ANNEX FLOOR.pdf. No ZIP file was made.')).toBeInTheDocument();
    expect(saved).toHaveLength(0);
    // The button is ready again.
    expect(screen.getByRole('button', { name: 'Download all (2)' })).not.toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(asked).toEqual(['fil_001', 'fil_002', 'fil_001', 'fil_002']));
  });
});
