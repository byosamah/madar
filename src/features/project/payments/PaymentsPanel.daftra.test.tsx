import { describe, expect, it } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

/**
 * The Daftra link in the prototype (owner, 2026-10-26). The prototype has no Daftra: daftra.status says "not ready", so no Daftra part
 * shows. A payment that carries a link (a test sets one) still shows its Invoiced sign, and the sheet still shows the linked lines, so the
 * words and the signs stay testable here. The states 0 to 4 need a ready Daftra: see PaymentSheet.daftra.remote.test.tsx.
 */
const PROJECT = '/projects/prj_001';
// Turki (usr_010) is Management: he sees payments and holds no Daftra switch. Noura (usr_011) is Accounting and holds it.
const LINKED = { account: 'MAZJ', invoiceId: '1830', invoiceNo: '1521945', total: 360000, issuedOn: '2026-09-29', linkedBy: 'usr_011', linkedAt: '2026-09-29T10:00:00.000+03:00' };

const prepare = (userId: string, ...linked: string[]) => (state: State) => {
  state.session.currentUserId = userId;
  for (const payment of Object.values(state.payments ?? {})) if (linked.includes(payment.name)) payment.daftra = { ...LINKED };
};
const panel = () => screen.findByRole('region', { name: 'Payments' }, { timeout: 8000 });
const sheetOf = (name: string) => screen.findByRole('dialog', { name }, { timeout: 8000 });
const settle = () => act(() => new Promise<void>((resolve) => { window.setTimeout(resolve, 30); }));
async function openSheet(name: string) {
  await userEvent.click(await within(await panel()).findByRole('button', { name: `Open payment ${name}` }));
  const sheet = await sheetOf('Edit payment');
  await settle();
  return sheet;
}

describe('the Invoiced sign in the Payments panel', () => {
  it('shows Invoiced, with its own shape, on a linked payment that is not received, and keeps the other signs', async () => {
    await renderApp(PROJECT, prepare('usr_011', 'Construction documents fee', 'Concept stage fee'));
    const rows = await within(await panel()).findAllByRole('listitem');
    const row = (name: string) => rows.find((item) => within(item).queryByText(name)) as HTMLElement;
    expect(within(row('Construction documents fee')).getByText('Invoiced')).toBeInTheDocument();
    expect(row('Construction documents fee').querySelector('[data-sign="invoiced"]')).not.toBeNull();
    expect(within(row('Construction documents fee')).queryByText('Awaiting')).toBeNull();
    // A linked payment that Daftra marked received keeps the Received sign. An unlinked overdue payment keeps its own sign.
    expect(within(row('Concept stage fee')).getByText('Received 18 Jun')).toBeInTheDocument();
    expect(within(row('Concept stage fee')).queryByText('Invoiced')).toBeNull();
    expect(within(row('Design development fee')).getByText('Overdue')).toBeInTheDocument();
    expect(within(row('Design development fee')).queryByText('Invoiced')).toBeNull();
  });

  it('shows Invoiced to Management too, who may see payments', async () => {
    await renderApp(PROJECT, prepare('usr_010', 'Construction documents fee'));
    expect(await within(await panel()).findByText('Invoiced')).toBeInTheDocument();
  });
});

describe('the payment sheet with no Daftra (the prototype)', () => {
  it('shows no Daftra part to Accounting while daftra.status says not ready, and keeps Mark as received', async () => {
    await renderApp(PROJECT, prepare('usr_011'));
    const sheet = await openSheet('Construction documents fee');
    expect(within(sheet).queryByText('Daftra')).toBeNull();
    expect(within(sheet).queryByRole('button', { name: 'Link this invoice' })).toBeNull();
    expect(within(sheet).queryByRole('textbox', { name: 'Client name in Daftra' })).toBeNull();
    expect(within(sheet).getByRole('button', { name: 'Mark as received' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Save' })).toHaveClass('signature');
  });

  it('shows the Add payment sheet with no Daftra part', async () => {
    await renderApp(PROJECT, prepare('usr_011'));
    await userEvent.click(within(await panel()).getByRole('button', { name: 'Add payment' }));
    const sheet = await sheetOf('Add payment');
    await settle();
    expect(within(sheet).queryByText('Daftra')).toBeNull();
  });
});

describe('a linked payment in the sheet', () => {
  it('shows Management the read-only lines, and no Link, no Unlink and no Mark as received', async () => {
    await renderApp(PROJECT, prepare('usr_010', 'Construction documents fee'));
    const sheet = await openSheet('Construction documents fee');
    expect(within(sheet).getByText('Invoiced: invoice 1521945.')).toBeInTheDocument();
    expect(within(sheet).getByText('Daftra sets Received when it is paid.')).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'Unlink' })).toBeNull();
    expect(within(sheet).queryByRole('button', { name: 'Link this invoice' })).toBeNull();
    expect(within(sheet).queryByRole('button', { name: 'Mark as received' })).toBeNull();
  });

  it('shows Management the invoice of a payment that Daftra marked received', async () => {
    await renderApp(PROJECT, prepare('usr_010', 'Concept stage fee'));
    const sheet = await openSheet('Concept stage fee');
    expect(within(sheet).getByText('Invoice 1521945 is paid in Daftra.')).toBeInTheDocument();
    expect(within(sheet).queryByText('Daftra sets Received when it is paid.')).toBeNull();
    expect(within(sheet).queryByRole('button', { name: 'Unlink' })).toBeNull();
  });

  it('shows both amounts when the invoice total is not the payment amount', async () => {
    await renderApp(PROJECT, (state) => {
      prepare('usr_010', 'Construction documents fee')(state);
      for (const payment of Object.values(state.payments ?? {})) if (payment.daftra) payment.daftra.total = 150000;
    });
    const sheet = await openSheet('Construction documents fee');
    expect(within(sheet).getByText(/The invoice total is SAR 150,000\. The payment is SAR \d/)).toBeInTheDocument();
  });

  it('lets Accounting unlink with an Undo toast, and Undo puts the link back', async () => {
    const { store } = await renderApp(PROJECT, prepare('usr_011', 'Construction documents fee'));
    const sheet = await openSheet('Construction documents fee');
    expect(within(sheet).queryByRole('button', { name: 'Mark as received' })).toBeNull();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Unlink' }));
    expect(await screen.findByText('Invoice 1521945 is unlinked.')).toBeInTheDocument();
    const payment = () => Object.values(store.state.payments ?? {}).find((item) => item.name === 'Construction documents fee');
    await waitFor(() => expect(payment()?.daftra).toBeUndefined());
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit payment' })).toBeNull());
    expect(await within(await panel()).findAllByText('Awaiting')).not.toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(payment()?.daftra?.invoiceId).toBe('1830'));
    expect(await within(await panel()).findByText('Invoiced')).toBeInTheDocument();
  });

  it('shows Accounting the unlink beside a payment that Daftra marked received', async () => {
    await renderApp(PROJECT, prepare('usr_011', 'Concept stage fee'));
    const sheet = await openSheet('Concept stage fee');
    expect(within(sheet).getByText('Invoice 1521945 is paid in Daftra.')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Unlink' })).toBeInTheDocument();
  });
});
