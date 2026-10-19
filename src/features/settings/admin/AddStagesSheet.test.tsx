import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../../test/render';

/**
 * "Add stages from another template" (fbk_008 item 7). The sample office holds "Villa, full design" (5 stages, 11 tasks) and
 * "Competition entry" (3 stages). The editor of a new template starts with one empty stage.
 */
const region = (name: string) => screen.findByRole('region', { name });

async function openNewEditor() {
  await renderApp('/admin/project-templates');
  await userEvent.click(within(await region('Project templates')).getByRole('button', { name: 'New template' }));
  return screen.findByRole('dialog', { name: 'New project template' });
}

async function openAddStages(editor: HTMLElement) {
  await userEvent.click(within(editor).getByRole('button', { name: 'Add stages from another template' }));
  return screen.findByRole('dialog', { name: 'Add stages from another template' });
}

describe('Add stages from another template', () => {
  it('adds the ticked stage with its tasks to the open editor, with "With their tasks" on at the start (ADM-17)', async () => {
    const editor = await openNewEditor();
    const sheet = await openAddStages(editor);
    await userEvent.selectOptions(within(sheet).getByLabelText('Template to take stages from'), 'Villa, full design');
    expect(within(sheet).getByRole('checkbox', { name: 'With their tasks' })).toBeChecked();
    await userEvent.click(within(sheet).getByRole('checkbox', { name: /^Concept/ }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Add the stages' }));
    expect(screen.queryByRole('dialog', { name: 'Add stages from another template' })).not.toBeInTheDocument();
    // The empty stage stays first. The copy of Concept comes second, with its three tasks.
    expect(editor.querySelectorAll('[data-row="stage"]')).toHaveLength(2);
    expect(within(editor).getByRole('button', { name: 'Concept' })).toBeInTheDocument();
    expect(within(editor).getByRole('button', { name: 'Site visit and survey' })).toBeInTheDocument();
    expect(within(editor).getByRole('button', { name: 'Concept presentation' })).toBeInTheDocument();
  });

  it('names the tasks and the days of each stage, so the person knows what a stage brings (ADM-17)', async () => {
    const editor = await openNewEditor();
    const sheet = await openAddStages(editor);
    await userEvent.selectOptions(within(sheet).getByLabelText('Template to take stages from'), 'Villa, full design');
    expect(within(sheet).getByRole('checkbox', { name: /^Concept.*3 tasks · 12 working days$/ })).toBeInTheDocument();
  });

  it('puts the copied stages right after the last stage, and keeps their days only when asked (ADM-17)', async () => {
    await renderApp('/admin/project-templates');
    await userEvent.click(await within(await region('Project templates')).findByRole('button', { name: /^Competition entry/ }));
    const editor = await screen.findByRole('dialog', { name: /^Competition entry/ });
    const sheet = await openAddStages(editor);
    await userEvent.selectOptions(within(sheet).getByLabelText('Template to take stages from'), 'Villa, full design');
    await userEvent.click(within(sheet).getByRole('checkbox', { name: /^Design Development/ }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Add the stages' }));
    // The stage templates have no days, so the template ends on day 0 and the copy of Design Development (day 20 in the villa) starts on day 0.
    expect(within(editor).getByRole('slider', { name: 'Start of Material board' })).toHaveAttribute('aria-valuenow', '0');
  });

  it('adds only the stage when "With their tasks" is unticked', async () => {
    const editor = await openNewEditor();
    const sheet = await openAddStages(editor);
    await userEvent.selectOptions(within(sheet).getByLabelText('Template to take stages from'), 'Villa, full design');
    await userEvent.click(within(sheet).getByRole('checkbox', { name: 'With their tasks' }));
    await userEvent.click(within(sheet).getByRole('checkbox', { name: /^Concept/ }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Add the stages' }));
    expect(within(editor).getByRole('button', { name: 'Concept' })).toBeInTheDocument();
    expect(within(editor).queryByRole('button', { name: 'Site visit and survey' })).not.toBeInTheDocument();
  });

  it('keeps the add button off until a template and a stage are chosen', async () => {
    const editor = await openNewEditor();
    const sheet = await openAddStages(editor);
    const add = within(sheet).getByRole('button', { name: 'Add the stages' });
    expect(add).toBeDisabled();
    await userEvent.selectOptions(within(sheet).getByLabelText('Template to take stages from'), 'Villa, full design');
    expect(add).toBeDisabled();
    await userEvent.click(within(sheet).getByRole('checkbox', { name: /^Concept/ }));
    expect(add).toBeEnabled();
  });

  it('offers the other templates only, not the one the editor holds', async () => {
    await renderApp('/admin/project-templates');
    await userEvent.click(await within(await region('Project templates')).findByRole('button', { name: /^Villa, full design/ }));
    const editor = await screen.findByRole('dialog', { name: 'Villa, full design' });
    const sheet = await openAddStages(editor);
    const picker = within(sheet).getByLabelText('Template to take stages from');
    expect(within(picker).queryByRole('option', { name: 'Villa, full design' })).not.toBeInTheDocument();
    expect(within(picker).getByRole('option', { name: 'Competition entry' })).toBeInTheDocument();
  });
});
