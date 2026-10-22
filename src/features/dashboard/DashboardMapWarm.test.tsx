import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithRuntime } from '../../test/render';
import { DashboardScreen } from './DashboardScreen';

// Performance audit 2026-10-21, LV-10. The real build starts the map chunk and the library when a finger or a mouse goes down on the
// Map tab, so the download runs while the click finishes. The prototype has no map and starts nothing.
const warm = vi.hoisted(() => {
  vi.stubEnv('VITE_MADAR_API', 'remote');
  return { map: undefined as unknown as ReturnType<typeof vi.fn> };
});

vi.mock('../map/mapLib', () => {
  warm.map = vi.fn();
  return { warmMap: warm.map, lazyMapCanvas: () => () => null };
});

describe('the Dashboard Map tab', () => {
  it('starts the map on pointer down of the tab, and only of that tab', async () => {
    await renderWithRuntime(<DashboardScreen />, undefined, { path: '/dashboard' });
    const tab = await screen.findByRole('tab', { name: 'Map' });
    fireEvent.pointerDown(await screen.findByRole('tab', { name: 'People' }));
    fireEvent.pointerDown(screen.getByRole('tab', { name: 'Schedule' }));
    expect(warm.map).not.toHaveBeenCalled();
    fireEvent.pointerDown(tab);
    expect(warm.map).toHaveBeenCalledTimes(1);
  });
});
