import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GeoPoint } from '../../api/contract/entities';
import type { State } from '../../api/store';
import { resetGate } from '../../lib/nominatimGate';
import { projectKey } from '../../lib/projectCode';
import { addSampleInternalProject } from '../../data/sampleInternalProject';
import { TODAY } from '../../test/factories';
import { renderWithRuntime } from '../../test/render';
import { DashboardMap } from './DashboardMap';

// The real build loads the street map. These tests run the real-build branch, with the map itself replaced by a double.
const mapState = vi.hoisted(() => {
  vi.stubEnv('VITE_MADAR_API', 'remote');
  return { failed: false };
});

// The loader still imports the library: the real one makes a Worker, which jsdom has not.
vi.mock('maplibre-gl', () => import('../../test/fakeMapLib'));

vi.mock('../map/MapCanvas', async () => {
  const React = await import('react');
  type Pin = { id: string; label?: string };
  type Props = {
    pins: Pin[];
    onPinClick?: (id: string) => void;
    selectedId?: string | null;
    renderPin?: (pin: Pin, selected: boolean) => unknown;
    renderPopup?: (id: string) => unknown;
    onFailedChange?: (failed: boolean) => void;
  };
  return {
    default: (props: Props) => (React.useEffect(() => props.onFailedChange?.(mapState.failed), [props.onFailedChange]), React.createElement(
      'div',
      { role: 'region', 'aria-label': 'Map' },
      props.pins.map((pin) => React.createElement('button', {
        key: pin.id,
        type: 'button',
        'aria-label': pin.label,
        onClick: () => props.onPinClick?.(pin.id),
      }, props.renderPin?.(pin, props.selectedId === pin.id) as never)),
      props.selectedId && props.renderPopup ? (props.renderPopup(props.selectedId) as never) : null,
    )),
  };
});

afterAll(() => {
  vi.unstubAllEnvs();
});

type Api = Awaited<ReturnType<typeof renderWithRuntime>>['api'];

const HEALTH_WORD = { at_risk: 'At risk', late: 'Late' } as const;

/** The first four projects of the office get a pin. The others have none. */
function pinFirstFour(state: State) {
  Object.values(state.projects).slice(0, 4).forEach((project, index) => {
    const point: GeoPoint = { lat: 26.2 + index * 0.01, lng: 50.2 };
    project.geo = point;
  });
}

/** The open projects (active or paused), as the list of the Dashboard map counts them: the rule of the Open space (INT-11). */
async function openProjects(api: Api, filter: { leaderId?: string } = {}) {
  const rows = await api.call('projects.list', { status: 'all', sort: 'name', ...filter });
  return rows.filter((row) => row.project.status === 'active' || row.project.status === 'on_hold');
}

async function pinned(api: Api, filter: { leaderId?: string } = {}) {
  return (await openProjects(api, filter)).filter((row) => row.geo !== null);
}

const mapPins = () => within(screen.getByRole('region', { name: 'Map' })).queryAllByRole('button')
  .map((pin) => pin.getAttribute('aria-label') ?? '')
  .sort();

