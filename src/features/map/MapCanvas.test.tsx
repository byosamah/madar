import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRuntime } from '../../test/render';
import MapCanvas from './MapCanvas';

// MapLibre runs in a browser, so these tests replace it with a double.
const made = vi.hoisted(() => [] as { easeTo: (options: unknown) => void }[]);

vi.mock('maplibre-gl', () => {
  class FakeMap {
    easeTo = vi.fn();
    constructor() {
      made.push(this);
    }
    addControl() {}
    on() {}
    remove() {}
    setStyle() {}
    fitBounds() {}
    getZoom() {
      return 10;
    }
  }
  class FakeControl {}
  class FakeBounds {}
  class FakeMarker {}
  return {
    Map: FakeMap,
    NavigationControl: FakeControl,
    LngLatBounds: FakeBounds,
    Marker: FakeMarker,
    setWorkerUrl: vi.fn(),
    setRTLTextPlugin: vi.fn(() => Promise.resolve()),
    addProtocol: vi.fn(),
  };
});
vi.mock('pmtiles', () => ({ Protocol: class {
  tile() {}
} }));
vi.mock('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url', () => ({ default: 'worker.js' }));

describe('MapCanvas (fbk_017)', () => {
  beforeEach(() => {
    made.length = 0;
  });

  it('names the box of the Dashboard map as a map of the projects, because no pin moves', async () => {
    await renderWithRuntime(<MapCanvas pins={[]} fitTo="pins" />);
    expect(screen.getByRole('region', { name: 'Map of the projects' })).toBeTruthy();
  });

  it('names the box of the pin picker as a map where the pin moves by a drag', async () => {
    await renderWithRuntime(<MapCanvas pins={[]} draggablePin />);
    expect(screen.getByRole('region', { name: 'Map. Drag the pin to move it.' })).toBeTruthy();
  });
});
