import { beforeEach, describe, expect, it } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { ar } from '../../i18n/trees';
import { renderHeldRemoteApp } from '../../test/heldRemoteApp';

/**
 * Instant send (chat design 2026-10-19, item 13; track msg B14). The app runs as the real build runs it (runtime mode remote) over the
 * sample office, with no change signals, so a test that wants the list to reload asks for it, as a signal would. Hala (usr_001) is the
 * Admin. "failing" makes every send fail like a lost network.
 */
let failing = false;
beforeEach(() => {
  failing = false;
});
const fail = (name: string) => failing && (name === 'chats.send' || name === 'comments.create');

const roomOf = (state: State) => Object.values(state.conversations).find((c) => c.kind === 'project' && c.projectId === 'prj_001')!;
function plant(state: State) {
  state.messages.msg_901 = {
    id: 'msg_901', conversationId: roomOf(state).id, authorId: 'usr_002', actingForId: 'usr_002', body: 'The wall is 40 cm higher.', mentions: [],
    createdAt: '2026-09-30T08:00:00.000+03:00', editedAt: null,
  };
}
function inArabic(state: State) {
  plant(state);
  state.users.usr_001.preferences.language = 'ar';
}
function plantComment(state: State) {
  const task = Object.values(state.tasks).find((t) => t.projectId === 'prj_006')!;
  for (const [id, c] of Object.entries(state.comments)) if (c.targetType === 'task' && c.targetId === task.id) delete state.comments[id];
  state.comments.cmt_901 = {
    id: 'cmt_901', targetType: 'task', targetId: task.id, authorId: 'usr_006', body: 'The finish codes are ready.',
    reactions: { '👍': [], '✅': [], '👀': [] }, createdAt: '2026-09-30T07:00:00.000+03:00', editedAt: null,
  };
}

const log = () => screen.getByRole('log', { name: /Messages|الرسائل/ });
const bubbleOf = async (text: string) => (await within(log()).findByText(text)).closest('li')!;
const box = (name = 'Message') => screen.getByRole('textbox', { name });

async function open(prepare: (state: State) => void = plant, listName = 'Chats') {
  const app = await renderHeldRemoteApp('/inbox', prepare, { fail });
  await userEvent.click(await within(await screen.findByRole('list', { name: listName }, { timeout: 10_000 })).findByRole('link', { name: /Corniche Office Tower/ }, { timeout: 10_000 }));
  await within(await screen.findByRole('log', { name: /Messages|الرسائل/ }, { timeout: 10_000 })).findByText('The wall is 40 cm higher.', {}, { timeout: 10_000 });
  return app;
}

async function send(text: string, name = 'Message') {
  await userEvent.type(box(name), `${text}{Enter}`);
}

/** What a change signal does after a write: the list asks again. */
const reload = (app: Awaited<ReturnType<typeof open>>, call: string) => act(() => app.queryClient.invalidateQueries({ queryKey: ['api', call] }));

