import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { readDraft, writeDraft } from '../../app/drafts';
import { renderApp } from '../../test/render';
import { fakeVisualViewport, stubPhone } from './phoneHarness';

const FAISAL = 'The wall is 40 cm higher.';
const MINE = 'I will check it today.';
const roomOf = (state: State) => Object.values(state.conversations).find((c) => c.kind === 'project' && c.projectId === 'prj_001')!;
function plant(state: State) {
  const room = roomOf(state);
  state.messages.msg_901 = {
    id: 'msg_901', conversationId: room.id, authorId: 'usr_002', actingForId: 'usr_002', body: FAISAL, mentions: [],
    createdAt: '2026-09-30T08:00:00.000+03:00', editedAt: null,
  };
  state.messages.msg_902 = {
    id: 'msg_902', conversationId: room.id, authorId: 'usr_001', actingForId: 'usr_001', body: MINE, mentions: [],
    createdAt: '2026-09-30T08:05:00.000+03:00', editedAt: null,
  };
}
const row = (id: string) => document.querySelector<HTMLElement>(`[data-message-id="${id}"]`)!;
const field = () => screen.findByRole('textbox', { name: 'Message' });
const rowLink = async (name: RegExp) => within(await screen.findByRole('list', { name: 'Chats' })).getByRole('link', { name });
async function openTower() {
  await userEvent.click(await rowLink(/Corniche Office Tower/));
  return field();
}
async function longPress(id: string) {
  await waitFor(() => expect(row(id)).not.toBeNull());
  const target = row(id).querySelector<HTMLElement>('p')!;
  fireEvent.pointerDown(target, { pointerType: 'touch', clientX: 10, clientY: 10 });
  await act(() => new Promise((resolve) => setTimeout(resolve, 550)));
}
const sheetRow = async (name: string) => within(await screen.findByRole('dialog')).findByRole('button', { name });

