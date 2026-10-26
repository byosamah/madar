import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { renderApp, renderWithRuntime } from '../../test/render';
import { NewProjectSheet } from './NewProjectSheet';

/**
 * The Arabic name of a project in the forms (owner, 2026-10-26, fbk_062): one optional field right under "Name", empty at the start,
 * with the typed text in its own direction. The New and Edit sheets send it; the Edit sheet shows the stored value.
 */
const LOAD = { timeout: 10_000 };
const NAME_AR = 'برج الميناء للمكاتب';

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Start</button>
      <NewProjectSheet open={open} onOpenChange={setOpen} />
    </>
  );
}

async function openNew() {
  const view = await renderWithRuntime(<Harness />, undefined, { path: '/' });
  await userEvent.click(screen.getByText('Start'));
  return { ...view, sheet: await screen.findByRole('dialog', { name: 'New Project' }) };
}

async function fillCode(sheet: HTMLElement) {
  const field = within(sheet).getByLabelText('Client initials') as HTMLInputElement;
  if (!field.readOnly) await userEvent.type(field, 'HGO');
  await userEvent.selectOptions(within(sheet).getByLabelText('Classification'), 'COM');
  await userEvent.type(within(sheet).getByLabelText('Building type'), 'Offices');
}

describe('the Arabic name field of the New Project sheet', () => {
  it('sits right under Name, starts empty, takes its own direction, and is not required', async () => {
    const { sheet } = await openNew();
    const name = within(sheet).getByLabelText('Name');
    const field = within(sheet).getByLabelText('Arabic name');
    expect(field).toHaveValue('');
    expect(field).not.toBeRequired();
    expect(field).toHaveAttribute('dir', 'auto');
    expect(field).toHaveAttribute('maxlength', '120');
    expect(field).toHaveAttribute('autocomplete', 'off');
    // Right under the name: the next text field after Name in the order of the page.
    const inputs = [...sheet.querySelectorAll('input')];
    expect(inputs.indexOf(field as HTMLInputElement)).toBe(inputs.indexOf(name as HTMLInputElement) + 1);
  });

  it('sends the Arabic name with the new project', async () => {
    const { sheet, store } = await openNew();
    await userEvent.type(within(sheet).getByLabelText('Name'), 'Harbour Gate Offices');
    await userEvent.type(within(sheet).getByLabelText('Arabic name'), NAME_AR);
    await fillCode(sheet);
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(Object.values(store.state.projects).some((p) => p.name === 'Harbour Gate Offices')).toBe(true));
    expect(Object.values(store.state.projects).find((p) => p.name === 'Harbour Gate Offices')?.nameAr).toBe(NAME_AR);
  });

  it('leaves the Arabic name out when the field stays empty', async () => {
    const { sheet, store } = await openNew();
    await userEvent.type(within(sheet).getByLabelText('Name'), 'Harbour Gate Offices');
    await fillCode(sheet);
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(Object.values(store.state.projects).some((p) => p.name === 'Harbour Gate Offices')).toBe(true));
    expect(Object.values(store.state.projects).find((p) => p.name === 'Harbour Gate Offices')?.nameAr).toBeUndefined();
  });

  it('is also in the form of an internal project', async () => {
    const { sheet, store } = await openNew();
    await userEvent.click(within(sheet).getByRole('radio', { name: 'Internal project' }));
    await userEvent.type(within(sheet).getByLabelText('Name'), 'Office portfolio');
    await userEvent.type(within(sheet).getByLabelText('Arabic name'), 'ملف أعمال المكتب');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(Object.values(store.state.projects).some((p) => p.name === 'Office portfolio')).toBe(true));
    expect(Object.values(store.state.projects).find((p) => p.name === 'Office portfolio')?.nameAr).toBe('ملف أعمال المكتب');
  });
});

describe('the Arabic name field of the Edit project sheet', () => {
  const openEdit = async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'More actions' }, LOAD));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit project' }));
    return screen.findByRole('dialog', { name: 'Edit project' });
  };

  it('starts empty for a project with no Arabic name, and saves a new one', async () => {
    const { store } = await renderApp('/projects/prj_001');
    const sheet = await openEdit();
    const field = within(sheet).getByLabelText('Arabic name');
    expect(field).toHaveValue('');
    await userEvent.type(field, NAME_AR);
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(store.state.projects.prj_001.nameAr).toBe(NAME_AR));
  });

  it('shows the stored value, and clears it when the field is emptied', async () => {
    const { store } = await renderApp('/projects/prj_001', (state) => {
      state.projects.prj_001.nameAr = NAME_AR;
    });
    const sheet = await openEdit();
    const field = within(sheet).getByLabelText('Arabic name');
    expect(field).toHaveValue(NAME_AR);
    await userEvent.clear(field);
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(store.state.projects.prj_001.nameAr ?? '').toBe(''));
  });
});
