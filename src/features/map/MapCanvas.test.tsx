import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { GeoPoint } from '../../api/contract/entities';
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

/** A map with a button. The button sets the point that the map centers on, as a search hit does. */
function Host() {
  const [point, setPoint] = useState<GeoPoint | null>(null);
  return (
    <>
      <button type="button" onClick={() => setPoint({ lat: 26.3, lng: 50.1 })}>Go</button>
      <MapCanvas pins={[]} centerOn={point} />
    </>
  );
}

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

  it('moves the view to the point of centerOn, and keeps a zoom of at least 14', async () => {
    await renderWithRuntime(<Host />);
    await waitFor(() => expect(made).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(made[0].easeTo).toHaveBeenCalledWith(expect.objectContaining({ center: [50.1, 26.3], zoom: 14 }));
  });
});
