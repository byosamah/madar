import { expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/** Opens the Agenda sheet from the top bar. */
export async function openAgendaSheet(): Promise<HTMLElement> {
  await userEvent.click(screen.getByRole('button', { name: /^Agenda/, hidden: true }));
  return screen.findByRole('dialog', { name: 'Agenda' });
}

/** The summary lives in the Agenda sheet: open the sheet and press "See the meeting summary". */
export async function openSummary() {
  const sheet = await openAgendaSheet();
  await userEvent.click(within(sheet).getByRole('button', { name: 'See the meeting summary' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Agenda' })).toBeNull());
}

/** Big screen is a switch in the Agenda sheet: open the sheet, press the switch, close the sheet. */
export async function pressBigScreen(): Promise<boolean> {
  const sheet = await openAgendaSheet();
  const big = within(sheet).getByRole('switch', { name: 'Big screen' });
  await userEvent.click(big);
  const on = big.getAttribute('aria-checked') === 'true';
  await userEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Agenda' })).toBeNull());
  return on;
}
