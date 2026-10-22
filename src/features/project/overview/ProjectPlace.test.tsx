import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { useCall } from '../../../app/runtime';
import { renderWithRuntime } from '../../../test/render';
import type { State } from '../../../api/store';
import { ProjectPlace } from './ProjectPlace';

// The real build loads the street map. These tests run the real-build branch, with the map itself replaced by a double.
vi.hoisted(() => vi.stubEnv('VITE_MADAR_API', 'remote'));

// The loader still imports the library: the real one makes a Worker, which jsdom has not.
vi.mock('maplibre-gl', () => import('../../../test/fakeMapLib'));

vi.mock('../../map/MapCanvas', async () => {
  const React = await import('react');
  type Pin = { id: string; label?: string };
  return {
    default: (props: { pins: Pin[]; fullscreen?: boolean; renderPin?: (pin: Pin, selected: boolean) => unknown }) =>
      React.createElement(
        'div',
        { role: 'region', 'aria-label': 'Map', 'data-fullscreen': String(Boolean(props.fullscreen)) },
        props.pins.map((pin) => React.createElement('span', { key: pin.id }, `pin ${pin.label}`, props.renderPin?.(pin, false) as never)),
      ),
  };
});

const LOAD = { timeout: 10_000 };

function Host() {
  const detail = useCall('projects.get', { id: 'prj_001' });
  return detail.data ? <ProjectPlace detail={detail.data} /> : <p>loading</p>;
}

const pinned = (state: State) => {
  state.projects.prj_001.geo = { lat: 26.29, lng: 50.21 };
};

// The owner asked for the map of the project at the top of About, in place of the cover picture (2026-10-19).
describe('the place of the project on the Overview', () => {
  it('shows the pin of the project on a map, with full screen', async () => {
    await renderWithRuntime(<Host />, pinned);
    const map = await screen.findByRole('region', { name: 'Map' }, LOAD);
    expect(within(map).getByText('pin Corniche Office Tower')).toBeInTheDocument();
    expect(map).toHaveAttribute('data-fullscreen', 'true');
  });

  it('shows no map for a project with no pin', async () => {
    await renderWithRuntime(<Host />, (state) => {
      state.projects.prj_001.geo = null;
    });
    await waitFor(() => expect(screen.queryByText('loading')).toBeNull(), LOAD);
    expect(screen.queryByRole('region', { name: 'Map' })).toBeNull();
  });
});
