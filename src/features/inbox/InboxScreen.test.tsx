import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

const list = async () => within(await screen.findByRole('list', { name: 'Chats' }));
const rowLink = async (name: RegExp) => (await list()).getByRole('link', { name });
const PICKED = 'Files to send';

// Hala is the Admin and leads the clinic project. The sample talk leaves two unread messages in the tower chat and one in Faisal's chat.
const withTaskTalk = (state: State) => {
  const task = Object.values(state.tasks).find((t) => t.projectId === 'prj_006');
  if (!task) throw new Error('The sample has no task in the clinic project.');
  task.title = 'Room finish schedule';
  for (const [id, c] of Object.entries(state.comments)) if (c.targetType === 'task' && c.targetId === task.id) delete state.comments[id];
  state.comments.cmt_901 = {
    id: 'cmt_901', targetType: 'task', targetId: task.id, authorId: 'usr_006', body: 'The finish codes are ready.',
    reactions: { '👍': [], '✅': [], '👀': [] }, createdAt: '2026-09-30T07:00:00.000+03:00', editedAt: null,
  };
};

describe('the Inbox chat', () => {
  it('lists project chats, direct chats and task threads', async () => {
    await renderApp('/inbox', withTaskTalk);
    expect(await rowLink(/Corniche Office Tower/)).toHaveAttribute('href', expect.stringMatching(/#?\/inbox\/cnv_\d+/));
    expect(await rowLink(/Faisal Al-Harbi/)).toBeInTheDocument();
    expect(await rowLink(/Reem Al-Ghamdi/)).toBeInTheDocument();
    const thread = await rowLink(/Room finish schedule/);
    expect(thread).toHaveAttribute('href', expect.stringMatching(/#?\/inbox\/tsk_\d+/));
    expect(within(thread).getByText(/The finish codes are ready/)).toBeInTheDocument();
  });

  it('filters the list by title', async () => {
    await renderApp('/inbox', withTaskTalk);
    await userEvent.type(await screen.findByRole('searchbox', { name: 'Search chats' }), 'faisal');
    const chats = await list();
    expect(chats.getByRole('link', { name: /Faisal Al-Harbi/ })).toBeInTheDocument();
    expect(chats.queryByRole('link', { name: /Corniche Office Tower/ })).toBeNull();
  });

  it('shows the unread count of a chat and clears it when the chat opens', async () => {
    const { store } = await renderApp('/inbox');
    const row = await rowLink(/Corniche Office Tower/);
    expect(within(row).getByText('Unread: 2')).toBeInTheDocument();
    await userEvent.click(row);
    const log = await screen.findByRole('log', { name: 'Messages' });
    expect(within(log).getByText(/The sprinkler riser clashes with beam B14/)).toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Chats' })).queryByText('Unread: 2')).toBeNull());
    expect(Object.values(store.state.chatReads).find((r) => r.userId === 'usr_001' && store.state.conversations[r.conversationId].projectId === 'prj_001')?.lastReadAt)
      .toBeDefined();
  });

  it('attaches a file in a project chat, and a direct chat has no attach control', async () => {
    const { store } = await renderApp('/inbox');
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    await userEvent.upload(await screen.findByLabelText('Attach files'), new File(['x'], 'Beam B14.pdf', { type: 'application/pdf' }));
    await userEvent.type(await screen.findByRole('textbox', { name: 'Message' }), 'The beam sheet.');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('button', { name: 'Download Beam B14.pdf' })).toBeInTheDocument();
    const file = Object.values(store.state.files).find((f) => f.name === 'Beam B14.pdf');
    expect(file?.projectId).toBe('prj_001');
    await userEvent.click(await rowLink(/Faisal Al-Harbi/));
    await screen.findByRole('textbox', { name: 'Message' });
    expect(screen.queryByLabelText('Attach files')).toBeNull();
  });

  it('sends a message with the Send button and with Enter, and keeps a new line for Shift+Enter', async () => {
    const { store } = await renderApp('/inbox');
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    const box = await screen.findByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(box).toHaveFocus());
    await userEvent.type(box, 'Please send the new section.');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    const log = screen.getByRole('log', { name: 'Messages' });
    expect(await within(log).findByText('Please send the new section.')).toBeInTheDocument();
    expect(box).toHaveValue('');
    await userEvent.type(box, 'First line{Shift>}{Enter}{/Shift}Second line');
    expect(box).toHaveValue('First line\nSecond line');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(Object.values(store.state.messages).some((m) => m.body === 'First line\nSecond line')).toBe(true));
    expect(box).toHaveValue('');
  });

  it('opens a task thread, posts a task comment, and links to the task', async () => {
    const { store } = await renderApp('/inbox', withTaskTalk);
    await userEvent.click(await rowLink(/Room finish schedule/));
    expect(await within(await screen.findByRole('log', { name: 'Messages' })).findByText('The finish codes are ready.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open task' })).toHaveAttribute('href', expect.stringMatching(/\/projects\/prj_006\?tab=tasks&task=tsk_\d+/));
    await userEvent.type(await screen.findByRole('textbox', { name: 'Message' }), 'Thanks, I will check them.');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(Object.values(store.state.comments).some((c) => c.body === 'Thanks, I will check them.')).toBe(true));
    expect(await within(screen.getByRole('log', { name: 'Messages' })).findByText('Thanks, I will check them.')).toBeInTheDocument();
  });

  it('starts a direct chat with a person', async () => {
    const { store } = await renderApp('/inbox');
    await userEvent.click(await screen.findByRole('button', { name: 'New message' }));
    await userEvent.click(await screen.findByRole('button', { name: /Omar Haddad/ }));
    await waitFor(() => expect(window.location.hash).toMatch(/#\/inbox\/cnv_\d+/));
    expect(Object.values(store.state.conversations).some((c) => c.kind === 'direct' && c.memberIds.includes('usr_004'))).toBe(true);
    expect(await screen.findByRole('heading', { level: 2, name: 'Omar Haddad' })).toBeInTheDocument();
  });

  it('shows a message from another person that arrives while the chat is open', async () => {
    const { api, store } = await renderApp('/inbox');
    await userEvent.click(await rowLink(/Faisal Al-Harbi/));
    expect(await within(await screen.findByRole('log', { name: 'Messages' })).findByText('I will bring the new stage dates.')).toBeInTheDocument();
    store.state.session.currentUserId = 'usr_002';
    const room = Object.values(store.state.conversations).find((c) => c.kind === 'direct' && c.memberIds.includes('usr_001') && c.memberIds.includes('usr_002'));
    await api.call('chats.send', { conversationId: room?.id ?? '', body: 'One more thing.' });
    store.state.session.currentUserId = 'usr_001';
    expect(await within(screen.getByRole('log', { name: 'Messages' })).findByText('One more thing.')).toBeInTheDocument();
  });
});

describe('the Inbox chat after the audit of 2026-10-03', () => {
  it('empties the box after a Retry of a failed send, so the next Send does not post it twice (SHL-10)', async () => {
    const { store } = await renderApp('/inbox', undefined, { failFirst: 'chats.send' });
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    const box = await screen.findByRole('textbox', { name: 'Message' });
    await userEvent.type(box, 'Please check beam B14.');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(Object.values(store.state.messages).filter((m) => m.body === 'Please check beam B14.')).toHaveLength(1));
    await waitFor(() => expect(box).toHaveValue(''));
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('sends a file with no words, with its name as the words, as Share does (SHL-21)', async () => {
    const { store } = await renderApp('/inbox');
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    await userEvent.upload(await screen.findByLabelText('Attach files'), new File(['x'], 'Drawing.pdf', { type: 'application/pdf' }));
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(Object.values(store.state.messages).some((m) => m.body === 'Drawing.pdf' && (m.fileIds ?? []).length === 1)).toBe(true));
    expect(await screen.findByRole('button', { name: 'Download Drawing.pdf' })).toBeInTheDocument();
    // With no file and no words, Send stays off.
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('closes a direct chat with a person who left the office (SHL-15)', async () => {
    await renderApp('/inbox', (state) => {
      state.users.usr_002.active = false;
    });
    await userEvent.click(await rowLink(/Faisal Al-Harbi/));
    await screen.findByRole('heading', { level: 2, name: 'Faisal Al-Harbi' });
    expect(await screen.findByText('Left the office')).toBeInTheDocument();
    expect(screen.getByText('Faisal Al-Harbi left the office. This chat takes no new messages.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Message' })).toBeNull();
  });

  it('marks a task thread with a new comment as unread, and reads it when it opens (SHL-5)', async () => {
    const { store } = await renderApp('/inbox', withTaskTalk);
    const row = await rowLink(/Room finish schedule/);
    expect(within(row).getByText('Unread: 1')).toBeInTheDocument();
    await userEvent.click(row);
    expect(await within(await screen.findByRole('log', { name: 'Messages' })).findByText('The finish codes are ready.')).toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Chats' })).getByRole('link', { name: /Room finish schedule/ })).not.toHaveTextContent('Unread'));
    const taskId = Object.values(store.state.tasks).find((t) => t.title === 'Room finish schedule')?.id ?? '';
    expect(Object.values(store.state.chatReads).some((r) => r.conversationId === taskId && r.userId === 'usr_001')).toBe(true);
  });

  it('keeps a half-typed message and its picked file for each chat (SHL-4)', async () => {
    await renderApp('/inbox');
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    await userEvent.type(await screen.findByRole('textbox', { name: 'Message' }), 'Half a thought about the riser');
    await userEvent.upload(screen.getByLabelText('Attach files'), new File(['x'], 'Riser.pdf', { type: 'application/pdf' }));
    await userEvent.click(await rowLink(/Faisal Al-Harbi/));
    await screen.findByRole('heading', { level: 2, name: 'Faisal Al-Harbi' });
    expect(await screen.findByRole('textbox', { name: 'Message' })).toHaveValue('');
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    await screen.findByRole('heading', { level: 2, name: 'Corniche Office Tower' });
    expect(await screen.findByRole('textbox', { name: 'Message' })).toHaveValue('Half a thought about the riser');
    expect(within(screen.getByRole('list', { name: PICKED })).getByText('Riser.pdf')).toBeInTheDocument();
    // Another tab and back keeps it too.
    await userEvent.click(within(await screen.findByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name: 'Projects' }));
    await screen.findByRole('heading', { level: 1, name: 'Projects' });
    window.location.hash = '#/inbox';
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    expect(await screen.findByRole('textbox', { name: 'Message' })).toHaveValue('Half a thought about the riser');
    // A sent message leaves no draft behind.
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue(''));
    await userEvent.click(await rowLink(/Faisal Al-Harbi/));
    await screen.findByRole('heading', { level: 2, name: 'Faisal Al-Harbi' });
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    await screen.findByRole('heading', { level: 2, name: 'Corniche Office Tower' });
    expect(await screen.findByRole('textbox', { name: 'Message' })).toHaveValue('');
    expect(screen.queryByRole('list', { name: PICKED })).toBeNull();
    // Many steps, so the test gets more time than the default on a busy machine.
  }, 20000);
});

