import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../../test/render';

/**
 * The Admin section "Project templates" (owner, 2026-10-05, item 6a). The sample office has two stage templates as project
 * templates with stages only, and "Villa, full design": 5 stages, 11 tasks, 60 working days. The project "Seaside Villa Compound"
 * follows the villa template. The editor fills the screen: the timeline is the main view and the details of a picked part sit
 * beside it (ADM-06).
 */
const region = (name: string) => screen.findByRole('region', { name });
type Saved = { id: string; name: string; roles: unknown[]; stages: { id: string; name: string; startOffset: number | null; durationDays: number | null; prerequisiteIds?: string[] }[]; tasks: { id: string; title: string; startOffset: number; durationDays: number; flexible: boolean; description: string; checklist: string[]; needsReview: boolean; prerequisiteIds?: string[] }[] };
const savedNamed = (store: { state: { projectTemplates?: Record<string, { name: string }> } }, name: string) =>
  Object.values(store.state.projectTemplates ?? {}).find((template) => template.name === name) as unknown as Saved | undefined;

/** Opens a template from its row, and gives its editor. */
async function openEditor(name: RegExp) {
  await userEvent.click(await within(await region('Project templates')).findByRole('button', { name }));
  return screen.findByRole('dialog', { name });
}
const details = (sheet: HTMLElement) => within(sheet).getByRole('complementary', { name: 'Details' });
const pick = (sheet: HTMLElement, name: string) => userEvent.click(within(sheet).getByRole('button', { name }));

