import { afterEach, describe, expect, it } from 'vitest';
import { createEvent, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { keepDraftsOf } from '../../app/drafts';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';
import { expectCalm } from '../auth/calmChecks';

// Picked files wait in memory for each chat (app/drafts.ts), so a test must not leave them for the next one.
afterEach(() => keepDraftsOf(''));

const list = async () => within(await screen.findByRole('list', { name: 'Chats' }));
const rowLink = async (name: RegExp) => (await list()).getByRole('link', { name });
const files = (n: number) => Array.from({ length: n }, (_, i) => new File(['x'], `Sketch ${i + 1}.pdf`, { type: 'application/pdf' }));
const drag = (picked: File[]) => ({ dataTransfer: { types: ['Files'], files: picked } });

describe('drop and paste files (design item 14, fbk_030)', () => {
  it('shows a soft frame that says where the files go, and adds the dropped files to the box without a send', async () => {
    const { store } = await renderApp('/inbox');
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    const log = await screen.findByRole('log', { name: 'Messages' });
    const before = Object.keys(store.state.messages).length;
    fireEvent.dragEnter(log, drag([]));
    expect(screen.getByText('Drop to attach')).toBeInTheDocument();
    expect(screen.getByText('The files also join the files of the project.')).toBeInTheDocument();
    fireEvent.drop(log, drag(files(1)));
    expect(screen.queryByText('Drop to attach')).toBeNull();
    expect(within(screen.getByRole('list', { name: 'Files to send' })).getByText('Sketch 1.pdf')).toBeInTheDocument();
    expect(Object.keys(store.state.messages)).toHaveLength(before);
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus();
  });
  it('says the files stay in a direct chat', async () => {
    await renderApp('/inbox');
    await userEvent.click(await rowLink(/Faisal Al-Harbi/));
    fireEvent.dragEnter(await screen.findByRole('log', { name: 'Messages' }), drag([]));
    expect(screen.getByText('The files stay in this chat.')).toBeInTheDocument();
  });
  it('says the files stay with an office task', async () => {
    // An office task that Faisal made and Hala leads, with one comment by Faisal (the fields of withOfficeTask in
    // src/features/work/OfficeTasks.test.tsx).
    const withOfficeTaskTalk = (state: State) => {
      state.tasks.tsk_950 = {
        id: 'tsk_950', projectId: null, stageId: null, title: 'Office keys', description: '', ownerId: 'usr_001', status: 'todo',
        dueDate: null, flagged: false, needsReview: false, checklist: [], createdBy: 'usr_002', createdAt: '2026-09-29T09:00:00.000+03:00', completedAt: null,
      };
      state.counters.tsk = Math.max(state.counters.tsk ?? 0, 950);
      state.comments.cmt_950 = {
        id: 'cmt_950', targetType: 'task', targetId: 'tsk_950', authorId: 'usr_002', body: 'The spare keys are in the top drawer.',
        reactions: { '👍': [], '✅': [], '👀': [] }, createdAt: '2026-09-29T10:00:00.000+03:00', editedAt: null,
      };
    };
    await renderApp('/inbox', withOfficeTaskTalk);
    await userEvent.click(await rowLink(/Office keys/));
    fireEvent.dragEnter(await screen.findByRole('log', { name: 'Messages' }), drag([]));
    expect(screen.getByText('The files stay with this task.')).toBeInTheDocument();
  });
  it('takes 10 files at most from one drop, as the attach button does', async () => {
    await renderApp('/inbox');
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    const log = await screen.findByRole('log', { name: 'Messages' });
    fireEvent.dragEnter(log, drag([]));
    fireEvent.drop(log, drag(files(11)));
    expect(within(screen.getByRole('list', { name: 'Files to send' })).getAllByRole('listitem')).toHaveLength(10);
    expect(await screen.findByText('You can attach 10 files at most.')).toBeInTheDocument();
  });
  it('refuses a drop in a closed chat, and the browser does not open the file', async () => {
    await renderApp('/inbox', (state) => { state.users.usr_002.active = false; });
    await userEvent.click(await rowLink(/Faisal Al-Harbi/));
    const log = await screen.findByRole('log', { name: 'Messages' });
    fireEvent.dragEnter(log, drag([]));
    expect(screen.queryByText('Drop to attach')).toBeNull();
    const event = createEvent.drop(log, drag(files(1)));
    fireEvent(log, event);
    expect(event.defaultPrevented).toBe(true);
    expect(screen.queryByRole('list', { name: 'Files to send' })).toBeNull();
  });
  it('adds a pasted picture, and keeps a paste that holds text as text', async () => {
    await renderApp('/inbox');
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    const box = await screen.findByRole('textbox', { name: 'Message' });
    const png = new File(['png'], 'image.png', { type: 'image/png' });
    fireEvent.paste(box, { clipboardData: { files: [png], getData: () => '' } });
    expect(within(screen.getByRole('list', { name: 'Files to send' })).getByText('image.png')).toBeInTheDocument();
    fireEvent.paste(box, { clipboardData: { files: [png], getData: (type: string) => (type === 'text/plain' ? 'Copied words' : '') } });
    expect(within(screen.getByRole('list', { name: 'Files to send' })).getAllByRole('listitem')).toHaveLength(1);
  });
  it('speaks Arabic and stays calm', async () => {
    await renderApp('/inbox', (state) => { state.users.usr_001.preferences.language = 'ar'; });
    await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
    await userEvent.click(await within(await screen.findByRole('list', { name: 'المحادثات' })).findByRole('link', { name: /Corniche Office Tower|برج/ }));
    const log = await screen.findByRole('log', { name: 'الرسائل' });
    expectCalm(log.parentElement as HTMLElement, { titleLevel: 2 });
    fireEvent.dragEnter(log, drag([]));
    expect(screen.getByText('أفلت الملفات لإرفاقها')).toBeInTheDocument();
    expect(screen.getByText('تنضم الملفات أيضًا إلى ملفات المشروع.')).toBeInTheDocument();
  });
});
