import { describe, expect, it } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { addGroupConversation } from '../../api/chatState';
import { chatReadKey } from '../../api/rowKeys';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

const list = async () => within(await screen.findByRole('list', { name: 'Chats' }));
const filterButton = () => screen.findByRole('button', { name: /^Show chats:/ });

/** Hala (the Admin) sees a project chat, a direct chat, a group and a task thread, one of each kind at least. */
const withEveryKind = (state: State) => {
  const task = Object.values(state.tasks).find((t) => t.projectId === 'prj_006');
  if (!task) throw new Error('The sample has no task in the clinic project.');
  task.title = 'Room finish schedule';
  state.comments.cmt_901 = {
    id: 'cmt_901', targetType: 'task', targetId: task.id, authorId: 'usr_006', body: 'The finish codes are ready.',
    reactions: { '👍': [], '✅': [], '👀': [] }, createdAt: '2026-09-30T07:00:00.000+03:00', editedAt: null,
  };
  addGroupConversation(state, 'Site crew', 'usr_001', ['usr_001', 'usr_002', 'usr_005'], '2026-09-29T09:00:00.000+03:00');
};

async function pick(name: string) {
  await userEvent.click(await filterButton());
  await userEvent.click(await screen.findByRole('menuitemradio', { name }));
}

describe('the filter of the chat list (owner, 2026-10-20)', () => {
  it('sits beside the search, starts on All, and offers All, Projects, To-dos and People', async () => {
    await renderApp('/inbox', withEveryKind);
    const button = await filterButton();
    expect(button).toHaveAccessibleName('Show chats: All');
    expect(button).toHaveTextContent('All');
    await userEvent.click(button);
    const items = await screen.findAllByRole('menuitemradio');
    expect(items.map((item) => item.textContent)).toEqual(['All', 'Projects', 'To-dos', 'People']);
    expect(screen.getByRole('menuitemradio', { name: 'All' })).toHaveAttribute('aria-checked', 'true');
  });

  it('shows only the project chats under Projects', async () => {
    await renderApp('/inbox', withEveryKind);
    await pick('Projects');
    const chats = await list();
    expect(chats.getByRole('link', { name: /Corniche Office Tower/ })).toBeInTheDocument();
    expect(chats.queryByRole('link', { name: /Faisal Al-Harbi/ })).toBeNull();
    expect(chats.queryByRole('link', { name: /Site crew/ })).toBeNull();
    expect(chats.queryByRole('link', { name: /Room finish schedule/ })).toBeNull();
    expect(await filterButton()).toHaveAccessibleName('Show chats: Projects');
  });

  it('shows only the threads of to-dos under To-dos', async () => {
    await renderApp('/inbox', withEveryKind);
    await pick('To-dos');
    const chats = await list();
    expect(chats.getByRole('link', { name: /Room finish schedule/ })).toBeInTheDocument();
    expect(chats.queryByRole('link', { name: /Corniche Office Tower/ })).toBeNull();
    expect(chats.queryByRole('link', { name: /Faisal Al-Harbi/ })).toBeNull();
  });

  it('shows the direct chats and the groups under People', async () => {
    await renderApp('/inbox', withEveryKind);
    await pick('People');
    const chats = await list();
    expect(chats.getByRole('link', { name: /Faisal Al-Harbi/ })).toBeInTheDocument();
    expect(chats.getByRole('link', { name: /Site crew/ })).toBeInTheDocument();
    expect(chats.queryByRole('link', { name: /Corniche Office Tower/ })).toBeNull();
    expect(chats.queryByRole('link', { name: /Room finish schedule/ })).toBeNull();
  });

  it('searches inside the chosen kind only', async () => {
    await renderApp('/inbox', withEveryKind);
    await pick('Projects');
    await userEvent.type(await screen.findByRole('searchbox', { name: 'Search chats' }), 'faisal');
    expect(await screen.findByText('No chat matches.')).toBeInTheDocument();
  });

  it('says so in one line when the chosen kind has no chat, and All brings every chat back', async () => {
    await renderApp('/inbox', (state) => {
      withEveryKind(state);
      for (const [id, comment] of Object.entries(state.comments)) if (comment.targetType === 'task') delete state.comments[id];
    });
    await pick('To-dos');
    expect(await screen.findByText('No chats here.')).toBeInTheDocument();
    await pick('All');
    expect((await list()).getByRole('link', { name: /Corniche Office Tower/ })).toBeInTheDocument();
    expect(screen.queryByText('No chats here.')).toBeNull();
  });
  it('keeps the last choice after a new visit, and after the Inbox closes (owner, 2026-10-23)', async () => {
    await renderApp('/inbox', withEveryKind);
    await pick('People');
    expect(window.localStorage.getItem('madar.chatKind')).toBe('people');
    cleanup();
    await renderApp('/inbox', withEveryKind);
    expect(await filterButton()).toHaveAccessibleName('Show chats: People');
    const chats = await list();
    expect(chats.getByRole('link', { name: /Faisal Al-Harbi/ })).toBeInTheDocument();
    expect(chats.queryByRole('link', { name: /Corniche Office Tower/ })).toBeNull();
  });

  it('reads a stored value that is no kind as All', async () => {
    window.localStorage.setItem('madar.chatKind', 'nonsense');
    await renderApp('/inbox', withEveryKind);
    expect(await filterButton()).toHaveAccessibleName('Show chats: All');
  });
});

