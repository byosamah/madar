import { describe, expect, it } from 'vitest';
import { createEvent, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RoleSettings } from '../../api/contract/entities';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';
import { without } from '../../test/rr2work';
import { as as asUser, ENDED, withMeeting } from '../meetings/testMeetings';

/**
 * Paste and drop in the Tracker quick log, the project post box and the meeting minutes (fbk_046, fbk_047): the rules of the chat box.
 * A paste that holds text stays text, a paste of only pictures adds them, dropped files go to the picked chips, nothing saves before the
 * save button, and the frame shows only where the person may upload.
 */
const as = (userId: string, roles?: RoleSettings) => (state: State) => {
  state.session.currentUserId = userId;
  if (roles) state.settings.roles = roles;
};
const clip = (files: File[], text: string) => ({ files, types: files.length > 0 ? ['Files'] : ['text/plain'], getData: (type: string) => (type === 'text/plain' ? text : '') });
const drag = (picked: File[]) => ({ dataTransfer: { types: ['Files'], files: picked, dropEffect: 'none' } });
const PDF = () => new File(['x'], 'Survey.pdf', { type: 'application/pdf' });
const PNG = () => new File(['x'], 'Landing.png', { type: 'image/png' });
const picked = () => screen.queryByRole('list', { name: 'Files to send' });

type Spot = {
  name: string;
  url: string;
  prepare: (roles?: RoleSettings) => (state: State) => void;
  box: () => Promise<HTMLElement>;
  zone: () => HTMLElement;
  note: string;
  ready: () => Promise<unknown>;
};

const SPOTS: Spot[] = [
  {
    name: 'the Tracker quick log',
    url: '/projects/prj_001?tab=tracker',
    prepare: (roles) => as('usr_005', roles),
    box: () => screen.findByRole('textbox', { name: 'Log an exchange' }),
    zone: () => screen.getByRole('form', { name: 'Log an exchange' }).parentElement as HTMLElement,
    note: 'The files join this entry. Nothing saves until you press Log it.',
    ready: () => screen.findByRole('region', { name: 'History' }),
  },
  {
    name: 'the project post box',
    url: '/projects/prj_001?tab=activity',
    prepare: (roles) => as('usr_005', roles),
    box: () => screen.findByRole('textbox', { name: 'Post an update' }),
    zone: () => screen.getByRole('form', { name: 'Post an update' }).parentElement as HTMLElement,
    note: 'The files join this post. Nothing posts until you press Post.',
    ready: () => screen.findByRole('region', { name: 'Updates' }),
  },
];

describe.each(SPOTS)('paste and drop in $name', (spot) => {
  it('leaves a paste of text alone, and adds a pasted picture to the picked files', async () => {
    await renderApp(spot.url, spot.prepare());
    const box = await spot.box();
    expect(fireEvent.paste(box, { clipboardData: clip([], 'Some words') })).toBe(true);
    expect(picked()).toBeNull();
    expect(fireEvent.paste(box, { clipboardData: clip([PNG()], '') })).toBe(false);
    expect(within(picked() as HTMLElement).getByText('Landing.png')).toBeInTheDocument();
  });

  it('shows the frame with its note, adds the dropped files to the chips, and saves nothing', async () => {
    const { store } = await renderApp(spot.url, spot.prepare());
    await spot.ready();
    await spot.box();
    const files = Object.keys(store.state.files).length;
    const zone = spot.zone();
    fireEvent.dragEnter(zone, drag([]));
    expect(screen.getByText('Drop to attach')).toBeInTheDocument();
    expect(screen.getByText(spot.note)).toBeInTheDocument();
    fireEvent.drop(zone, drag([PDF()]));
    expect(screen.queryByText('Drop to attach')).toBeNull();
    expect(within(picked() as HTMLElement).getByText('Survey.pdf')).toBeInTheDocument();
    expect(Object.keys(store.state.files)).toHaveLength(files);
  });

  it('shows no frame, takes no paste and no drop, and still keeps the browser from opening the file, with file.upload off', async () => {
    await renderApp(spot.url, spot.prepare(without('file.upload.team')));
    await spot.ready();
    const box = await spot.box();
    expect(fireEvent.paste(box, { clipboardData: clip([PNG()], '') })).toBe(true);
    const zone = spot.zone();
    fireEvent.dragEnter(zone, drag([]));
    expect(screen.queryByText('Drop to attach')).toBeNull();
    fireEvent.drop(zone, drag([PDF()]));
    expect(picked()).toBeNull();
    // A file dropped anywhere else on the screen never opens in the tab (useBlockFileDrop).
    const stray = createEvent.drop(document.body, drag([PDF()]));
    fireEvent(document.body, stray);
    expect(stray.defaultPrevented).toBe(true);
  });
});

describe('paste and drop in the meeting minutes sheet', () => {
  async function openMinutes(roles?: RoleSettings) {
    const view = await renderApp('/meetings?meeting=mtg_001', (state) => {
      asUser('usr_005')(state);
      withMeeting(state, { id: 'mtg_001', title: 'Review the facade', attendeeIds: ['usr_005'], ...ENDED });
      if (roles) state.settings.roles = roles;
    });
    const meeting = await screen.findByRole('dialog', { name: 'Review the facade' });
    await userEvent.click(await within(meeting).findByRole('button', { name: /Add the minutes|Edit the minutes/ }));
    return { ...view, box: await screen.findByRole('dialog', { name: 'Minutes of “Review the facade”' }) };
  }

  it('leaves a paste of text alone, and adds a pasted picture to the picked files', async () => {
    const { box } = await openMinutes();
    const field = within(box).getByRole('textbox');
    expect(fireEvent.paste(field, { clipboardData: clip([], 'Some words') })).toBe(true);
    expect(within(box).queryByRole('list', { name: 'Files to send' })).toBeNull();
    expect(fireEvent.paste(field, { clipboardData: clip([PNG()], '') })).toBe(false);
    expect(within(within(box).getByRole('list', { name: 'Files to send' })).getByText('Landing.png')).toBeInTheDocument();
  });

  it('shows the frame with its note, adds the dropped files to the chips, and saves nothing', async () => {
    const { box, store } = await openMinutes();
    const zone = within(box).getByRole('textbox').closest('form')!.parentElement as HTMLElement;
    const files = Object.keys(store.state.files).length;
    fireEvent.dragEnter(zone, drag([]));
    expect(within(box).getByText('Drop to attach')).toBeInTheDocument();
    expect(within(box).getByText('The files join the minutes. Nothing saves until you press Save the minutes.')).toBeInTheDocument();
    fireEvent.drop(zone, drag([PDF()]));
    expect(within(within(box).getByRole('list', { name: 'Files to send' })).getByText('Survey.pdf')).toBeInTheDocument();
    expect(Object.keys(store.state.files)).toHaveLength(files);
    expect(screen.getByRole('dialog', { name: 'Minutes of “Review the facade”' })).toBeInTheDocument();
  });

  it('keeps the browser from opening a file that is dropped on the sheet outside the frame', async () => {
    await openMinutes();
    const stray = createEvent.drop(document.body, drag([PDF()]));
    fireEvent(document.body, stray);
    expect(stray.defaultPrevented).toBe(true);
  });
});
