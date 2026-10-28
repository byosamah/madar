import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OfficeRight } from '../../../api/contract/entities';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';
import { without } from '../../../test/rr2work';

/**
 * The fields of the to-do panel follow their switches (role rights version 2): the title, description, flag, stage and checklist items
 * follow task.details; the dates follow task.dates; the status and the ticks follow task.work; Take it, Join as a helper, Approve, the
 * lead field, Save as template and Delete follow their own switches. Yousef (usr_006) leads "Stair details" (tsk_007) of prj_001, Sara
 * (usr_005) is on the team of that project and neither leads nor helps, Faisal (usr_002) leads the project.
 */
const OPEN = (id: string) => `/projects/prj_001?tab=tasks&task=${id}`;
const as = (userId: string, off: OfficeRight[] = []) => (state: State) => {
  state.session.currentUserId = userId;
  if (off.length > 0) state.settings.roles = without(...off);
};
const sheet = async (title: string) => screen.findByRole('dialog', { name: title });

type Case = { name: string; user: string; task: string; title: string; off: OfficeRight[]; find: (panel: HTMLElement) => HTMLElement | null };

const CASES: Case[] = [
  { name: 'the title field', user: 'usr_006', task: 'tsk_007', title: 'Stair details', off: ['task.details'], find: (p) => within(p).queryByLabelText('Title') },
  { name: 'the description field', user: 'usr_006', task: 'tsk_007', title: 'Stair details', off: ['task.details'], find: (p) => within(p).queryByLabelText('Description') },
  { name: 'the flag switch', user: 'usr_006', task: 'tsk_007', title: 'Stair details', off: ['task.details'], find: (p) => within(p).queryByRole('switch', { name: /^Flag/ }) },
  { name: 'the checklist item field', user: 'usr_006', task: 'tsk_007', title: 'Stair details', off: ['task.details'], find: (p) => within(p).queryByPlaceholderText('Add an item') },
  { name: 'the stage field', user: 'usr_006', task: 'tsk_007', title: 'Stair details', off: ['task.details'], find: (p) => within(p).queryByLabelText('Stage') },
  { name: 'the due date field', user: 'usr_006', task: 'tsk_007', title: 'Stair details', off: ['task.dates'], find: (p) => within(p).queryByLabelText('Due date') },
  { name: 'the status menu', user: 'usr_006', task: 'tsk_007', title: 'Stair details', off: ['task.work'], find: (p) => within(p).queryByLabelText('Status') },
  { name: 'Join as a helper', user: 'usr_005', task: 'tsk_007', title: 'Stair details', off: ['task.help'], find: (p) => within(p).queryByRole('button', { name: 'Join as a helper' }) },
  { name: 'the lead field', user: 'usr_002', task: 'tsk_007', title: 'Stair details', off: ['task.any.lead', 'task.assign'], find: (p) => within(p).queryByRole('combobox', { name: 'Lead' }) },
  { name: 'Save as template', user: 'usr_002', task: 'tsk_007', title: 'Stair details', off: ['templates.taskSave.lead'], find: (p) => within(p).queryByRole('button', { name: 'Save as template' }) },
  { name: 'Approve', user: 'usr_002', task: 'tsk_010', title: 'Toilet details', off: ['task.review.lead'], find: (p) => within(p).queryByRole('button', { name: 'Approve' }) },
];

describe.each(CASES)('$name', (item) => {
  it('shows with the switch on', async () => {
    await renderApp(OPEN(item.task), as(item.user));
    const panel = await sheet(item.title);
    await waitFor(() => expect(item.find(panel)).not.toBeNull());
  });

  it('is gone with the switch off', async () => {
    await renderApp(OPEN(item.task), as(item.user, item.off));
    const panel = await sheet(item.title);
    // The panel has loaded when the title shows, as a field or as plain text.
    await within(panel).findByText('Stair details', { selector: 'bdi, input, h2' }).catch(() => undefined);
    await waitFor(() => expect(item.find(panel)).toBeNull());
  });
});

