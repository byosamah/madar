import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import type { GeoPoint } from '../../api/contract/entities';
import { renderWithRuntime } from '../../test/render';
import MapCanvas from './MapCanvas';

// MapLibre runs in a browser, so these tests replace it with a double.
type Handler = (event?: unknown) => void;
const made = vi.hoisted(() => [] as { easeTo: (options: unknown) => void; handlers: Record<string, Handler[]>; style: unknown }[]);
const markers = vi.hoisted(() => [] as { element: HTMLElement; lngLat: number[] }[]);
const popups = vi.hoisted(() => [] as { content: HTMLElement | null; lngLat: number[]; options: unknown; removed: boolean }[]);
const rtl = vi.hoisted(() => ({ setRTLTextPlugin: undefined as unknown as ReturnType<typeof vi.fn> }));

vi.mock('maplibre-gl', () => {
  class FakeMap {
    easeTo = vi.fn();
    handlers: Record<string, Handler[]> = {};
    style: unknown;
    constructor(options: { style: unknown }) {
      this.style = options.style;
      made.push(this);
    }
    addControl() {}
    on(name: string, handler: Handler) {
      (this.handlers[name] ??= []).push(handler);
    }
    remove() {}
    setStyle() {}
    fitBounds() {}
    getZoom() {
      return 10;
    }
    getBounds() {
      return { contains: () => true };
    }
  }
  class FakeControl {}
  class FakeBounds {
    extend() {}
  }
  class FakeMarker {
    entry: { element: HTMLElement; lngLat: number[] };
    constructor(options: { element: HTMLElement }) {
      this.entry = { element: options.element, lngLat: [] };
      markers.push(this.entry);
    }
    setLngLat(lngLat: number[]) {
      this.entry.lngLat = lngLat;
      return this;
    }
    addTo() {
      return this;
    }
    on() {}
    remove() {}
    getLngLat() {
      return { lat: 0, lng: 0 };
    }
  }
  class FakePopup {
    entry: { content: HTMLElement | null; lngLat: number[]; options: unknown; removed: boolean };
    constructor(options: unknown) {
      this.entry = { content: null, lngLat: [], options, removed: false };
      popups.push(this.entry);
    }
    setLngLat(lngLat: number[]) {
      this.entry.lngLat = lngLat;
      return this;
    }
    setDOMContent(content: HTMLElement) {
      this.entry.content = content;
      return this;
    }
    addTo() {
      return this;
    }
    on() {}
    remove() {
      this.entry.removed = true;
    }
  }
  rtl.setRTLTextPlugin = vi.fn(() => Promise.resolve());
  return {
    Map: FakeMap,
    NavigationControl: FakeControl,
    LngLatBounds: FakeBounds,
    Marker: FakeMarker,
    Popup: FakePopup,
    setWorkerUrl: vi.fn(),
    setRTLTextPlugin: rtl.setRTLTextPlugin,
  };
});
vi.mock('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url', () => ({ default: 'worker.js' }));
vi.mock('../../../node_modules/@mapbox/mapbox-gl-rtl-text/dist/mapbox-gl-rtl-text.js?url', () => ({ default: '/assets/rtl-text-abc.js' }));

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
    markers.length = 0;
    popups.length = 0;
  });

  // This test comes first: the library loads once for the whole file, so only the first render calls the plugin loader.
  it('draws the tiles of OpenFreeMap, and loads the Arabic text plugin from a file of this build', async () => {
    await renderWithRuntime(<MapCanvas pins={[]} />);
    await waitFor(() => expect(made).toHaveLength(1));
    const style = made[0].style as { sources: { openmaptiles: { url: string } }; glyphs: string };
    expect(style.sources.openmaptiles.url).toBe('https://tiles.openfreemap.org/planet');
    expect(rtl.setRTLTextPlugin).toHaveBeenCalledWith(expect.stringMatching(/\/assets\/rtl-text-abc\.js$/), true);
    expect(String(rtl.setRTLTextPlugin.mock.calls[0][0])).not.toMatch(/^https:\/\/(?!localhost)/);
  });

  it('names the box of the Dashboard map as a map of the projects, because no pin moves', async () => {
    await renderWithRuntime(<MapCanvas pins={[]} fitTo="pins" />);
    expect(screen.getByRole('region', { name: 'Map of the projects' })).toBeTruthy();
  });

  it('keeps the map box left to right, because MapLibre places pins and cards that way, also on an Arabic screen', async () => {
    await renderWithRuntime(<MapCanvas pins={[]} />);
    expect(screen.getByRole('region', { name: 'Map of the projects' }).getAttribute('dir')).toBe('ltr');
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

  it('says in one line that the street map is not ready when the map fails before it starts (PRJ-01)', async () => {
    const onFailedChange = vi.fn();
    await renderWithRuntime(<MapCanvas pins={[]} onFailedChange={onFailedChange} />);
    await waitFor(() => expect(made).toHaveLength(1));
    expect(screen.queryByText('The street map is not ready yet.')).toBeNull();
    act(() => made[0].handlers.error.forEach((handler) => handler({ error: new Error('tiles') })));
    expect(await screen.findByText('The street map is not ready yet.')).toBeTruthy();
    expect(onFailedChange).toHaveBeenLastCalledWith(true);
    act(() => made[0].handlers.load.forEach((handler) => handler()));
    await waitFor(() => expect(screen.queryByText('The street map is not ready yet.')).toBeNull());
  });

  it('ignores an error after the map started: MapLibre retries a tile by itself', async () => {
    await renderWithRuntime(<MapCanvas pins={[]} />);
    await waitFor(() => expect(made).toHaveLength(1));
    act(() => made[0].handlers.load.forEach((handler) => handler()));
    act(() => made[0].handlers.error.forEach((handler) => handler({ error: new Error('one tile') })));
    expect(screen.queryByText('The street map is not ready yet.')).toBeNull();
  });

  it('draws each pin with renderPin in a press box of 44 px, and sends the press to onPinClick (PRJ-14)', async () => {
    const onPinClick = vi.fn();
    await renderWithRuntime(
      <MapCanvas pins={[{ id: 'prj_001', point: { lat: 26.3, lng: 50.2 }, label: 'Villa' }]} onPinClick={onPinClick} renderPin={(pin) => <i>{`tile of ${pin.id}`}</i>} />,
    );
    await waitFor(() => expect(markers).toHaveLength(1));
    expect(markers[0].lngLat).toEqual([50.2, 26.3]);
    await waitFor(() => expect(markers[0].element.textContent).toBe('tile of prj_001'));
    const press = markers[0].element.querySelector('button')!;
    expect(press.getAttribute('aria-label')).toBe('Villa');
    expect(press.className).toContain('size-11');
    fireEvent.click(press);
    expect(onPinClick).toHaveBeenCalledWith('prj_001');
  });

  it('opens the card of the chosen pin next to it, and removes the card when no pin is chosen (PRJ-14)', async () => {
    const pins = [{ id: 'prj_001', point: { lat: 26.3, lng: 50.2 }, label: 'Villa' }];
    const view = await renderWithRuntime(<MapCanvas pins={pins} selectedId="prj_001" renderPopup={(id) => <b>{`card of ${id}`}</b>} />);
    await waitFor(() => expect(popups).toHaveLength(1));
    expect(popups[0].lngLat).toEqual([50.2, 26.3]);
    await waitFor(() => expect(popups[0].content?.textContent).toBe('card of prj_001'));
    // The card takes the direction of the screen language again (English here).
    expect(popups[0].content?.firstElementChild?.getAttribute('dir')).toBe('ltr');
    view.rerender(<MapCanvas pins={pins} selectedId={null} renderPopup={(id) => <b>{`card of ${id}`}</b>} />);
    await waitFor(() => expect(popups[0].removed).toBe(true));
  });
});
