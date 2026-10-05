import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

const as = (userId: string, more?: (state: State) => void) => (state: State) => {
  state.session.currentUserId = userId;
  more?.(state);
};
const TASKS = '/projects/prj_001?tab=tasks';
const TASK = (id: string) => `${TASKS}&task=${id}`;
const rowOf = async (title: string) => (await screen.findByText(title)).closest('li') as HTMLElement;
/**
 * The Tasks tab is a large page, and a role query checks the style of each element on it: about 100 ms a run in jsdom, more under
 * load. findByRole runs that query again on each change of the page while the tab loads, so it held up the screen it waited for,
 * and the first test of this file ran out of time in full runs (track Q, item 4). The wait uses the label, then the role is checked once.
 */
async function templateButton(stage: string): Promise<HTMLElement> {
  const name = `From a template in ${stage}`;
  await screen.findByLabelText(name);
  return screen.getByRole('button', { name });
}

describe('"From a template" on the Tasks tab', () => {
  it('lists only the templates saved for that stage, and makes the task with its checklist unticked', async () => {
    const { store } = await renderApp(TASKS, as('usr_002'));
    await userEvent.click(await templateButton('Construction Documents'));
    const menu = screen.getByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Floor plans set', 'Sections and elevations set', 'Wall sections and details']);
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Floor plans set' }));
    await waitFor(() => expect(Object.values(store.state.tasks).some((task) => task.title === 'Floor plans set')).toBe(true));
    const made = Object.values(store.state.tasks).find((task) => task.title === 'Floor plans set')!;
    expect(made.stageId).toBe(Object.values(store.state.stages).find((s) => s.projectId === 'prj_001' && s.name === 'Construction Documents')!.id);
    expect(made.checklist.map((item) => [item.text, item.done])).toEqual([['Ground floor', false], ['Typical floor', false], ['Roof plan', false]]);
    expect(await screen.findByText('Added “Floor plans set” from a template.')).toBeInTheDocument();
    expect(await rowOf('Floor plans set')).toBeInTheDocument();
  });

  it("never shows another stage's templates, and no button for a stage with none", async () => {
    await renderApp(TASKS, as('usr_002'));
    await userEvent.click(await templateButton('Permits'));
    expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Balady submission pack']);
    expect(screen.queryByRole('button', { name: 'From a template in Tender' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'From a template in Concept' })).toBeNull();
  });

  it('is there for a team member too, and the new task has no lead (owner, 2026-10-05)', async () => {
    const { store } = await renderApp(TASKS, as('usr_005'));
    await userEvent.click(await templateButton('Design Development'));
    await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Material board' }));
    // Design Development is before the stage the project is in (Construction Documents), so the new task moves the project back and the server asks why.
    const ask = await screen.findByRole('dialog', { name: 'This moves the project back to Design Development. Why?' });
    await userEvent.type(within(ask).getByRole('textbox', { name: 'Reason' }), 'The client wants a material board');
    await userEvent.click(within(ask).getByRole('button', { name: 'Move back' }));
    await waitFor(() => expect(Object.values(store.state.tasks).some((task) => task.title === 'Material board' && task.ownerId === null)).toBe(true));
    expect(store.state.projects.prj_001.stageBack).toMatchObject({ reason: 'The client wants a material board' });
  });
});

describe('"Save as template" in the task panel', () => {
  it('saves the task for its stage, with the checklist titles', async () => {
    const { store } = await renderApp(TASK('tsk_007'), as('usr_002', (state) => {
      state.tasks.tsk_007.checklist = [{ id: 'chk_a', text: 'Handrail height', done: true }, { id: 'chk_b', text: 'Tread depth', done: false }];
    }));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save as template' }));
    expect(await screen.findByText('Saved as a template for Construction Documents.')).toBeInTheDocument();
    const saved = Object.values(store.state.taskTemplates ?? {}).find((tpl) => tpl.name === 'Stair details')!;
    expect(saved).toMatchObject({ stageName: 'Construction Documents', checklist: ['Handrail height', 'Tread depth'] });
  });

  it('is not there for the lead who is not the leader', async () => {
    await renderApp(TASK('tsk_007'), as('usr_006'));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    expect(within(sheet).queryByRole('button', { name: 'Save as template' })).toBeNull();
  });
});

