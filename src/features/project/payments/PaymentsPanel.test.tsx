import { describe, expect, it } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { initI18n } from '../../../i18n';
import { renderApp } from '../../../test/render';
import { amountText } from './PaymentsPanel';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const PROJECT = '/projects/prj_001';
// Turki (usr_010) is Management. Noura (usr_011) is Accounting. Faisal (usr_002) leads prj_001. Sara (usr_005) is on its team.
// prj_001 has four milestones: two received, one overdue (due 18 Sep) and one in 40 days. prj_002 has one due in 4 days.
const panel = () => screen.findByRole('region', { name: 'Payments' });
const sheetOf = (name: string) => screen.findByRole('dialog', { name });

describe('the Payments panel', () => {
  it.each([['Management', 'usr_010'], ['Accounting', 'usr_011'], ['Admin', 'usr_001']])('shows the milestones to %s with the amount, the due date and the state', async (_role, user) => {
    await renderApp(PROJECT, as(user));
    const region = await panel();
    const rows = await within(region).findAllByRole('listitem');
    expect(rows).toHaveLength(4);
    expect(within(rows[0]).getByText('Concept stage fee')).toBeInTheDocument();
    expect(within(rows[0]).getByText('SAR 180,000')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Due 12 Jun')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Received 18 Jun')).toBeInTheDocument();
    expect(rows[0].querySelector('[data-sign="completed"]')).not.toBeNull();
    expect(within(rows[2]).getByText('Design development fee')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Overdue')).toBeInTheDocument();
    expect(rows[2].querySelector('[data-sign="late"]')).not.toBeNull();
    expect(within(rows[3]).getByText('Awaiting')).toBeInTheDocument();
    expect(rows[3].querySelector('[data-sign="active"]')).not.toBeNull();
    expect(within(region).getByText('SAR 420,000 of SAR 1,100,000 received')).toBeInTheDocument();
  });

  it.each([['a member', 'usr_005'], ['the project leader', 'usr_002'], ['an outsider', 'usr_003']])('is not on the page for %s, and the Needs attention panel has no payment group', async (_who, user) => {
    const { store } = await renderApp(PROJECT, as(user));
    await screen.findByRole('region', { name: 'Needs attention' });
    await within(screen.getByRole('region', { name: 'Where the project stands' })).findByText('Construction Documents');
    expect(screen.queryByRole('region', { name: 'Payments' })).toBeNull();
    expect(screen.queryByText('Awaiting payment')).toBeNull();
    expect(screen.queryByText('Design development fee')).toBeNull();
    expect(document.body.textContent).not.toMatch(/SAR \d/);
    expect(Object.keys(store.state.payments ?? {}).length).toBeGreaterThan(0);
  });

  it('adds a payment with one button and a sheet', async () => {
    const { store } = await renderApp(PROJECT, as('usr_011'));
    await userEvent.click(within(await panel()).getByRole('button', { name: 'Add payment' }));
    const sheet = await sheetOf('Add payment');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    expect(within(sheet).getByText('Enter a name.')).toBeInTheDocument();
    expect(within(sheet).getByText('Enter an amount above zero.')).toBeInTheDocument();
    expect(within(sheet).getByText('Choose a due date.')).toBeInTheDocument();
    await userEvent.type(within(sheet).getByLabelText('Name'), 'Tender stage fee');
    await userEvent.type(within(sheet).getByLabelText('Amount (SAR)'), '85,500');
    fireEvent.change(within(sheet).getByLabelText('Due date'), { target: { value: '2026-11-15' } });
    await userEvent.type(within(sheet).getByLabelText('Note'), 'Invoice 31');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(Object.values(store.state.payments ?? {}).some((p) => p.name === 'Tender stage fee')).toBe(true));
    expect(Object.values(store.state.payments ?? {}).find((p) => p.name === 'Tender stage fee')).toMatchObject({
      projectId: 'prj_001', amount: 85500, dueDate: '2026-11-15', receivedOn: null, note: 'Invoice 31', createdBy: 'usr_011',
    });
    expect(await screen.findByText('Payment added.')).toBeInTheDocument();
    expect(await within(await panel()).findByText('SAR 85,500')).toBeInTheDocument();
  });

  it('edits a payment from its row', async () => {
    const { store } = await renderApp(PROJECT, as('usr_010'));
    await userEvent.click(await within(await panel()).findByRole('button', { name: 'Open payment Construction documents fee' }));
    const sheet = await sheetOf('Edit payment');
    expect(within(sheet).getByLabelText('Name')).toHaveValue('Construction documents fee');
    const amount = within(sheet).getByLabelText('Amount (SAR)');
    await userEvent.clear(amount);
    await userEvent.type(amount, '350000');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(Object.values(store.state.payments ?? {}).find((p) => p.name === 'Construction documents fee')?.amount).toBe(350000));
    expect(await screen.findByText('Payment saved.')).toBeInTheDocument();
  });

  it('marks a payment as received from its row, then Undo brings the old state back', async () => {
    const { store } = await renderApp(PROJECT, as('usr_011'));
    await userEvent.click(await within(await panel()).findByRole('button', { name: 'Open payment Design development fee' }));
    const sheet = await sheetOf('Edit payment');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Mark as received' }));
    const find = () => Object.values(store.state.payments ?? {}).find((p) => p.name === 'Design development fee');
    await waitFor(() => expect(find()?.receivedOn).toBe('2026-09-30'));
    expect(await within(await panel()).findByText('Received 30 Sept')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(find()?.receivedOn).toBeNull());
  });

  it('deletes a payment, then Undo brings it back', async () => {
    const { store } = await renderApp(PROJECT, as('usr_011'));
    await userEvent.click(await within(await panel()).findByRole('button', { name: 'Open payment Construction documents fee' }));
    const sheet = await sheetOf('Edit payment');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Delete' }));
    const names = () => Object.values(store.state.payments ?? {}).map((p) => p.name);
    await waitFor(() => expect(names()).not.toContain('Construction documents fee'));
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(names()).toContain('Construction documents fee'));
  });

  it('refuses a received date in the future under its field', async () => {
    await renderApp(PROJECT, as('usr_011'));
    await userEvent.click(await within(await panel()).findByRole('button', { name: 'Open payment Construction documents fee' }));
    const sheet = await sheetOf('Edit payment');
    fireEvent.change(within(sheet).getByLabelText('Received on'), { target: { value: '2026-12-01' } });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    expect(within(sheet).getByText('The received date cannot be in the future.')).toBeInTheDocument();
  });

  it('writes the amount with Western digits in Arabic', () => {
    const i18n = initI18n('ar');
    try {
      expect(amountText(i18n.t, 'ar', 120000)).toBe('120,000 ر.س');
      expect(amountText(i18n.t, 'ar', 1250.5)).toBe('1,250.5 ر.س');
    } finally {
      initI18n('en');
    }
    expect(amountText(i18n.t, 'en', 120000)).toBe('SAR 120,000');
  });
});

