import { describe, expect, it } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { addGroupConversation } from '../../api/chatState';
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
