import { afterEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { alwaysSignedIn } from '../../app/auth';
import type { State } from '../../api/store';
import { renderRemoteApp, type SentCall } from '../../test/renderRemote';
import { phoneMedia } from '../../test/phoneMedia';

const AUTH_ID = '3f0c2a9e-0000-4000-8000-000000000001';
const HINT_KEY = `madar.homeRole.${AUTH_ID}`;
const auth = { ...alwaysSignedIn(), userId: () => AUTH_ID };
const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const lists = (sent: SentCall[]) => sent.filter((call) => call.name === 'projects.list').map((call) => call.input);
const ADMIN_LIST = { filter: 'all', sort: 'deadline' };
const MINE_LIST = { filter: 'mine', status: 'all', sort: 'deadline' };

afterEach(() => window.localStorage.clear());

describe("Home asks for the person's project list before session.get answers (performance audit 2026-10-07, FET-8)", () => {
  it('asks for the Admin list at once when the device saw an Admin last time', async () => {
    window.localStorage.setItem(HINT_KEY, 'admin');
    let holding = true;
    const { sent, release } = await renderRemoteApp('/', as('usr_001'), { auth, hold: (name) => holding && name === 'session.get' });
    await waitFor(() => expect(lists(sent)).toEqual([ADMIN_LIST]));
    holding = false;
    release();
    await screen.findByRole('list', { name: 'Your projects' });
    expect(lists(sent)).toEqual([ADMIN_LIST]);
  });

  it('asks as today with no hint, and keeps the role for the next start', async () => {
    let holding = true;
    const { sent, release } = await renderRemoteApp('/', as('usr_001'), { auth, hold: (name) => holding && name === 'session.get' });
    await waitFor(() => expect(lists(sent)).toEqual([MINE_LIST]));
    holding = false;
    release();
    await screen.findByRole('list', { name: 'Your projects' });
    expect(lists(sent)).toEqual([MINE_LIST, ADMIN_LIST]);
    expect(window.localStorage.getItem(HINT_KEY)).toBe('admin');
  });

  it('lets the session decide when the hint is wrong', async () => {
    window.localStorage.setItem(HINT_KEY, 'admin');
    let holding = true;
    const { sent, release } = await renderRemoteApp('/', as('usr_003'), { auth, hold: (name) => holding && name === 'session.get' });
    await waitFor(() => expect(lists(sent)).toEqual([ADMIN_LIST]));
    holding = false;
    release();
    const list = await screen.findByRole('list', { name: 'Your projects' });
    expect(within(list).getByText('Tamr Staff Housing')).toBeInTheDocument();
    expect(lists(sent)).toEqual([ADMIN_LIST, MINE_LIST]);
    expect(window.localStorage.getItem(HINT_KEY)).toBe('member');
  });

  it('asks for the Member list at once when the device saw an Admin with "Only my work", and keeps the choice for the next start', async () => {
    window.localStorage.setItem(HINT_KEY, 'admin|mine');
    let holding = true;
    const { sent, release } = await renderRemoteApp('/', (state) => {
      state.session.currentUserId = 'usr_001';
      state.users.usr_001.preferences.adminReach = 'mine';
    }, { auth, hold: (name) => holding && name === 'session.get' });
    await waitFor(() => expect(lists(sent)).toEqual([MINE_LIST]));
    holding = false;
    release();
    await screen.findByRole('list', { name: 'Your projects' });
    expect(lists(sent)).toEqual([MINE_LIST]);
    expect(window.localStorage.getItem(HINT_KEY)).toBe('admin|mine');
  });

  it('lets the session decide when the stored choice is out of date', async () => {
    window.localStorage.setItem(HINT_KEY, 'admin|mine');
    let holding = true;
    const { sent, release } = await renderRemoteApp('/', as('usr_001'), { auth, hold: (name) => holding && name === 'session.get' });
    await waitFor(() => expect(lists(sent)).toEqual([MINE_LIST]));
    holding = false;
    release();
    await screen.findByRole('list', { name: 'Your projects' });
    await waitFor(() => expect(lists(sent)).toEqual([MINE_LIST, ADMIN_LIST]));
    expect(window.localStorage.getItem(HINT_KEY)).toBe('admin');
  });

  it('reads no hint without an auth user, as in the prototype', async () => {
    window.localStorage.setItem(HINT_KEY, 'admin');
    let holding = true;
    const { sent, release } = await renderRemoteApp('/', as('usr_001'), { hold: (name) => holding && name === 'session.get' });
    await waitFor(() => expect(lists(sent)).toEqual([MINE_LIST]));
    holding = false;
    release();
    await screen.findByRole('list', { name: 'Your projects' });
  });

  it('feeds no read from the hint on a phone, and still keeps the role for the next start', async () => {
    phoneMedia(true);
    window.localStorage.setItem(HINT_KEY, 'admin');
    let holding = true;
    const { sent, release } = await renderRemoteApp('/', as('usr_001'), { auth, hold: (name) => holding && name === 'session.get' });
    await waitFor(() => expect(sent.some((call) => call.name === 'session.get')).toBe(true));
    holding = false;
    release();
    await screen.findByRole('region', { name: 'Next for you' });
    expect(lists(sent)).toEqual([]);
    expect(window.localStorage.getItem(HINT_KEY)).toBe('admin');
  });
});
