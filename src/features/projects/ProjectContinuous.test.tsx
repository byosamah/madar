import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type { State } from '../../api/store';
import { renderApp, renderWithRuntime } from '../../test/render';
import { NextDeadlineLabel } from './ProjectCard';
import { NewProjectSheet } from './NewProjectSheet';
import { EditProjectSheet } from './EditProjectSheet';
import { useCall } from '../../app/runtime';
import { validateProjectForm, emptyProjectForm } from './projectForm';

/**
 * The switch "Continuous project" (fbk_069, owner 2026-10-26): one switch in the New and Edit sheets. While it is on the Target end date
 * field is hidden and empty, and the screens say "Continuous" where they say "No deadline" for a project with no named deadline.
 */
const LOAD = { timeout: 10_000 };

describe('the label of the next deadline', () => {
  it('says "No deadline" for a project with no deadline, and "Continuous" for a continuous one', async () => {
    const first = await renderWithRuntime(<NextDeadlineLabel deadline={null} stageEnd={null} />, undefined, { path: '/' });
    expect(await screen.findByText('No deadline')).toBeInTheDocument();
    first.unmount();
    await renderWithRuntime(<NextDeadlineLabel deadline={null} stageEnd={null} continuous />, undefined, { path: '/' });
    expect(await screen.findByText('Continuous')).toBeInTheDocument();
    expect(screen.queryByText('No deadline')).toBeNull();
  });

  it('still shows a named deadline of a continuous project', async () => {
    await renderWithRuntime(<NextDeadlineLabel deadline={{ id: 'ddl_1', name: 'Permit set', date: '2026-10-12', daysLeft: 12 }} continuous />, undefined, { path: '/' });
    expect(await screen.findByText(/Permit set/)).toBeInTheDocument();
    expect(screen.queryByText('Continuous')).toBeNull();
  });

  it('shows "Continuous" in place of the end of the stage, since a stage date does not drive a continuous project', async () => {
    await renderWithRuntime(<NextDeadlineLabel deadline={null} stageEnd={{ date: '2026-10-12', daysLeft: 12 }} continuous />, undefined, { path: '/' });
    expect(await screen.findByText('Continuous')).toBeInTheDocument();
    expect(screen.queryByText(/Stage ends/)).toBeNull();
  });
});

const continuous = (state: State) => {
  state.projects.prj_001.continuous = true;
  state.projects.prj_001.targetEndDate = null;
  for (const id of Object.keys(state.deadlines)) if (state.deadlines[id].projectId === 'prj_001') delete state.deadlines[id];
};
const continuousArabic = (state: State) => {
  continuous(state);
  state.users.usr_001.preferences.language = 'ar';
};

describe('the project page of a continuous project', () => {
  it('shows "Continuous" in the header and in the About panel, and no "No deadline"', async () => {
    await renderApp('/projects/prj_001', continuous);
    const header = await screen.findByRole('heading', { level: 1, name: 'Corniche Office Tower' }, LOAD);
    expect(await within(header.closest('header') as HTMLElement).findByText('Continuous')).toBeInTheDocument();
    const about = (await screen.findByRole('heading', { name: 'About' }, LOAD)).closest('section') as HTMLElement;
    expect(within(about).getByText('Continuous')).toBeInTheDocument();
    expect(screen.queryByText('No deadline')).toBeNull();
  });

  it('says «مستمر» on an Arabic screen', async () => {
    await renderApp('/projects/prj_001', continuousArabic);
    const header = await screen.findByRole('heading', { level: 1 }, LOAD);
    expect(await within(header.closest('header') as HTMLElement).findByText('مستمر')).toBeInTheDocument();
    expect(screen.queryByText('لا يوجد موعد')).toBeNull();
  });

  it('does not show the project as Late from the end date of its stage', async () => {
    await renderApp('/projects/prj_001', (state) => {
      continuous(state);
      for (const task of Object.values(state.tasks)) if (task.projectId === 'prj_001') task.dueDate = null;
      for (const stage of Object.values(state.stages)) if (stage.projectId === 'prj_001') stage.endDate = '2026-09-01';
    });
    const header = (await screen.findByRole('heading', { level: 1, name: 'Corniche Office Tower' }, LOAD)).closest('header') as HTMLElement;
    await within(header).findByText('Continuous');
    expect(within(header).queryByText('Late')).toBeNull();
  });
});

describe('the Projects list', () => {
  it('shows "Continuous" on the row of a continuous project with no named deadline', async () => {
    await renderApp('/projects', continuous);
    const row = await screen.findByRole('link', { name: /Corniche Office Tower/ }, LOAD);
    expect(await within(row).findByText('Continuous')).toBeInTheDocument();
  });
});

describe('the form rules', () => {
  it('does not check the end date against the start date while the switch is on', () => {
    const values = { ...emptyProjectForm(['Concept']), name: 'Retainer', startDate: '2026-10-10', targetEndDate: '2026-10-01' };
    expect(validateProjectForm(values).targetEndDate).toBe('projectForm.errors.endAfterStart');
    expect(validateProjectForm({ ...values, continuous: true }).targetEndDate).toBeUndefined();
  });
});

function NewHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Start</button>
      <NewProjectSheet open={open} onOpenChange={setOpen} />
    </>
  );
}

