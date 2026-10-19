import { describe, expect, it } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type { State } from '../api/store';
import { NewProjectSheet } from '../features/projects/NewProjectSheet';
import { renderApp, renderWithRuntime } from '../test/render';

// The owner (2026-10-05): "fix visuals for unset date to not be overwhelming and bulky, make it show a 'Set date...' in a light grey
// color and the alignment". The forms that save with their own button now use DateField, so no form shows the native dd/mm/yyyy.

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};

/** The date field of a label: the real date input, under the quiet look. */
const quiet = (root: HTMLElement, label: string) => {
  const field = within(root).getByLabelText(label);
  expect(field).toHaveAttribute('type', 'date');
  expect(field).not.toHaveClass('field');
  return field;
};

/** The quiet text that shows for a date field. */
const shownFor = (field: HTMLElement) => field.parentElement?.querySelector('span[aria-hidden]')?.textContent;

function NewProject() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Start</button>
      <NewProjectSheet open={open} onOpenChange={setOpen} />
    </>
  );
}

describe('the dates of the forms show "Set date…" (owner, 2026-10-05)', () => {
  it('the new project form: three quiet dates, and the start and end dates in two equal columns', async () => {
    await renderWithRuntime(<NewProject />, undefined, { path: '/' });
    await userEvent.click(screen.getByText('Start'));
    const sheet = await screen.findByRole('dialog', { name: 'New Project' });
    const contract = quiet(sheet, 'Contract start date');
    const start = quiet(sheet, 'Start date');
    const end = quiet(sheet, 'Target end date');
    for (const field of [contract, start, end]) expect(shownFor(field)).toBe('Set date…');
    fireEvent.change(start, { target: { value: '2026-10-12' } });
    expect(shownFor(start)).toBe('12 Oct');
    // The pair sits in one grid of two columns at every width, so the two dates line up.
    const pair = start.closest('.grid');
    expect(pair).toBe(end.closest('.grid'));
    expect(pair).toHaveClass('grid-cols-2');
    expect(within(sheet).getByRole('button', { name: 'Clear Start date' })).toBeInTheDocument();
  });

  it('the payment sheet: a due date the form needs has no clear control, the received date has one', async () => {
    await renderApp('/projects/prj_001', as('usr_011'));
    await userEvent.click(within(await screen.findByRole('region', { name: 'Payments' })).getByRole('button', { name: 'Add payment' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add payment' });
    const due = quiet(sheet, 'Due date');
    const received = quiet(sheet, 'Received on');
    expect(shownFor(due)).toBe('Set date…');
    expect(shownFor(received)).toBe('Set date…');
    fireEvent.change(due, { target: { value: '2026-11-15' } });
    fireEvent.change(received, { target: { value: '2026-09-28' } });
    expect(shownFor(due)).toBe('15 Nov');
    expect(within(sheet).queryByRole('button', { name: 'Clear Due date' })).toBeNull();
    expect(within(sheet).getByRole('button', { name: 'Clear Received on' })).toBeInTheDocument();
    expect(due.closest('.grid')).toHaveClass('grid-cols-2');
  });

  it('the deadline form and the pause sheet', async () => {
    await renderApp('/projects/prj_001?tab=schedule', as('usr_002'));
    const deadlines = await screen.findByRole('region', { name: 'Deadlines' });
    expect(shownFor(quiet(deadlines, 'Date'))).toBe('Set date…');
    await userEvent.click(await screen.findByRole('button', { name: 'More actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Pause project' }));
    const sheet = await screen.findByRole('dialog', { name: 'Pause this project?' });
    // fbk_025: the date reads as a reminder, with one hint line that says Madar does not restart the project by itself.
    const resume = quiet(sheet, 'Remind me to restart on (optional)');
    expect(shownFor(resume)).toBe('Set date…');
    expect(within(sheet).getByText('Madar does not restart the project by itself. On this day, you and the project leader get a notice.')).toBeInTheDocument();
    // The picker still starts from tomorrow.
    expect(resume).toHaveAttribute('min', '2026-10-01');
  });
});
