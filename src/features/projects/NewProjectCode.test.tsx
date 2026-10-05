import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type { State } from '../../api/store';
import { renderWithRuntime } from '../../test/render';
import { NewProjectSheet } from './NewProjectSheet';

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

const preview = (sheet: HTMLElement) => within(sheet).getByText('The new code').nextElementSibling?.textContent;
const named = (store: { state: State }, name: string) => Object.values(store.state.projects).find((p) => p.name === name);

describe('the Project code group (item 6b)', () => {
  it('marks the name and the three code parts as required', async () => {
    const { sheet } = await openSheet();
    for (const label of ['Name', 'Client initials', 'Classification', 'Building type']) {
      expect(within(sheet).getByLabelText(label)).toHaveAccessibleDescription(expect.stringMatching(/^required/));
    }
    expect(within(sheet).getByLabelText('Location')).not.toHaveAccessibleDescription(expect.stringMatching(/required/));
  });

  it('shows a message under each empty code part after a press on Create, and creates nothing', async () => {
    const { sheet, store } = await openSheet();
    await userEvent.type(within(sheet).getByLabelText('Name'), 'Zahra Villas');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create project' }));
    expect(within(sheet).getByText('Use 3 or 4 capital Latin letters.')).toBeInTheDocument();
    expect(within(sheet).getByText('Choose a classification.')).toBeInTheDocument();
    expect(within(sheet).getByText('Write the building type.')).toBeInTheDocument();
    await waitFor(() => expect(within(sheet).getByLabelText('Client initials')).toHaveFocus());
    expect(Object.keys(store.state.projects)).toHaveLength(12);
  });

  it('shows a message only after the person changes the field and leaves it', async () => {
    const { sheet } = await openSheet();
    await userEvent.click(within(sheet).getByLabelText('Building type'));
    await userEvent.tab();
    // The focus only passed through: no message (2026-10-05).
    expect(within(sheet).queryByText('Write the building type.')).toBeNull();
    await userEvent.type(within(sheet).getByLabelText('Building type'), 'x');
    await userEvent.clear(within(sheet).getByLabelText('Building type'));
    expect(within(sheet).queryByText('Write the building type.')).toBeNull();
    await userEvent.tab();
    expect(within(sheet).getByText('Write the building type.')).toBeInTheDocument();
  });

  it('shows the code as the person fills the parts, with typed initials as capitals', async () => {
    const { sheet, store } = await openSheet();
    expect(preview(sheet)).toBe('260900···-···-···');
    await userEvent.type(within(sheet).getByLabelText('Name'), 'Zahra Villas');
    await userEvent.type(within(sheet).getByLabelText('Client initials'), 'azt');
    expect(within(sheet).getByLabelText('Client initials')).toHaveValue('AZT');
    await userEvent.selectOptions(within(sheet).getByLabelText('Classification'), 'RES');
    await userEvent.type(within(sheet).getByLabelText('Building type'), 'Multi-unit Dev.');
    expect(preview(sheet)).toBe('260900AZT-RES-Multi-unit Dev.');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(named(store, 'Zahra Villas')?.code).toBe('260900AZT-RES-Multi-unit Dev.'));
  });

  it('names each class in words', async () => {
    const { sheet } = await openSheet();
    const options = within(within(sheet).getByLabelText('Classification')).getAllByRole('option').map((option) => option.textContent);
    expect(options).toEqual([
      'Choose', 'RES · Residential', 'COM · Commercial', 'IND · Industrial', 'INS · Institutional (mosques too)', 'REC · Recreational',
      'AGR · Agricultural', 'UTL · Utility', 'MIX · Mixed-use',
    ]);
  });

  it('takes the initials from a client that has them, and locks the field', async () => {
    const { sheet } = await openSheet((state) => {
      state.clients.cli_001.initials = 'GCH';
    });
    await userEvent.selectOptions(within(sheet).getByLabelText('Client'), 'Gulf Crest Holding');
    const initials = within(sheet).getByLabelText('Client initials');
    await waitFor(() => expect(initials).toHaveValue('GCH'));
    expect(initials).toHaveAttribute('readonly');
    expect(within(sheet).getByText('From the client. The Admin changes them in Clients.')).toBeInTheDocument();
  });

  it('saves the typed initials on a client that has none', async () => {
    const { sheet, store } = await openSheet();
    await userEvent.type(within(sheet).getByLabelText('Name'), 'Dune Offices');
    await userEvent.selectOptions(within(sheet).getByLabelText('Client'), 'Dune Line Developments');
    expect(within(sheet).getByText('The client gets these initials too.')).toBeInTheDocument();
    await userEvent.type(within(sheet).getByLabelText('Client initials'), 'DLD');
    await userEvent.selectOptions(within(sheet).getByLabelText('Classification'), 'COM');
    await userEvent.type(within(sheet).getByLabelText('Building type'), 'Offices');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(named(store, 'Dune Offices')?.code).toBe('260900DLD-COM-Offices'));
    expect(store.state.clients.cli_002.initials).toBe('DLD');
  });

  it('takes a full code typed by hand', async () => {
    const { sheet, store } = await openSheet();
    await userEvent.type(within(sheet).getByLabelText('Name'), 'Old Mosque');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Type the code by hand' }));
    expect(within(sheet).queryByLabelText('Client initials')).toBeNull();
    await userEvent.type(within(sheet).getByLabelText('Full project code'), '250311azt-ins-Mosque');
    expect(within(sheet).getByLabelText('Full project code')).toHaveValue('250311AZT-INS-Mosque');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(named(store, 'Old Mosque')?.code).toBe('250311AZT-INS-Mosque'));
  });

  it('refuses a wrong typed code under its field', async () => {
    const { sheet } = await openSheet();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Type the code by hand' }));
    await userEvent.type(within(sheet).getByLabelText('Full project code'), '250311AZT-XYZ-Mosque');
    await userEvent.tab();
    expect(within(sheet).getByText('Use a code like 260902AZT-RES-Villa.')).toBeInTheDocument();
  });

  it('says so when a typed code takes the series of another contract', async () => {
    const { sheet } = await openSheet((state) => {
      state.projects.prj_003.code = '250311BAY-COM-Shop';
    });
    await userEvent.type(within(sheet).getByLabelText('Name'), 'Old Mosque');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Type the code by hand' }));
    await userEvent.type(within(sheet).getByLabelText('Full project code'), '250311AZT-INS-Mosque');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create project' }));
    expect(await screen.findByText('Another contract has this month and series. Check the code.')).toBeInTheDocument();
  });

  it('copies the code of a project of the same contract', async () => {
    const { sheet, store } = await openSheet((state) => {
      state.projects.prj_003.code = '250311AZT-INS-Mosque';
    });
    await userEvent.type(within(sheet).getByLabelText('Name'), 'Mosque annex');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Same contract as another project' }));
    await userEvent.selectOptions(within(sheet).getByLabelText('The project of the same contract'), '250311AZT · Eastern Shore Primary School');
    expect(preview(sheet)).toBe('250311AZT-INS-Mosque');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(named(store, 'Mosque annex')?.code).toBe('250311AZT-INS-Mosque'));
  });

  it('goes back to the parts from a typed code', async () => {
    const { sheet } = await openSheet();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Type the code by hand' }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Make the code from its parts' }));
    expect(within(sheet).getByLabelText('Client initials')).toBeInTheDocument();
  });
});

