import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { renderWithRuntime } from '../../test/render';
import { NewProjectSheet } from './NewProjectSheet';

/**
 * The new-project form with a project template (owner, 2026-10-05, item 6a). The sample office has "Villa, full design":
 * 60 working days, 5 stages, 11 tasks, the roles Architect (Faisal), Structural engineer (Omar), Interior designer (Lina) and
 * Permits (no default person). 17 days of its tasks do not stretch. 2026-10-04 is a Sunday.
 */
const TEMPLATE = 'Villa, full design';

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Start</button>
      <NewProjectSheet open={open} onOpenChange={setOpen} />
    </>
  );
}

async function openSheet() {
  const view = await renderWithRuntime(<Harness />, undefined, { path: '/' });
  await userEvent.click(screen.getByText('Start'));
  const sheet = await screen.findByRole('dialog', { name: 'New Project' });
  await userEvent.type(within(sheet).getByLabelText('Name'), 'Villa Noor');
  await userEvent.type(within(sheet).getByLabelText('Client initials'), 'VNR');
  await userEvent.selectOptions(within(sheet).getByLabelText('Classification'), 'RES');
  await userEvent.type(within(sheet).getByLabelText('Building type'), 'Villa');
  await waitFor(() => expect(within(sheet).getByRole('option', { name: TEMPLATE })).toBeInTheDocument());
  return { ...view, sheet };
}

const date = (sheet: HTMLElement, label: string, value: string) => fireEvent.change(within(sheet).getByLabelText(label), { target: { value } });

