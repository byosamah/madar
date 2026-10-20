import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { emptyReactions } from '../../api/contract/entities';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

/**
 * The Messages group of the Search screen (chat design 2026-10-19, item 16): last after Files, one hit for each message or task
 * comment, with the chat, the person, the line with the matched word marked, and the date. A press opens the chat at the message.
 */
const box = () => screen.findByRole('combobox');
const riserId = 'msg_950';
const arabicId = 'msg_951';
const noteId = 'cmt_950';
let room = '';
let taskId = '';

/** The tower chat of prj_001 gets a message by Faisal and an Arabic message, and a project task gets a comment of the viewer. */
function prepare(state: State): void {
  room = Object.values(state.conversations).find((c) => c.kind === 'project' && c.projectId === 'prj_001')!.id;
  taskId = Object.values(state.tasks).find((t) => t.projectId === 'prj_001')!.id;
  state.messages[riserId] = {
    id: riserId, conversationId: room, authorId: 'usr_002', actingForId: 'usr_002', body: 'The new riser size is 150 mm', mentions: [], fileIds: [],
    createdAt: '2026-10-04T08:30:00.000+03:00', editedAt: null,
  };
  state.messages[arabicId] = {
    id: arabicId, conversationId: room, authorId: 'usr_002', actingForId: 'usr_002', body: 'تغيّرت الأسعار اليوم', mentions: [], fileIds: [],
    createdAt: '2026-10-04T08:31:00.000+03:00', editedAt: null,
  };
  state.comments[noteId] = {
    id: noteId, targetType: 'task', targetId: taskId, authorId: 'usr_001', body: 'Manhole spacing noted for the riser', reactions: emptyReactions(), fileIds: [],
    createdAt: '2026-10-04T08:32:00.000+03:00', editedAt: null,
  };
}

describe('the Messages group of Search', () => {
  it('shows a Messages group last, with the chat, the person, the line and the date, and opens the chat at the message', async () => {
    await renderApp('/search', prepare);
    await userEvent.type(await box(), 'riser size');
    const group = await screen.findByRole('group', { name: 'Messages' });
    const hit = within(group).getByRole('option', { name: /Corniche Office Tower.*Faisal:.*riser/ });
    expect(hit.querySelector('mark')?.textContent).toBe('riser');
    expect(hit.querySelector('mark')?.className).toContain('bg-fill-strong');
    expect(hit.querySelector('time')?.getAttribute('datetime')).toBe('2026-10-04T08:30:00.000+03:00');
    expect(screen.getAllByRole('group').at(-1)).toBe(group);
    await userEvent.click(hit);
    await waitFor(() => expect(window.location.hash).toBe(`#/inbox/${room}?at=${riserId}`));
  });

  it('shows no Messages group for a query with no word of 3 letters', async () => {
    await renderApp('/search', prepare);
    await userEvent.type(await box(), 'ri');
    await waitFor(() => expect(window.location.hash).toContain('q=ri'));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(screen.queryByRole('group', { name: 'Messages' })).toBeNull();
  });

  it('shows a task comment with its task, the project key and You, and opens the task thread at the comment', async () => {
    await renderApp('/search', prepare);
    await userEvent.type(await box(), 'manhole spacing');
    const group = await screen.findByRole('group', { name: 'Messages' });
    const hit = within(group).getByRole('option');
    expect(hit).toHaveTextContent(/KH-26-001/);
    expect(hit).toHaveTextContent(/You:/);
    expect(hit.querySelectorAll('mark')).toHaveLength(2);
    await userEvent.click(hit);
    await waitFor(() => expect(window.location.hash).toBe(`#/inbox/${taskId}?at=${noteId}`));
  });

  it('marks the whole Arabic word on an Arabic screen', async () => {
    await renderApp('/search', (state) => { prepare(state); state.users.usr_001.preferences.language = 'ar'; });
    await userEvent.type(await box(), 'اسعار');
    const group = await screen.findByRole('group', { name: 'الرسائل' });
    expect(within(group).getByRole('option').querySelector('mark')?.textContent).toBe('الأسعار');
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
  });

  it('names the search for messages in the placeholder', async () => {
    await renderApp('/search');
    expect(await screen.findByPlaceholderText('Search projects, to-dos, people, files and messages')).toBeInTheDocument();
  });
});
