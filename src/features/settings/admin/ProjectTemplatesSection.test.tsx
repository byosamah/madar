import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../../test/render';

/**
 * The Admin section "Project templates" (owner, 2026-10-05, item 6a). The sample office has two stage templates as project
 * templates with stages only, and "Villa, full design": 5 stages, 11 tasks, 60 working days.
 */
const region = (name: string) => screen.findByRole('region', { name });
const savedNamed = (store: { state: { projectTemplates?: Record<string, { name: string }> } }, name: string) =>
  Object.values(store.state.projectTemplates ?? {}).find((template) => template.name === name);

describe('the Admin section Project templates', () => {
  it('lists each template with its size, and a former stage template with its stages only', async () => {
    await renderApp('/admin/project-templates');
    const section = await region('Project templates');
    expect(await within(section).findByText('Villa, full design')).toBeInTheDocument();
    expect(within(section).getByText('5 stages · 11 tasks · 60 working days')).toBeInTheDocument();
    expect(within(section).getByText('Competition entry')).toBeInTheDocument();
    expect(within(section).getByText('3 stages')).toBeInTheDocument();
  });

  it('makes a new template with a role, a stage and a task', async () => {
    const { store } = await renderApp('/admin/project-templates');
    const section = await region('Project templates');
    await userEvent.click(within(section).getByRole('button', { name: 'New template' }));
    const sheet = await screen.findByRole('dialog', { name: 'New project template' });
    await userEvent.type(within(sheet).getByLabelText('Template name'), 'Small house');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Add a role' }));
    await userEvent.type(within(sheet).getByLabelText('Name of role 1'), 'Architect');
    await userEvent.selectOptions(within(sheet).getByLabelText('Default person of role 1'), 'Faisal Al-Harbi');
    await userEvent.type(within(sheet).getByLabelText('Name of stage 1'), 'Concept');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Add a task' }));
    await userEvent.type(within(sheet).getByLabelText('Task'), 'Massing');
    await userEvent.selectOptions(within(sheet).getByLabelText('Role'), 'Architect');
    // The stage card has its own "Working days" field, so the query stays in the task row.
    const taskRow = within(sheet).getByLabelText('Task').closest('li') as HTMLElement;
    const days = within(taskRow).getByLabelText('Working days');
    await userEvent.clear(days);
    await userEvent.type(days, '8');
    await userEvent.click(within(sheet).getByRole('checkbox', { name: 'Can stretch' }));
    expect(within(sheet).getByText('Length: 8 working days')).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save template' }));
    expect(await screen.findByText('Template saved.')).toBeInTheDocument();
    const saved = savedNamed(store, 'Small house') as unknown as { roles: unknown[]; stages: unknown[]; tasks: unknown[] };
    expect(saved.roles).toEqual([{ id: 'r1', name: 'Architect', defaultUserId: 'usr_002' }]);
    expect(saved.stages).toEqual([{ id: 's1', name: 'Concept', startOffset: null, durationDays: null }]);
    expect(saved.tasks).toEqual([{
      id: 't1', stageId: 's1', title: 'Massing', description: '', checklist: [], needsReview: true, roleId: 'r1', startOffset: 0, durationDays: 8, flexible: false,
    }]);
  });

  it('shows the first problem and saves nothing', async () => {
    const { store } = await renderApp('/admin/project-templates');
    await userEvent.click(within(await region('Project templates')).getByRole('button', { name: 'New template' }));
    const sheet = await screen.findByRole('dialog', { name: 'New project template' });
    const before = Object.keys(store.state.projectTemplates ?? {}).length;
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save template' }));
    expect(within(sheet).getByRole('alert')).toHaveTextContent('Give the template a name.');
    await userEvent.type(within(sheet).getByLabelText('Template name'), 'Small house');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save template' }));
    expect(within(sheet).getByRole('alert')).toHaveTextContent('Give every stage a name.');
    expect(Object.keys(store.state.projectTemplates ?? {})).toHaveLength(before);
  });

  it('opens a template from its row, with its timeline, and saves a change', async () => {
    const { store } = await renderApp('/admin/project-templates');
    const section = await region('Project templates');
    await userEvent.click(await within(section).findByRole('button', { name: /^Villa, full design/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Villa, full design' });
    expect(within(sheet).getByText('Length: 60 working days')).toBeInTheDocument();
    // The legend names the two kinds of bar, with no colour word: the colours change with the theme.
    expect(within(within(sheet).getByRole('region', { name: 'Timeline' })).getByText('Keeps its length')).toBeInTheDocument();
    expect(within(sheet).getAllByLabelText('Task').map((field) => (field as HTMLInputElement).value)).toHaveLength(11);
    const name = within(sheet).getByLabelText('Template name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Villa, long');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(savedNamed(store, 'Villa, long')).toBeDefined());
    expect(savedNamed(store, 'Villa, full design')).toBeUndefined();
  });

  it('moves a stage up and removes a task', async () => {
    const { store } = await renderApp('/admin/project-templates');
    await userEvent.click(await within(await region('Project templates')).findByRole('button', { name: /^Villa, full design/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Villa, full design' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Actions for stage 2' }));
    await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Move up' }));
    expect(within(sheet).getByLabelText('Name of stage 1')).toHaveValue('Schematic Design');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Remove the task Site visit and survey' }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save template' }));
    await waitFor(() => {
      const saved = savedNamed(store, 'Villa, full design') as unknown as { stages: { name: string }[]; tasks: { title: string }[] };
      expect(saved.stages.map((stage) => stage.name).slice(0, 2)).toEqual(['Schematic Design', 'Concept']);
      expect(saved.tasks).toHaveLength(10);
    });
  });

  it('shows the start and length fields of a stage that has tasks', async () => {
    await renderApp('/admin/project-templates');
    await userEvent.click(await within(await region('Project templates')).findByRole('button', { name: /^Villa, full design/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Villa, full design' });
    const card = within(sheet).getByLabelText('Name of stage 1').closest('li') as HTMLElement;
    expect(card.querySelector<HTMLInputElement>('#tpl-s1-start')).toBeInTheDocument();
    expect(card.querySelector<HTMLInputElement>('#tpl-s1-days')).toBeInTheDocument();
  });

  it('says where the tasks of a stage end when they run past the own days of the stage', async () => {
    await renderApp('/admin/project-templates');
    await userEvent.click(await within(await region('Project templates')).findByRole('button', { name: /^Villa, full design/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Villa, full design' });
    const card = within(sheet).getByLabelText('Name of stage 1').closest('li') as HTMLElement;
    const ownStart = card.querySelector<HTMLInputElement>('#tpl-s1-start')!;
    const ownDays = card.querySelector<HTMLInputElement>('#tpl-s1-days')!;
    await userEvent.type(ownStart, '0');
    await userEvent.type(ownDays, '5');
    // The last task of Concept ends on day 11, after the 5 days of the stage.
    expect(within(card).getByText('The tasks end on day 11.')).toBeInTheDocument();
    await userEvent.clear(ownDays);
    await userEvent.type(ownDays, '20');
    expect(within(card).queryByText('The tasks end on day 11.')).not.toBeInTheDocument();
  });

  it('names the problem of a stage with tasks and a start day but no working days, and keeps the field', async () => {
    await renderApp('/admin/project-templates');
    await userEvent.click(await within(await region('Project templates')).findByRole('button', { name: /^Villa, full design/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Villa, full design' });
    const card = within(sheet).getByLabelText('Name of stage 1').closest('li') as HTMLElement;
    await userEvent.type(card.querySelector<HTMLInputElement>('#tpl-s1-start')!, '0');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save template' }));
    expect(within(sheet).getByRole('alert')).toHaveTextContent('A stage needs both a start day and working days, or neither.');
    expect(card.querySelector<HTMLInputElement>('#tpl-s1-start')).toHaveValue('0');
    expect(card.querySelector<HTMLInputElement>('#tpl-s1-days')).toHaveValue('');
  });

  it('duplicates a template: the editor opens filled with the copy, and Save makes a new template', async () => {
    const { store } = await renderApp('/admin/project-templates');
    const section = await region('Project templates');
    await userEvent.click(await within(section).findByRole('button', { name: 'Actions for template Villa, full design' }));
    await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Duplicate' }));
    const sheet = await screen.findByRole('dialog', { name: 'Copy of Villa, full design' });
    expect(within(sheet).getByLabelText('Template name')).toHaveValue('Copy of Villa, full design');
    expect(within(sheet).getByLabelText('Name of stage 1')).toHaveValue('Concept');
    expect(within(sheet).getAllByLabelText('Task')).toHaveLength(11);
    const original = savedNamed(store, 'Villa, full design') as unknown as { id: string };
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save template' }));
    expect(await screen.findByText('Template saved.')).toBeInTheDocument();
    const copy = savedNamed(store, 'Copy of Villa, full design') as unknown as { id: string; tasks: unknown[] };
    expect(copy.id).not.toBe(original.id);
    expect(copy.tasks).toHaveLength(11);
    expect(savedNamed(store, 'Villa, full design')).toBeDefined();
  });

  it('deletes a template, with Undo', async () => {
    const { store } = await renderApp('/admin/project-templates');
    const section = await region('Project templates');
    await userEvent.click(await within(section).findByRole('button', { name: 'Actions for template Competition entry' }));
    await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(savedNamed(store, 'Competition entry')).toBeUndefined());
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(savedNamed(store, 'Competition entry')).toBeDefined());
  });

  it('opens the projects that use a template from its row menu', async () => {
    await renderApp('/admin/project-templates');
    const section = await region('Project templates');
    await userEvent.click(await within(section).findByRole('button', { name: 'Actions for template Villa, full design' }));
    await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Projects using this template' }));
    expect(await screen.findByRole('dialog', { name: 'Projects using this template' })).toBeInTheDocument();
  });

  it('makes a task and a stage wait for other parts of the template, and saves the waits', async () => {
    const { store } = await renderApp('/admin/project-templates');
    await userEvent.click(within(await region('Project templates')).getByRole('button', { name: 'New template' }));
    const sheet = await screen.findByRole('dialog', { name: 'New project template' });
    await userEvent.type(within(sheet).getByLabelText('Template name'), 'Waits');
    await userEvent.type(within(sheet).getByLabelText('Name of stage 1'), 'Concept');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Add a task' }));
    await userEvent.type(within(sheet).getByLabelText('Task'), 'Massing');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Add a task' }));
    const pack = within(sheet).getAllByLabelText('Task')[1];
    await userEvent.type(pack, 'Pack');
    const packRow = pack.closest('li') as HTMLElement;
    await userEvent.selectOptions(within(packRow).getByLabelText('Waits for'), 'Massing');
    expect(within(packRow).getByRole('button', { name: 'Stop waiting for Massing' })).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Add a stage' }));
    await userEvent.type(within(sheet).getByLabelText('Name of stage 2'), 'Permits');
    const permitsCard = within(sheet).getByLabelText('Name of stage 2').closest('div.rounded-2xl') as HTMLElement;
    await userEvent.selectOptions(within(permitsCard).getByLabelText('Waits for'), 'Concept');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save template' }));
    expect(await screen.findByText('Template saved.')).toBeInTheDocument();
    const saved = savedNamed(store, 'Waits') as unknown as { stages: { prerequisiteIds?: string[] }[]; tasks: { prerequisiteIds?: string[] }[] };
    expect(saved.stages[1].prerequisiteIds).toEqual(['s1']);
    expect(saved.tasks[1].prerequisiteIds).toEqual(['t1']);
    expect(saved.tasks[0].prerequisiteIds).toBeUndefined();
  });
});
