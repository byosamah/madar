import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Meeting } from '../../api/contract/entities';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';
import { as, ENDED, SOME_MINUTES, withLine, withMeeting } from './testMeetings';

/**
 * The Minutes sheet (wave 2, owner 2026-10-19): one text area, the attach button, and one main button. "Now" is Wednesday 2026-09-30 09:00 in
 * Riyadh. The meeting ended yesterday. Sara (usr_005) attends; Faisal (usr_002) leads prj_001 and organizes it.
 */
function ended(state: State, over: Partial<Meeting> = {}): void {
  as('usr_005')(state);
  withMeeting(state, { id: 'mtg_001', title: 'Review the facade', attendeeIds: ['usr_005'], ...ENDED, ...over });
}

const FIELD = 'What did you agree, and who does what?';
const sheet = () => screen.findByRole('dialog', { name: 'Minutes of “Review the facade”' });

async function open(path = '/meetings?meeting=mtg_001', prepare: (state: State) => void = ended) {
  const view = await renderApp(path, prepare);
  const meeting = await screen.findByRole('dialog', { name: 'Review the facade' });
  await userEvent.click(await within(meeting).findByRole('button', { name: /Add the minutes|Edit the minutes/ }));
  return { ...view, box: await sheet() };
}

describe('the Minutes sheet', () => {
  it('has one text area, the attach button and one main button', async () => {
    const { box } = await open();
    expect(within(box).getAllByRole('textbox')).toHaveLength(1);
    const area = within(box).getByRole('textbox', { name: FIELD });
    expect(area).toHaveAttribute('dir', 'auto');
    expect(area).toHaveAttribute('autocomplete', 'off');
    expect(area).toHaveAttribute('maxlength', '10000');
    expect(area).toHaveAttribute('rows', '8');
    expect(within(box).getByText('Attach files')).toBeInTheDocument();
    expect(box.querySelectorAll('.signature')).toHaveLength(1);
    expect(within(box).getByRole('button', { name: 'Save the minutes' }).className).toContain('signature');
  });

  it('saves the text on the Tracker line of a project meeting, settles it on the way, and offers Undo', async () => {
    const { box, store } = await open();
    await userEvent.type(within(box).getByRole('textbox', { name: FIELD }), 'We agreed on the facade.');
    await userEvent.click(within(box).getByRole('button', { name: 'Save the minutes' }));
    await waitFor(() => expect(Object.values(store.state.tracker ?? {}).filter((entry) => entry.auto === 'meeting')).toHaveLength(1));
    const line = Object.values(store.state.tracker ?? {}).find((entry) => entry.auto === 'meeting')!;
    expect(line.minutes).toMatchObject({ text: 'We agreed on the facade.', fileIds: [], updatedBy: 'usr_005' });
    expect(await screen.findByText('Minutes saved.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Minutes of “Review the facade”' })).toBeNull());
    // The sheet of the meeting shows the minutes now. The toast works in a browser (isToastPress).
    expect(await screen.findByText('We agreed on the facade.')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.tracker![line.id].minutes).toBeNull());
    // Only the minutes came back: the mark and the line stay.
    expect(store.state.meetings!.mtg_001.settledAt).toBeTruthy();
    expect(store.state.tracker![line.id]).toBeDefined();
  });

  it('saves the text on the meeting itself for a meeting with no project', async () => {
    const { box, store } = await open('/meetings?meeting=mtg_001', (state) => ended(state, { projectId: null }));
    await userEvent.type(within(box).getByRole('textbox', { name: FIELD }), 'Private minutes.');
    await userEvent.click(within(box).getByRole('button', { name: 'Save the minutes' }));
    await waitFor(() => expect(store.state.meetings!.mtg_001.minutes?.text).toBe('Private minutes.'));
    expect(Object.values(store.state.tracker ?? {}).filter((entry) => entry.auto === 'meeting')).toEqual([]);
  });

  it('sends the text as it stands, and the value of since that the sheet opened', async () => {
    const calls: unknown[] = [];
    const { box, store, api } = await open('/meetings?meeting=mtg_001', (state) => {
      ended(state, { kind: 'team', minutes: SOME_MINUTES });
    });
    const original = api.call.bind(api);
    (api as { call: typeof api.call }).call = ((name: string, input: unknown, meta?: unknown) => {
      if (name === 'meetings.saveMinutes') calls.push(input);
      return (original as (n: string, i: unknown, m?: unknown) => Promise<unknown>)(name, input, meta);
    }) as typeof api.call;
    const area = within(box).getByRole('textbox', { name: FIELD });
    expect(area).toHaveValue(SOME_MINUTES.text);
    await userEvent.clear(area);
    await userEvent.type(area, 'New text');
    await userEvent.click(within(box).getByRole('button', { name: 'Save the minutes' }));
    await waitFor(() => expect(store.state.meetings!.mtg_001.minutes?.text).toBe('New text'));
    expect(calls).toEqual([{ id: 'mtg_001', text: 'New text', fileIds: [], since: SOME_MINUTES.updatedAt }]);
  });

  it('sends since null when there are no minutes yet', async () => {
    const calls: unknown[] = [];
    const { box, api } = await open();
    const original = api.call.bind(api);
    (api as { call: typeof api.call }).call = ((name: string, input: unknown, meta?: unknown) => {
      if (name === 'meetings.saveMinutes') calls.push(input);
      return (original as (n: string, i: unknown, m?: unknown) => Promise<unknown>)(name, input, meta);
    }) as typeof api.call;
    await userEvent.type(within(box).getByRole('textbox', { name: FIELD }), 'First');
    await userEvent.click(within(box).getByRole('button', { name: 'Save the minutes' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ id: 'mtg_001', text: 'First', fileIds: [], since: null });
  });

  it('keeps the text in the field and shows the reason when another attendee saved first (minutes_changed)', async () => {
    const { box, store } = await open('/meetings?meeting=mtg_001', (state) => {
      ended(state, { kind: 'team', minutes: SOME_MINUTES });
    });
    const area = within(box).getByRole('textbox', { name: FIELD });
    await userEvent.clear(area);
    await userEvent.type(area, 'My late text');
    // Faisal saves while Sara still types.
    store.run((state) => {
      state.meetings!.mtg_001.minutes = { ...SOME_MINUTES, text: 'Faisal was first', updatedAt: '2026-09-30T08:30:00.000+03:00' };
    });
    await userEvent.click(within(box).getByRole('button', { name: 'Save the minutes' }));
    expect(await within(box).findByRole('alert')).toHaveTextContent('Someone saved the minutes after you opened them. Copy your text, then open them again.');
    expect(within(box).getByRole('textbox', { name: FIELD })).toHaveValue('My late text');
    expect(store.state.meetings!.mtg_001.minutes?.text).toBe('Faisal was first');
    // The sheet stays open: a closed sheet would lose the text.
    expect(screen.getByRole('dialog', { name: 'Minutes of “Review the facade”' })).toBeInTheDocument();
  });

  it('keeps the existing files, lets the person take one out, and adds a new one with the minutes', async () => {
    const { box, store } = await open('/meetings?meeting=mtg_001', (state) => {
      ended(state, { projectId: null, minutes: { ...SOME_MINUTES, fileIds: ['fil_900'] } });
      state.files.fil_900 = {
        id: 'fil_900', projectId: null, stageId: null, taskId: null, meetingId: 'mtg_001', name: 'Notes.pdf',
        versions: [{ letter: 'A', blobKey: 'blob_900', mimeType: 'application/pdf', size: 5, uploadedBy: 'usr_002', uploadedAt: '2026-09-29T16:00:00.000+03:00' }],
      };
    });
    expect(within(box).getByText('Notes.pdf')).toBeInTheDocument();
    await userEvent.upload(within(box).getByLabelText('Attach files'), new File(['x'], 'Second.pdf', { type: 'application/pdf' }));
    expect(await within(box).findByText('Second.pdf')).toBeInTheDocument();
    await userEvent.click(within(box).getByRole('button', { name: 'Save the minutes' }));
    await waitFor(() => expect(store.state.meetings!.mtg_001.minutes?.fileIds).toHaveLength(2));
    const second = Object.values(store.state.files).find((file) => file.name === 'Second.pdf')!;
    // The new file stays with the meeting: no project, no stage, no task.
    expect(second).toMatchObject({ projectId: null, stageId: null, taskId: null, meetingId: 'mtg_001' });
    expect(store.state.meetings!.mtg_001.minutes?.fileIds).toEqual(['fil_900', second.id]);
  });

  it('takes the files of the project for a project meeting', async () => {
    const { box, store } = await open();
    await userEvent.type(within(box).getByRole('textbox', { name: FIELD }), 'With a drawing');
    await userEvent.upload(within(box).getByLabelText('Attach files'), new File(['x'], 'Facade.pdf', { type: 'application/pdf' }));
    await userEvent.click(within(box).getByRole('button', { name: 'Save the minutes' }));
    await waitFor(() => expect(Object.values(store.state.tracker ?? {}).find((entry) => entry.auto === 'meeting')?.minutes?.fileIds).toHaveLength(1));
    expect(Object.values(store.state.files).find((file) => file.name === 'Facade.pdf')).toMatchObject({ projectId: 'prj_001' });
  });

  it('saves an empty text as a clear of the minutes', async () => {
    const { box, store } = await open('/meetings?meeting=mtg_001', (state) => {
      ended(state, { kind: 'team', minutes: SOME_MINUTES });
    });
    await userEvent.clear(within(box).getByRole('textbox', { name: FIELD }));
    await userEvent.click(within(box).getByRole('button', { name: 'Save the minutes' }));
    await waitFor(() => expect(store.state.meetings!.mtg_001.minutes ?? null).toBeNull());
  });

  it('opens from the Edit button of a meeting whose minutes stand on the Tracker line', async () => {
    const { box } = await open('/meetings?meeting=mtg_001', (state) => {
      ended(state);
      withLine(state, { minutes: SOME_MINUTES });
    });
    expect(within(box).getByRole('textbox', { name: FIELD })).toHaveValue(SOME_MINUTES.text);
  });
});