describe('the client form in the new-project form (item 1)', () => {
  it('shows every message after a press on Add, and adds nothing', async () => {
    const { sheet, store } = await openSheet();
    await userEvent.click(within(sheet).getByRole('button', { name: 'New client' }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Add client' }));
    expect(within(sheet).getByText('Write the client name in English or in Arabic.')).toBeInTheDocument();
    expect(within(sheet).getByLabelText('English name (or Arabic)')).toHaveAttribute('aria-invalid', 'true');
    expect(within(sheet).getByLabelText('Arabic name (or English)')).toHaveAttribute('aria-invalid', 'true');
    expect(within(sheet).getByLabelText('Initials')).toHaveAttribute('aria-invalid', 'true');
    expect(Object.keys(store.state.clients)).toHaveLength(6);
  });

  it('checks the email when the person leaves it', async () => {
    const { sheet } = await openSheet();
    await userEvent.click(within(sheet).getByRole('button', { name: 'New client' }));
    await userEvent.type(within(sheet).getByLabelText('Email'), 'owner at villa');
    expect(within(sheet).queryByText('Enter a valid email, or leave it empty.')).toBeNull();
    await userEvent.tab();
    expect(within(sheet).getByText('Enter a valid email, or leave it empty.')).toBeInTheDocument();
  });

  it('warns when another client has the same initials, and still adds the client', async () => {
    const { sheet, store } = await openSheet((state) => {
      state.clients.cli_001.initials = 'GCH';
    });
    await userEvent.click(within(sheet).getByRole('button', { name: 'New client' }));
    await userEvent.type(within(sheet).getByLabelText('English name (or Arabic)'), 'Gulf Coast Homes');
    await userEvent.type(within(sheet).getByLabelText('Initials'), 'gch');
    expect(within(sheet).getByRole('status')).toHaveTextContent('Gulf Crest Holding has these initials too.');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Add client' }));
    await waitFor(() => expect(Object.values(store.state.clients).find((c) => c.name === 'Gulf Coast Homes')?.initials).toBe('GCH'));
  });
});
