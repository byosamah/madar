import { describe, expect, it } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { readDraft } from '../../app/drafts';
import { renderApp } from '../../test/render';
import { fakeVisualViewport, stubPhone } from './phoneHarness';

const FAISAL = 'The wall is 40 cm higher.';
const roomOf = (state: State) => Object.values(state.conversations).find((c) => c.kind === 'project' && c.projectId === 'prj_001')!;
function plant(state: State) {
  state.messages.msg_901 = {
    id: 'msg_901', conversationId: roomOf(state).id, authorId: 'usr_002', actingForId: 'usr_002', body: FAISAL, mentions: [],
    createdAt: '2026-09-30T08:00:00.000+03:00', editedAt: null,
  };
}
const rowLink = async (name: RegExp) => within(await screen.findByRole('list', { name: 'Chats' })).getByRole('link', { name });
async function openTower() {
  await userEvent.click(await rowLink(/Corniche Office Tower/));
  return document.querySelector<HTMLElement>('[data-chat-page]')!;
}
const message = () => document.querySelector<HTMLElement>('[data-message-id="msg_901"]');

describe('the chat as a full-screen page on a phone (Direction D)', () => {
  it('draws the chat in a portal on the body, outside .app-page, below the sheets', async () => {
    stubPhone();
    await renderApp('/inbox');
    const root = await openTower();
    expect(root).not.toBeNull();
    expect(root.parentElement).toBe(document.body);
    expect(root.closest('.app-page')).toBeNull();
    expect(root).toHaveClass('fixed', 'z-30', 'overscroll-none');
  });

  it('follows the visual viewport', async () => {
    stubPhone();
    const viewport = fakeVisualViewport({ height: 500, offsetTop: 20 });
    await renderApp('/inbox');
    const root = await openTower();
    expect(root.style.height).toBe('500px');
    expect(root.style.top).toBe('20px');
    expect(root.style.getPropertyValue('--chat-h')).toBe('500px');
    viewport.set({ height: 300 });
    expect(root.style.height).toBe('300px');
    expect(root.style.getPropertyValue('--chat-h')).toBe('300px');
  });

  it('falls back to 100dvh where the browser has no visual viewport', async () => {
    stubPhone();
    await renderApp('/inbox');
    const root = await openTower();
    expect(root.style.getPropertyValue('--chat-h')).toBe('100dvh');
  });

  it('keeps the same root when ?at= changes, so the entrance does not play again', async () => {
    stubPhone();
    const { router } = await renderApp('/inbox', plant);
    const root = await openTower();
    const id = router.state.location.pathname.split('/').pop()!;
    await act(async () => { await router.navigate(`/inbox/${id}?at=msg_901`); });
    await waitFor(() => expect(message()).not.toBeNull());
    expect(document.querySelector('[data-chat-page]')).toBe(root);
  });

  it('hides the list and the title while a chat is open, and shows them on Back', async () => {
    stubPhone();
    await renderApp('/inbox');
    await openTower();
    expect(screen.queryByRole('list', { name: 'Chats' })).toBeNull();
    expect(screen.queryByRole('heading', { level: 1, name: 'Inbox' })).toBeNull();
    await userEvent.click(screen.getByRole('link', { name: 'Back to chats' }));
    expect(await screen.findByRole('list', { name: 'Chats' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Inbox' })).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('[data-chat-page]')).toBeNull());
  });

  it('keeps the search text of the list while a chat is open', async () => {
    stubPhone();
    await renderApp('/inbox');
    await userEvent.type(await screen.findByRole('searchbox', { name: 'Search chats' }), 'corn');
    await openTower();
    await userEvent.click(screen.getByRole('link', { name: 'Back to chats' }));
    expect(await screen.findByRole('searchbox', { name: 'Search chats' })).toHaveValue('corn');
  });

  it('shows no "Pick a chat" text on a phone', async () => {
    stubPhone();
    await renderApp('/inbox');
    await screen.findByRole('list', { name: 'Chats' });
    expect(screen.queryByText('Pick a chat')).toBeNull();
    expect(screen.queryByText(/Pick a chat/i)).toBeNull();
  });

  it('moves the toast lane to the top while the chat page is open', async () => {
    stubPhone();
    await renderApp('/inbox');
    expect(document.querySelector('[data-toasts]')!.className).not.toContain('max-sm:top-');
    await openTower();
    await waitFor(() => expect(document.querySelector('[data-toasts]')!.className).toContain('max-sm:top-'));
  });

  it('takes the page out of reach of a screen reader while a sheet is open over it', async () => {
    stubPhone();
    await renderApp('/inbox', plant);
    const root = await openTower();
    await waitFor(() => expect(message()).not.toBeNull());
    expect(root.inert).toBe(false);
    const target = message()!.querySelector<HTMLElement>('p')!;
    fireEvent.pointerDown(target, { pointerType: 'touch', clientX: 10, clientY: 10 });
    await act(() => new Promise((resolve) => setTimeout(resolve, 550)));
    const sheet = await screen.findByRole('dialog');
    await waitFor(() => expect(root.inert).toBe(true));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(root.inert).toBe(false));
  });

  it('shows no tab bar and no top row on the chat page', async () => {
    stubPhone();
    await renderApp('/inbox');
    expect(await screen.findByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
    await openTower();
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Main navigation' })).toBeNull());
  });

  it('carries the Back link in the load state', async () => {
    stubPhone();
    await renderApp('/inbox/cnv_001', undefined, { latencyMs: 300 });
    expect(await screen.findByRole('link', { name: 'Back to chats' })).toBeInTheDocument();
    expect(document.querySelector('[data-chat-page] [aria-busy="true"]')).not.toBeNull();
  });

  it('carries the Back link in the error state', async () => {
    stubPhone();
    await renderApp('/inbox/cnv_001', undefined, { failFirst: 'chats.messages' });
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to chats' })).toBeInTheDocument();
  });

  it('carries the Back link in the not found state', async () => {
    stubPhone();
    await renderApp('/inbox/xyz_1');
    expect(await screen.findByText('This item does not exist anymore.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to chats' })).toBeInTheDocument();
  });

  it('keeps the draft of the chat when the screen turns wide (a phone turned sideways)', async () => {
    const device = stubPhone();
    const { router } = await renderApp('/inbox');
    await openTower();
    const id = router.state.location.pathname.split('/').pop()!;
    await userEvent.type(await screen.findByRole('textbox', { name: 'Message' }), 'Half a thought');
    device.set({ narrow: false });
    await waitFor(() => expect(document.querySelector('[data-chat-page]')).toBeNull());
    expect(readDraft('usr_001', `chat:${id}`)).toBe('Half a thought');
    // The desk shows the chat in its panel with the draft.
    expect(await screen.findByRole('textbox', { name: 'Message' })).toHaveValue('Half a thought');
  });

  it('draws the pane inside the panel on a desk and no portal', async () => {
    await renderApp('/inbox');
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    await screen.findByRole('log', { name: 'Messages' });
    expect(document.querySelector('[data-chat-page]')).toBeNull();
    expect(screen.getByRole('log', { name: 'Messages' }).closest('section')).toHaveClass('panel');
  });
});