// A pane that closes with a failed entry writes a draft. The unmount of the test must not leave that draft for the next test.
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('the message box on a phone (Direction D)', () => {
  it('does not focus the field when a chat opens on a phone', async () => {
    stubPhone();
    await renderApp('/inbox');
    const box = await openTower();
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(box).not.toHaveFocus();
  });

  it('focuses the field when a chat opens on a desk', async () => {
    await renderApp('/inbox');
    const box = await openTower();
    await waitFor(() => expect(box).toHaveFocus());
  });

  it('focuses the field after a press on Reply', async () => {
    stubPhone();
    await renderApp('/inbox', plant);
    const box = await openTower();
    await longPress('msg_901');
    await userEvent.click(await sheetRow('Reply'));
    await waitFor(() => expect(box).toHaveFocus());
  });

  it('docks the form with the safe area below, and with 0.5rem when the keyboard is open', async () => {
    stubPhone();
    const viewport = fakeVisualViewport({ height: 800, innerHeight: 800 });
    await renderApp('/inbox');
    const box = await openTower();
    const form = box.closest('form')!;
    expect(form.className).toContain('pb-[max(env(safe-area-inset-bottom),0.5rem)]');
    viewport.set({ height: 450 });
    await waitFor(() => expect(form.className).toContain('pb-2'));
    expect(form.className).not.toContain('safe-area-inset-bottom');
  });

  it('keeps the form of a desk as it was', async () => {
    await renderApp('/inbox');
    const box = await openTower();
    expect(box.closest('form')!.className).toContain('pb-3');
  });

  it('limits the field to 40 percent of the visible height', async () => {
    stubPhone();
    await renderApp('/inbox');
    const box = await openTower();
    expect(box.parentElement!.className).toContain('--chat-h');
    expect(box.parentElement!.className).toContain('*0.4');
  });

  it('gives the @ list a max height that stops under the header', async () => {
    stubPhone();
    await renderApp('/inbox');
    const box = await openTower();
    await userEvent.type(box, 'Hi @');
    const list = await screen.findByRole('listbox');
    expect(list.getAttribute('style')).toContain('--chat-h');
    expect(list.className).toContain('overflow-y-auto');
  });

  it('gives the @ list no max height on a desk', async () => {
    await renderApp('/inbox');
    const box = await openTower();
    await userEvent.type(box, 'Hi @');
    const list = await screen.findByRole('listbox');
    expect(list.getAttribute('style') ?? '').not.toContain('max-height');
  });

  it('adds a line with Enter in the edit form on a phone, and saves with the Save button', async () => {
    stubPhone();
    const { store } = await renderApp('/inbox', plant);
    await openTower();
    await longPress('msg_902');
    await userEvent.click(await sheetRow('Edit'));
    const edit = await screen.findByRole('textbox', { name: 'Edit' });
    await userEvent.clear(edit);
    await userEvent.type(edit, 'First line{Enter}Second line');
    expect(edit).toHaveValue('First line\nSecond line');
    expect(store.state.messages.msg_902.body).toBe(MINE);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(store.state.messages.msg_902.body).toBe('First line\nSecond line'));
  });

  it('does not focus the composer after Save or Cancel of an edit on a phone', async () => {
    stubPhone();
    await renderApp('/inbox', plant);
    const box = await openTower();
    await longPress('msg_902');
    await userEvent.click(await sheetRow('Edit'));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await act(() => new Promise((resolve) => setTimeout(resolve, 80)));
    expect(box).not.toHaveFocus();
  });

  it('keeps the closed-chat note above the safe area', async () => {
    stubPhone();
    await renderApp('/inbox', (state) => { state.users.usr_002.active = false; });
    await userEvent.click(await rowLink(/Faisal Al-Harbi/));
    const note = await screen.findByText('This person is inactive. This chat takes no new messages.');
    expect(note.className).toContain('max-sm:pb-[max(env(safe-area-inset-bottom),0.75rem)]');
  });

  it('writes the words of a failed message into the draft when Back closes the chat', async () => {
    stubPhone();
    const { router } = await renderApp('/inbox', undefined, { failFirst: 'chats.send' });
    const box = await openTower();
    const id = router.state.location.pathname.split('/').pop()!;
    await userEvent.type(box, 'Ok then');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Not sent')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Back to chats' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/inbox'));
    await waitFor(() => expect(readDraft('usr_001', `chat:${id}`)).toBe('Ok then'));
  });

  it('writes the words into the draft when the failure comes after Back', async () => {
    stubPhone();
    const { router } = await renderApp('/inbox', undefined, { latencyMs: 80, failFirst: 'chats.send' });
    const box = await openTower();
    const id = router.state.location.pathname.split('/').pop()!;
    await userEvent.type(box, 'Late words');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await userEvent.click(screen.getByRole('link', { name: 'Back to chats' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/inbox'));
    await waitFor(() => expect(readDraft('usr_001', `chat:${id}`)).toBe('Late words'));
  });

  it('puts the words before a draft that the person wrote in the meantime', async () => {
    stubPhone();
    const { router } = await renderApp('/inbox', undefined, { failFirst: 'chats.send' });
    const box = await openTower();
    const id = router.state.location.pathname.split('/').pop()!;
    await userEvent.type(box, 'Ok then');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Not sent');
    writeDraft('usr_001', `chat:${id}`, 'Newer words');
    await userEvent.click(screen.getByRole('link', { name: 'Back to chats' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/inbox'));
    await waitFor(() => expect(readDraft('usr_001', `chat:${id}`)).toBe('Ok then\nNewer words'));
  });

  it('keeps the same rule for a to-do thread (draft key task:<id>)', async () => {
    stubPhone();
    const { router } = await renderApp('/inbox/tsk_001', undefined, { failFirst: 'comments.create' });
    const box = await field();
    await userEvent.type(box, 'Thread words');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Not sent')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Back to chats' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/inbox'));
    await waitFor(() => expect(readDraft('usr_001', 'task:tsk_001')).toBe('Thread words'));
  });

  it('does not write a draft on a desk', async () => {
    const { router } = await renderApp('/inbox', undefined, { failFirst: 'chats.send' });
    const box = await openTower();
    const id = router.state.location.pathname.split('/').pop()!;
    await userEvent.type(box, 'Ok then');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Not sent')).toBeInTheDocument();
    await act(async () => { await router.navigate('/inbox'); });
    expect(readDraft('usr_001', `chat:${id}`)).toBe('');
  });
});