describe('the Awaiting payment group in Needs attention', () => {
  it('lists an overdue milestone, for Management and Accounting', async () => {
    for (const user of ['usr_010', 'usr_011']) {
      const view = await renderApp(PROJECT, as(user));
      const attention = await screen.findByRole('region', { name: 'Needs attention' });
      const group = (await within(attention).findByRole('heading', { name: /^Awaiting payment/ })).parentElement as HTMLElement;
      expect(within(group).getByText('Design development fee')).toBeInTheDocument();
      expect(within(group).getByText('SAR 320,000')).toBeInTheDocument();
      expect(within(group).getByText('12 days past due')).toBeInTheDocument();
      // The milestone due in 40 days and the received ones stay out.
      expect(within(group).queryByText('Construction documents fee')).toBeNull();
      expect(within(group).queryByText('Concept stage fee')).toBeNull();
      view.unmount();
    }
  });

  it('lists a milestone due within a week, and opens it', async () => {
    await renderApp('/projects/prj_002', as('usr_011'));
    const attention = await screen.findByRole('region', { name: 'Needs attention' });
    const group = (await within(attention).findByRole('heading', { name: /^Awaiting payment/ })).parentElement as HTMLElement;
    expect(within(group).getByText('Schematic design fee')).toBeInTheDocument();
    expect(within(group).getByText('In 4 days')).toBeInTheDocument();
    await userEvent.click(within(group).getByRole('button', { name: /Schematic design fee/ }));
    expect(await sheetOf('Edit payment')).toBeInTheDocument();
  });

  it('is not there when nothing is overdue or due soon', async () => {
    await renderApp('/projects/prj_003', as('usr_011'));
    await screen.findByRole('region', { name: 'Needs attention' });
    await within(await panel()).findAllByRole('listitem');
    expect(screen.queryByRole('heading', { name: /^Awaiting payment/ })).toBeNull();
  });
});

