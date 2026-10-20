import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

// Each test renders the whole project page several times; under the load of the full run that takes more than 5 s.
vi.setConfig({ testTimeout: 20_000 });

const LOAD = { timeout: 10_000 };

/**
 * "Apply a template" in the project menu (fbk_020, owner 2026-10-19). The sample office: Faisal (usr_002) leads prj_001 "Corniche Office
 * Tower", active, started 2026-05-09. Reem (usr_003) leads prj_002. Sara (usr_005) is on the team of prj_001 and leads nothing. prj_007
 * follows the template "Villa, full design" (ptp_003) and Omar (usr_004) leads it. prj_009 is paused and prj_010 is done. Today is 2026-09-30.
 */
const as = (userId: string, change?: (state: State) => void) => (state: State) => {
  state.session.currentUserId = userId;
  change?.(state);
};

/** The items of the project menu: none when the page has no menu, or when the menu holds no item for this person. */
async function menuItems(): Promise<string[]> {
  await screen.findByRole('heading', { level: 1 }, LOAD);
  const button = screen.queryByRole('button', { name: 'More actions' });
  if (!button) return [];
  await userEvent.click(button);
  return screen.queryAllByRole('menuitem').map((item) => item.textContent ?? '');
}

async function openPicker() {
  await userEvent.click(await screen.findByRole('button', { name: 'More actions' }, LOAD));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Apply a template' }));
  return screen.findByRole('dialog', { name: 'Apply a template' });
}

describe('who sees "Apply a template" in the project menu', () => {
  it('shows it to the leader of an open project', async () => {
    await renderApp('/projects/prj_001', as('usr_002'));
    expect(await menuItems()).toContain('Apply a template');
  });

  it('shows it to the Admin on a project of another leader', async () => {
    await renderApp('/projects/prj_001');
    expect(await menuItems()).toContain('Apply a template');
  });

  it('shows it for a paused project', async () => {
    await renderApp('/projects/prj_009', as('usr_002'));
    expect(await menuItems()).toContain('Apply a template');
  });

  it('hides it from a team member who leads nothing, and from a leader on the project of another leader', async () => {
    const first = await renderApp('/projects/prj_001', as('usr_005'));
    expect(await menuItems()).not.toContain('Apply a template');
    first.unmount();
    await renderApp('/projects/prj_001', as('usr_003'));
    expect(await menuItems()).not.toContain('Apply a template');
  });

  it('hides it on a done project and on an archived project', async () => {
    const done = await renderApp('/projects/prj_010', as('usr_004'));
    expect(await menuItems()).not.toContain('Apply a template');
    done.unmount();
    await renderApp('/projects/prj_001', as('usr_002', (state) => { state.projects.prj_001.status = 'archived'; }));
    expect(await menuItems()).not.toContain('Apply a template');
  });
});

describe('the choice of the template', () => {
  it('lists the templates of the office with their stages and tasks, and sends nothing yet', async () => {
    const { store } = await renderApp('/projects/prj_001', as('usr_002'));
    const picker = await openPicker();
    const villa = await within(picker).findByRole('button', { name: /Villa, full design/ }, LOAD);
    expect(villa).toHaveTextContent('5 stages · 11 to-dos');
    // A template that came from a stage template has stages only.
    expect(within(picker).getByRole('button', { name: /Competition entry/ })).toHaveTextContent('3 stages');
    expect(store.state.projects.prj_001.templateLink).toBeFalsy();
  });

  it('opens the matching step for the template, with "Add them to the project" chosen and the rules in short lines', async () => {
    await renderApp('/projects/prj_001', as('usr_002'));
    const picker = await openPicker();
    await userEvent.click(await within(picker).findByRole('button', { name: /Villa, full design/ }, LOAD));
    const sheet = await screen.findByRole('dialog', { name: 'Apply Villa, full design to Corniche Office Tower' }, LOAD);
    expect(await within(sheet).findByRole('radio', { name: /^Add them to the project/ }, LOAD)).toBeChecked();
    expect(within(sheet).getByText(/^Each new to-do gets the default person of its role as lead/)).toBeInTheDocument();
    // The project started in May, so the dates of the template are past and the new parts move forward.
    expect(within(sheet).getByText(/^The new parts run from .+ to .+\./)).toBeInTheDocument();
    expect(within(sheet).getByText(/the new parts move forward/)).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Apply template' })).toBeEnabled();
  });

  it('goes back to the choice on Cancel and sends nothing', async () => {
    const { store } = await renderApp('/projects/prj_001', as('usr_002'));
    const picker = await openPicker();
    await userEvent.click(await within(picker).findByRole('button', { name: /Villa, full design/ }, LOAD));
    const sheet = await screen.findByRole('dialog', { name: /^Apply Villa, full design to/ }, LOAD);
    await userEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Apply Villa, full design to/ })).not.toBeInTheDocument());
    expect(screen.getByRole('dialog', { name: 'Apply a template' })).toBeInTheDocument();
    expect(store.state.projects.prj_001.templateLink).toBeFalsy();
  });
});