async function fillCode(sheet: HTMLElement) {
  const field = within(sheet).getByLabelText('Client initials') as HTMLInputElement;
  if (!field.readOnly) await userEvent.type(field, 'HGO');
  await userEvent.selectOptions(within(sheet).getByLabelText('Classification'), 'COM');
  await userEvent.type(within(sheet).getByLabelText('Building type'), 'Offices');
}

describe('the New Project sheet', () => {
  it('has the switch off at the start, with its hint, right after the dates', async () => {
    await renderWithRuntime(<NewHarness />, undefined, { path: '/' });
    await userEvent.click(screen.getByText('Start'));
    const sheet = await screen.findByRole('dialog', { name: 'New Project' });
    const control = within(sheet).getByRole('switch', { name: 'Continuous project' });
    expect(control).toHaveAttribute('aria-checked', 'false');
    expect(within(sheet).getByText('No deadline. The project goes on.')).toBeInTheDocument();
    expect(within(sheet).getByLabelText('Target end date')).toBeInTheDocument();
  });

  it('hides the Target end date and its value while the switch is on, and brings the field back when it is off', async () => {
    await renderWithRuntime(<NewHarness />, undefined, { path: '/' });
    await userEvent.click(screen.getByText('Start'));
    const sheet = await screen.findByRole('dialog', { name: 'New Project' });
    await userEvent.click(within(sheet).getByRole('switch', { name: 'Continuous project' }));
    expect(within(sheet).getByRole('switch', { name: 'Continuous project' })).toHaveAttribute('aria-checked', 'true');
    expect(within(sheet).queryByLabelText('Target end date')).toBeNull();
    await userEvent.click(within(sheet).getByRole('switch', { name: 'Continuous project' }));
    expect(within(sheet).getByLabelText('Target end date')).toBeInTheDocument();
  });

  it('creates a continuous project with no target end date', async () => {
    const view = await renderWithRuntime(<NewHarness />, undefined, { path: '/' });
    await userEvent.click(screen.getByText('Start'));
    const sheet = await screen.findByRole('dialog', { name: 'New Project' });
    await userEvent.type(within(sheet).getByLabelText('Name'), 'Office retainer');
    await fillCode(sheet);
    await userEvent.click(within(sheet).getByRole('switch', { name: 'Continuous project' }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(Object.values(view.store.state.projects).some((p) => p.name === 'Office retainer')).toBe(true));
    const made = Object.values(view.store.state.projects).find((p) => p.name === 'Office retainer')!;
    expect(made.continuous).toBe(true);
    expect(made.targetEndDate).toBeNull();
  });

  it('creates a project with the switch off as before: no continuous value', async () => {
    const view = await renderWithRuntime(<NewHarness />, undefined, { path: '/' });
    await userEvent.click(screen.getByText('Start'));
    const sheet = await screen.findByRole('dialog', { name: 'New Project' });
    await userEvent.type(within(sheet).getByLabelText('Name'), 'Plain tower');
    await fillCode(sheet);
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(Object.values(view.store.state.projects).some((p) => p.name === 'Plain tower')).toBe(true));
    expect(Object.values(view.store.state.projects).find((p) => p.name === 'Plain tower')?.continuous).toBeUndefined();
  });
});

function EditHarness() {
  const [open, setOpen] = useState(false);
  const detail = useCall('projects.get', { id: 'prj_001' });
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Start</button>
      {detail.data && <EditProjectSheet detail={detail.data} open={open} onOpenChange={setOpen} />}
    </>
  );
}

describe('the Edit project sheet', () => {
  it('turns the switch on, hides the end date, and saves with the target end date cleared', async () => {
    const view = await renderWithRuntime(<EditHarness />, undefined, { path: '/' });
    expect(view.store.state.projects.prj_001.targetEndDate).not.toBeNull();
    await userEvent.click(await screen.findByText('Start'));
    const sheet = await screen.findByRole('dialog', { name: 'Edit project' }, LOAD);
    expect(within(sheet).getByRole('switch', { name: 'Continuous project' })).toHaveAttribute('aria-checked', 'false');
    expect((within(sheet).getByLabelText('Target end date') as HTMLInputElement).value).not.toBe('');
    await userEvent.click(within(sheet).getByRole('switch', { name: 'Continuous project' }));
    expect(within(sheet).queryByLabelText('Target end date')).toBeNull();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(view.store.state.projects.prj_001.continuous).toBe(true), LOAD);
    expect(view.store.state.projects.prj_001.targetEndDate).toBeNull();
  });

  it('shows the switch on for a continuous project, and turns it off with a new end date', async () => {
    const view = await renderWithRuntime(<EditHarness />, continuous, { path: '/' });
    await userEvent.click(await screen.findByText('Start'));
    const sheet = await screen.findByRole('dialog', { name: 'Edit project' }, LOAD);
    expect(within(sheet).getByRole('switch', { name: 'Continuous project' })).toHaveAttribute('aria-checked', 'true');
    expect(within(sheet).queryByLabelText('Target end date')).toBeNull();
    await userEvent.click(within(sheet).getByRole('switch', { name: 'Continuous project' }));
    expect(within(sheet).getByLabelText('Target end date')).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(view.store.state.projects.prj_001.continuous).toBe(false), LOAD);
  });
});
