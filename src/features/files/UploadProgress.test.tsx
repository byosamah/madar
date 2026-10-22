import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type { MadarApi } from '../../api/calls';
import type { State } from '../../api/store';
import { renderApp, renderWithRuntime } from '../../test/render';
import { NewProjectSheet } from '../projects/NewProjectSheet';
import { as as asUser, ENDED, withMeeting } from '../meetings/testMeetings';

/**
 * Every upload spot shows the same 3 px bar for each file and locks Remove while the upload runs (fbk_045). The prototype api drops
 * onProgress, so a test plays a store that reports 30 of 60 bytes and then waits for the gate.
 */
afterEach(() => vi.restoreAllMocks());

type Meta = { onProgress?: (sent: number, total: number) => void };
function holdUploads(api: MadarApi, name = 'files.upload'): () => void {
  let release = () => undefined as void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const original = api.call.bind(api);
  vi.spyOn(api, 'call').mockImplementation((async (callName: string, input: unknown, meta?: Meta) => {
    if (callName === name) { meta?.onProgress?.(30, 60); await gate; }
    return (original as (n: string, i: unknown, m?: unknown) => Promise<unknown>)(callName, input, meta);
  }) as typeof api.call);
  return release;
}
const PDF = () => new File(['x'], 'Door sketch.pdf', { type: 'application/pdf' });
const BAR = 'Door sketch.pdf: 50% uploaded';
const as = (userId: string) => (state: State) => { state.session.currentUserId = userId; };