describe('the New Project sheet with a project template', () => {
  it('puts the template part in place of the stage list, and the stage list back with No template', async () => {
    const { sheet } = await openSheet();
    expect(within(sheet).getAllByLabelText(/^Stage \d+$/)).toHaveLength(7);
    await userEvent.selectOptions(within(sheet).getByLabelText('Start from a template'), TEMPLATE);
    expect(within(sheet).queryAllByLabelText(/^Stage \d+$/)).toHaveLength(0);
    expect(within(sheet).getByText('Template length: 60 working days.')).toBeInTheDocument();
    expect(within(sheet).getByText('Empty keeps the length of the template.')).toBeInTheDocument();
    // The default person of a role shows first. A role with no default person shows No lead.
    expect(within(sheet).getByLabelText('Architect')).toHaveDisplayValue('Faisal Al-Harbi');
    expect(within(sheet).getByLabelText('Permits')).toHaveDisplayValue('No lead');
    await userEvent.selectOptions(within(sheet).getByLabelText('Start from a template'), 'No template');
    expect(within(sheet).getAllByLabelText(/^Stage \d+$/)).toHaveLength(7);
  });

  it('needs a start date with a template and creates nothing without one', async () => {
    const { sheet, store } = await openSheet();
    const before = Object.keys(store.state.projects).length;
    await userEvent.selectOptions(within(sheet).getByLabelText('Start from a template'), TEMPLATE);
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create project' }));
    expect(await within(sheet).findByText('A template needs a start date.')).toBeInTheDocument();
    expect(Object.keys(store.state.projects)).toHaveLength(before);
  });

  it('creates the project with the stages, the tasks and the leads of the template', async () => {
    const { sheet, store } = await openSheet();
    await userEvent.selectOptions(within(sheet).getByLabelText('Start from a template'), TEMPLATE);
    date(sheet, 'Start date', '2026-10-04');
    expect(within(sheet).getByText(/^Template length: 60 working days\. The project ends on /)).toBeInTheDocument();
    // No stretch ticks while the project keeps the template length.
    expect(within(sheet).queryByText('Stretch or shrink')).toBeNull();
    await userEvent.selectOptions(within(sheet).getByLabelText('Architect'), 'Reem Al-Ghamdi');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(Object.values(store.state.projects).some((p) => p.name === 'Villa Noor')).toBe(true));
    const project = Object.values(store.state.projects).find((p) => p.name === 'Villa Noor')!;
    expect(project).toMatchObject({ startDate: '2026-10-04', targetEndDate: '2026-12-24' });
    const stages = Object.values(store.state.stages).filter((s) => s.projectId === project.id).sort((a, b) => a.order - b.order);
    expect(stages.map((s) => s.name)).toEqual(['Concept', 'Schematic Design', 'Design Development', 'Construction Documents', 'Permits']);
    const tasks = Object.values(store.state.tasks).filter((task) => task.projectId === project.id);
    expect(tasks).toHaveLength(11);
    const lead = (title: string) => tasks.find((task) => task.title === title)!.ownerId;
    expect(lead('Massing options')).toBe('usr_003');
    expect(lead('Structural concept')).toBe('usr_004');
    expect(lead('Municipality review')).toBeNull();
    // The person of a role joins the team.
    expect(store.state.members[`${project.id}:usr_003`]).toBeDefined();
  });

  it('shrinks the template to the end date, and keeps the length of an unticked task', async () => {
    const { sheet, store } = await openSheet();
    await userEvent.selectOptions(within(sheet).getByLabelText('Start from a template'), TEMPLATE);
    date(sheet, 'Start date', '2026-10-04');
    // 25 working days: Sunday 4 October to Thursday 5 November.
    date(sheet, 'Target end date', '2026-11-05');
    expect(within(sheet).getByText('Template length: 60 working days. This project: 25 working days.')).toBeInTheDocument();
    await userEvent.click(within(sheet).getByText('Stretch or shrink'));
    const details = within(sheet).getByRole('checkbox', { name: 'Wall sections and details' });
    expect(details).toBeChecked();
    expect(within(sheet).getByRole('checkbox', { name: 'Municipality review' })).not.toBeChecked();
    expect(within(sheet).getByRole('checkbox', { name: 'Permits' })).not.toBeChecked();
    // 2 + 7 + 5 + 10 locked days: 24 of the 25.
    await userEvent.click(details);
    expect(within(sheet).getByRole('checkbox', { name: 'Construction Documents' })).toHaveAttribute('aria-checked', 'mixed');
    expect(within(sheet).getByText('Template length: 60 working days. This project: 25 working days.')).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(Object.values(store.state.projects).some((p) => p.name === 'Villa Noor')).toBe(true));
    const project = Object.values(store.state.projects).find((p) => p.name === 'Villa Noor')!;
    expect(project.targetEndDate).toBe('2026-11-05');
    const task = Object.values(store.state.tasks).find((t) => t.projectId === project.id && t.title === 'Wall sections and details')!;
    // It keeps its 7 working days.
    expect([task.startDate, task.dueDate]).toEqual(['2026-10-07', '2026-10-15']);
  });

  it('says how many days the locked tasks need, and creates nothing', async () => {
    const { sheet, store } = await openSheet();
    const before = Object.keys(store.state.projects).length;
    await userEvent.selectOptions(within(sheet).getByLabelText('Start from a template'), TEMPLATE);
    date(sheet, 'Start date', '2026-10-04');
    date(sheet, 'Target end date', '2026-10-15');
    expect(within(sheet).getByRole('alert')).toHaveTextContent('The locked tasks need at least 17 working days. Choose a later end date, or let more tasks stretch.');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create project' }));
    expect(await within(sheet).findByText('Choose a later end date.')).toBeInTheDocument();
    expect(Object.keys(store.state.projects)).toHaveLength(before);
    // A press on the tick of the Permits stage lets its tasks stretch, so the plan fits.
    await userEvent.click(within(sheet).getByText('Stretch or shrink'));
    await userEvent.click(within(sheet).getByRole('checkbox', { name: 'Permits' }));
    await userEvent.click(within(sheet).getByRole('checkbox', { name: 'Concept presentation' }));
    expect(within(sheet).getByText('Template length: 60 working days. This project: 10 working days.')).toBeInTheDocument();
  });
});