/** Faisal's direct chat is archived for Hala, so the archived list holds one People chat. */
const withArchivedFaisal = (state: State) => {
  withEveryKind(state);
  const room = Object.values(state.conversations).find((c) => c.kind === 'direct');
  if (!room) throw new Error('The sample has no direct chat.');
  state.chatReads[chatReadKey(room.id, 'usr_001')] = {
    conversationId: room.id, userId: 'usr_001', lastReadAt: '2026-09-30T09:00:00.000+03:00', archivedAt: '2099-01-01T00:00:00.000+03:00',
  };
};

describe('the line of unread messages in the other chats (fbk_056, owner 2026-10-25)', () => {
  const line = () => screen.queryByText(/unread messages? (is|are) in other chats/);

  it('says how many unread messages the chosen kind hides, under the list, with a quiet button', async () => {
    await renderApp('/inbox', withEveryKind);
    await pick('People');
    const chats = await screen.findByRole('list', { name: 'Chats' });
    const sentence = await screen.findByText(/unread messages are in other chats\./);
    // The tower chat holds 2 unread messages and the to-do thread 1: the badge counts them, the People list hides them.
    expect(sentence).toHaveTextContent('3 unread messages are in other chats.');
    // The line sits after the list and outside its scroll box.
    expect(chats.contains(sentence)).toBe(false);
    expect(chats.compareDocumentPosition(sentence) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Show all' });
    expect(button).toHaveClass('min-h-11');
    expect(button.className).not.toContain('signature');
    expect(sentence.className).not.toMatch(/danger|red|signature/);
  });

  it('counts the unread messages of a to-do thread too', async () => {
    const { api } = await renderApp('/inbox', withEveryKind);
    await pick('Projects');
    // Outside Projects: the unread message of Faisal's chat and the unread comment of the to-do thread.
    const sentence = await screen.findByText(/unread messages? (is|are) in other chats/);
    const rows = (await api.call('chats.list', {})).filter((row) => row.kind !== 'project');
    const sum = rows.reduce((total, row) => total + row.unread, 0);
    expect(rows.some((row) => row.kind === 'task' && row.unread > 0)).toBe(true);
    expect(sentence).toHaveTextContent(`${sum} unread message`);
  });

  it('chooses All with "Show all": the project chat shows and the line goes', async () => {
    await renderApp('/inbox', withEveryKind);
    await pick('People');
    await userEvent.click(await screen.findByRole('button', { name: 'Show all' }));
    expect((await list()).getByRole('link', { name: /Corniche Office Tower/ })).toBeInTheDocument();
    expect(await filterButton()).toHaveAccessibleName('Show chats: All');
    expect(window.localStorage.getItem('madar.chatKind')).toBe('all');
    expect(line()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show all' })).toBeNull();
  });

  it('shows no line when All is chosen', async () => {
    await renderApp('/inbox', withEveryKind);
    await list();
    expect(line()).toBeNull();
  });

  it('shows no line when the unread messages are in the chosen kind', async () => {
    await renderApp('/inbox', (state) => {
      withEveryKind(state);
      // Every unread message sits in the project chats: Projects hides none.
      for (const read of Object.values(state.chatReads)) read.lastReadAt = '2099-01-01T00:00:00.000+03:00';
      for (const [id, comment] of Object.entries(state.comments)) if (comment.targetType === 'task') delete state.comments[id];
    });
    await pick('Projects');
    await list();
    expect(line()).toBeNull();
  });

  it('shows no line while a search word is typed', async () => {
    await renderApp('/inbox', withEveryKind);
    await pick('People');
    await screen.findByText(/unread messages are in other chats/);
    await userEvent.type(await screen.findByRole('searchbox', { name: 'Search chats' }), 'faisal');
    expect(line()).toBeNull();
  });

  it('shows no line in the archived list', async () => {
    await renderApp('/inbox', withArchivedFaisal);
    await pick('People');
    await screen.findByText(/unread messages? (is|are) in other chats/);
    await userEvent.click(await screen.findByRole('button', { name: /^Archived \(1\)/ }));
    await screen.findByRole('heading', { level: 2, name: 'Archived chats' });
    expect(line()).toBeNull();
  });
});