describe('the bell and the Inbox badge', () => {
  it('opens the notifications from the bell in the pill', async () => {
    await renderApp('/dashboard');
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' });
    await userEvent.click(within(nav).getByRole('link', { name: 'Notifications' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Notifications' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/notifications');
    expect(within(nav).getByRole('link', { name: 'Notifications' })).toHaveAttribute('aria-current', 'page');
  });

  it('counts unread chat messages on the Inbox tab', async () => {
    await renderApp('/dashboard');
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' });
    const inbox = within(nav).getByRole('link', { name: /^Inbox/ });
    // Three chat messages, and two task threads with a new comment from someone else (audit 2026-10-03, SHL-5).
    expect(await within(inbox).findByText('Unread messages: 5')).toBeInTheDocument();
  });

  it('counts a new chat message and clears the count once the chat is read', async () => {
    const { api, store } = await renderApp('/dashboard');
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' });
    await within(within(nav).getByRole('link', { name: /^Inbox/ })).findByText('Unread messages: 5');
    await api.call('chats.markRead', { conversationId: Object.values(store.state.conversations).find((c) => c.projectId === 'prj_001')?.id ?? '' });
    expect(await within(within(nav).getByRole('link', { name: /^Inbox/ })).findByText('Unread messages: 3')).toBeInTheDocument();
  });
});
