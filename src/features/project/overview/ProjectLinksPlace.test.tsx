import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { useCall } from '../../../app/runtime';
import { resetGate } from '../../../lib/nominatimGate';
import { renderWithRuntime } from '../../../test/render';
import { ProjectLinks } from './ProjectLinks';

// A location link that holds a point moves the pin. The screen looks up the address of that point first and sends it with the link,
// so the link, the pin and the address are one write and one Undo (the Location is the address of the pin, owner, 2026-10-19).
vi.hoisted(() => {
  vi.stubEnv('VITE_MADAR_API', 'remote');
});

const fetchMock = vi.fn();
const answer = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const DAMMAM = { address: { road: 'King Fahd Road', city: 'Dammam' } };

beforeEach(() => {
  resetGate();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(answer(DAMMAM));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(() => {
  vi.unstubAllEnvs();
});

function Harness() {
  const detail = useCall('projects.get', { id: 'prj_001' });
  return detail.data ? <ProjectLinks detail={detail.data} /> : null;
}

const asLeader = (state: State) => {
  state.session.currentUserId = state.projects.prj_001.leaderId!;
};

async function addLink(kind: string, url: string, prepare = asLeader) {
  const view = await renderWithRuntime(<Harness />, prepare);
  await userEvent.click(await screen.findByRole('button', { name: 'Add link' }));
  const sheet = await screen.findByRole('dialog', { name: 'Add a link' });
  await userEvent.selectOptions(within(sheet).getByLabelText('Kind'), kind);
  fireEvent.change(within(sheet).getByLabelText('Link'), { target: { value: url } });
  await userEvent.click(within(sheet).getByRole('button', { name: 'Add link' }));
  return { ...view, sheet };
}

const reverseCalls = () => fetchMock.mock.calls.map((call) => String(call[0])).filter((url) => url.includes('/reverse'));

describe('a location link and the address of the pin (owner, 2026-10-19)', () => {
  it('looks up the address of the new place and saves the link, the pin and the address in one write', async () => {
    const { store } = await addLink('location', 'https://www.google.com/maps/@26.3,50.1,17z');
    await waitFor(() => expect(store.state.projects.prj_001.geo).toEqual({ lat: 26.3, lng: 50.1 }));
    expect(store.state.projects.prj_001.location).toBe('King Fahd Road, Dammam');
    expect(store.state.projects.prj_001.links?.some((link) => link.url.includes('26.3,50.1'))).toBe(true);
    expect(reverseCalls()).toEqual(['https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=26.3&lon=50.1&zoom=17&accept-language=en']);
  });

  it('takes the link, the pin and the address back with one Undo', async () => {
    const { store } = await addLink('location', 'https://www.google.com/maps/@26.3,50.1,17z');
    const before = { geo: { lat: 26.2928, lng: 50.2172 }, location: 'Al Khobar, Corniche' };
    await waitFor(() => expect(store.state.projects.prj_001.location).toBe('King Fahd Road, Dammam'));
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.projects.prj_001.geo).toEqual(before.geo));
    expect(store.state.projects.prj_001.location).toBe(before.location);
    expect(store.state.projects.prj_001.links?.some((link) => link.url.includes('26.3,50.1')) ?? false).toBe(false);
  });

  it('saves the link with no address when the lookup fails: no old text stays beside the new pin', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const { store } = await addLink('location', 'https://www.google.com/maps/@26.3,50.1,17z');
    await waitFor(() => expect(store.state.projects.prj_001.geo).toEqual({ lat: 26.3, lng: 50.1 }));
    expect(store.state.projects.prj_001.location).toBe('');
  });

  it('asks nothing when the link holds the point that the pin already has', async () => {
    const { store } = await addLink('location', 'https://maps.google.com/?q=26.2928,50.2172');
    await waitFor(() => expect(store.state.projects.prj_001.links?.some((link) => link.url.includes('26.2928')) ?? false).toBe(true));
    expect(reverseCalls()).toEqual([]);
    expect(store.state.projects.prj_001.location).toBe('Al Khobar, Corniche');
  });

  it('asks nothing for a link of another kind, or a location link with no point', async () => {
    const { store } = await addLink('moodboard', 'https://pinterest.com/x?q=26.9,50.9');
    await waitFor(() => expect(store.state.projects.prj_001.links?.some((link) => link.url.includes('pinterest')) ?? false).toBe(true));
    expect(reverseCalls()).toEqual([]);
    expect(store.state.projects.prj_001.location).toBe('Al Khobar, Corniche');
  });

  it('asks nothing of a person who may post but may not move the pin', async () => {
    const teamMember = (state: State) => {
      const member = Object.values(state.members).find((row) => row.projectId === 'prj_001' && row.userId !== state.projects.prj_001.leaderId && state.users[row.userId].systemRole === 'member');
      state.session.currentUserId = member!.userId;
    };
    const { store, api } = await addLink('location', 'https://www.google.com/maps/@26.3,50.1,17z', teamMember);
    const seen = await api.call('projects.get', { id: 'prj_001' });
    expect(seen.viewerCan.edit).toBe(false);
    await waitFor(() => expect(store.state.projects.prj_001.links?.some((link) => link.url.includes('26.3,50.1')) ?? false).toBe(true));
    expect(reverseCalls()).toEqual([]);
    expect(store.state.projects.prj_001.geo).toEqual({ lat: 26.2928, lng: 50.2172 });
    expect(store.state.projects.prj_001.location).toBe('Al Khobar, Corniche');
  });
});
