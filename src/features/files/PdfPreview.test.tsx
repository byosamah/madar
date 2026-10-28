import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MadarApi } from '../../api/calls';
import type { Attachment } from '../../api/contract/views';
import type { State } from '../../api/store';
import { RuntimeProvider, createQueryClient, type Runtime } from '../../app/runtime';
import { ToastProvider } from '../../app/toasts';
import { initI18n } from '../../i18n';
import { renderApp } from '../../test/render';
import { stubPhone } from '../inbox/phoneHarness';
import { AttachmentList } from './PictureAttachments';

/**
 * A PDF in a chat message or a comment opens a preview before it downloads (tsk_485, owner 2026-10-28: "there should be a preview in chats
 * and comments when I open it, before I download it"). It is the preview of the Files tab (PreviewSheet), with Download inside. Every
 * other file type keeps the chip that downloads at once. The preview asks files.link as the person, as the download does. On a phone the
 * PDF is a sheet with one real link, because Safari for iPhone blocks a window that opens after a wait.
 */
const file = (id: string, name: string | null, mimeType?: string): Attachment => ({ id, name, ...(mimeType ? { mimeType } : {}) });
const PLAN = file('fil_004', 'Plan.pdf', 'application/pdf');
const SHEET = file('fil_005', 'Quantities.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

type Call = { name: string; input: Record<string, unknown> };

/** The list in the real build: files.link signs a new link on each call. The stub records every call. */
function renderList(files: Attachment[], o: { refuse?: boolean } = {}) {
  const calls: Call[] = [];
  let n = 0;
  const api = {
    call: async (name: string, input: Record<string, unknown>) => {
      calls.push({ name, input });
      if (name === 'files.link') {
        if (o.refuse) throw Object.assign(new Error('You cannot open this file.'), { code: 'not_found' });
        n += 1;
        return { url: `https://store.test/${String(input.disposition)}-${String(input.id)}-${n}`, expiresAt: 'x', name: 'Plan.pdf', mimeType: 'application/pdf', size: 1 };
      }
      throw new Error(`unexpected ${name}`);
    },
    run: async () => { throw new Error('not used'); },
  } as unknown as MadarApi;
  initI18n('en');
  const runtime: Runtime = { api, mode: 'remote' };
  render(
    <RuntimeProvider runtime={runtime} queryClient={createQueryClient({ remote: true })}>
      <ToastProvider><AttachmentList files={files} /></ToastProvider>
    </RuntimeProvider>,
  );
  return { calls, links: () => calls.filter((c) => c.name === 'files.link').map((c) => c.input) };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('a PDF in a message or a comment (tsk_485)', () => {
  it('shows a PDF as a chip that previews, asks for no link before the press, and leaves every other type as a download chip', async () => {
    const { calls } = renderList([PLAN, SHEET]);
    expect(await screen.findByRole('button', { name: 'Preview Plan.pdf' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download Plan.pdf' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Download Quantities.xlsx' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Preview Quantities.xlsx' })).toBeNull();
    expect(calls).toEqual([]);
  });

  it('opens the preview of the Files tab on a press, with the PDF in a frame, and downloads only from the Download button inside', async () => {
    const save = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const { links } = renderList([PLAN]);
    await userEvent.click(await screen.findByRole('button', { name: 'Preview Plan.pdf' }));
    const sheet = await screen.findByRole('dialog', { name: 'Plan.pdf' });
    // The preview asks files.link as the person, for the inline view. Nothing saves yet.
    await waitFor(() => expect(sheet.querySelector('iframe')).toHaveAttribute('src', 'https://store.test/inline-fil_004-1'));
    expect(links()).toEqual([{ id: 'fil_004', letter: undefined, variant: 'full', disposition: 'inline' }]);
    expect(save).not.toHaveBeenCalled();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(links().at(-1)).toMatchObject({ id: 'fil_004', disposition: 'attachment' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Plan.pdf' })).toBeNull());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Preview Plan.pdf' })).toBeInTheDocument());
  });

  it('opens a sheet with one real link on a phone, made after the signed link has loaded', async () => {
    stubPhone();
    renderList([PLAN]);
    await userEvent.click(await screen.findByRole('button', { name: 'Preview Plan.pdf' }));
    const sheet = await screen.findByRole('dialog', { name: 'Plan.pdf' });
    const link = await within(sheet).findByRole('link', { name: 'Open the PDF' });
    expect(link).toHaveAttribute('href', 'https://store.test/inline-fil_004-1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(sheet.querySelector('iframe')).toBeNull();
  });

  it('keeps the rights of the download: a refused link shows no PDF, never one', async () => {
    renderList([PLAN], { refuse: true });
    await userEvent.click(await screen.findByRole('button', { name: 'Preview Plan.pdf' }));
    const sheet = await screen.findByRole('dialog', { name: 'Plan.pdf' });
    await waitFor(() => expect(sheet.querySelector('iframe')).toBeNull());
    expect(within(sheet).queryByRole('link')).toBeNull();
  });

  it('also has a Download button in the phone sheet, so a person can save from inside it', async () => {
    stubPhone();
    const save = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    renderList([PLAN]);
    await userEvent.click(await screen.findByRole('button', { name: 'Preview Plan.pdf' }));
    const sheet = await screen.findByRole('dialog', { name: 'Plan.pdf' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  });

  it('keeps a removed file as removed, with no preview', () => {
    renderList([file('fil_006', null, 'application/pdf')]);
    expect(screen.getByText('File removed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Preview/ })).toBeNull();
  });
});

const as = (userId: string) => (state: State) => { state.session.currentUserId = userId; };

describe('a PDF in the chats and the comments of the screens', () => {
  it('previews a PDF of a direct chat before it downloads', async () => {
    const save = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await renderApp('/inbox/cnv_013');
    await userEvent.upload(await screen.findByLabelText('Attach files'), new File(['x'], 'Brief.pdf', { type: 'application/pdf' }));
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    const log = within(await screen.findByRole('log', { name: 'Messages' }));
    await userEvent.click(await log.findByRole('button', { name: 'Preview Brief.pdf' }));
    const sheet = await screen.findByRole('dialog', { name: 'Brief.pdf' });
    expect(save).not.toHaveBeenCalled();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(save).toHaveBeenCalled());
  });

  it('previews a PDF of a project chat', async () => {
    await renderApp('/inbox');
    const list = within(await screen.findByRole('list', { name: 'Chats' }));
    await userEvent.click(list.getByRole('link', { name: /Corniche Office Tower/ }));
    await userEvent.upload(await screen.findByLabelText('Attach files'), new File(['x'], 'Beam B14.pdf', { type: 'application/pdf' }));
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Preview Beam B14.pdf' }));
    expect(await screen.findByRole('dialog', { name: 'Beam B14.pdf' })).toBeInTheDocument();
  });

  it('previews a PDF of a to-do comment, and keeps another type as a download chip', async () => {
    await renderApp('/projects/prj_001?tab=tasks&task=tsk_007&thread=1', as('usr_006'));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    await userEvent.upload(
      within(sheet).getByLabelText('Attach files'),
      [new File(['x'], 'Stair detail.pdf', { type: 'application/pdf' }), new File(['y'], 'Stair list.xlsx', { type: 'application/vnd.ms-excel' })],
    );
    await userEvent.type(within(sheet).getByRole('textbox', { name: 'Add a comment' }), 'Detail attached.');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Send' }));
    expect(await within(sheet).findByRole('button', { name: 'Download Stair list.xlsx' })).toBeInTheDocument();
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Preview Stair detail.pdf' }));
    expect(await screen.findByRole('dialog', { name: 'Stair detail.pdf' })).toBeInTheDocument();
  });
});