/** A template with one stage that has its own start day, and two tasks that start on the same day (ADM-08). */
const WAITS = {
  name: 'Waits',
  roles: [],
  stages: [{ id: 's1', name: 'Concept', startOffset: 3, durationDays: 20 }],
  tasks: [
    { id: 't1', stageId: 's1', title: 'Concept presentation', description: '', checklist: [], needsReview: true, roleId: null, startOffset: 10, durationDays: 1, flexible: true },
    { id: 't2', stageId: 's1', title: 'Massing options', description: '', checklist: [], needsReview: true, roleId: null, startOffset: 10, durationDays: 5, flexible: true },
  ],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the Admin section Project templates', () => {
  it('lists each template with its size, the projects that follow it, and a former stage template with its stages only', async () => {
    await renderApp('/admin/project-templates');
    const section = await region('Project templates');
    expect(await within(section).findByText('Villa, full design')).toBeInTheDocument();
    expect(within(section).getByText('5 stages · 11 to-dos · 60 working days')).toBeInTheDocument();
    expect(within(section).getByText('1 project follows it')).toBeInTheDocument();
    expect(within(section).getByText('Competition entry')).toBeInTheDocument();
    expect(within(section).getByText('3 stages')).toBeInTheDocument();
  });

  it('makes a new template with a task lead, a stage and a task', async () => {
    const { store } = await renderApp('/admin/project-templates');
    const section = await region('Project templates');
    await userEvent.click(within(section).getByRole('button', { name: 'New template' }));
    const sheet = await screen.findByRole('dialog', { name: 'New project template' });
    await userEvent.type(within(sheet).getByLabelText(/Template name/), 'Small house');
    await userEvent.click(within(sheet).getByRole('button', { name: 'To-do leads · 0' }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Add a to-do lead' }));
    await userEvent.type(within(sheet).getByLabelText('Name of to-do lead 1'), 'Architect');
    await userEvent.selectOptions(within(sheet).getByLabelText('Default person of to-do lead 1'), 'Faisal Al-Harbi');
    await pick(sheet, '1');
    await userEvent.type(within(details(sheet)).getByLabelText('Stage name'), 'Concept');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Add a to-do' }));
    const panel = details(sheet);
    await userEvent.type(within(panel).getByLabelText('To-do title'), 'Massing');
    await userEvent.selectOptions(within(panel).getByLabelText('To-do lead'), 'Architect');
    const days = within(panel).getByLabelText('Working days');
    await userEvent.clear(days);
    await userEvent.type(days, '8');
    await userEvent.click(within(panel).getByRole('checkbox', { name: 'Can stretch' }));
    expect(within(sheet).getByText('Length: 8 working days')).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save template' }));
    expect(await screen.findByText('Template saved.')).toBeInTheDocument();
    const saved = savedNamed(store, 'Small house')!;
    expect(saved.roles).toEqual([{ id: 'r1', name: 'Architect', defaultUserId: 'usr_002' }]);
    expect(saved.stages).toEqual([{ id: 's1', name: 'Concept', startOffset: null, durationDays: null }]);
    expect(saved.tasks).toEqual([{
      id: 't1', stageId: 's1', title: 'Massing', description: '', checklist: [], needsReview: true, roleId: 'r1', startOffset: 0, durationDays: 8, flexible: false,
    }]);
  });

  it('names the first problem, opens its part, marks its field, and saves nothing (ADM-10)', async () => {
    const { store } = await renderApp('/admin/project-templates');
    await userEvent.click(within(await region('Project templates')).getByRole('button', { name: 'New template' }));
    const sheet = await screen.findByRole('dialog', { name: 'New project template' });
    const before = Object.keys(store.state.projectTemplates ?? {}).length;
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save template' }));
    expect(within(sheet).getByRole('alert')).toHaveTextContent('Fix 1 problem to save.');
    expect(within(sheet).getByLabelText(/Template name/)).toHaveAttribute('aria-invalid', 'true');
    expect(within(sheet).getByText('Give the template a name.')).toBeInTheDocument();
    await userEvent.type(within(sheet).getByLabelText(/Template name/), 'Small house');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save template' }));
    // The stage with no name opens beside the chart, with its field marked and the message under it.
    const field = within(details(sheet)).getByLabelText('Stage name');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(within(details(sheet)).getByText('Give every stage a name.')).toBeInTheDocument();
    // The message goes when the field is fixed.
    await userEvent.type(field, 'Concept');
    expect(within(sheet).queryByRole('alert')).not.toBeInTheDocument();
    expect(Object.keys(store.state.projectTemplates ?? {})).toHaveLength(before);
  });

  it('opens a template from its row, with its timeline as the main view, and saves a change', async () => {
    const { store } = await renderApp('/admin/project-templates');
    const sheet = await openEditor(/^Villa, full design/);
    expect(within(sheet).getByText('Length: 60 working days')).toBeInTheDocument();
    // The legend names the two kinds of bar, with no colour word: the colours change with the theme.
    expect(within(sheet).getByText('Keeps its length')).toBeInTheDocument();
    expect(sheet.querySelectorAll('[data-row="stage"]')).toHaveLength(5);
    expect(sheet.querySelectorAll('[data-row="task"]')).toHaveLength(11);
    expect(within(details(sheet)).getByText('Pick a stage or a to-do to see its details.')).toBeInTheDocument();
    const name = within(sheet).getByLabelText(/Template name/);
    await userEvent.clear(name);
    await userEvent.type(name, 'Villa, long');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(savedNamed(store, 'Villa, long')).toBeDefined());
    expect(savedNamed(store, 'Villa, full design')).toBeUndefined();
  });

  it('shows no empty "Waits for" box until a part waits for something', async () => {
    await renderApp('/admin/project-templates');
    const sheet = await openEditor(/^Villa, full design/);
    await pick(sheet, 'Floor plans');
    const panel = details(sheet);
    expect(within(panel).queryByRole('combobox', { name: 'Waits for' })).not.toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Waits for' })).toBeInTheDocument();
    // The description, the checklist and "Needs review" sit under a fold (ADM-21).
    expect(within(panel).getByText('More about this to-do').closest('details')).not.toHaveAttribute('open');
  });

  it('moves a stage down and removes a task', async () => {
    const { store } = await renderApp('/admin/project-templates');
    const sheet = await openEditor(/^Villa, full design/);
    await pick(sheet, 'Concept');
    await userEvent.click(within(details(sheet)).getByRole('button', { name: 'Move down' }));
    await pick(sheet, 'Site visit and survey');
    await userEvent.click(within(details(sheet)).getByRole('button', { name: 'Remove this to-do' }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save template' }));
    await waitFor(() => {
      const saved = savedNamed(store, 'Villa, full design')!;
      expect(saved.stages.map((stage) => stage.name).slice(0, 2)).toEqual(['Schematic Design', 'Concept']);
      expect(saved.tasks).toHaveLength(10);
    });
  });

  it('edits the description, the checklist and Needs review of a task under the fold (ADM-21)', async () => {
    const { store } = await renderApp('/admin/project-templates');
    const sheet = await openEditor(/^Villa, full design/);
    await pick(sheet, 'Site visit and survey');
    const panel = details(sheet);
    await userEvent.click(within(panel).getByText('More about this to-do'));
    expect(within(panel).getByLabelText('Checklist')).toHaveValue('Photos\nBoundary check');
    await userEvent.type(within(panel).getByLabelText('Description'), 'Visit with the client.');
    const list = within(panel).getByLabelText('Checklist');
    await userEvent.clear(list);
    await userEvent.type(list, 'Photos{enter}Neighbours{enter}');
    await userEvent.click(within(panel).getByRole('checkbox', { name: 'Needs review' }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save template' }));
    await waitFor(() => {
      const task = savedNamed(store, 'Villa, full design')!.tasks.find((part) => part.id === 't1')!;
      expect(task).toMatchObject({ description: 'Visit with the client.', checklist: ['Photos', 'Neighbours'], needsReview: false });
    });
  });

  it('shows the start and length fields of a stage that has tasks', async () => {
    await renderApp('/admin/project-templates');
    const sheet = await openEditor(/^Villa, full design/);
    await pick(sheet, 'Concept');
    expect(within(details(sheet)).getByLabelText('Start day')).toBeInTheDocument();
    expect(within(details(sheet)).getByLabelText('Working days')).toBeInTheDocument();
  });

  it('says where the tasks of a stage end when they run past the own days of the stage', async () => {
    await renderApp('/admin/project-templates');
    const sheet = await openEditor(/^Villa, full design/);
    await pick(sheet, 'Concept');
    const panel = details(sheet);
    await userEvent.type(within(panel).getByLabelText('Start day'), '0');
    const ownDays = within(panel).getByLabelText('Working days');
    await userEvent.type(ownDays, '5');
    // The last task of Concept ends on day 11, after the 5 days of the stage.
    expect(within(panel).getByText('The to-dos end on day 11.')).toBeInTheDocument();
    await userEvent.clear(ownDays);
    await userEvent.type(ownDays, '20');
    expect(within(panel).queryByText('The to-dos end on day 11.')).not.toBeInTheDocument();
  });

  it('names the stage in the problem of a start day with no working days, and keeps the field', async () => {
    await renderApp('/admin/project-templates');
    const sheet = await openEditor(/^Villa, full design/);
    await pick(sheet, 'Concept');
    await userEvent.type(within(details(sheet)).getByLabelText('Start day'), '0');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save template' }));
    const panel = details(sheet);
    expect(within(panel).getByText('Concept: add the working days, or clear the start day.')).toBeInTheDocument();
    expect(within(panel).getByLabelText('Working days')).toHaveAttribute('aria-invalid', 'true');
    expect(within(panel).getByLabelText('Start day')).toHaveValue('0');
    expect(within(sheet).getByRole('alert')).toHaveTextContent('Fix 1 problem to save.');
  });

  it('moves the tasks of a stage with its start day, as the timeline does (INT-12)', async () => {
    const { store, api } = await renderApp('/admin/project-templates');
    await api.call('projectTemplates.save', WAITS as never);
    const sheet = await openEditor(/^Waits/);
    await pick(sheet, 'Concept');
    const start = within(details(sheet)).getByLabelText('Start day');
    await userEvent.clear(start);
    await userEvent.type(start, '5');
    // Nothing moves while the person types. The tasks move once, when the field is left.
    await userEvent.tab();
    expect(within(sheet).getByRole('slider', { name: 'Start of Concept presentation' })).toHaveAttribute('aria-valuenow', '12');
    expect(within(details(sheet)).getByText('The to-dos move with the stage.')).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save template' }));
    await waitFor(() => {
      const saved = savedNamed(store, 'Waits')!;
      expect(saved.stages[0]).toMatchObject({ startOffset: 5 });
      expect(saved.tasks.map((task) => task.startOffset)).toEqual([12, 12]);
    });
  });

  it('starts the first task of a stage at the own start day of the stage (ADM-18)', async () => {
    const { api } = await renderApp('/admin/project-templates');
    await api.call('projectTemplates.save', { ...WAITS, name: 'Empty stage', tasks: [] } as never);
    const sheet = await openEditor(/^Empty stage/);
    await pick(sheet, 'Concept');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Add a to-do' }));
    expect(within(details(sheet)).getByLabelText('Start day')).toHaveValue('3');
  });

  it('moves a task that starts before the task it waits for, and Undo takes the move back (ADM-08)', async () => {
    const { api } = await renderApp('/admin/project-templates');
    await api.call('projectTemplates.save', WAITS as never);
    const sheet = await openEditor(/^Waits/);
    await pick(sheet, 'Concept presentation');
    await userEvent.click(within(details(sheet)).getByRole('button', { name: 'Waits for' }));
    await userEvent.selectOptions(within(details(sheet)).getByLabelText('Waits for'), 'Massing options');
    expect(await screen.findByText('Concept presentation now starts on day 15.')).toBeInTheDocument();
    expect(within(details(sheet)).getByLabelText('Start day')).toHaveValue('15');
    expect(within(details(sheet)).getByRole('button', { name: 'Remove the wait for Massing options' })).toBeInTheDocument();
    // A modal sheet makes the page ignore the pointer in this test setup; the toast takes the click as it does in the browser.
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(within(details(sheet)).getByLabelText('Start day')).toHaveValue('10');
    expect(within(details(sheet)).queryByRole('button', { name: 'Remove the wait for Massing options' })).not.toBeInTheDocument();
  });

  it('asks before it drops changes, and Keep editing is the focused choice (ADM-02)', async () => {
    const { store } = await renderApp('/admin/project-templates');
    const before = Object.keys(store.state.projectTemplates ?? {}).length;
    await userEvent.click(within(await region('Project templates')).getByRole('button', { name: 'New template' }));
    const sheet = await screen.findByRole('dialog', { name: 'New project template' });
    await userEvent.type(within(sheet).getByLabelText(/Template name/), 'Small house');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    const question = await screen.findByRole('dialog', { name: 'Discard the changes to this template?' });
    expect(within(question).getByRole('button', { name: 'Keep editing' })).toHaveFocus();
    await userEvent.click(within(question).getByRole('button', { name: 'Keep editing' }));
    expect(within(sheet).getByLabelText(/Template name/)).toHaveValue('Small house');
    // Escape asks too, and never closes an editor that has changes.
    await userEvent.keyboard('{Escape}');
    expect(await screen.findByRole('dialog', { name: 'Discard the changes to this template?' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New project template' })).not.toBeInTheDocument());
    expect(Object.keys(store.state.projectTemplates ?? {})).toHaveLength(before);
  });

  it('closes an editor with no changes without a question', async () => {
    await renderApp('/admin/project-templates');
    await userEvent.click(within(await region('Project templates')).getByRole('button', { name: 'New template' }));
    const sheet = await screen.findByRole('dialog', { name: 'New project template' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New project template' })).not.toBeInTheDocument());
    expect(screen.queryByRole('dialog', { name: 'Discard the changes to this template?' })).not.toBeInTheDocument();
  });

  it('duplicates a template: the editor opens filled with the copy, and Save makes a new template', async () => {
    const { store } = await renderApp('/admin/project-templates');
    const section = await region('Project templates');
    await userEvent.click(await within(section).findByRole('button', { name: 'Actions for template Villa, full design' }));
    await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Duplicate' }));
    const sheet = await screen.findByRole('dialog', { name: 'Copy of Villa, full design' });
    expect(within(sheet).getByLabelText(/Template name/)).toHaveValue('Copy of Villa, full design');
    expect(sheet.querySelectorAll('[data-row="task"]')).toHaveLength(11);
    const original = savedNamed(store, 'Villa, full design')!;
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save template' }));
    expect(await screen.findByText('Template saved.')).toBeInTheDocument();
    const copy = savedNamed(store, 'Copy of Villa, full design')!;
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

  it('says how many projects keep their tasks when a template that projects follow is deleted (ADM-05)', async () => {
    await renderApp('/admin/project-templates');
    const section = await region('Project templates');
    await userEvent.click(await within(section).findByRole('button', { name: 'Actions for template Villa, full design' }));
    await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Delete' }));
    expect(await screen.findByText('Template deleted. 1 project keeps its to-dos.')).toBeInTheDocument();
  });

  it('opens the projects that use a template from its row menu', async () => {
    await renderApp('/admin/project-templates');
    const section = await region('Project templates');
    await userEvent.click(await within(section).findByRole('button', { name: 'Actions for template Villa, full design' }));
    await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Projects using this template' }));
    expect(await screen.findByRole('dialog', { name: 'Projects using this template' })).toBeInTheDocument();
  });

  it('offers the update of the projects right after a save of a template that projects follow (ADM-05)', async () => {
    await renderApp('/admin/project-templates');
    const sheet = await openEditor(/^Villa, full design/);
    await pick(sheet, 'Floor plans');
    const title = within(details(sheet)).getByLabelText('To-do title');
    await userEvent.type(title, ' v2');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save template' }));
    expect(await screen.findByText('Template saved. 1 project follows it.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Update them' }));
    expect(await screen.findByRole('dialog', { name: 'Review the changes' })).toBeInTheDocument();
  });

  it('says only "Template saved." when the save changed nothing', async () => {
    await renderApp('/admin/project-templates');
    const sheet = await openEditor(/^Villa, full design/);
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save template' }));
    expect(await screen.findByText('Template saved.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Update them' })).not.toBeInTheDocument();
  });

  it('hides "Projects using this template" from a person who has the template right but is not the Admin (ADM-03)', async () => {
    await renderApp('/admin/project-templates', (state) => {
      state.settings.roles = { custom: [{ id: 'rol_001', name: 'Keeper', nameAr: 'أمين القوالب', rights: ['templates.manageAll', 'templates.projectCreate'] }] };
      state.users.usr_003.roleId = 'rol_001';
      state.session.currentUserId = 'usr_003';
    });
    const section = await region('Project templates');
    expect(within(section).queryByText('1 project follows it')).not.toBeInTheDocument();
    await userEvent.click(await within(section).findByRole('button', { name: 'Actions for template Villa, full design' }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Duplicate' })).toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: 'Projects using this template' })).not.toBeInTheDocument();
  });

  // role-rights (owner, 2026-10-23): the update of projects has its own right, templates.updateProjects.
  it('shows "Projects using this template" and the count to a person with the update right, who is not the Admin', async () => {
    await renderApp('/admin/project-templates', (state) => {
      state.settings.roles = { custom: [{ id: 'rol_001', name: 'Updater', nameAr: 'محدّث', rights: ['templates.manageAll', 'templates.updateProjects'] }] };
      state.users.usr_003.roleId = 'rol_001';
      state.session.currentUserId = 'usr_003';
    });
    const section = await region('Project templates');
    expect(await within(section).findByText('1 project follows it')).toBeInTheDocument();
    await userEvent.click(await within(section).findByRole('button', { name: 'Actions for template Villa, full design' }));
    expect(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Projects using this template' })).toBeInTheDocument();
  });

  it('opens the section for the update right alone, without the right to change a template', async () => {
    await renderApp('/admin/project-templates', (state) => {
      state.settings.roles = { custom: [{ id: 'rol_001', name: 'Updater', nameAr: 'محدّث', rights: ['templates.updateProjects'] }] };
      state.users.usr_003.roleId = 'rol_001';
      state.session.currentUserId = 'usr_003';
    });
    const section = await region('Project templates');
    expect(await within(section).findByText('1 project follows it')).toBeInTheDocument();
    await userEvent.click(await within(section).findByRole('button', { name: 'Actions for template Villa, full design' }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Projects using this template' })).toBeInTheDocument();
    // The right to update the projects is not the right to change or delete a template that another person made.
    expect(within(menu).queryByRole('menuitem', { name: 'Duplicate' })).not.toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('makes a task and a stage wait for other parts of the template, and saves the waits', async () => {
    const { store } = await renderApp('/admin/project-templates');
    await userEvent.click(within(await region('Project templates')).getByRole('button', { name: 'New template' }));
    const sheet = await screen.findByRole('dialog', { name: 'New project template' });
    await userEvent.type(within(sheet).getByLabelText(/Template name/), 'Waits');
    await pick(sheet, '1');
    await userEvent.type(within(details(sheet)).getByLabelText('Stage name'), 'Concept');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Add a to-do' }));
    await userEvent.type(within(details(sheet)).getByLabelText('To-do title'), 'Massing');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Add a to-do' }));
    await userEvent.type(within(details(sheet)).getByLabelText('To-do title'), 'Pack');
    await userEvent.click(within(details(sheet)).getByRole('button', { name: 'Waits for' }));
    await userEvent.selectOptions(within(details(sheet)).getByLabelText('Waits for'), 'Massing');
    expect(within(details(sheet)).getByRole('button', { name: 'Remove the wait for Massing' })).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Add a stage' }));
    await userEvent.type(within(details(sheet)).getByLabelText('Stage name'), 'Permits');
    await userEvent.click(within(details(sheet)).getByRole('button', { name: 'Waits for' }));
    await userEvent.selectOptions(within(details(sheet)).getByLabelText('Waits for'), 'Concept');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save template' }));
    expect(await screen.findByText('Template saved.')).toBeInTheDocument();
    const saved = savedNamed(store, 'Waits')!;
    expect(saved.stages[1].prerequisiteIds).toEqual(['s1']);
    expect(saved.tasks[1].prerequisiteIds).toEqual(['t1']);
    expect(saved.tasks[0].prerequisiteIds).toBeUndefined();
  });

  // fbk_031 (Faisal): "adding a task to an existing template does not let you change which stage it's added in".
  describe('the stage of a task (fbk_031)', () => {
    /** Two stages with their own days, and one task in each. */
    const TWO = {
      name: 'Two stages',
      roles: [],
      stages: [{ id: 's1', name: 'Concept', startOffset: 0, durationDays: 10 }, { id: 's2', name: 'Permits', startOffset: 20, durationDays: 10 }],
      tasks: [
        { id: 't1', stageId: 's1', title: 'Massing options', description: '', checklist: [], needsReview: true, roleId: null, startOffset: 0, durationDays: 8, flexible: true },
        { id: 't2', stageId: 's2', title: 'Balady pack', description: '', checklist: [], needsReview: true, roleId: null, startOffset: 20, durationDays: 6, flexible: true },
      ],
    };

    it('has a Stage field in the details of every task, with the stages of the template, and shows the stage of the task', async () => {
      const { api } = await renderApp('/admin/project-templates');
      await api.call('projectTemplates.save', TWO as never);
      const sheet = await openEditor(/^Two stages/);
      await pick(sheet, 'Massing options');
      const stage = within(details(sheet)).getByLabelText('Stage');
      expect(stage).toHaveValue('s1');
      expect(within(stage).getAllByRole('option').map((option) => option.textContent)).toEqual(['Concept', 'Permits']);
      // It sits right under the title, before the task lead.
      const labels = [...details(sheet).querySelectorAll('label')].map((label) => label.textContent);
      expect(labels.findIndex((text) => text?.startsWith('Stage'))).toBe(labels.findIndex((text) => text?.startsWith('To-do title')) + 1);
    });

    it('moves an old task to another stage and keeps its days, and the save accepts it', async () => {
      const { store, api } = await renderApp('/admin/project-templates');
      await api.call('projectTemplates.save', TWO as never);
      const sheet = await openEditor(/^Two stages/);
      await pick(sheet, 'Massing options');
      await userEvent.selectOptions(within(details(sheet)).getByLabelText('Stage'), 'Permits');
      expect(within(details(sheet)).getByLabelText('Start day')).toHaveValue('0');
      expect(within(details(sheet)).getByLabelText('Working days')).toHaveValue('8');
      // The days of the task are outside the days of its new stage (20 to 30): the editor says so, and moves nothing.
      expect(within(details(sheet)).getByText('The days of this to-do are outside the days of its stage. Change the start day, or the days of the stage.')).toBeInTheDocument();
      await userEvent.click(within(sheet).getByRole('button', { name: 'Save template' }));
      expect(await screen.findByText('Template saved.')).toBeInTheDocument();
      const saved = savedNamed(store, 'Two stages')!;
      // The list stays grouped by stage: the moved task goes after the last task of Permits.
      expect(saved.tasks.map((task) => [task.id, (task as unknown as { stageId: string }).stageId, task.startOffset, task.durationDays])).toEqual([['t2', 's2', 20, 6], ['t1', 's2', 0, 8]]);
      expect(saved.stages.map((stage) => stage.id)).toEqual(['s1', 's2']);
    });

    it('shows no note when the days of the task fit the days of the new stage', async () => {
      const { api } = await renderApp('/admin/project-templates');
      await api.call('projectTemplates.save', { ...TWO, tasks: [{ ...TWO.tasks[0], startOffset: 22, durationDays: 4 }, TWO.tasks[1]] } as never);
      const sheet = await openEditor(/^Two stages/);
      await pick(sheet, 'Massing options');
      await userEvent.selectOptions(within(details(sheet)).getByLabelText('Stage'), 'Permits');
      expect(within(details(sheet)).queryByText(/outside the days of its stage/)).toBeNull();
    });

    it('lets the person change the stage of a task that was just added, and the task starts where Add task would put it in that stage', async () => {
      const { store, api } = await renderApp('/admin/project-templates');
      await api.call('projectTemplates.save', TWO as never);
      const sheet = await openEditor(/^Two stages/);
      // Add task goes to the last stage (nothing is picked): Permits. Its first day is the end of Balady pack, day 26.
      await userEvent.click(within(sheet).getByRole('button', { name: 'Add a to-do' }));
      const panel = details(sheet);
      expect(within(panel).getByLabelText('Stage')).toHaveValue('s2');
      expect(within(panel).getByLabelText('Start day')).toHaveValue('26');
      await userEvent.type(within(panel).getByLabelText('To-do title'), 'Site survey');
      await userEvent.selectOptions(within(panel).getByLabelText('Stage'), 'Concept');
      // Now it starts at the end of Massing options in Concept, day 8.
      expect(within(panel).getByLabelText('Start day')).toHaveValue('8');
      await userEvent.click(within(sheet).getByRole('button', { name: 'Save template' }));
      expect(await screen.findByText('Template saved.')).toBeInTheDocument();
      const added = savedNamed(store, 'Two stages')!.tasks.find((task) => task.title === 'Site survey') as unknown as { stageId: string; startOffset: number; durationDays: number };
      expect(added).toMatchObject({ stageId: 's1', startOffset: 8, durationDays: 5 });
    });

    it('keeps the days of a new task after the person typed its start day, whatever the stage', async () => {
      const { store, api } = await renderApp('/admin/project-templates');
      await api.call('projectTemplates.save', TWO as never);
      const sheet = await openEditor(/^Two stages/);
      await userEvent.click(within(sheet).getByRole('button', { name: 'Add a to-do' }));
      const panel = details(sheet);
      await userEvent.type(within(panel).getByLabelText('To-do title'), 'Site survey');
      const start = within(panel).getByLabelText('Start day');
      await userEvent.clear(start);
      await userEvent.type(start, '3');
      await userEvent.selectOptions(within(panel).getByLabelText('Stage'), 'Concept');
      expect(within(panel).getByLabelText('Start day')).toHaveValue('3');
      await userEvent.click(within(sheet).getByRole('button', { name: 'Save template' }));
      expect(await screen.findByText('Template saved.')).toBeInTheDocument();
      expect(savedNamed(store, 'Two stages')!.tasks.find((task) => task.title === 'Site survey')).toMatchObject({ startOffset: 3 });
    });

    it('shows the Stage field in the details sheet on a phone as well', async () => {
      vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
        matches: query === '(max-width: 639px)', media: query, onchange: null,
        addListener: () => undefined, removeListener: () => undefined,
        addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false,
      }) as MediaQueryList);
      const { store, api } = await renderApp('/admin/project-templates');
      await api.call('projectTemplates.save', TWO as never);
      const sheet = await openEditor(/^Two stages/);
      await userEvent.click(within(sheet).getByRole('button', { name: /Massing options/ }));
      const part = await screen.findByRole('dialog', { name: 'Massing options' });
      await userEvent.selectOptions(within(part).getByLabelText('Stage'), 'Permits');
      await userEvent.click(within(part).getByRole('button', { name: 'Done' }));
      await userEvent.click(within(sheet).getByRole('button', { name: 'Save template' }));
      expect(await screen.findByText('Template saved.')).toBeInTheDocument();
      expect(savedNamed(store, 'Two stages')!.tasks.find((task) => task.id === 't1')).toMatchObject({ stageId: 's2', startOffset: 0 });
    });
  });

  it('shows a list of rows on a phone, and a press on a row opens its details in a sheet', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
      matches: query === '(max-width: 639px)', media: query, onchange: null,
      addListener: () => undefined, removeListener: () => undefined,
      addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false,
    }) as MediaQueryList);
    await renderApp('/admin/project-templates');
    const sheet = await openEditor(/^Villa, full design/);
    expect(sheet.querySelector('[data-row]')).toBeNull();
    expect(within(sheet).queryByRole('complementary')).not.toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('button', { name: /Floor plans/ }));
    const part = await screen.findByRole('dialog', { name: 'Floor plans' });
    expect(within(part).getByLabelText('To-do title')).toHaveValue('Floor plans');
    expect(within(part).getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });
});
