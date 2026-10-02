import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
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

  it('shows a moved date with the old date, the new date and the meeting reason', async () => {
    const { store } = await renderApp(`${MEETING}&task=tsk_130`, (state) => {
      waitsForReview(state);
      Object.assign(state.tasks.tsk_130, { startDate: '2026-10-04', schedule: 'static', durationDays: null, dueDate: '2026-10-20' });
    });
    const sheet = await screen.findByRole('dialog', { name: 'Progress photos' });
    const due = within(sheet).getByLabelText('Due date');
    fireEvent.change(due, { target: { value: '2026-10-26' } });
    fireEvent.blur(due);
    const ask = await screen.findByRole('dialog', { name: 'Why do the dates change?' });
    await userEvent.click(within(ask).getByRole('button', { name: 'Decided in the meeting on Wed 30 Sept' }));
    await waitFor(() => expect(store.state.tasks.tsk_130.dueDate).toBe('2026-10-26'));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Progress photos' })).toBeNull());
    await userEvent.click(screen.getByRole('button', { name: 'Summary' }));
    const summary = await screen.findByRole('region', { name: 'Meeting summary' });
    const project = within(await within(summary).findByRole('group', { name: 'Shore Walk Retail Kiosks' }));
    // The reason is a message in the task Conversation. It joins the line of its move, so it is not a second line.
    expect(project.getAllByRole('listitem')).toHaveLength(1);
    expect(project.getByText('moved the dates of “Progress photos”: the due date from Tue 20 Oct to Mon 26 Oct. Reason: Decided in the meeting on Wed 30 Sept')).toBeInTheDocument();
  });

  it('lists a new lead, a closed client item, a reply person and any other change, and never a payment', async () => {
    const { api } = await renderApp(MEETING, (state) => {
      waitsForReview(state);
      state.tasks.tsk_130.flagged = false;
    });
    await screen.findByRole('article');
    const asked = await api.call('tracker.log', { projectId: 'prj_011', type: 'message', direction: 'in', title: 'Kiosk lighting question', waiting: 'us' });
    const sent = await api.call('tracker.log', { projectId: 'prj_011', type: 'message', direction: 'out', title: 'Signage drawings', waiting: 'client' });
    await api.call('tracker.assignReply', { id: asked.entry.id, userId: 'usr_008', dueDate: '2026-10-05' });
    await api.call('tracker.close', { id: sent.entry.id });
    await api.call('tasks.update', { id: 'tsk_130', patch: { ownerId: 'usr_008' } });
    await api.call('tasks.update', { id: 'tsk_130', patch: { flagged: true } });
    await api.call('payments.create', { projectId: 'prj_011', name: 'Second payment', amount: 5000, dueDate: '2026-10-15' });
    // A change and its Undo in the same meeting cancel out, so neither shows.
    await api.call('tasks.update', { id: 'tsk_131', patch: { flagged: true } }, { correlationId: 'cor_meeting_undo' });
    await api.call('events.undoStory', { correlationId: 'cor_meeting_undo' });
    await userEvent.click(screen.getByRole('button', { name: 'Summary' }));
    const summary = await screen.findByRole('region', { name: 'Meeting summary' });
    const project = within(await within(summary).findByRole('group', { name: 'Shore Walk Retail Kiosks' }));
    const whats = project.getAllByRole('listitem').map((item) => item.querySelector('.text-ink-2:not(bdi)')?.textContent);
    expect(whats).toEqual([
      'made a change to “Kiosk lighting question”',
      'made a change to “Signage drawings”',
      'added the task “Reply: Kiosk lighting question”',
      'asked Khalid Al-Mutairi to reply to “Kiosk lighting question”',
      'marked “Signage drawings” as received',
      'made Khalid Al-Mutairi the lead of “Progress photos”',
      'changed the flag of “Progress photos”',
    ]);
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