describe('instant send in a chat', () => {
  it('shows my message at once, faded, then once', async () => {
    const app = await open();
    app.hold();
    await send('Quick note');
    expect(await bubbleOf('Quick note')).toHaveAttribute('aria-busy', 'true');
    expect(box()).toHaveValue('');
    await act(async () => {
      app.release();
    });
    await reload(app, 'chats.messages');
    await waitFor(() => expect(within(log()).getAllByText('Quick note')).toHaveLength(1));
    await waitFor(async () => expect(await bubbleOf('Quick note')).not.toHaveAttribute('aria-busy'));
    // The saved message has its menu again.
    expect(within(await bubbleOf('Quick note')).getByRole('button', { name: 'Actions for this message' })).toBeInTheDocument();
  });

  it('shows Not sent and sends again with the same key', async () => {
    const app = await open();
    failing = true;
    await send('Lost note');
    expect(await screen.findByText('Not sent')).toBeInTheDocument();
    // A lost network has its own button, so no error toast shows beside it.
    expect(screen.queryByRole('alert')).toBeNull();
    // A failed bubble has no menu.
    expect(within(await bubbleOf('Lost note')).queryByRole('button', { name: 'Actions for this message' })).toBeNull();
    failing = false;
    await userEvent.click(screen.getByRole('button', { name: 'Send again' }));
    await waitFor(() => expect(screen.queryByText('Not sent')).toBeNull());
    await reload(app, 'chats.messages');
    await waitFor(() => expect(within(log()).getAllByText('Lost note')).toHaveLength(1));
    await waitFor(async () => expect(await bubbleOf('Lost note')).not.toHaveAttribute('aria-busy'));
    const [first, again] = app.keysOf('chats.send');
    expect(first).toBeDefined();
    expect(again).toBe(first);
    // One message went in, though the call was asked twice.
    expect(Object.values(app.store.state.messages).filter((m) => m.body === 'Lost note')).toHaveLength(1);
  });

  it('sends the next message while the first one waits', async () => {
    const app = await open();
    app.hold();
    await send('First one');
    await send('Second one');
    expect(await bubbleOf('First one')).toHaveAttribute('aria-busy', 'true');
    expect(await bubbleOf('Second one')).toHaveAttribute('aria-busy', 'true');
    expect(box()).toHaveValue('');
    expect(app.callsOf('chats.send')).toHaveLength(2);
    await act(async () => {
      app.release();
    });
    await reload(app, 'chats.messages');
    await waitFor(() => expect(within(log()).getAllByText(/First one|Second one/)).toHaveLength(2));
    await waitFor(() => expect(log().querySelectorAll('[aria-busy="true"]')).toHaveLength(0));
  });

  it('shows two same words once each', async () => {
    const app = await open();
    app.hold();
    await send('ok');
    await send('ok');
    await act(async () => {
      app.release();
    });
    await reload(app, 'chats.messages');
    await waitFor(() => expect(within(log()).getAllByText('ok')).toHaveLength(2));
    await waitFor(() => expect(log().querySelectorAll('[aria-busy="true"]')).toHaveLength(0));
  });

  it('shows the toast of the failure when the chat closed before it', async () => {
    const app = await open();
    app.hold();
    await send('Gone note');
    await act(async () => {
      await app.router.navigate('/inbox');
    });
    failing = true;
    await act(async () => {
      app.releaseHeld();
    });
    const toast = await screen.findByRole('alert');
    expect(toast).toHaveTextContent('Something went wrong. Try again.');
    // The failure after the chat closed has its Retry, as every failed write has.
    expect(within(toast).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('keeps the reply strip of a reply on the faded bubble', async () => {
    const app = await open();
    await userEvent.click(within(document.querySelector<HTMLElement>('[data-message-id="msg_901"]')!).getByRole('button', { name: 'Actions for this message' }));
    await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Reply' }));
    app.hold();
    await send('Approved.');
    const faded = await bubbleOf('Approved.');
    expect(within(faded).getByText('The wall is 40 cm higher.')).toBeInTheDocument();
    expect(screen.queryByText('Reply to Faisal Al-Harbi')).toBeNull();
    await act(async () => {
      app.release();
    });
    expect(Object.values(app.store.state.messages).find((m) => m.body === 'Approved.')?.replyToId).toBe('msg_901');
  });
});

describe('instant send in a task thread', () => {
  it('sends a task comment the same way in the Inbox thread', async () => {
    const app = await renderHeldRemoteApp('/inbox', plantComment, { fail });
    const taskId = Object.values(app.store.state.tasks).find((t) => t.projectId === 'prj_006')!.id;
    await act(async () => {
      await app.router.navigate(`/inbox/${taskId}`);
    });
    await within(await screen.findByRole('log', { name: 'Messages' }, { timeout: 10_000 })).findByText('The finish codes are ready.', {}, { timeout: 10_000 });
    app.hold();
    await send('Thread note');
    expect(await bubbleOf('Thread note')).toHaveAttribute('aria-busy', 'true');
    await act(async () => {
      app.release();
    });
    await reload(app, 'comments.list');
    await waitFor(() => expect(within(log()).getAllByText('Thread note')).toHaveLength(1));
    await waitFor(async () => expect(await bubbleOf('Thread note')).not.toHaveAttribute('aria-busy'));
    expect(Object.values(app.store.state.comments).filter((c) => c.body === 'Thread note')).toHaveLength(1);
  });
});

describe('Arabic, right to left', () => {
  it('reads Not sent and Send again in Arabic', async () => {
    await open(inArabic, ar.chat.list);
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    failing = true;
    await send('رسالة ضائعة', ar.chat.composer);
    expect(await screen.findByText('لم تُرسَل')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'أرسلها مجددًا' })).toBeInTheDocument();
  });
});
