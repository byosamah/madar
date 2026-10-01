import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { renderWithRuntime } from '../../test/render';
import { NewProjectSheet } from './NewProjectSheet';
import { ApiError } from '../../api/errors';

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
  return { ...view, sheet: await screen.findByRole('dialog', { name: 'New Project' }) };
}

describe('the New Project sheet', () => {
  it('checks each field when the person leaves it', async () => {
    const { sheet } = await openSheet();
    await userEvent.click(within(sheet).getByLabelText('Name'));
    await userEvent.tab();
    expect(within(sheet).getByText('Enter a name.')).toBeInTheDocument();
    fireEvent.change(within(sheet).getByLabelText('Start date'), { target: { value: '2026-10-10' } });
    const end = within(sheet).getByLabelText('Target end date');
    fireEvent.change(end, { target: { value: '2026-10-01' } });
    fireEvent.blur(end);
    expect(await within(sheet).findByText('The end date must be after the start date.')).toBeInTheDocument();
  });

  it('shows every error on submit and creates nothing', async () => {
    const { sheet, store } = await openSheet();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create project' }));
    expect(within(sheet).getByText('Enter a name.')).toBeInTheDocument();
    await waitFor(() => expect(within(sheet).getByLabelText('Name')).toHaveFocus());
    expect(Object.keys(store.state.projects)).toHaveLength(12);
  });

  it('creates a project with a new client, another leader and a team', async () => {
    const { sheet, store } = await openSheet();
    await userEvent.type(within(sheet).getByLabelText('Name'), 'Harbour Gate Offices');
    await userEvent.click(within(sheet).getByRole('button', { name: 'New client' }));
    await userEvent.type(within(sheet).getByLabelText('Client name (English)'), 'Harbour Holding');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Add client' }));
    await waitFor(() => expect((within(sheet).getByLabelText('Client') as HTMLSelectElement).selectedOptions[0].textContent).toBe('Harbour Holding'));
    await userEvent.selectOptions(within(sheet).getByLabelText('Leader'), 'Faisal Al-Harbi');
    await userEvent.click(within(sheet).getByRole('checkbox', { name: /Sara Al-Qahtani/ }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create project' }));
    expect(await screen.findByText(/KH-26-\d{3} created\./)).toBeInTheDocument();
    const project = Object.values(store.state.projects).find((p) => p.name === 'Harbour Gate Offices');
    expect(project?.leaderId).toBe('usr_002');
    expect(store.state.clients[project!.clientId!].name).toBe('Harbour Holding');
    expect(store.state.members[`${project!.id}:usr_005`]).toBeDefined();
  });

  it('adds a client with an Arabic name and the contact the same as the client (colleague comments 10 and 11)', async () => {
    const { sheet, store } = await openSheet();
    await userEvent.click(within(sheet).getByRole('button', { name: 'New client' }));
    await userEvent.type(within(sheet).getByLabelText('Client name (English)'), 'Villa Owner');
    await userEvent.type(within(sheet).getByLabelText('Client name (Arabic)'), 'مالك الفيلا');
    await userEvent.click(within(sheet).getByRole('checkbox', { name: 'Same as client' }));
    expect(within(sheet).getByLabelText('Contact name')).toBeDisabled();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Add client' }));
    await waitFor(() => expect(Object.values(store.state.clients).some((c) => c.name === 'Villa Owner')).toBe(true));
    const client = Object.values(store.state.clients).find((c) => c.name === 'Villa Owner')!;
    expect(client.nameAr).toBe('مالك الفيلا');
    expect(client.contactName).toBe('Villa Owner');
  });

  it('fills the stage list from a saved template, and the person can still edit it', async () => {
    const { sheet } = await openSheet();
    const stageNames = () => within(sheet).getAllByLabelText(/^Stage \d+$/).map((input) => (input as HTMLInputElement).value);
    expect(stageNames()).toHaveLength(7);
    await userEvent.selectOptions(within(sheet).getByLabelText('Start from'), 'Competition entry');
    expect(stageNames()).toEqual(['Brief', 'Concept', 'Presentation']);
    await userEvent.type(within(sheet).getByLabelText('Stage 3'), ' board');
    expect(stageNames()[2]).toBe('Presentation board');
    await userEvent.selectOptions(within(sheet).getByLabelText('Start from'), 'Office default stages');
    expect(stageNames()).toHaveLength(7);
  });

  it('saves the current stage list as a template and offers it under Start from', async () => {
    const { sheet, store } = await openSheet();
    await userEvent.selectOptions(within(sheet).getByLabelText('Start from'), 'Competition entry');
    await userEvent.type(within(sheet).getByLabelText('Stage 3'), ' board');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save as template' }));
    await userEvent.type(within(sheet).getByLabelText('Template name'), 'Boards{Enter}');
    expect(await screen.findByText('Template saved.')).toBeInTheDocument();
    const saved = Object.values(store.state.stageTemplates ?? {}).find((tpl) => tpl.name === 'Boards');
    expect(saved?.stages).toEqual(['Brief', 'Concept', 'Presentation board']);
    // Enter saved the template and did not send the project form.
    expect(Object.keys(store.state.projects)).toHaveLength(12);
    expect(within(sheet).getByRole('option', { name: 'Boards' })).toBeInTheDocument();
  });

  it('keeps what the person typed when the office settings change while the sheet is open', async () => {
    const { sheet, api } = await openSheet();
    await userEvent.type(within(sheet).getByLabelText('Name'), 'Harbour Gate Offices');
    await api.call('settings.update', { workloadLimit: 12 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(within(sheet).getByLabelText('Name')).toHaveValue('Harbour Gate Offices');
  });

  it('creates the project once when the cover upload fails, and retries the upload alone', async () => {
    const { sheet, store, api } = await openSheet();
    const original = api.call.bind(api);
    let failed = false;
    api.call = ((name: string, input: unknown, meta?: { correlationId?: string }) => {
      if (name === 'files.upload' && !failed) {
        failed = true;
        return Promise.reject(new ApiError('failed', 'The call failed. Try again.'));
      }
      return (original as (n: string, i: unknown, m?: unknown) => Promise<unknown>)(name, input, meta);
    }) as typeof api.call;
    await userEvent.type(within(sheet).getByLabelText('Name'), 'Harbour Gate Offices');
    await userEvent.upload(within(sheet).getByLabelText('Cover image'), new File(['x'], 'cover.png', { type: 'image/png' }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New Project' })).toBeNull());
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    const made = Object.values(store.state.projects).filter((p) => p.name === 'Harbour Gate Offices');
    expect(made).toHaveLength(1);
    await waitFor(() => expect(store.state.projects[made[0].id].coverFileId).not.toBeNull());
  });
});