describe('upload progress outside the chat box (fbk_045)', () => {
  it('shows the bar in the Tracker quick log, locks Remove, and saves the entry after the upload', async () => {
    const { api, store } = await renderApp('/projects/prj_001?tab=tracker', as('usr_002'));
    const release = holdUploads(api);
    await userEvent.upload((await screen.findByText('Attach files')).closest('label')!.querySelector('input')!, PDF());
    await userEvent.type(screen.getByRole('textbox', { name: 'Log an exchange' }), 'Client sent the sketch{Enter}');
    const bar = await screen.findByRole('progressbar', { name: BAR });
    expect(bar).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByRole('button', { name: 'Remove Door sketch.pdf' })).toBeDisabled();
    release();
    await waitFor(() => expect(Object.values(store.state.tracker ?? {}).some((e) => e.title === 'Client sent the sketch')).toBe(true));
    await waitFor(() => expect(screen.queryByRole('progressbar', { name: /uploaded/ })).toBeNull());
  });

  it('shows the bar in the comments of a to-do', async () => {
    const { api } = await renderApp('/projects/prj_001?tab=tasks&task=tsk_007&thread=1', as('usr_006'));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    const release = holdUploads(api);
    await userEvent.upload(within(sheet).getByLabelText('Attach files'), PDF());
    await userEvent.type(within(sheet).getByRole('textbox', { name: 'Add a comment' }), 'The sketch.');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Send' }));
    expect(await within(sheet).findByRole('progressbar', { name: BAR })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Remove Door sketch.pdf' })).toBeDisabled();
    release();
    await waitFor(() => expect(within(sheet).queryByRole('progressbar', { name: /uploaded/ })).toBeNull());
  });

  it('shows the bar in the box of a project post', async () => {
    const { api, store } = await renderApp('/projects/prj_001?tab=activity', as('usr_002'));
    const release = holdUploads(api);
    await userEvent.type(await screen.findByRole('textbox', { name: 'Post an update' }), 'New sketch');
    await userEvent.upload(screen.getByLabelText('Attach files'), PDF());
    await userEvent.click(screen.getByRole('button', { name: 'Post' }));
    expect(await screen.findByRole('progressbar', { name: BAR })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Door sketch.pdf' })).toBeDisabled();
    release();
    await waitFor(() => expect(Object.values(store.state.updates ?? {}).some((u) => u.body === 'New sketch')).toBe(true));
  });

  it('shows the bar in the meeting minutes sheet', async () => {
    const { api } = await renderApp('/meetings?meeting=mtg_001', (state) => {
      asUser('usr_005')(state);
      withMeeting(state, { id: 'mtg_001', title: 'Review the facade', attendeeIds: ['usr_005'], ...ENDED });
    });
    const meeting = await screen.findByRole('dialog', { name: 'Review the facade' });
    await userEvent.click(await within(meeting).findByRole('button', { name: /Add the minutes|Edit the minutes/ }));
    const box = await screen.findByRole('dialog', { name: 'Minutes of “Review the facade”' });
    const release = holdUploads(api);
    await userEvent.upload(within(box).getByLabelText('Attach files'), PDF());
    await userEvent.type(within(box).getByRole('textbox'), 'We agreed.');
    await userEvent.click(within(box).getByRole('button', { name: 'Save the minutes' }));
    expect(await within(box).findByRole('progressbar', { name: BAR })).toBeInTheDocument();
    expect(within(box).getByRole('button', { name: 'Remove Door sketch.pdf' })).toBeDisabled();
    release();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Minutes of “Review the facade”' })).toBeNull());
  });

  it('shows a bar for each file of the Files tab queue', async () => {
    const { api, store } = await renderApp('/projects/prj_001?tab=files', as('usr_005'));
    const release = holdUploads(api);
    await userEvent.upload(await screen.findByLabelText('Upload files'), [PDF(), new File(['y'], 'Roof plan.pdf', { type: 'application/pdf' })]);
    const list = await screen.findByRole('list', { name: 'Files going up' });
    expect(await within(list).findByRole('progressbar', { name: BAR })).toHaveAttribute('aria-valuenow', '50');
    expect(within(list).getByText('Roof plan.pdf')).toBeInTheDocument();
    // The second file waits at 0.
    expect(within(list).getByRole('progressbar', { name: 'Roof plan.pdf: 0% uploaded' })).toBeInTheDocument();
    release();
    await waitFor(() => expect(Object.values(store.state.files).some((f) => f.name === 'Roof plan.pdf')).toBe(true));
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Files going up' })).toBeNull());
  });

  it('shows the bar of the project cover in the New Project sheet, then closes it', async () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return <NewProjectSheet open={open} onOpenChange={setOpen} />;
    }
    const { api, store } = await renderWithRuntime(<Harness />, undefined, { path: '/' });
    const sheet = await screen.findByRole('dialog', { name: 'New Project' });
    const release = holdUploads(api);
    await userEvent.type(within(sheet).getByLabelText('Name'), 'Harbour Gate Offices');
    const initials = within(sheet).getByLabelText('Client initials') as HTMLInputElement;
    if (!initials.readOnly) await userEvent.type(initials, 'HGO');
    await userEvent.selectOptions(within(sheet).getByLabelText('Classification'), 'COM');
    await userEvent.type(within(sheet).getByLabelText('Building type'), 'Offices');
    fireEvent.change(within(sheet).getByLabelText('Cover image'), { target: { files: [new File(['x'], 'cover.png', { type: 'image/png' })] } });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create project' }));
    expect(await within(sheet).findByRole('progressbar', { name: 'cover.png: 50% uploaded' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Create project' })).toBeDisabled();
    release();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New Project' })).toBeNull());
    const made = Object.values(store.state.projects).filter((p) => p.name === 'Harbour Gate Offices');
    await waitFor(() => expect(store.state.projects[made[0].id].coverFileId).not.toBeNull());
  });

  it('shows one bar for the screenshots of a feedback report and locks the Remove buttons', async () => {
    const { api } = await renderApp('/projects', as('usr_003'));
    await userEvent.click((await screen.findAllByRole('button', { name: 'Reem Al-Ghamdi' }))[0]);
    await userEvent.click(await screen.findByRole('button', { name: 'Request a feature or report a bug' }));
    const sheet = await screen.findByRole('dialog', { name: 'Request a feature or report a bug' });
    const release = holdUploads(api, 'feedback.send');
    await userEvent.type(within(sheet).getByLabelText('What would help you?'), 'A wider board.');
    await userEvent.upload(within(sheet).getByLabelText('Add a screenshot'), new File(['shot'], 'board.png', { type: 'image/png' }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Send' }));
    expect(await within(sheet).findByRole('progressbar', { name: 'Screenshots: 50% uploaded' })).toHaveAttribute('aria-valuenow', '50');
    expect(within(sheet).getByRole('button', { name: 'Remove screenshot 1' })).toBeDisabled();
    release();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Request a feature or report a bug' })).toBeNull());
  });
});