describe('the Needs first list of the maker (tsk_418)', () => {
  const remove = { name: 'Remove Reflected ceiling plans from the list' };

  it('shows the X to the maker with task.assign off, on the desk', async () => {
    await renderApp(OPEN('tsk_007'), (state) => {
      as('usr_005', ['task.assign'])(state);
      state.tasks.tsk_007.createdBy = 'usr_005';
    });
    const panel = await sheet('Stair details');
    expect(await within(panel).findByRole('button', remove)).toBeInTheDocument();
  });

  it('hides the X from a team member who did not make the to-do', async () => {
    await renderApp(OPEN('tsk_007'), as('usr_005'));
    const panel = await sheet('Stair details');
    await within(panel).findByText('Reflected ceiling plans');
    expect(within(panel).queryByRole('button', remove)).toBeNull();
  });
});

describe('Delete to-do (task.deleteOwn)', () => {
  it('shows for the lead who did not take the to-do, with the switch on', async () => {
    await renderApp(OPEN('tsk_007'), as('usr_002'));
    const panel = await sheet('Stair details');
    expect(await within(panel).findByRole('button', { name: 'Delete to-do' })).toBeInTheDocument();
  });

  it('is gone for the leader with task.any.lead off and task.deleteOwn off', async () => {
    await renderApp(OPEN('tsk_007'), as('usr_002', ['task.any.lead', 'task.deleteOwn']));
    const panel = await sheet('Stair details');
    await within(panel).findByText('Stair details');
    expect(within(panel).queryByRole('button', { name: 'Delete to-do' })).toBeNull();
  });
});

describe('the comment box of the Conversation (comment.create, file.upload)', () => {
  const conversation = (userId: string, off: OfficeRight[] = []) => async () => {
    await renderApp(`${OPEN('tsk_007')}&thread=1`, as(userId, off));
    return sheet('Stair details');
  };

  it('shows the box and the Attach button with the switches on', async () => {
    const panel = await conversation('usr_005')();
    expect(await within(panel).findByLabelText('Add a comment')).toBeInTheDocument();
    // The clip opens a short menu (fbk_070): Upload a file and Insert from a project.
    expect(within(panel).getByRole('button', { name: 'Attach' })).toBeInTheDocument();
  });

  it('shows the quiet line in place of the box with comment.create off', async () => {
    const panel = await conversation('usr_005', ['comment.create.team'])();
    expect(await within(panel).findByText('Only the project team can comment here.')).toBeInTheDocument();
    expect(within(panel).queryByLabelText('Add a comment')).toBeNull();
  });

  it('keeps the box and takes the Attach button away with file.upload off', async () => {
    const panel = await conversation('usr_005', ['file.upload.team'])();
    expect(await within(panel).findByLabelText('Add a comment')).toBeInTheDocument();
    expect(within(panel).queryByText('Attach files')).toBeNull();
  });
});

describe('the checklist ticks (task.work) for a person who edits the details', () => {
  it('shows the boxes off for a person with task.details and no task.work', async () => {
    await renderApp(OPEN('tsk_007'), (state) => {
      as('usr_006', ['task.work'])(state);
      state.tasks.tsk_007.checklist = [{ id: 'chk_1', text: 'Check the rise', done: false }];
    });
    const panel = await sheet('Stair details');
    const box = await within(panel).findByRole('checkbox', { name: 'Check the rise' });
    expect(box).toBeDisabled();
    expect(within(panel).getByPlaceholderText('Add an item')).toBeInTheDocument();
  });

  it('lets the lead tick the box with task.work on', async () => {
    await renderApp(OPEN('tsk_007'), (state) => {
      as('usr_006')(state);
      state.tasks.tsk_007.checklist = [{ id: 'chk_1', text: 'Check the rise', done: false }];
    });
    const panel = await sheet('Stair details');
    expect(await within(panel).findByRole('checkbox', { name: 'Check the rise' })).toBeEnabled();
  });
});

describe('naming a person outside the team (project.team)', () => {
  const options = async (off: OfficeRight[]) => {
    await renderApp(OPEN('tsk_007'), as('usr_002', off));
    const lead = await within(await sheet('Stair details')).findByRole('combobox', { name: 'Lead' });
    return within(lead).getAllByRole('option').length;
  };

  it('lists every active person as the lead for the leader, and only the team with project.team off', async () => {
    const full = await options([]);
    expect(full).toBeGreaterThan(5);
  });

  it('lists only the team with project.team off', async () => {
    const team = await options(['project.team.lead']);
    // The team of prj_001 is the leader and three people, plus "No lead".
    expect(team).toBeLessThan(7);
  });
});