// A sheet closed by accident (Escape, a press outside, Close) keeps what the person typed. Only Save and Cancel start from the
// saved values again: the same rule as the New Project sheet (audit 2026-10-03, F-17).
describe('the payment sheet keeps what the person typed (audit 2026-10-03, F-17)', () => {
  const sheetGone = (name: string) => waitFor(() => expect(screen.queryByRole('dialog', { name })).toBeNull());
  async function typeNew() {
    await userEvent.click(within(await panel()).getByRole('button', { name: 'Add payment' }));
    const sheet = await sheetOf('Add payment');
    await userEvent.type(within(sheet).getByLabelText('Name'), 'Concept design fee');
    await userEvent.type(within(sheet).getByLabelText('Amount (SAR)'), '25000');
    return sheet;
  }
  async function reopenNew() {
    await userEvent.click(within(await panel()).getByRole('button', { name: 'Add payment' }));
    return sheetOf('Add payment');
  }

  it('keeps a new payment after Escape, and Cancel empties it', async () => {
    await renderApp(PROJECT, as('usr_011'));
    await typeNew();
    await userEvent.keyboard('{Escape}');
    await sheetGone('Add payment');
    const again = await reopenNew();
    expect(within(again).getByLabelText('Name')).toHaveValue('Concept design fee');
    expect(within(again).getByLabelText('Amount (SAR)')).toHaveValue('25000');
    await userEvent.click(within(again).getByRole('button', { name: 'Cancel' }));
    await sheetGone('Add payment');
    const fresh = await reopenNew();
    expect(within(fresh).getByLabelText('Name')).toHaveValue('');
    expect(within(fresh).getByLabelText('Amount (SAR)')).toHaveValue('');
  });

  it('keeps a new payment after a press outside and after Close', async () => {
    await renderApp(PROJECT, as('usr_011'));
    await typeNew();
    // Radix waits 0 ms before it listens for presses.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);
    await sheetGone('Add payment');
    const again = await reopenNew();
    expect(within(again).getByLabelText('Name')).toHaveValue('Concept design fee');
    await userEvent.click(within(again).getByRole('button', { name: 'Close' }));
    await sheetGone('Add payment');
    expect(within(await reopenNew()).getByLabelText('Amount (SAR)')).toHaveValue('25000');
  });

  it('keeps an edit of a saved payment after Escape, for that payment only', async () => {
    const { store } = await renderApp(PROJECT, as('usr_011'));
    const openRow = async (name: string) => {
      await userEvent.click(await within(await panel()).findByRole('button', { name: `Open payment ${name}` }));
      return sheetOf('Edit payment');
    };
    const sheet = await openRow('Construction documents fee');
    const amount = within(sheet).getByLabelText('Amount (SAR)');
    await userEvent.clear(amount);
    await userEvent.type(amount, '375000');
    await userEvent.type(within(sheet).getByLabelText('Note'), 'Client asked for a split');
    await userEvent.keyboard('{Escape}');
    await sheetGone('Edit payment');
    const other = await openRow('Design development fee');
    expect(within(other).getByLabelText('Amount (SAR)')).toHaveValue('320000');
    await userEvent.keyboard('{Escape}');
    await sheetGone('Edit payment');
    const again = await openRow('Construction documents fee');
    expect(within(again).getByLabelText('Amount (SAR)')).toHaveValue('375000');
    expect(within(again).getByLabelText('Note')).toHaveValue('Client asked for a split');
    expect(Object.values(store.state.payments ?? {}).find((p) => p.name === 'Construction documents fee')?.amount).toBe(360000);
  });

  it('starts the next new payment empty after Save', async () => {
    await renderApp(PROJECT, as('usr_011'));
    const sheet = await typeNew();
    fireEvent.change(within(sheet).getByLabelText('Due date'), { target: { value: '2026-11-15' } });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Payment added.')).toBeInTheDocument();
    await sheetGone('Add payment');
    expect(within(await reopenNew()).getByLabelText('Name')).toHaveValue('');
  });
});
