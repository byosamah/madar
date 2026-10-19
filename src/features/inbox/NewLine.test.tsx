import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';
import { expectCalm } from '../auth/calmChecks';

const list = async () => within(await screen.findByRole('list', { name: 'Chats' }));
const rowLink = async (name: RegExp) => (await list()).getByRole('link', { name });

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

const newLine = (log: HTMLElement) => log.querySelector('[data-new-line]');

describe('the New line (design item 3)', () => {
  it('opens the tower chat at its first unread message, under a thin blue line with the word New', async () => {
    await renderApp('/inbox');
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    const log = await screen.findByRole('log', { name: 'Messages' });
    await within(log).findByText(/The sprinkler riser clashes with beam B14/);
    const line = newLine(log) as HTMLElement;
    expect(line).toHaveTextContent('New');
    expect(line.className).toMatch(/text-link/);
    expect(line.nextElementSibling).toHaveTextContent(/The sprinkler riser clashes with beam B14/);
  });
  it('keeps the line after the open marks the chat read, and drops it when the person sends a message', async () => {
    await renderApp('/inbox');
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    const log = await screen.findByRole('log', { name: 'Messages' });
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Chats' })).queryByText('Unread: 2')).toBeNull());
    expect(newLine(log)).not.toBeNull();
    await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'Thanks.');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await within(log).findByText('Thanks.');
    expect(newLine(log)).toBeNull();
  });
  it('opens a chat with nothing unread at the bottom, with no line', async () => {
    await renderApp('/inbox');
    await userEvent.click(await rowLink(/Reem Al-Ghamdi/));
    const log = await screen.findByRole('log', { name: 'Messages' });
    await within(log).findByText(/Good news/);
    expect(newLine(log)).toBeNull();
  });
  it('opens a task thread at its first new comment', async () => {
    await renderApp('/inbox', withTaskTalk);
    await userEvent.click(await rowLink(/Room finish schedule/));
    const log = await screen.findByRole('log', { name: 'Messages' });
    await within(log).findByText('The finish codes are ready.');
    expect(newLine(log)?.nextElementSibling).toHaveTextContent('The finish codes are ready.');
  });
  it('reads جديد in Arabic and passes the calm checks', async () => {
    await renderApp('/inbox', (state) => { state.users.usr_001.preferences.language = 'ar'; });
    await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
    await userEvent.click(await within(await screen.findByRole('list', { name: 'المحادثات' })).findByRole('link', { name: /Corniche Office Tower|برج/ }));
    const log = await screen.findByRole('log', { name: 'الرسائل' });
    await waitFor(() => expect(newLine(log)).toHaveTextContent('جديد'));
    expectCalm(log.parentElement as HTMLElement, { titleLevel: 2 });
  });
});
