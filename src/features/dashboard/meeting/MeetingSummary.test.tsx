import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

const MEETING = '/dashboard/meeting?mode=projects';

// Shore Walk Retail Kiosks is late here, so it is the first project of the agenda.
// The sample events carry the pinned time of the tests, which is the start of the meeting. They are older here, so only new events count.
const waitsForReview = (state: State) => {
  state.projects.prj_011.healthOverride = { value: 'late', reason: 'The client moved the opening.', setBy: 'usr_001', setAt: '2026-09-30T09:00:00.000+03:00' };
  state.tasks.tsk_131.status = 'in_review';
  for (const event of Object.values(state.events)) event.createdAt = '2026-09-20T09:00:00.000+03:00';
};

afterEach(() => {
  vi.restoreAllMocks();
});

/** Approves the task that waits for review, then opens the summary. */
async function approveThenSummary() {
  const rendered = await renderApp(MEETING, waitsForReview);
  const attention = within(await screen.findByRole('region', { name: 'Needs attention' }));
  await userEvent.click(attention.getByRole('button', { name: /^Handover checklist.*Waiting for review/ }));
  const sheet = await screen.findByRole('dialog', { name: 'Handover checklist' });
  await userEvent.click(within(sheet).getByRole('button', { name: 'Approve' }));
  await waitFor(() => expect(Object.values(rendered.store.state.events).some((event) => event.verb === 'task.approved')).toBe(true));
  await userEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Handover checklist' })).toBeNull());
  await userEvent.click(screen.getByRole('button', { name: 'Summary' }));
  return rendered;
}

describe('the summary at the end of the meeting (owner, 2026-10-02)', () => {
  it('lists the approval under its project, with the person and the time', async () => {
    const { store } = await approveThenSummary();
    const summary = await screen.findByRole('region', { name: 'Meeting summary' });
    const project = within(await within(summary).findByRole('group', { name: 'Shore Walk Retail Kiosks' }));
    const who = store.state.users.usr_001.name;
    const line = project.getByText(/approved “Handover checklist”/).closest('li')!;
    expect(within(line).getByText(who)).toBeInTheDocument();
    expect(within(line).getByText('09:00')).toBeInTheDocument();
    // A project with no change does not show.
    expect(within(summary).getAllByRole('group')).toHaveLength(1);
  });

  it('copies a table with a header line and one line for each change', async () => {
    const { store } = await approveThenSummary();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await userEvent.click(await screen.findByRole('button', { name: 'Copy as a table' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const lines = (writeText.mock.calls[0][0] as string).split('\n');
    expect(lines).toEqual([
      'Project\tWho\tWhat\tTime',
      `Shore Walk Retail Kiosks\t${store.state.users.usr_001.name}\tapproved “Handover checklist”\t09:00`,
    ]);
    expect(await screen.findByText('Table copied.')).toBeInTheDocument();
  });

  it('shows an error toast when the browser refuses to copy', async () => {
    await approveThenSummary();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('no')) }, configurable: true });
    await userEvent.click(await screen.findByRole('button', { name: 'Copy as a table' }));
    expect(await screen.findByText('The browser did not allow copying.')).toBeInTheDocument();
  });

  it('posts one message to the chat of the project, and says how many chats got it', async () => {
    const { store } = await approveThenSummary();
    const chat = Object.values(store.state.conversations).find((item) => item.kind === 'project' && item.projectId === 'prj_011')!;
    const messages = () => Object.values(store.state.messages).filter((message) => message.conversationId === chat.id);
    const before = messages().length;
    await userEvent.click(await screen.findByRole('button', { name: 'Share to the project chats' }));
    await waitFor(() => expect(messages()).toHaveLength(before + 1));
    const [first, second] = messages().at(-1)!.body.split('\n');
    expect(first).toBe('Meeting summary, Wed 30 Sept');
    expect(second).toBe(`${store.state.users.usr_001.name} approved “Handover checklist”`);
    expect(await screen.findByText('The summary went to 1 chat.')).toBeInTheDocument();
  });

  it('says so when nothing changed, and goes back to the same project', async () => {
    await renderApp(MEETING, waitsForReview);
    await screen.findByRole('article');
    await userEvent.click(screen.getByRole('button', { name: 'Summary' }));
    expect(await screen.findByText('No changes in this meeting yet.')).toBeInTheDocument();
    expect(screen.queryByRole('article')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText(/Project 1 of 9/)).toBeInTheDocument();
    expect(screen.queryByText('No changes in this meeting yet.')).toBeNull();
  });
});
