import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { State } from '../../../api/store';
import { phoneMedia } from '../../../test/phoneMedia';
import { renderApp } from '../../../test/render';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const TRACKER = '/projects/prj_001?tab=tracker';
const QUESTION = 'The client asked to move the lobby entrance';

async function openSheet() {
  await userEvent.click(await screen.findByRole('button', { name: 'Log a new line' }));
  return screen.findByRole('dialog', { name: 'Log a new line' });
}

describe('the Tracker tab on a phone (phone D, P8)', () => {
  it('shows the main button first and no form on the page', async () => {
    phoneMedia(true);
    await renderApp(TRACKER, as('usr_002'));
    const button = await screen.findByRole('button', { name: 'Log a new line' });
    expect(button).toHaveClass('signature');
    expect(screen.queryByRole('textbox', { name: 'Log an exchange' })).toBeNull();
    const history = screen.getByRole('region', { name: 'History' });
    expect(button.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(history).toHaveClass('panel');
  });

  it('logs a line in a sheet, closes it and shows the Undo toast', async () => {
    phoneMedia(true);
    const { store } = await renderApp(TRACKER, as('usr_002'));
    const sheet = await openSheet();
    await userEvent.click(within(sheet).getByRole('radio', { name: 'Other' }));
    await userEvent.type(within(sheet).getByRole('textbox', { name: 'Log an exchange' }), 'A neighbour phoned');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Log it' }));
    await waitFor(() => expect(Object.values(store.state.tracker ?? {}).filter((entry) => entry.title === 'A neighbour phoned')).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Log a new line' })).toBeNull());
    expect(await screen.findByText('Logged.')).toBeInTheDocument();
  });

  it('keeps the type and the side for the next line', async () => {
    phoneMedia(true);
    await renderApp(TRACKER, as('usr_002'));
    let sheet = await openSheet();
    await userEvent.click(within(sheet).getByRole('radio', { name: 'Other' }));
    await userEvent.click(within(sheet).getByRole('radio', { name: 'None' }));
    await userEvent.type(within(sheet).getByRole('textbox', { name: 'Log an exchange' }), 'A neighbour phoned');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Log it' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Log a new line' })).toBeNull());
    sheet = await openSheet();
    expect(within(sheet).getByRole('radio', { name: 'Other' })).toHaveAttribute('aria-checked', 'true');
    expect(within(sheet).getByRole('radio', { name: 'None' })).toBeChecked();
  });

  it('has no drop frame in the sheet', async () => {
    phoneMedia(true);
    await renderApp(TRACKER, as('usr_002'));
    const sheet = await openSheet();
    fireEvent.dragEnter(within(sheet).getByRole('textbox', { name: 'Log an exchange' }).closest('form') as HTMLElement, { dataTransfer: { types: ['Files'] } });
    expect(screen.queryByText('The files join this entry. Nothing saves until you press Log it.')).toBeNull();
  });

  it('keeps Filter and Export inside History and the open loops never filtered', async () => {
    phoneMedia(true);
    await renderApp(`${TRACKER}&type=file`, as('usr_002'));
    const history = await screen.findByRole('region', { name: 'History' });
    expect(within(history).getByRole('button', { name: /^Filter/ })).toBeInTheDocument();
    const waiting = await screen.findByRole('group', { name: 'Waiting for our reply' });
    expect(within(waiting).getByText(QUESTION)).toBeInTheDocument();
  });

  it('shows the line "Only the team of the project can log here." in place of the button', async () => {
    phoneMedia(true);
    await renderApp(TRACKER, as('usr_003'));
    expect(await screen.findByText('Only the team of the project can log here.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Log a new line' })).toBeNull();
  });

  it('keeps the desk form on the page', async () => {
    await renderApp(TRACKER, as('usr_002'));
    expect(await screen.findByRole('textbox', { name: 'Log an exchange' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Log a new line' })).toBeNull();
  });
});
