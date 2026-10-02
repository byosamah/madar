import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';
import { openSummary } from './steps';

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
async function approveThenSummary(prepare: (state: State) => void = waitsForReview) {
  const rendered = await renderApp(MEETING, prepare);
  const attention = within(await screen.findByRole('region', { name: 'Needs attention' }));
  await userEvent.click(attention.getByRole('button', { name: /^Handover checklist.*Waiting for review/ }));
  const sheet = await screen.findByRole('dialog', { name: 'Handover checklist' });
  await userEvent.click(within(sheet).getByRole('button', { name: 'Approve' }));
  await waitFor(() => expect(Object.values(rendered.store.state.events).some((event) => event.verb === 'task.approved')).toBe(true));
  await userEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Handover checklist' })).toBeNull());
  await openSummary();
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
    await openSummary();
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
    await openSummary();
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

  it('posts once for two presses, and stays shared until the summary changes', async () => {
    const { store } = await approveThenSummary();
    const chat = Object.values(store.state.conversations).find((item) => item.kind === 'project' && item.projectId === 'prj_011')!;
    const messages = () => Object.values(store.state.messages).filter((message) => message.conversationId === chat.id);
    const before = messages().length;
    const share = await screen.findByRole('button', { name: 'Share to the project chats' });
    await userEvent.click(share);
    await userEvent.click(share);
    const done = await screen.findByRole('button', { name: 'Shared to 1 chat' });
    expect(done).toBeDisabled();
    expect(messages()).toHaveLength(before + 1);
    // Back and Summary again show the same summary, so it stays shared.
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    await openSummary();
    expect(await screen.findByRole('button', { name: 'Shared to 1 chat' })).toBeDisabled();
    // A new decision changes the summary, so it can go to the chats again.
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    await userEvent.type(await screen.findByRole('textbox', { name: 'Write a decision' }), 'Order the stone tiles{Enter}');
    await waitFor(() => expect(Object.values(store.state.updates).some((update) => update.body === 'Order the stone tiles')).toBe(true));
    await openSummary();
    expect(await screen.findByRole('button', { name: 'Share to the project chats' })).toBeEnabled();
  });

  it('offers Share only when a project in the summary has a chat the viewer can see', async () => {
    await approveThenSummary((state) => {
      waitsForReview(state);
      for (const [id, chat] of Object.entries(state.conversations)) if (chat.projectId === 'prj_011') delete state.conversations[id];
      for (const [id, message] of Object.entries(state.messages)) if (!state.conversations[message.conversationId]) delete state.messages[id];
    });
    expect(await screen.findByRole('button', { name: 'Copy as a table' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Share to the project chats' })).toBeNull();
  });

  it('says so when nothing changed, and goes back to the same project', async () => {
    await renderApp(MEETING, waitsForReview);
    await screen.findByRole('article');
    await openSummary();
    expect(await screen.findByText('No changes in this meeting yet.')).toBeInTheDocument();
    // The meeting started at the pinned time of the tests, 09:00 office time.
    expect(screen.getByText('Changes since 09:00')).toBeInTheDocument();
    expect(screen.queryByRole('article')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.getByRole('button', { name: /^Agenda 1 of 9/ })).toBeInTheDocument();
    expect(screen.queryByText('No changes in this meeting yet.')).toBeNull();
  });
});

describe('the projects of the summary, and what went to the chats (audit 2026-10-03)', () => {
  const idOf = (state: State, name: string) => Object.values(state.projects).find((project) => project.name === name)!.id;
  const summariesIn = (state: State, projectId: string) => {
    const chat = Object.values(state.conversations).find((item) => item.kind === 'project' && item.projectId === projectId)!;
    return Object.values(state.messages).filter((message) => message.conversationId === chat.id && message.body.startsWith('Meeting summary'));
  };

  it('keeps a project that leaves the agenda in the meeting, with its decision (DSH-1)', async () => {
    const { api } = await renderApp(MEETING, waitsForReview);
    await screen.findByRole('article', { name: 'Shore Walk Retail Kiosks' });
    await api.call('updates.create', { projectId: 'prj_011', body: 'Hand over the kiosks.', decision: true });
    await api.call('projects.setStatus', { id: 'prj_011', status: 'completed' });
    // The completed project leaves the agenda.
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Shore Walk Retail Kiosks' })).toBeNull());
    await openSummary();
    const summary = await screen.findByRole('region', { name: 'Meeting summary' });
    const project = within(await within(summary).findByRole('group', { name: 'Shore Walk Retail Kiosks' }));
    expect(project.getByText('wrote the decision “Hand over the kiosks.”')).toBeInTheDocument();
    expect(within(summary).queryByText('No changes in this meeting yet.')).toBeNull();
  });

  it('remembers what went to the chats after Exit and a return, so Share does not post it again (DSH-4)', async () => {
    const { store } = await approveThenSummary();
    await userEvent.click(await screen.findByRole('button', { name: 'Share to the project chats' }));
    await waitFor(() => expect(summariesIn(store.state, 'prj_011')).toHaveLength(1));
    await userEvent.click(screen.getByRole('button', { name: 'Exit' }));
    await screen.findByRole('heading', { level: 1, name: 'Dashboard' });
    window.location.hash = `#${MEETING}`;
    await screen.findByRole('article', { name: 'Shore Walk Retail Kiosks' });
    await openSummary();
    expect(await screen.findByRole('button', { name: 'Shared to 1 chat' })).toBeDisabled();
    expect(summariesIn(store.state, 'prj_011')).toHaveLength(1);
  });

  it('posts again only to the chat of a project whose lines changed (DSH-4)', async () => {
    const { api, store } = await renderApp(MEETING, waitsForReview);
    await screen.findByRole('article', { name: 'Shore Walk Retail Kiosks' });
    const corniche = idOf(store.state, 'Corniche Office Tower');
    await api.call('updates.create', { projectId: 'prj_011', body: 'Order the kiosk glass.', decision: true });
    await api.call('updates.create', { projectId: corniche, body: 'Keep the lobby double height.', decision: true });
    await openSummary();
    await userEvent.click(await screen.findByRole('button', { name: 'Share to the project chats' }));
    expect(await screen.findByRole('button', { name: 'Shared to 2 chats' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    await api.call('updates.create', { projectId: corniche, body: 'Use the glass rail.', decision: true });
    await openSummary();
    await userEvent.click(await screen.findByRole('button', { name: 'Share to the project chats' }));
    await waitFor(() => expect(summariesIn(store.state, corniche)).toHaveLength(2));
    expect(summariesIn(store.state, 'prj_011')).toHaveLength(1);
    expect(await screen.findByText('The summary went to 1 chat.')).toBeInTheDocument();
  });

  it('names the projects that did not get the summary (DSH-17)', async () => {
    const { api, store } = await renderApp(MEETING, (state) => {
      waitsForReview(state);
      const corniche = idOf(state, 'Corniche Office Tower');
      for (const [id, chat] of Object.entries(state.conversations)) if (chat.projectId === corniche) delete state.conversations[id];
      for (const [id, message] of Object.entries(state.messages)) if (!state.conversations[message.conversationId]) delete state.messages[id];
    });
    await screen.findByRole('article', { name: 'Shore Walk Retail Kiosks' });
    await api.call('updates.create', { projectId: 'prj_011', body: 'Order the kiosk glass.', decision: true });
    await api.call('updates.create', { projectId: idOf(store.state, 'Corniche Office Tower'), body: 'Keep the lobby double height.', decision: true });
    await openSummary();
    await userEvent.click(await screen.findByRole('button', { name: 'Share to the project chats' }));
    expect(await screen.findByText('The summary went to 1 chat. Not shared: Corniche Office Tower.')).toBeInTheDocument();
  });
});
