import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { renderWithRuntime } from '../../test/render';
import type { State } from '../../api/store';
import { NewProjectSheet } from './NewProjectSheet';

/** The first choice of the New project sheet (fbk_044, owner 2026-10-22): a client project or an internal project. */
function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Start</button>
      <NewProjectSheet open={open} onOpenChange={setOpen} />
    </>
  );
}

async function openSheet(prepare?: (state: State) => void) {
  const view = await renderWithRuntime(<Harness />, prepare, { path: '/' });
  await userEvent.click(screen.getByText('Start'));
  return { ...view, sheet: await screen.findByRole('dialog', { name: 'New Project' }) };
}

const CLIENT_ONLY = ['Client', 'Location', 'Area (m²)', 'Contract start date'];

describe('the kind of a new project', () => {
  it('starts as a client project, with one choice as the first control', async () => {
    const { sheet } = await openSheet();
    const group = within(sheet).getByRole('radiogroup', { name: 'Kind of project' });
    expect(within(group).getByRole('radio', { name: 'Client project' })).toHaveAttribute('aria-checked', 'true');
    expect(within(group).getByRole('radio', { name: 'Internal project' })).toHaveAttribute('aria-checked', 'false');
    const first = sheet.querySelector('form')!.querySelector('button, input, select, textarea');
    expect(first).toBe(within(group).getAllByRole('radio')[0]);
    for (const label of CLIENT_ONLY) expect(within(sheet).getByLabelText(label), label).toBeInTheDocument();
    expect(within(sheet).getByText('Project code')).toBeInTheDocument();
    expect(within(sheet).queryByText('Only the team sees an internal project. You can share it later.')).toBeNull();
  });

  it('hides the client fields for an internal project, shows one line, and keeps the template picker', async () => {
    const { sheet } = await openSheet();
    await userEvent.click(within(sheet).getByRole('radio', { name: 'Internal project' }));
    for (const label of CLIENT_ONLY) expect(within(sheet).queryByLabelText(label), label).toBeNull();
    expect(within(sheet).queryByText('Project code')).toBeNull();
    expect(within(sheet).queryByRole('group', { name: /Sub-company/ })).toBeNull();
    expect(within(sheet).getByText('Only the team sees an internal project. You can share it later.')).toBeInTheDocument();
    expect(within(sheet).getByLabelText('Name')).toBeInTheDocument();
    expect(within(sheet).getByLabelText(/Start from a template/i)).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('radio', { name: 'Client project' }));
    for (const label of CLIENT_ONLY) expect(within(sheet).getByLabelText(label), label).toBeInTheDocument();
  });

  it('creates an internal project with the kind and no code, client, place, area or sub-company, in an office with sub-companies', async () => {
    const { sheet, store } = await openSheet((state) => {
      state.subCompanies = {
        sub_001: { id: 'sub_001', name: 'Vado', nameAr: 'فادو', logo: null, createdBy: 'usr_001', createdAt: '2026-09-01T09:00:00.000+03:00' },
        sub_002: { id: 'sub_002', name: 'Bunah', nameAr: 'بناة', logo: null, createdBy: 'usr_001', createdAt: '2026-09-01T09:00:00.000+03:00' },
      };
    });
    await userEvent.click(within(sheet).getByRole('radio', { name: 'Internal project' }));
    await userEvent.type(within(sheet).getByLabelText('Name'), 'Portfolio 2027');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(Object.values(store.state.projects).some((project) => project.name === 'Portfolio 2027')).toBe(true));
    const made = Object.values(store.state.projects).find((project) => project.name === 'Portfolio 2027')!;
    expect(made).toMatchObject({ kind: 'internal', clientId: null, areaM2: null, location: '', access: { hidden: true, viewerIds: [] } });
    expect(made.code).toMatch(/^INT-\d{2}-001$/);
    expect(made.subCompanyId ?? null).toBeNull();
    // The toast says the word Internal, never the code.
    expect(await screen.findByText(/Internal created\./)).toBeInTheDocument();
  });

  it('still asks for the code parts of a client project', async () => {
    const { sheet, store } = await openSheet();
    await userEvent.type(within(sheet).getByLabelText('Name'), 'Villa');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create project' }));
    expect(await within(sheet).findByText(/initials/i)).toBeInTheDocument();
    expect(Object.values(store.state.projects).some((project) => project.name === 'Villa')).toBe(false);
  });
});