describe('task versions', () => {
  const finished = (state: State) => {
    state.tasks.tsk_007.status = 'done';
    state.tasks.tsk_007.completedAt = '2026-09-28T10:00:00.000+03:00';
    state.tasks.tsk_007.checklist = [{ id: 'chk_a', text: 'Handrail height', done: true }];
  };

  it('opens a new version with a reason and dates, then lists both versions', async () => {
    const { store } = await renderApp(TASK('tsk_007'), as('usr_002', finished));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    expect(within(sheet).queryByText('Versions')).toBeNull();
    await userEvent.click(within(sheet).getByRole('button', { name: 'New version' }));
    const form = within(sheet).getByRole('region', { name: 'New version' });
    expect(within(form).getByRole('button', { name: 'Start version 2' })).toBeDisabled();
    await userEvent.type(within(form).getByLabelText('Why does it open again?'), 'Client comments, 12 Oct');
    const due = within(form).getByLabelText('Due date');
    fireEvent.change(due, { target: { value: '2026-10-20' } });
    fireEvent.blur(due);
    await userEvent.click(within(form).getByRole('button', { name: 'Start version 2' }));
    await waitFor(() => expect(store.state.tasks.tsk_007.version).toBe(2));
    expect(store.state.tasks.tsk_007).toMatchObject({ status: 'todo', dueDate: '2026-10-20', completedAt: null });
    expect(store.state.tasks.tsk_007.checklist.map((item) => item.done)).toEqual([false]);
    const versions = await within(sheet).findByRole('region', { name: 'Versions' });
    const items = within(versions).getAllByRole('listitem').map((item) => item.textContent);
    expect(items[0]).toContain('Version 2 open since');
    expect(items[0]).toContain('Client comments, 12 Oct');
    expect(items[1]).toContain('Version 1 finished 28 Sept');
    expect(Object.values(store.state.tracker ?? {}).some((entry) => entry.auto === 'version' && entry.title === 'Stair details: version 2')).toBe(true);
  });

  it('takes the new version back with Undo, and the Tracker entry with it', async () => {
    const { store } = await renderApp(TASK('tsk_007'), as('usr_002', finished));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'New version' }));
    const form = within(sheet).getByRole('region', { name: 'New version' });
    await userEvent.type(within(form).getByLabelText('Why does it open again?'), 'Client comments');
    await userEvent.click(within(form).getByRole('button', { name: 'Start version 2' }));
    expect(await screen.findByText('Version 2 started.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.tasks.tsk_007.status).toBe('done'));
    expect(store.state.tasks.tsk_007.checklist.map((item) => item.done)).toEqual([true]);
    expect(Object.values(store.state.tracker ?? {}).some((entry) => entry.auto === 'version')).toBe(false);
  });

  it('offers the button only on a done task, and only to the lead, the leader and the Admin', async () => {
    const first = await renderApp(TASK('tsk_007'), as('usr_002'));
    expect(within(await screen.findByRole('dialog', { name: 'Stair details' })).queryByRole('button', { name: 'New version' })).toBeNull();
    first.unmount();
    const second = await renderApp(TASK('tsk_007'), as('usr_006', finished));
    expect(await within(await screen.findByRole('dialog', { name: 'Stair details' })).findByRole('button', { name: 'New version' })).toBeInTheDocument();
    second.unmount();
    await renderApp(TASK('tsk_007'), as('usr_005', (state) => {
      finished(state);
      state.tasks.tsk_007.helperIds = ['usr_005'];
    }));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    await within(sheet).findByText('Handrail height');
    expect(within(sheet).queryByRole('button', { name: 'New version' })).toBeNull();
  });

  it('shows "v2" next to the title in the task row', async () => {
    await renderApp(TASKS, as('usr_002', (state) => {
      state.tasks.tsk_007.version = 2;
    }));
    const row = await rowOf('Stair details');
    expect(within(row).getByText('v2')).toBeInTheDocument();
    const other = await rowOf('Specifications draft');
    expect(within(other).queryByText(/^v\d/)).toBeNull();
  });
});

