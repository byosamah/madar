import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { checkinsOf } from '../../api/store';
import { setNow } from '../../lib/dates';
import { renderApp } from '../../test/render';

/**
 * The weekly card on Home (fbk_088, owner 2026-11-08). The test office has "now" on Wednesday 2026-09-30 09:00, so the week began on
 * Sunday 2026-09-27 and the card asks for the plan. usr_005 leads Civil Defense drawings (tsk_012) in prj_001.
 */
const ME = 'usr_005';
const THURSDAY = new Date('2026-10-01T06:00:00Z');

/** Two to-dos of mine in this week: tsk_012 due on Thursday and a copy due on Tuesday. Every other to-do of mine is out of the week. */
function mine(state: State, edit: (state: State) => void = () => undefined) {
  state.session.currentUserId = ME;
  for (const task of Object.values(state.tasks)) {
    if (task.ownerId === ME || (task.helperIds ?? []).includes(ME)) task.dueDate = '2099-06-01';
  }
  state.tasks.tsk_012.dueDate = '2026-10-01';
  state.tasks.tsk_901 = { ...structuredClone(state.tasks.tsk_012), id: 'tsk_901', title: 'Probe stair section', dueDate: '2026-09-29', prerequisiteIds: [] };
  state.counters.tsk = Math.max(state.counters.tsk, 901);
  edit(state);
}

const card = (name: string) => screen.findByRole('region', { name });
const answersOf = (state: State) => Object.values(checkinsOf(state));

