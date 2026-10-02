import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { recordTrackerHistory } from '../../../data/seed';
import { renderApp } from '../../../test/render';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const TRACKER = '/projects/prj_001?tab=tracker';
const QUESTION = 'The client asked to move the lobby entrance';
const ASKED = 'Asked the client for the signed fee agreement';

// Faisal (usr_002) leads prj_001. Sara (usr_005) is on its team. The sample day is Wednesday 30 September 2026.
const entriesOf = (state: State, title: string) => Object.values(state.tracker ?? {}).filter((e) => e.title === title);

const SIDES = ['From the client', 'To the client', 'Both sides', 'Third party', 'None'];
const sideButtons = () => SIDES.filter((name) => screen.queryByRole('radio', { name }));

describe('the Tracker tab: types, sides and replies', () => {
  it('logs an "Other" entry with no side by default', async () => {
    const { store } = await renderApp(TRACKER, as('usr_002'));
    await userEvent.click(await screen.findByRole('radio', { name: 'Other' }));
    expect(sideButtons()).toEqual(['From the client', 'To the client', 'Both sides', 'None']);
    expect(screen.getByRole('radio', { name: 'None' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.type(screen.getByRole('textbox', { name: 'Log an exchange' }), 'A neighbour phoned{Enter}');
    await waitFor(() => expect(entriesOf(store.state, 'A neighbour phoned')).toHaveLength(1));
    expect(entriesOf(store.state, 'A neighbour phoned')[0]).toMatchObject({ type: 'other', direction: 'none' });
  });

  it('shows the side choices that fit each type, and none for a meeting or a Balady update', async () => {
    const { store } = await renderApp(TRACKER, as('usr_002'));
    await screen.findByRole('radio', { name: 'Message' });
    expect(sideButtons()).toEqual(['From the client', 'To the client']);
    await userEvent.click(screen.getByRole('radio', { name: 'Meeting' }));
    expect(sideButtons()).toEqual([]);
    expect(screen.queryByRole('radiogroup', { name: 'Direction' })).not.toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: 'Log an exchange' }), 'Site meeting{Enter}');
    await waitFor(() => expect(entriesOf(store.state, 'Site meeting')).toHaveLength(1));
    expect(entriesOf(store.state, 'Site meeting')[0]).toMatchObject({ type: 'meeting', direction: 'both' });
    await userEvent.click(screen.getByRole('radio', { name: 'Balady' }));
    expect(sideButtons()).toEqual([]);
    await userEvent.type(screen.getByRole('textbox', { name: 'Log an exchange' }), 'Permit moved{Enter}');
    await waitFor(() => expect(entriesOf(store.state, 'Permit moved')).toHaveLength(1));
    expect(entriesOf(store.state, 'Permit moved')[0]).toMatchObject({ type: 'balady', direction: 'third_party' });
    await userEvent.click(screen.getByRole('radio', { name: 'File' }));
    expect(sideButtons()).toEqual(['From the client', 'To the client']);
  });

  it('keeps a message or file side when the type switches between them, and resets it for another type', async () => {
    await renderApp(TRACKER, as('usr_002'));
    await userEvent.click(await screen.findByRole('radio', { name: 'To the client' }));
    await userEvent.click(screen.getByRole('radio', { name: 'File' }));
    expect(screen.getByRole('radio', { name: 'To the client' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByRole('radio', { name: 'Other' }));
    expect(screen.getByRole('radio', { name: 'None' })).toHaveAttribute('aria-checked', 'true');
  });

  it('asks "Who replies?" and "Reply by" only with "Needs a reply"', async () => {
    const { store } = await renderApp(TRACKER, as('usr_005'));
    await screen.findByRole('switch', { name: 'Needs a reply' });
    expect(screen.queryByLabelText('Who replies?')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Reply by')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('switch', { name: 'Needs a reply' }));
    // The person who logs replies by default. Two working days from Wednesday 30 September is Sunday 4 October.
    expect(screen.getByLabelText('Who replies?')).toHaveValue('usr_005');
    expect(screen.getByLabelText('Reply by')).toHaveValue('2026-10-04');
    await userEvent.selectOptions(screen.getByLabelText('Who replies?'), 'usr_002');
    fireEvent.change(screen.getByLabelText('Reply by'), { target: { value: '2026-10-06' } });
    await userEvent.type(screen.getByRole('textbox', { name: 'Log an exchange' }), 'Can the lobby move?{Enter}');
    await waitFor(() => expect(entriesOf(store.state, 'Can the lobby move?')).toHaveLength(1));
    const entry = entriesOf(store.state, 'Can the lobby move?')[0];
    expect(store.state.tasks[entry.replyTaskId!]).toMatchObject({ title: 'Reply: Can the lobby move?', ownerId: 'usr_002', dueDate: '2026-10-06', trackerEntryId: entry.id });
    // The fields go away after the save, and they do not show when the side is to the client.
    expect(screen.queryByLabelText('Who replies?')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'To the client' }));
    await userEvent.click(screen.getByRole('switch', { name: 'Waiting for the client' }));
    expect(screen.queryByLabelText('Who replies?')).not.toBeInTheDocument();
  });

  it('offers "Assign a reply" in the sheet of an open entry that waits for our reply', async () => {
    const { store } = await renderApp(TRACKER, as('usr_002'));
    const loops = await screen.findByRole('group', { name: 'Waiting for our reply' });
    await userEvent.click(within(loops).getByRole('button', { name: `Open ${QUESTION}` }));
    await userEvent.click(await screen.findByRole('button', { name: 'Assign a reply' }));
    expect(screen.getByLabelText('Reply by')).toHaveValue('2026-10-04');
    await userEvent.selectOptions(screen.getByLabelText('Who replies?'), 'usr_005');
    await userEvent.click(screen.getByRole('button', { name: 'Assign' }));
    const entry = entriesOf(store.state, QUESTION)[0];
    await waitFor(() => expect(entry.replyTaskId).toBeDefined());
    expect(store.state.tasks[entry.replyTaskId!]).toMatchObject({ ownerId: 'usr_005', dueDate: '2026-10-04' });
    // The sheet now names the task and the button is gone.
    expect(await screen.findByText('Reply task')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Assign a reply' })).not.toBeInTheDocument();
  });

  it('does not offer "Assign a reply" for an entry that waits for the client', async () => {
    await renderApp(TRACKER, as('usr_002'));
    const client = await screen.findByRole('group', { name: 'Waiting for the client' });
    await userEvent.click(within(client).getByRole('button', { name: `Open ${ASKED}` }));
    await screen.findByRole('button', { name: 'Edit' });
    expect(screen.queryByRole('button', { name: 'Assign a reply' })).not.toBeInTheDocument();
  });
});

describe('the Tracker tab: export', () => {
  const FORMULA = '=SUM(1+1)';
  const prepare = (state: State) => {
    as('usr_002')(state);
    const first = Object.values(state.tracker!).find((e) => e.projectId === 'prj_001')!;
    const entry = { ...first, id: 'trk_900', title: FORMULA, createdAt: '2026-09-30T08:30:15.000+03:00' };
    state.tracker!.trk_900 = entry;
    recordTrackerHistory(state, entry);
  };
  const openSheet = async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Export' }));
    const sheet = await screen.findByRole('dialog', { name: 'Export the log' });
    await within(sheet).findByRole('region', { name: 'Preview' });
    return sheet;
  };

  it('opens the sheet "Export the log" with a preview and the two actions, and says that the review link blocks downloads', async () => {
    await renderApp(TRACKER, prepare);
    const sheet = await openSheet();
    const preview = within(sheet).getByRole('region', { name: 'Preview' });
    expect(within(preview).getAllByRole('listitem')).toHaveLength(5);
    expect(within(sheet).getByText(/^\d+ events$/)).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Download CSV' })).toBeEnabled();
    expect(within(sheet).getByRole('button', { name: 'Copy as a table' })).toBeEnabled();
    expect(within(sheet).getByText(/review link blocks downloads/i)).toBeInTheDocument();
  });

  it('copies tab-separated text with the formula guard from the click, and shows a toast', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await renderApp(TRACKER, prepare);
    const sheet = await openSheet();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Copy as a table' }));
    expect(writeText).toHaveBeenCalledTimes(1);
    const lines = (writeText.mock.calls[0][0] as string).split('\n');
    expect(lines[0]).toBe('Date\tTime\tEvent\tLogged by\tType\tSide\tTitle\tNote\tFiles\tAutomatic');
    const formulaLine = lines.find((line) => line.includes(FORMULA))!;
    expect(formulaLine.split('\t')).toEqual(['2026-09-30', '08:30:15', 'Entry logged', expect.any(String), expect.any(String), expect.any(String), `'${FORMULA}`, expect.any(String), expect.any(String), expect.any(String)]);
    expect(await screen.findByText(/Copied\./)).toBeInTheDocument();
  });

  it('shows a toast when the browser refuses to copy', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, configurable: true });
    await renderApp(TRACKER, prepare);
    const sheet = await openSheet();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Copy as a table' }));
    expect(await screen.findByText('The browser did not allow copying. Use Download instead.')).toBeInTheDocument();
  });

  it('downloads a CSV file that starts with a byte order mark and guards the formula', async () => {
    const blobs: Blob[] = [];
    Object.defineProperty(URL, 'createObjectURL', { value: (blob: Blob) => { blobs.push(blob); return 'blob:csv'; }, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: () => undefined, configurable: true });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await renderApp(TRACKER, prepare);
    const sheet = await openSheet();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Download CSV' }));
    expect(click).toHaveBeenCalledTimes(1);
    const bytes = new Uint8Array(await new Promise<ArrayBuffer>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.readAsArrayBuffer(blobs[0]);
    }));
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
    expect(text.startsWith('﻿Date,Time,Event,Logged by,Type,Side,Title,Note,Files,Automatic\r\n')).toBe(true);
    expect(text).toContain(`'${FORMULA}`);
    expect(text).not.toMatch(/,=SUM/);
    click.mockRestore();
  });
});