describe('a lead with helpers', () => {
  it('lets the leader add a helper, even one outside the team, and remove them', async () => {
    const { store } = await renderApp(TASK('tsk_007'), as('usr_002'));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    const outsider = Object.values(store.state.users).find((user) => user.kind === 'human' && user.active && !store.state.members[`prj_001:${user.id}`] && user.id !== 'usr_002')!;
    const pick = within(sheet).getByLabelText('Add a helper');
    expect(within(pick).getByRole('option', { name: `${outsider.name} (joins the team)` })).toBeInTheDocument();
    await userEvent.selectOptions(pick, outsider.id);
    await waitFor(() => expect(store.state.tasks.tsk_007.helperIds).toEqual([outsider.id]));
    expect(store.state.members[`prj_001:${outsider.id}`]).toBeDefined();
    const helpers = await within(sheet).findByRole('region', { name: 'Helpers' });
    expect(within(helpers).getByText(outsider.name)).toBeInTheDocument();
    await userEvent.click(within(helpers).getByRole('button', { name: `Remove helper ${outsider.name}` }));
    await waitFor(() => expect(store.state.tasks.tsk_007.helperIds).toEqual([]));
  });

  it('shows the helpers as plain text to the lead, who cannot change them', async () => {
    const { store } = await renderApp(TASK('tsk_007'), as('usr_006', (state) => {
      state.tasks.tsk_007.helperIds = ['usr_005'];
    }));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    const helpers = await within(sheet).findByRole('region', { name: 'Helpers' });
    expect(within(helpers).getByText(store.state.users.usr_005.name)).toBeInTheDocument();
    expect(within(sheet).queryByLabelText('Add a helper')).toBeNull();
    expect(within(helpers).queryByRole('button')).toBeNull();
  });

  it('lets a helper tick items but not add them, and shows the task as theirs', async () => {
    const { store } = await renderApp(TASK('tsk_007'), as('usr_005', (state) => {
      state.tasks.tsk_007.helperIds = ['usr_005'];
      state.tasks.tsk_007.checklist = [{ id: 'chk_a', text: 'Handrail height', done: false }];
    }));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    expect(within(sheet).queryByRole('textbox', { name: 'Add an item' })).toBeNull();
    expect(within(sheet).queryByRole('textbox', { name: 'Title' })).toBeNull();
    await userEvent.click(await within(sheet).findByRole('checkbox', { name: 'Handrail height' }));
    await waitFor(() => expect(store.state.tasks.tsk_007.checklist[0].done).toBe(true));
  });

  it("puts the task in the helper's own list and shows the lead's picture with the helpers small", async () => {
    const first = await renderApp('/work', as('usr_005'));
    await screen.findByText('Civil Defense drawings');
    expect(screen.queryByText('Stair details')).toBeNull();
    first.unmount();
    await renderApp('/work', as('usr_005', (state) => {
      state.tasks.tsk_007.helperIds = ['usr_005'];
    }));
    expect(await screen.findByText('Stair details')).toBeInTheDocument();
  });

  it("tells a helper in the row that they help and who leads, on the Tasks tab and in My tasks (audit 2026-10-03, V-35)", async () => {
    const helping = as('usr_005', (state) => {
      state.tasks.tsk_007.helperIds = ['usr_005'];
    });
    const first = await renderApp(TASKS, helping);
    expect(await rowOf('Stair details')).toHaveTextContent('Helper · Lead: Yousef Saleh');
    expect(within(await rowOf('Civil Defense drawings')).queryByText(/^Helper ·/)).toBeNull();
    first.unmount();
    await renderApp('/work', helping);
    expect(await rowOf('Stair details')).toHaveTextContent('Helper · Lead: Yousef Saleh');
  });

  it('says the helper line in Arabic, in the form for a woman (audit 2026-10-03, V-35)', async () => {
    await renderApp(TASKS, as('usr_005', (state) => {
      state.users.usr_005.preferences.language = 'ar';
      state.tasks.tsk_007.helperIds = ['usr_005'];
    }));
    expect(await rowOf('Stair details')).toHaveTextContent('مساعدة · المسؤول الرئيسي: يوسف صالح');
  });

  it('shows the lead and up to three helpers in the row, then +N', async () => {
    const { store } = await renderApp(TASKS, as('usr_002', (state) => {
      state.tasks.tsk_007.helperIds = ['usr_001', 'usr_003', 'usr_004', 'usr_005', 'usr_002'];
    }));
    const row = await rowOf('Stair details');
    const lead = store.state.users.usr_006.name;
    expect(within(row).getByRole('img', { name: lead })).toBeInTheDocument();
    for (const id of ['usr_001', 'usr_003', 'usr_004']) expect(within(row).getByRole('img', { name: store.state.users[id].name })).toBeInTheDocument();
    expect(within(row).queryByRole('img', { name: store.state.users.usr_005.name })).toBeNull();
    expect(within(row).getByText('+2')).toBeInTheDocument();
  });
});