describe('the plan card (Sunday to Wednesday)', () => {
  it('asks what the person plans, lists the to-dos due this week with every line kept, and has no main button of its own', async () => {
    await renderApp('/', mine);
    const plan = await card('What do you plan this week?');
    const lines = within(plan).getAllByRole('checkbox');
    expect(lines.map((line) => line.closest('label')?.textContent)).toEqual(['Probe stair section', 'Civil Defense drawings']);
    expect(lines.every((line) => (line as HTMLInputElement).checked)).toBe(true);
    expect(within(plan).getByRole('textbox', { name: 'Anything else' })).toBeInTheDocument();
    // The Save button is the secondary button: Home keeps the one navy button for itself.
    expect(within(plan).getByRole('button', { name: 'Save' }).className).not.toContain('signature');
  });

  it('saves the kept lines and the words, and turns into one quiet line with Edit and the link to the week of the team', async () => {
    const { store } = await renderApp('/', mine);
    const plan = await card('What do you plan this week?');
    await userEvent.click(within(plan).getByRole('checkbox', { name: 'Probe stair section' }));
    await userEvent.type(within(plan).getByRole('textbox', { name: 'Anything else' }), 'Site visit on Tuesday.');
    await userEvent.click(within(plan).getByRole('button', { name: 'Save' }));
    const sent = await screen.findByText('Plan sent.');
    const line = sent.closest('section')!;
    expect(within(line).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(within(line).getByRole('link', { name: "See the team's week" })).toHaveAttribute('href', '#/week');
    expect(within(line).queryByRole('checkbox')).toBeNull();
    expect(answersOf(store.state)).toEqual([expect.objectContaining({
      userId: ME, kind: 'plan', week: '2026-09-27', text: 'Site visit on Tuesday.', items: [{ taskId: 'tsk_012', title: 'Civil Defense drawings' }],
    })]);
  });

  it('opens the saved answer for an edit, with the saved lines ticked, and saves the change into the same answer', async () => {
    const { store } = await renderApp('/', mine);
    const plan = await card('What do you plan this week?');
    await userEvent.click(within(plan).getByRole('button', { name: 'Save' }));
    await screen.findByText('Plan sent.');
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const form = await card('What do you plan this week?');
    expect(within(form).getAllByRole('checkbox').every((line) => (line as HTMLInputElement).checked)).toBe(true);
    await userEvent.click(within(form).getByRole('checkbox', { name: 'Civil Defense drawings' }));
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await screen.findByText('Plan sent.');
    expect(answersOf(store.state)).toHaveLength(1);
    expect(answersOf(store.state)[0].items.map((item) => item.taskId)).toEqual(['tsk_901']);
  });

  it('goes back to the quiet line with Cancel, and writes nothing', async () => {
    const { store } = await renderApp('/', mine);
    await userEvent.click(within(await card('What do you plan this week?')).getByRole('button', { name: 'Save' }));
    await screen.findByText('Plan sent.');
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await userEvent.click(within(await card('What do you plan this week?')).getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Plan sent.')).toBeInTheDocument();
    expect(Object.values(store.state.events).filter((event) => event.targetType === 'checkin')).toHaveLength(1);
  });

  it('offers Undo after a save, and the card asks again after the Undo', async () => {
    const { store } = await renderApp('/', mine);
    await userEvent.click(within(await card('What do you plan this week?')).getByRole('button', { name: 'Save' }));
    await screen.findByText('Plan sent.');
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(answersOf(store.state)).toEqual([]));
    expect(await card('What do you plan this week?')).toBeInTheDocument();
  });

  it('shows only the box when no to-do falls due this week, and keeps Save off until the person writes a line', async () => {
    await renderApp('/', (state) => mine(state, (office) => {
      office.tasks.tsk_012.dueDate = '2099-06-01';
      office.tasks.tsk_901.dueDate = '2099-06-02';
    }));
    const plan = await card('What do you plan this week?');
    expect(within(plan).queryByRole('checkbox')).toBeNull();
    expect(within(plan).getByRole('button', { name: 'Save' })).toBeDisabled();
    await userEvent.type(within(plan).getByRole('textbox', { name: 'Anything else' }), 'Draw the stair.');
    expect(within(plan).getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('leaves out the to-do of a person with no project, so a private office to-do never reaches the team', async () => {
    await renderApp('/', (state) => mine(state, (office) => {
      office.tasks.tsk_901 = { ...office.tasks.tsk_901, projectId: null, stageId: null, title: 'Private office to-do' };
    }));
    const plan = await card('What do you plan this week?');
    expect(within(plan).queryByText('Private office to-do')).toBeNull();
    expect(within(plan).getAllByRole('checkbox')).toHaveLength(1);
  });

  it('draws nothing for a person without the switch "Answer the weekly question"', async () => {
    await renderApp('/', (state) => mine(state, (office) => {
      office.users[ME].roleId = 'rol_901';
      office.settings.roles = { custom: [{ id: 'rol_901', name: 'Quiet', nameAr: 'هادئ', rights: [], off: ['checkin.answer'] }] };
    }));
    await screen.findByRole('link', { name: 'See all my to-dos' });
    expect(screen.queryByRole('region', { name: 'What do you plan this week?' })).toBeNull();
    expect(screen.queryByText('Plan sent.')).toBeNull();
  });
});

describe('the review card (Thursday to Saturday)', () => {
  it('asks what the person did, lists the to-dos finished since Sunday, and saves them as the review', async () => {
    const { store } = await renderApp('/', (state) => {
      setNow(THURSDAY);
      mine(state, (office) => {
        office.tasks.tsk_901.status = 'done';
        office.tasks.tsk_901.completedAt = '2026-09-29T10:00:00.000+03:00';
        office.tasks.tsk_012.status = 'done';
        office.tasks.tsk_012.completedAt = '2026-09-26T10:00:00.000+03:00';
      });
    });
    const review = await card('What did you do this week?');
    // tsk_012 was finished on Saturday, before the week began, so only the to-do of Tuesday is a line.
    expect(within(review).getAllByRole('checkbox').map((line) => line.closest('label')?.textContent)).toEqual(['Probe stair section']);
    await userEvent.click(within(review).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Answer sent.')).toBeInTheDocument();
    expect(answersOf(store.state)).toEqual([expect.objectContaining({ kind: 'review', week: '2026-09-27', items: [{ taskId: 'tsk_901', title: 'Probe stair section' }] })]);
  });

  it('shows the review card even when the plan of the week was never sent', async () => {
    await renderApp('/', (state) => {
      setNow(THURSDAY);
      mine(state);
    });
    expect(await card('What did you do this week?')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'What do you plan this week?' })).toBeNull();
  });
});