describe('Apply template', () => {
  it('links the project, adds the parts with no match from today, never moves an old item, and Undo takes it all back', async () => {
    const { store } = await renderApp('/projects/prj_001', as('usr_002'));
    const before = new Map(Object.values(store.state.tasks).filter((task) => task.projectId === 'prj_001').map((task) => [task.id, structuredClone(task)]));
    const picker = await openPicker();
    await userEvent.click(await within(picker).findByRole('button', { name: /Villa, full design/ }, LOAD));
    const sheet = await screen.findByRole('dialog', { name: /^Apply Villa, full design to/ }, LOAD);
    await within(sheet).findByRole('radio', { name: /^Add them to the project/ }, LOAD);
    await userEvent.click(within(sheet).getByRole('button', { name: 'Apply template' }));
    expect(await screen.findByText('The template is applied.', {}, LOAD)).toBeInTheDocument();
    // Both sheets close.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Apply/ })).not.toBeInTheDocument());
    expect(store.state.projects.prj_001.templateLink).toMatchObject({ templateId: 'ptp_003', droppedPartIds: [] });
    const mine = Object.values(store.state.tasks).filter((task) => task.projectId === 'prj_001');
    const added = mine.filter((task) => !before.has(task.id));
    expect(added.length).toBeGreaterThan(0);
    expect(added.every((task) => task.templatePartId !== undefined)).toBe(true);
    // The earliest new task starts today (2026-09-30, a Wednesday), and no new task starts before.
    expect(added.map((task) => task.startDate).sort()[0]).toBe('2026-09-30');
    for (const [id, old] of before) {
      expect(store.state.tasks[id].startDate).toBe(old.startDate);
      expect(store.state.tasks[id].dueDate).toBe(old.dueDate);
      expect(store.state.tasks[id].title).toBe(old.title);
    }
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.projects.prj_001.templateLink).toBeFalsy());
    expect(Object.values(store.state.tasks).filter((task) => task.projectId === 'prj_001').map((task) => task.id).sort()).toEqual([...before.keys()].sort());
  });

  it('adds nothing when the person picks "Leave them out", and still links the project', async () => {
    const { store } = await renderApp('/projects/prj_001', as('usr_002'));
    const count = () => Object.values(store.state.tasks).filter((task) => task.projectId === 'prj_001').length;
    const before = count();
    const picker = await openPicker();
    await userEvent.click(await within(picker).findByRole('button', { name: /Villa, full design/ }, LOAD));
    const sheet = await screen.findByRole('dialog', { name: /^Apply Villa, full design to/ }, LOAD);
    await userEvent.click(await within(sheet).findByRole('radio', { name: /^Leave them out/ }, LOAD));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Apply template' }));
    expect(await screen.findByText('The template is applied.', {}, LOAD)).toBeInTheDocument();
    expect(count()).toBe(before);
    expect(store.state.projects.prj_001.templateLink?.templateId).toBe('ptp_003');
  });
});

describe('a project that follows a template already', () => {
  it('says so in one line, and offers another template only after a confirm tick', async () => {
    await renderApp('/projects/prj_007', as('usr_004'));
    const picker = await openPicker();
    expect(await within(picker).findByText('This project follows the template Villa, full design.', {}, LOAD)).toBeInTheDocument();
    const another = Object.values(await within(picker).findAllByRole('button', { name: /Competition entry|Interior fit-out/ })).filter(Boolean);
    expect(another.length).toBeGreaterThan(0);
    for (const row of another) expect(row).toBeDisabled();
    // The template that the project follows is not in the list.
    expect(within(picker).queryByRole('button', { name: /Villa, full design/ })).not.toBeInTheDocument();
    await userEvent.click(within(picker).getByRole('checkbox', { name: /^I want to apply another template/ }));
    for (const row of another) expect(row).toBeEnabled();
  });

  it('replaces the link with the other template, and Undo brings the old link back', async () => {
    const { store } = await renderApp('/projects/prj_007', as('usr_004'));
    const old = structuredClone(store.state.projects.prj_007.templateLink);
    const picker = await openPicker();
    await userEvent.click(await within(picker).findByRole('checkbox', { name: /^I want to apply another template/ }, LOAD));
    await userEvent.click(within(picker).getByRole('button', { name: /Competition entry/ }));
    const sheet = await screen.findByRole('dialog', { name: /^Apply Competition entry to/ }, LOAD);
    await within(sheet).findByRole('button', { name: 'Apply template' }, LOAD);
    await userEvent.click(within(sheet).getByRole('button', { name: 'Apply template' }));
    expect(await screen.findByText('The template is applied.', {}, LOAD)).toBeInTheDocument();
    expect(store.state.projects.prj_007.templateLink?.templateId).toBe('ptp_002');
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.projects.prj_007.templateLink?.templateId).toBe('ptp_003'));
    expect(store.state.projects.prj_007.templateLink).toEqual(old);
  });
});
