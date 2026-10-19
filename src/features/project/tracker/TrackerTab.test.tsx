import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const TRACKER = '/projects/prj_001?tab=tracker';
const QUESTION = 'The client asked to move the lobby entrance';
const ASKED = 'Asked the client for the signed fee agreement';

async function historyReady() {
  const region = await screen.findByRole('region', { name: 'History' });
  await within(region).findAllByRole('listitem');
  return region;
}

// Faisal (usr_002) leads prj_001. Sara (usr_005) is on its team. Reem (usr_003) is not on it.
const entriesOf = (state: State, title: string) => Object.values(state.tracker ?? {}).filter((e) => e.title === title);

describe('the Tracker tab', () => {
  it('shows the open loops in two groups with their age, then the history by week', async () => {
    await renderApp(TRACKER, as('usr_002'));
    const us = await screen.findByRole('group', { name: 'Waiting for our reply' });
    expect(within(us).getByText(QUESTION)).toBeInTheDocument();
    expect(within(us).getByText('5 days')).toBeInTheDocument();
    expect(within(us).getByRole('button', { name: `Answered: ${QUESTION}` })).toBeInTheDocument();
    const client = screen.getByRole('group', { name: 'Waiting for the client' });
    expect(within(client).getByText(ASKED)).toBeInTheDocument();
    expect(within(client).getByText('6 days')).toBeInTheDocument();
    expect(within(client).getByRole('button', { name: `Received: ${ASKED}` })).toBeInTheDocument();
    const history = screen.getByRole('region', { name: 'History' });
    expect(within(history).getByRole('region', { name: 'This week' })).toBeInTheDocument();
    expect(within(history).getByRole('region', { name: 'Last week' })).toBeInTheDocument();
    expect(within(history).getByRole('region', { name: 'Week of 13 Sept' })).toBeInTheDocument();
    // The newest line is the Balady news of two days ago.
    const lines = within(history).getAllByRole('listitem');
    expect(lines[0]).toHaveTextContent('Balady portal: the request moved to Review');
  });

  it('has no Open section when nothing is open', async () => {
    await renderApp(TRACKER, (state) => {
      as('usr_002')(state);
      for (const entry of Object.values(state.tracker ?? {})) entry.waiting = null;
    });
    await historyReady();
    expect(screen.queryByRole('heading', { name: 'Open' })).not.toBeInTheDocument();
  });

  it('logs with Enter: today, a message from the client, and the box is empty again', async () => {
    const { store } = await renderApp(TRACKER, as('usr_005'));
    const field = await screen.findByRole('textbox', { name: 'Log an exchange' });
    expect(field).toHaveAttribute('placeholder', 'Log something… e.g. Client sent the land survey');
    await userEvent.type(field, 'Client sent the land survey{Enter}');
    await waitFor(() => expect(entriesOf(store.state, 'Client sent the land survey')).toHaveLength(1));
    expect(entriesOf(store.state, 'Client sent the land survey')[0]).toMatchObject({
      projectId: 'prj_001', type: 'message', direction: 'in', date: '2026-09-30', waiting: null, createdBy: 'usr_005', auto: null, fileIds: [],
    });
    expect(await screen.findByText('Logged.')).toBeInTheDocument();
    expect(field).toHaveValue('');
  });

  it('logs the type, the direction, the date and the open loop that were set', async () => {
    const { store } = await renderApp(TRACKER, as('usr_002'));
    await userEvent.click(await screen.findByRole('radio', { name: 'File' }));
    await userEvent.click(screen.getByRole('radio', { name: 'To the client' }));
    await userEvent.click(screen.getByRole('switch', { name: 'Waiting for the client' }));
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-09-29' } });
    await userEvent.type(screen.getByRole('textbox', { name: 'Log an exchange' }), 'Sent the options{Enter}');
    await waitFor(() => expect(entriesOf(store.state, 'Sent the options')).toHaveLength(1));
    expect(entriesOf(store.state, 'Sent the options')[0]).toMatchObject({ type: 'file', direction: 'out', date: '2026-09-29', waiting: 'client' });
    // The new loop shows in the Open section at once.
    const client = await screen.findByRole('group', { name: 'Waiting for the client' });
    expect(await within(client).findByText('Sent the options')).toBeInTheDocument();
  });

  it('reads "Needs a reply" when the direction is from the client', async () => {
    const { store } = await renderApp(TRACKER, as('usr_002'));
    await userEvent.click(await screen.findByRole('switch', { name: 'Needs a reply' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Log an exchange' }), 'Can we meet on Sunday?{Enter}');
    await waitFor(() => expect(entriesOf(store.state, 'Can we meet on Sunday?')[0]?.waiting).toBe('us'));
  });

  it('attaches files to the entry: they upload into the project and link to it', async () => {
    const { store } = await renderApp(TRACKER, as('usr_002'));
    const input = (await screen.findByText('Attach files')).closest('label')!.querySelector('input')!;
    await userEvent.upload(input, new File(['dwg'], 'Survey.dwg', { type: 'application/octet-stream' }));
    await userEvent.click(screen.getByRole('radio', { name: 'File' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Log an exchange' }), 'Client sent the survey{Enter}');
    await waitFor(() => expect(entriesOf(store.state, 'Client sent the survey')).toHaveLength(1));
    const entry = entriesOf(store.state, 'Client sent the survey')[0];
    expect(entry.fileIds).toHaveLength(1);
    expect(store.state.files[entry.fileIds[0]]).toMatchObject({ name: 'Survey.dwg', projectId: 'prj_001' });
    expect(entry.auto).toBeNull();
  });

  it('closes an open loop with one press, and Undo opens it again', async () => {
    const { store } = await renderApp(TRACKER, as('usr_002'));
    await userEvent.click(await screen.findByRole('button', { name: `Answered: ${QUESTION}` }));
    const entry = () => entriesOf(store.state, QUESTION)[0];
    await waitFor(() => expect(entry()).toMatchObject({ closedBy: 'usr_002' }));
    expect(entry().closedAt).not.toBeNull();
    await waitFor(() => expect(screen.queryByRole('button', { name: `Answered: ${QUESTION}` })).not.toBeInTheDocument());
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(entry().closedAt).toBeNull());
    expect(await screen.findByRole('button', { name: `Answered: ${QUESTION}` })).toBeInTheDocument();
  });

  it('filters the history by type, by direction and by open loops, from one Filter button', async () => {
    await renderApp(TRACKER, as('usr_002'));
    const history = await historyReady();
    const titles = () => [...history.querySelectorAll('li > time')].map((time) => time.parentElement?.textContent ?? '');
    const all = titles().length;
    expect(all).toBe(8);
    await userEvent.click(screen.getByRole('button', { name: 'Filter' }));
    await userEvent.click(within(screen.getByRole('group', { name: 'Type' })).getByRole('radio', { name: 'Government' }));
    await waitFor(() => expect(titles()).toHaveLength(2));
    expect(screen.getByRole('button', { name: 'Filter, 1 active' })).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole('group', { name: 'Direction' })).getByRole('radio', { name: 'To the client' }));
    await waitFor(() => expect(screen.getByText('Nothing matches this filter.')).toBeInTheDocument());
    await userEvent.click(within(screen.getByRole('group', { name: 'Direction' })).getByRole('radio', { name: 'Third party' }));
    await waitFor(() => expect(titles()).toHaveLength(2));
    await userEvent.click(within(screen.getByRole('group', { name: 'Direction' })).getByRole('radio', { name: 'All' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Open only' }));
    await waitFor(() => expect(screen.getByText('Nothing matches this filter.')).toBeInTheDocument());
  });

  it('shows only the open entries with "Open only"', async () => {
    await renderApp(TRACKER, as('usr_002'));
    const history = await historyReady();
    await userEvent.click(screen.getByRole('button', { name: 'Filter' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Open only' }));
    await waitFor(() => expect(history.querySelectorAll('li > time')).toHaveLength(2));
  });

  it('opens an entry in a sheet with the note, the people, the files and who logged it', async () => {
    await renderApp(TRACKER, as('usr_002'));
    const history = await historyReady();
    await userEvent.click(within(history).getByRole('button', { name: /Kick-off meeting at the client office/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Kick-off meeting at the client office' });
    expect(within(sheet).getByText('We agreed the scope and the dates of the reviews.')).toBeInTheDocument();
    expect(within(sheet).getByText('Faisal Al-Harbi')).toBeInTheDocument();
    expect(within(sheet).getByText('Sara Al-Qahtani')).toBeInTheDocument();
    expect(within(sheet).getByText(/Logged by Faisal Al-Harbi on 4 Sept/)).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('says in the sheet that an entry was made automatically, and links its file', async () => {
    await renderApp(TRACKER, as('usr_002'));
    const history = await historyReady();
    await userEvent.click(within(history).getByRole('button', { name: /^(?!Download).*Ground floor plan\.pdf/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Ground floor plan.pdf' });
    expect(within(sheet).getByText('Added automatically when a file was marked as delivered to the client.')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Download Ground floor plan.pdf' })).toBeInTheDocument();
  });

  it('closes an entry from its sheet and shows who closed it and when', async () => {
    const { store } = await renderApp(TRACKER, as('usr_002'));
    const history = await historyReady();
    await userEvent.click(within(history).getByRole('button', { name: new RegExp(ASKED) }));
    const sheet = await screen.findByRole('dialog', { name: ASKED });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Received' }));
    await waitFor(() => expect(entriesOf(store.state, ASKED)[0].closedBy).toBe('usr_002'));
    expect(await within(sheet).findByText(/Closed by Faisal Al-Harbi on 30 Sept/)).toBeInTheDocument();
  });

  it('edits an entry from its sheet', async () => {
    const { store } = await renderApp(TRACKER, as('usr_002'));
    const history = await historyReady();
    await userEvent.click(within(history).getByRole('button', { name: /Submitted the building permit request/ }));
    const sheet = await screen.findByRole('dialog');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Edit' }));
    const title = within(sheet).getByRole('textbox', { name: 'What happened' });
    await userEvent.clear(title);
    await userEvent.type(title, 'Permit request filed');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(entriesOf(store.state, 'Permit request filed')).toHaveLength(1));
    expect(await within(sheet).findByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('deletes an entry from its sheet, then brings it back with Undo', async () => {
    const { store } = await renderApp(TRACKER, as('usr_002'));
    const history = await historyReady();
    await userEvent.click(within(history).getByRole('button', { name: /Balady portal: the request moved to Review/ }));
    const sheet = await screen.findByRole('dialog');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(entriesOf(store.state, 'Balady portal: the request moved to Review')).toHaveLength(0));
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(entriesOf(store.state, 'Balady portal: the request moved to Review')).toHaveLength(1));
  });

  it('lets a team member who did not log an entry edit it but not delete it', async () => {
    await renderApp(TRACKER, as('usr_005'));
    const history = await historyReady();
    await userEvent.click(within(history).getByRole('button', { name: /Kick-off meeting at the client office/ }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('shows a person outside the project the record and no way to log or close', async () => {
    await renderApp(TRACKER, as('usr_003'));
    expect(await screen.findByText('Only the team of the project can log here.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Log an exchange' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `Answered: ${QUESTION}` })).not.toBeInTheDocument();
    expect(await screen.findAllByText(QUESTION)).not.toHaveLength(0);
  });

  it('gives every direction arrow the class that flips it on a right-to-left page', async () => {
    await renderApp(TRACKER, as('usr_002'));
    const history = await historyReady();
    const marks = history.querySelectorAll('[data-direction="in"], [data-direction="out"]');
    expect(marks.length).toBeGreaterThan(0);
    for (const mark of marks) expect(mark.querySelector('[class*="rtl:-scale-x-100"]')).not.toBeNull();
  });

  it('is the tab after Activity', async () => {
    await renderApp(TRACKER, as('usr_002'));
    const tabs = (await screen.findAllByRole('tab')).map((tab) => tab.textContent);
    expect(tabs.indexOf('Tracker')).toBe(tabs.indexOf('Activity') + 1);
  });
});

// chats-20 and INT-22 (UX audit 2026-10-19): on a computer the date of the quick log opens Madar's calendar, not the browser's.
describe('the quick log date on a computer', () => {
  it('opens Madar\'s calendar on a press, and a picked day goes into the date field', async () => {
    const spy = vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) => ({
        matches: query === '(pointer: fine)', media: query, addEventListener: () => undefined, removeEventListener: () => undefined,
        addListener: () => undefined, removeListener: () => undefined,
      }) as unknown as MediaQueryList,
    );
    await renderApp(TRACKER, as('usr_002'));
    await historyReady();
    const date = screen.getByLabelText('Date') as HTMLInputElement;
    const today = date.value;
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The field keeps its full look: its date is never empty.
    expect(date).toHaveClass('field');
    await userEvent.click(date);
    const calendar = await screen.findByRole('dialog', { name: 'Pick a date' });
    const day = within(calendar).getAllByRole('button').find((button) => button.getAttribute('aria-pressed') === 'false' && !button.hasAttribute('disabled') && /\d/.test(button.getAttribute('aria-label') ?? '') && !button.getAttribute('aria-label')?.includes('month'));
    expect(day).toBeDefined();
    await userEvent.click(day!);
    expect(screen.queryByRole('dialog', { name: 'Pick a date' })).toBeNull();
    expect(date.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(date.value).not.toBe(today);
    spy.mockRestore();
  });

  it('keeps the browser date field where the pointer is coarse (a phone)', async () => {
    await renderApp(TRACKER, as('usr_002'));
    await historyReady();
    await userEvent.click(screen.getByLabelText('Date'));
    expect(screen.queryByRole('dialog', { name: 'Pick a date' })).toBeNull();
  });
});