// The pin sheet looks up the address of a pin when the person presses "Use this place" (the Location is the address of the pin,
// owner, 2026-10-19). The tests never reach the network: this double answers.
const fetchMock = vi.fn();
const addressAnswer = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
beforeEach(() => {
  resetGate();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(addressAnswer({ address: { road: 'King Fahd Road', city: 'Dammam' } }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the Dashboard map (fbk_017)', () => {
  it('puts one pin on the map for each active project with a pin', async () => {
    const { api } = await renderWithRuntime(<DashboardMap filters={{}} />, pinFirstFour, { path: '/dashboard' });
    const expected = (await pinned(api)).map((row) => row.project.name).sort();
    expect(expected.length).toBeGreaterThan(0);
    await waitFor(() => expect(mapPins()).toEqual(expected));
  });

  it('changes the pins with the Leader filter of the Dashboard', async () => {
    const first = await renderWithRuntime(<DashboardMap filters={{}} />, pinFirstFour, { path: '/dashboard' });
    const leaderId = (await pinned(first.api))[0].leader?.id;
    expect(leaderId).toBeDefined();
    await waitFor(() => expect(mapPins().length).toBeGreaterThan(0));
    first.unmount();
    const second = await renderWithRuntime(<DashboardMap filters={{ leaderId }} />, pinFirstFour, { path: '/dashboard' });
    const expected = (await pinned(second.api, { leaderId })).map((row) => row.project.name).sort();
    expect(expected.length).toBeGreaterThan(0);
    await waitFor(() => expect(mapPins()).toEqual(expected));
  });

  it('opens the card of a project when its pin is pressed', async () => {
    const { api } = await renderWithRuntime(<DashboardMap filters={{}} />, pinFirstFour, { path: '/dashboard' });
    const target = (await pinned(api))[0];
    await userEvent.click(await within(await screen.findByRole('region', { name: 'Map' })).findByRole('button', { name: target.project.name }));
    const card = await screen.findByRole('region', { name: target.project.name });
    expect(within(card).getByText(projectKey(target.project.code))).toBeInTheDocument();
    expect(within(card).getByText(`Stage: ${target.currentStage.name}`)).toBeInTheDocument();
    if (target.leader) expect(within(card).getByText(`Leader: ${target.leader.name}`)).toBeInTheDocument();
    // The health shows as a status sign for At risk and Late only. On track shows nothing (PRJ-14).
    const health = target.health?.value;
    if (health === 'late' || health === 'at_risk') expect(within(card).getByText(HEALTH_WORD[health])).toBeInTheDocument();
    expect(within(card).queryByText('On track')).toBeNull();
    expect(within(card).getByRole('link', { name: 'Open project' })).toHaveAttribute('href', `/projects/${target.project.id}`);
  });

  it('selects a pinned project from the list beside the map', async () => {
    const { api } = await renderWithRuntime(<DashboardMap filters={{}} />, pinFirstFour, { path: '/dashboard' });
    const target = (await pinned(api))[0];
    const list = await screen.findByRole('list', { name: 'Projects on the map' });
    const row = within(list).getByRole('button', { name: new RegExp(target.project.name) });
    expect(row).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(row);
    expect(row).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByRole('region', { name: target.project.name })).toBeInTheDocument();
  });

  it('lists the projects with no pin, and offers Set pin to the people who may edit them', async () => {
    const { api } = await renderWithRuntime(<DashboardMap filters={{}} />, pinFirstFour, { path: '/dashboard' });
    const unpinned = (await openProjects(api)).filter((row) => row.geo === null);
    expect(unpinned.length).toBeGreaterThan(0);
    await userEvent.click(await screen.findByRole('button', { name: `No pin yet (${unpinned.length})` }));
    for (const row of unpinned) {
      expect(screen.getByText(row.project.name)).toBeInTheDocument();
      const button = screen.queryByRole('button', { name: `Set pin for ${row.project.name}` });
      if (row.viewerCan.edit) expect(button).toBeInTheDocument();
      else expect(button).toBeNull();
    }
  });

  it('shows no Set pin button to a member who may not edit a project', async () => {
    const member = (state: State) => {
      pinFirstFour(state);
      const found = Object.values(state.users).find((user) => user.kind === 'human' && user.active && user.systemRole === 'member');
      if (found) state.session.currentUserId = found.id;
    };
    const { api } = await renderWithRuntime(<DashboardMap filters={{}} />, member, { path: '/dashboard' });
    const unpinned = (await openProjects(api)).filter((row) => row.geo === null);
    const editable = unpinned.filter((row) => row.viewerCan.edit);
    expect(editable.length).toBeLessThan(unpinned.length);
    await userEvent.click(await screen.findByRole('button', { name: `No pin yet (${unpinned.length})` }));
    expect(screen.queryAllByRole('button', { name: /^Set pin for / })).toHaveLength(editable.length);
  });

  it('saves a pin from the Set pin sheet', async () => {
    const { api } = await renderWithRuntime(<DashboardMap filters={{}} />, pinFirstFour, { path: '/dashboard' });
    const unpinned = (await openProjects(api)).filter((row) => row.geo === null);
    const target = unpinned.find((row) => row.viewerCan.edit);
    expect(target).toBeDefined();
    await userEvent.click(await screen.findByRole('button', { name: `No pin yet (${unpinned.length})` }));
    await userEvent.click(screen.getByRole('button', { name: `Set pin for ${target!.project.name}` }));
    const dialog = await screen.findByRole('dialog', { name: 'Pin on the map' });
    fireEvent.change(within(dialog).getByLabelText('Search a place or paste a Google Maps link'), { target: { value: 'https://www.google.com/maps/@26.2834,50.2105,17z' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Use this place' }));
    await waitFor(async () => expect((await api.call('projects.get', { id: target!.project.id })).geo).toEqual({ lat: 26.2834, lng: 50.2105 }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('saves the pin and its address in one write: one Undo takes both back', async () => {
    const { api } = await renderWithRuntime(<DashboardMap filters={{}} />, pinFirstFour, { path: '/dashboard' });
    const unpinned = (await openProjects(api)).filter((row) => row.geo === null);
    const target = unpinned.find((row) => row.viewerCan.edit)!;
    await userEvent.click(await screen.findByRole('button', { name: `No pin yet (${unpinned.length})` }));
    await userEvent.click(screen.getByRole('button', { name: `Set pin for ${target.project.name}` }));
    const dialog = await screen.findByRole('dialog', { name: 'Pin on the map' });
    fireEvent.change(within(dialog).getByLabelText('Search a place or paste a Google Maps link'), { target: { value: '26.2834, 50.2105' } });
    expect(fetchMock).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Use this place' }));
    await waitFor(async () => expect((await api.call('projects.get', { id: target.project.id })).project.location).toBe('King Fahd Road, Dammam'));
    const saved = await api.call('projects.get', { id: target.project.id });
    expect(saved.geo).toEqual({ lat: 26.2834, lng: 50.2105 });
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(async () => expect((await api.call('projects.get', { id: target.project.id })).geo).toBeNull());
    expect((await api.call('projects.get', { id: target.project.id })).project.location).toBe(target.project.location);
  });

  it('saves the pin with an empty address when the lookup fails, and the old text does not stay beside the new pin', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const { api } = await renderWithRuntime(<DashboardMap filters={{}} />, pinFirstFour, { path: '/dashboard' });
    const unpinned = (await openProjects(api)).filter((row) => row.geo === null);
    const target = unpinned.find((row) => row.viewerCan.edit)!;
    await userEvent.click(await screen.findByRole('button', { name: `No pin yet (${unpinned.length})` }));
    await userEvent.click(screen.getByRole('button', { name: `Set pin for ${target.project.name}` }));
    const dialog = await screen.findByRole('dialog', { name: 'Pin on the map' });
    fireEvent.change(within(dialog).getByLabelText('Search a place or paste a Google Maps link'), { target: { value: '26.2834, 50.2105' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Use this place' }));
    await waitFor(async () => expect((await api.call('projects.get', { id: target.project.id })).geo).toEqual({ lat: 26.2834, lng: 50.2105 }));
    expect((await api.call('projects.get', { id: target.project.id })).project.location).toBe('');
  });

  it('keeps the old pin when the person presses Cancel in the Set pin sheet (PRJ-13)', async () => {
    const { api } = await renderWithRuntime(<DashboardMap filters={{}} />, pinFirstFour, { path: '/dashboard' });
    const unpinned = (await openProjects(api)).filter((row) => row.geo === null);
    const target = unpinned.find((row) => row.viewerCan.edit)!;
    await userEvent.click(await screen.findByRole('button', { name: `No pin yet (${unpinned.length})` }));
    await userEvent.click(screen.getByRole('button', { name: `Set pin for ${target.project.name}` }));
    const dialog = await screen.findByRole('dialog', { name: 'Pin on the map' });
    fireEvent.change(within(dialog).getByLabelText('Search a place or paste a Google Maps link'), { target: { value: '26.2834, 50.2105' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await api.call('projects.get', { id: target.project.id })).geo).toBeNull();
  });

  it('shows the leader of each project that the person may not edit, so the person knows whom to ask (PRJ-20)', async () => {
    const member = (state: State) => {
      pinFirstFour(state);
      const found = Object.values(state.users).find((user) => user.kind === 'human' && user.active && user.systemRole === 'member');
      if (found) state.session.currentUserId = found.id;
    };
    const { api } = await renderWithRuntime(<DashboardMap filters={{}} />, member, { path: '/dashboard' });
    const unpinned = (await openProjects(api)).filter((row) => row.geo === null);
    const blocked = unpinned.filter((row) => !row.viewerCan.edit && row.leader);
    expect(blocked.length).toBeGreaterThan(0);
    await userEvent.click(await screen.findByRole('button', { name: `No pin yet (${unpinned.length})` }));
    for (const row of blocked) expect(screen.getAllByText(`Leader: ${row.leader!.name}`).length).toBeGreaterThan(0);
  });

  it('opens the card in a short sheet on a phone, not next to the pin (PRJ-14)', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
      matches: true, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined,
      addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
    }) as MediaQueryList);
    try {
      const { api } = await renderWithRuntime(<DashboardMap filters={{}} />, pinFirstFour, { path: '/dashboard' });
      const target = (await pinned(api))[0];
      const map = await screen.findByRole('region', { name: 'Map' });
      await userEvent.click(within(map).getByRole('button', { name: target.project.name }));
      const sheet = await screen.findByRole('dialog', { name: target.project.name });
      expect(within(sheet).getByRole('link', { name: 'Open project' })).toHaveAttribute('href', `/projects/${target.project.id}`);
      expect(within(map).queryByRole('link', { name: 'Open project' })).toBeNull();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('opens the card in a sheet when the street map did not load, so the person still reaches the project (PRJ-01)', async () => {
    mapState.failed = true;
    try {
      const { api } = await renderWithRuntime(<DashboardMap filters={{}} />, pinFirstFour, { path: '/dashboard' });
      const target = (await pinned(api))[0];
      const list = await screen.findByRole('list', { name: 'Projects on the map' });
      await userEvent.click(within(list).getByRole('button', { name: new RegExp(target.project.name) }));
      const sheet = await screen.findByRole('dialog', { name: target.project.name });
      expect(within(sheet).getByRole('link', { name: 'Open project' })).toBeInTheDocument();
    } finally {
      mapState.failed = false;
    }
  });
});

describe('the Dashboard map and an internal project (fbk_044)', () => {
  it('leaves an internal project out of the list of projects with no pin: it has no place', async () => {
    const plain = await renderWithRuntime(<DashboardMap filters={{}} />, pinFirstFour, { path: '/dashboard' });
    const unpinned = (await openProjects(plain.api)).filter((row) => row.geo === null).length;
    expect(unpinned).toBeGreaterThan(0);
    plain.unmount();
    await renderWithRuntime(<DashboardMap filters={{}} />, (state) => {
      pinFirstFour(state);
      addSampleInternalProject(state, TODAY);
    }, { path: '/dashboard' });
    await userEvent.click(await screen.findByRole('button', { name: `No pin yet (${unpinned})` }));
    expect(screen.queryByText('Portfolio 2026')).toBeNull();
  });
});

