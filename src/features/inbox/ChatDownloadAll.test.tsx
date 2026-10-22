import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { todayISO } from '../../lib/dates';
import { parseZip } from '../../test/zipRead';
import { renderApp } from '../../test/render';

let saved: { blob: Blob; name: string }[] = [];

beforeEach(() => {
  saved = [];
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    saved.push({ blob: blob as Blob, name: '' });
    return 'blob:zip';
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
    saved[saved.length - 1].name = this.download;
  });
});
afterEach(() => vi.restoreAllMocks());

const rowLink = async (name: RegExp) => within(await screen.findByRole('list', { name: 'Chats' })).getByRole('link', { name });
const pdf = (name: string) => new File([`data of ${name}`], name, { type: 'application/pdf' });

describe('Download all under a chat message and a to-do comment (fbk_050)', () => {
  it('names the ZIP file of a project chat message with the chat title and the day', async () => {
    await renderApp('/inbox');
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    await userEvent.type(await screen.findByRole('textbox', { name: 'Message' }), 'The two drawings.');
    await userEvent.upload(screen.getByLabelText('Attach files'), [pdf('Site plan.pdf'), pdf('Annex floor.pdf')]);
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Download all (2)' }, { timeout: 10_000 }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].name).toBe(`Corniche Office Tower ${todayISO()}.zip`);
    const zip = await parseZip(saved[0].blob);
    expect(zip.entries.map((entry) => entry.name).sort()).toEqual(['Annex floor.pdf', 'Site plan.pdf']);
  }, 30_000);

  it('names the ZIP file of a to-do comment with the title of the to-do', async () => {
    const { store } = await renderApp('/inbox/tsk_001');
    const title = store.state.tasks.tsk_001.title;
    await userEvent.type(await screen.findByRole('textbox', { name: 'Message' }, { timeout: 10_000 }), 'Both sheets.');
    await userEvent.upload(screen.getByLabelText('Attach files'), [pdf('Sheet A.pdf'), pdf('Sheet B.pdf')]);
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Download all (2)' }, { timeout: 10_000 }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].name).toBe(`${title.replace(/[/\\:*?"<>|]/g, '-')} ${todayISO()}.zip`);
  }, 30_000);

  it('names the ZIP file of a comment in the to-do panel with the title of the to-do', async () => {
    await renderApp('/projects/prj_001?tab=tasks&task=tsk_007&thread=1', (state) => { state.session.currentUserId = 'usr_006'; });
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' }, { timeout: 10_000 });
    await userEvent.type(within(sheet).getByRole('textbox', { name: 'Add a comment' }), 'Both stair sheets.');
    await userEvent.upload(within(sheet).getByLabelText('Attach files'), [pdf('Stair A.pdf'), pdf('Stair B.pdf')]);
    await userEvent.click(within(sheet).getByRole('button', { name: 'Send' }));
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Download all (2)' }, { timeout: 10_000 }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].name).toBe(`Stair details ${todayISO()}.zip`);
  }, 30_000);
});
