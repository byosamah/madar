import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';
import { openAgendaSheet } from './steps';

const MEETING = '/dashboard/meeting?mode=projects';

const shoreWalk = (state: State) => Object.values(state.projects).find((project) => project.name === 'Shore Walk Retail Kiosks')!;
// The agenda shows the late projects first, so Shore Walk Retail Kiosks is the first project screen.
// The sample tasks carry the pinned time of the tests, which is the start of the meeting. They are older here, so only new tasks count.
const shoreWalkFirst = (state: State) => {
  for (const task of Object.values(state.tasks)) task.createdAt = '2026-09-20T09:00:00.000+03:00';
  shoreWalk(state).healthOverride = { value: 'late', reason: 'The client moved the opening.', setBy: 'usr_001', setAt: '2026-09-30T09:00:00.000+03:00' };
};

const panel = async () => within(await screen.findByRole('region', { name: 'Decisions' }));

describe('decisions and actions, in the meeting (owner, 2026-10-02)', () => {
  it('posts a decision with Enter, lists it, and shows it in the Activity with a Decision label', async () => {
    const { store } = await renderApp(MEETING, shoreWalkFirst);
    const decisions = await panel();
    await userEvent.type(decisions.getByRole('textbox', { name: 'Write a decision' }), 'Keep the lobby double height.{Enter}');
    expect(await decisions.findByText('Keep the lobby double height.')).toBeInTheDocument();
    expect(decisions.getByRole('textbox', { name: 'Write a decision' })).toHaveValue('');
    const posted = Object.values(store.state.updates).filter((update) => update.decision);
    expect(posted).toHaveLength(1);
    expect(posted[0].projectId).toBe(shoreWalk(store.state).id);
    window.location.hash = `#/projects/${shoreWalk(store.state).id}?tab=activity`;
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Decisions' })).toBeNull());
    const post = (await screen.findByText('Keep the lobby double height.')).closest('li')!;
    expect(within(post).getByText('Decision')).toBeInTheDocument();
  });

  it('adds a decision with the Add button', async () => {
    await renderApp(MEETING, shoreWalkFirst);
    const decisions = await panel();
    await userEvent.type(decisions.getByRole('textbox', { name: 'Write a decision' }), 'Use the glass rail.');
    await userEvent.click(decisions.getByRole('button', { name: 'Add' }));
    expect(await decisions.findByText('Use the glass rail.')).toBeInTheDocument();
  });

  it('never writes a Tracker entry for a decision', async () => {
    const { store, api } = await renderApp(MEETING, shoreWalkFirst);
    const projectId = shoreWalk(store.state).id;
    const before = (await api.call('tracker.list', { projectId })).length;
    const total = Object.keys(store.state.tracker ?? {}).length;
    const decisions = await panel();
    await userEvent.type(decisions.getByRole('textbox', { name: 'Write a decision' }), 'Keep the lobby double height.{Enter}');
    await decisions.findByText('Keep the lobby double height.');
    expect(await api.call('tracker.list', { projectId })).toHaveLength(before);
    expect(Object.keys(store.state.tracker ?? {})).toHaveLength(total);
  });

  it('adds an action as a task in the current stage, with the person as lead and the date', async () => {
    const { store } = await renderApp(MEETING, shoreWalkFirst);
    const project = shoreWalk(store.state);
    const person = store.state.users[project.leaderId!];
    const decisions = await panel();
    await userEvent.click(decisions.getByRole('radio', { name: 'Action' }));
    await userEvent.type(decisions.getByRole('textbox', { name: 'Write an action' }), 'Revise sections');
    await userEvent.selectOptions(decisions.getByRole('combobox', { name: 'Who' }), person.id);
    const by = decisions.getByLabelText('Due date');
    await userEvent.clear(by);
    await userEvent.type(by, '2026-10-08');
    await userEvent.click(decisions.getByRole('button', { name: 'Add' }));
    expect(await decisions.findByText(`Action: Revise sections · ${person.name} · Thu 8 Oct`)).toBeInTheDocument();
    const task = Object.values(store.state.tasks).find((item) => item.title === 'Revise sections')!;
    expect(task.projectId).toBe(project.id);
    expect(task.stageId).toBe(project.currentStageId);
    expect(task.ownerId).toBe(person.id);
    expect(task.dueDate).toBe('2026-10-08');
  });

  it('lists an action of a paused project (audit 2026-10-03, DSH-5)', async () => {
    const { store } = await renderApp(`${MEETING}&status=all`, shoreWalkFirst);
    await panel();
    const sheet = await openAgendaSheet();
    await userEvent.click(within(sheet).getByRole('button', { name: /Gulf Crest HQ Interiors/ }));
    await screen.findByRole('article', { name: 'Gulf Crest HQ Interiors' });
    const decisions = await panel();
    await userEvent.click(decisions.getByRole('radio', { name: 'Action' }));
    await userEvent.type(decisions.getByRole('textbox', { name: 'Write an action' }), 'Call the client back');
    await userEvent.click(decisions.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(Object.values(store.state.tasks).filter((task) => task.title === 'Call the client back')).toHaveLength(1));
    expect(await decisions.findByText(/^Action: Call the client back/)).toBeInTheDocument();
  });

  it('keeps a typed decision and a typed action over a move to another project and back (audit 2026-10-03, DSH-3)', async () => {
    await renderApp(MEETING, shoreWalkFirst);
    let decisions = await panel();
    await userEvent.type(decisions.getByRole('textbox', { name: 'Write a decision' }), 'Half typed decision');
    await userEvent.click(decisions.getByRole('radio', { name: 'Action' }));
    await userEvent.type(decisions.getByRole('textbox', { name: 'Write an action' }), 'Half typed action');
    // The other kind keeps its text too.
    await userEvent.click(decisions.getByRole('radio', { name: 'Decision' }));
    expect(decisions.getByRole('textbox', { name: 'Write a decision' })).toHaveValue('Half typed decision');
    await userEvent.click(decisions.getByRole('radio', { name: 'Action' }));
    expect(decisions.getByRole('textbox', { name: 'Write an action' })).toHaveValue('Half typed action');
    // Done shows the next project. B comes back to this one, with the kind and both texts as they were.
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Shore Walk Retail Kiosks' })).toBeNull());
    await userEvent.keyboard('b');
    await screen.findByRole('article', { name: 'Shore Walk Retail Kiosks' });
    decisions = await panel();
    expect(decisions.getByRole('textbox', { name: 'Write an action' })).toHaveValue('Half typed action');
    await userEvent.click(decisions.getByRole('radio', { name: 'Decision' }));
    expect(decisions.getByRole('textbox', { name: 'Write a decision' })).toHaveValue('Half typed decision');
  });

  it('confirms a decision with an Undo toast, and Undo takes it back (browser audit 2026-10-03, BRW-14)', async () => {
    const { store } = await renderApp(MEETING, shoreWalkFirst);
    const decisions = await panel();
    await userEvent.type(decisions.getByRole('textbox', { name: 'Write a decision' }), 'Keep the lobby double height.{Enter}');
    await decisions.findByText('Keep the lobby double height.');
    const toast = (await screen.findByText('Decision added.')).closest('[role="status"]') as HTMLElement;
    await userEvent.click(within(toast).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(Object.values(store.state.updates).some((update) => update.body === 'Keep the lobby double height.')).toBe(false));
    await waitFor(() => expect(decisions.queryByText('Keep the lobby double height.')).toBeNull());
  });

  it('says for whom an action made a task, and Undo takes the task back (browser audit 2026-10-03, BRW-14)', async () => {
    const { store } = await renderApp(MEETING, shoreWalkFirst);
    const person = store.state.users[shoreWalk(store.state).leaderId!];
    const decisions = await panel();
    await userEvent.click(decisions.getByRole('radio', { name: 'Action' }));
    await userEvent.type(decisions.getByRole('textbox', { name: 'Write an action' }), 'Revise sections');
    await userEvent.selectOptions(decisions.getByRole('combobox', { name: 'Who' }), person.id);
    await userEvent.click(decisions.getByRole('button', { name: 'Add' }));
    await decisions.findByText(/^Action: Revise sections/);
    const toast = (await screen.findByText(`Task added for ${person.name}.`)).closest('[role="status"]') as HTMLElement;
    await userEvent.click(within(toast).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(Object.values(store.state.tasks).some((task) => task.title === 'Revise sections')).toBe(false));
    await waitFor(() => expect(decisions.queryByText(/^Action: Revise sections/)).toBeNull());
  });

  it('lists the decisions and actions of this meeting only, the newest last', async () => {
    await renderApp(MEETING, (state) => {
      shoreWalkFirst(state);
      const projectId = shoreWalk(state).id;
      state.updates.upd_901 = { id: 'upd_901', projectId, authorId: 'usr_001', body: 'Decided last week.', fileIds: [], decision: true, createdAt: '2026-09-23T10:00:00.000+03:00', editedAt: null };
    });
    const decisions = await panel();
    await userEvent.type(decisions.getByRole('textbox', { name: 'Write a decision' }), 'First one.{Enter}');
    await decisions.findByText('First one.');
    await userEvent.type(decisions.getByRole('textbox', { name: 'Write a decision' }), 'Second one.{Enter}');
    await decisions.findByText('Second one.');
    expect(decisions.queryByText('Decided last week.')).toBeNull();
    expect(decisions.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['First one.', 'Second one.']);
  });

  it('shows only the decision input to a viewer who may post but not make tasks for others', async () => {
    await renderApp(MEETING, (state) => {
      shoreWalkFirst(state);
      const project = shoreWalk(state);
      const member = Object.values(state.members).find((item) => item.projectId === project.id && item.userId !== project.leaderId && state.users[item.userId].systemRole === 'member')!;
      state.session.currentUserId = member.userId;
    });
    const decisions = await panel();
    expect(decisions.getByRole('textbox', { name: 'Write a decision' })).toBeInTheDocument();
    expect(decisions.queryByRole('radio', { name: 'Action' })).toBeNull();
  });

  it('does not render for a viewer who may do neither, when the list is empty', async () => {
    await renderApp(MEETING, (state) => {
      shoreWalkFirst(state);
      const project = shoreWalk(state);
      const outsider = Object.values(state.users).find((user) => user.kind === 'human' && user.systemRole === 'member' && user.id !== project.leaderId && !Object.values(state.members).some((m) => m.projectId === project.id && m.userId === user.id));
      state.session.currentUserId = outsider!.id;
    });
    await screen.findByRole('region', { name: 'Needs attention' });
    expect(screen.queryByRole('region', { name: 'Decisions' })).toBeNull();
  });

  it('shows the list without any input to a viewer who may do neither, when the list has items', async () => {
    await renderApp(MEETING, (state) => {
      shoreWalkFirst(state);
      const project = shoreWalk(state);
      state.updates.upd_902 = { id: 'upd_902', projectId: project.id, authorId: 'usr_001', body: 'Keep the lobby double height.', fileIds: [], decision: true, createdAt: '2026-09-30T09:00:00.000+03:00', editedAt: null };
      const outsider = Object.values(state.users).find((user) => user.kind === 'human' && user.systemRole === 'member' && user.id !== project.leaderId && !Object.values(state.members).some((m) => m.projectId === project.id && m.userId === user.id));
      state.session.currentUserId = outsider!.id;
    });
    const decisions = await panel();
    expect(decisions.getByText('Keep the lobby double height.')).toBeInTheDocument();
    expect(decisions.queryByRole('textbox')).toBeNull();
    expect(decisions.queryByRole('button')).toBeNull();
  });
});
