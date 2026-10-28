import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import type { GeoPoint } from '../../api/contract/entities';
import { renderWithRuntime } from '../../test/render';
import MapCanvas, { foldCredit, releaseUrl } from './MapCanvas';
import { loadSatelliteTile } from './satellite';

// MapLibre runs in a browser, so these tests replace it with a double.
// The map files load in the real build only (mapLib.ts folds the flag), so this test runs as the real build.
vi.hoisted(() => { vi.stubEnv('VITE_MADAR_API', 'remote'); });
type Handler = (event?: unknown) => void;
const made = vi.hoisted(() => [] as { easeTo: (options: unknown) => void; handlers: Record<string, Handler[]>; style: unknown }[]);
const markers = vi.hoisted(() => [] as { element: HTMLElement; lngLat: number[] }[]);
const popups = vi.hoisted(() => [] as { content: HTMLElement | null; lngLat: number[]; options: unknown; removed: boolean }[]);
const controls = vi.hoisted(() => [] as [string, unknown][]);
const rtl = vi.hoisted(() => ({ setRTLTextPlugin: undefined as unknown as ReturnType<typeof vi.fn>, addProtocol: undefined as unknown as ReturnType<typeof vi.fn> }));

vi.mock('maplibre-gl', () => {
  class FakeMap {
    easeTo = vi.fn();
    handlers: Record<string, Handler[]> = {};
    style: unknown;
    constructor(options: { style: unknown }) {
      this.style = options.style;
      made.push(this);
    }
    // A control of Madar (an object with onAdd) puts its box on the page, as MapLibre puts it in a corner of the map.
    addControl(control: { onAdd?: () => HTMLElement }, position?: string) {
      if (typeof control?.onAdd === 'function') {
        const box = control.onAdd();
        box.dataset.corner = position;
        document.body.append(box);
      }
    }
    on(name: string, handler: Handler) {
      (this.handlers[name] ??= []).push(handler);
    }
    remove() {}
    setStyle(style: unknown) {
      this.style = style;
    }
    fitBounds() {}
    getZoom() {
      return 10;
    }
    getBounds() {
      return { contains: () => true };
    }
  }
  class FakeControl {}
  class FakeAttribution {
    constructor(options: unknown) {
      controls.push(['attribution', options]);
    }
  }
  class FakeFullscreen {
    constructor(options: unknown) {
      controls.push(['fullscreen', options]);
    }
  }
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
  rtl.addProtocol = vi.fn();
  return {
    Map: FakeMap,
    NavigationControl: FakeControl,
    AttributionControl: FakeAttribution,
    FullscreenControl: FakeFullscreen,
    LngLatBounds: FakeBounds,
    Marker: FakeMarker,
    Popup: FakePopup,
    setWorkerUrl: vi.fn(),
    setRTLTextPlugin: rtl.setRTLTextPlugin,
    addProtocol: rtl.addProtocol,
  };
});
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

// A browser keeps an assets file for a year with the policy header of its first fetch. The worker obeys its own header, so each
// release asks for the worker by a new address (the owner's map showed no tiles under the old policy, 2026-10-19).
// The owner wants no credit text over the map (2026-10-19): the credit starts as the small "i" alone, and a tap opens it.
describe('the map credit', () => {
  it('starts folded, with only its small button', () => {
    const credit = document.createElement('details');
    credit.className = 'maplibregl-ctrl maplibregl-ctrl-attrib maplibregl-compact maplibregl-compact-show';
    credit.setAttribute('open', '');
    const box = document.createElement('div');
    box.append(credit);
    foldCredit(box);
    expect(credit.hasAttribute('open')).toBe(false);
    expect(credit.classList.contains('maplibregl-compact-show')).toBe(false);
    expect(credit.classList.contains('maplibregl-compact')).toBe(true);
  });
});

describe('the worker address', () => {
  it('carries the release, so a browser fetches the worker again with the policy of this release', () => {
    expect(releaseUrl('/assets/maplibre-gl-worker-a.js', '2026.10.19')).toBe('/assets/maplibre-gl-worker-a.js?release=2026.10.19');
    expect(releaseUrl('/assets/w.js', undefined)).toBe('/assets/w.js?release=0');
  });
});

describe('MapCanvas (fbk_017)', () => {
  beforeEach(() => {
    made.length = 0;
    markers.length = 0;
    popups.length = 0;
    controls.length = 0;
  });

  // This test comes first: the library loads once for the whole file, so only the first render runs the loader.
  // MapLibre 6 shapes Arabic text by itself. The Arabic text plugin ran with eval(), which the policy blocks, and gave an
  // unhandled error in PostHog, so the loader never sets it (owner, 2026-10-28, tsk_486).
  it('draws the tiles of OpenFreeMap, and loads no Arabic text plugin', async () => {
    await renderWithRuntime(<MapCanvas pins={[]} />);
    await waitFor(() => expect(made).toHaveLength(1));
    const style = made[0].style as { sources: { openmaptiles: { url: string } }; glyphs: string };
    expect(style.sources.openmaptiles.url).toBe('https://tiles.openfreemap.org/planet');
    expect(rtl.setRTLTextPlugin).not.toHaveBeenCalled();
    // The satellite tiles go through the loader of Madar, which sends the origin of the page as the referrer (owner, 2026-10-20).
    expect(rtl.addProtocol).toHaveBeenCalledWith('madar-satellite', loadSatelliteTile);
  });

  // The owner asked for no credit line under the map (2026-10-19). The free data still needs its credit (ODbL), so it is the small
  // button of MapLibre inside the map: open when the map starts, folded after the first move.
  it('credits OpenStreetMap inside the map as a small button, and shows no credit line under the map', async () => {
    await renderWithRuntime(<MapCanvas pins={[]} />);
    await waitFor(() => expect(controls.some(([name]) => name === 'attribution')).toBe(true));
    const [, options] = controls.find(([name]) => name === 'attribution')!;
    expect(options).toMatchObject({ compact: true });
    expect(String((options as { customAttribution: string }).customAttribution)).toMatch(/OpenStreetMap/);
    expect(screen.queryByText(/OpenStreetMap contributors/)).toBeNull();
  });

  it('offers full screen only to a map that asks for it', async () => {
    await renderWithRuntime(<MapCanvas pins={[]} fullscreen />);
    await waitFor(() => expect(made).toHaveLength(1));
    expect(controls.filter(([name]) => name === 'fullscreen')).toHaveLength(1);
    controls.length = 0;
    made.length = 0;
    await renderWithRuntime(<MapCanvas pins={[]} />);
    await waitFor(() => expect(made).toHaveLength(1));
    expect(controls.filter(([name]) => name === 'fullscreen')).toHaveLength(0);
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

// The satellite view (owner, 2026-10-20): Esri World Imagery through our own route, with the office's Esri key. A build without the
// flag (the prototype, a copy with no key) shows no button.
describe('the satellite view of MapCanvas', () => {
  type Style = { sources: Record<string, { type: string; tiles?: string[] }> };
  const styleNow = () => made[made.length - 1].style as Style;
  const button = (name: string) => screen.findByRole('button', { name });

  beforeEach(() => {
    made.length = 0;
    controls.length = 0;
    window.localStorage.removeItem('madar.mapLayer');
    vi.stubEnv('VITE_MADAR_SATELLITE', 'on');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    window.localStorage.removeItem('madar.mapLayer');
    for (const box of document.querySelectorAll('[data-corner]')) box.remove();
  });

  it('shows no Satellite button in a build without the flag', async () => {
    vi.stubEnv('VITE_MADAR_SATELLITE', '');
    await renderWithRuntime(<MapCanvas pins={[]} />);
    await waitFor(() => expect(made).toHaveLength(1));
    expect(screen.queryByRole('button', { name: 'Satellite' })).toBeNull();
  });

  it('switches to the satellite pictures and back with one small button in the top start corner, with "Powered by Esri" while they show', async () => {
    await renderWithRuntime(<MapCanvas pins={[]} draggablePin />);
    const satellite = await button('Satellite');
    expect(satellite.closest('[data-corner]')).toHaveAttribute('data-corner', 'top-left');
    expect(styleNow().sources.openmaptiles).toBeDefined();
    expect(screen.queryByText('Powered by Esri')).toBeNull();
    fireEvent.click(satellite);
    await waitFor(() => expect(styleNow().sources.satellite?.tiles?.[0]).toBe('madar-satellite://tile/{z}/{y}/{x}'));
    expect(await screen.findByText('Powered by Esri')).toBeInTheDocument();
    fireEvent.click(await button('Street map'));
    await waitFor(() => expect(styleNow().sources.openmaptiles).toBeDefined());
    expect(screen.queryByText('Powered by Esri')).toBeNull();
  });

  it('keeps the choice for the next map', async () => {
    const first = await renderWithRuntime(<MapCanvas pins={[]} />);
    fireEvent.click(await button('Satellite'));
    await waitFor(() => expect(styleNow().sources.satellite).toBeDefined());
    first.unmount();
    made.length = 0;
    await renderWithRuntime(<MapCanvas pins={[]} fitTo="pins" />);
    await waitFor(() => expect(made).toHaveLength(1));
    expect(styleNow().sources.satellite).toBeDefined();
    expect(await button('Street map')).toBeInTheDocument();
  });

  it('goes back to the street map with one line when the satellite pictures do not come, and hides the button', async () => {
    await renderWithRuntime(<MapCanvas pins={[]} />);
    await waitFor(() => expect(made).toHaveLength(1));
    act(() => made[0].handlers.load.forEach((handler) => handler()));
    fireEvent.click(await button('Satellite'));
    await waitFor(() => expect(styleNow().sources.satellite).toBeDefined());
    act(() => made[0].handlers.error.forEach((handler) => handler({ sourceId: 'satellite', error: new Error('498') })));
    expect(await screen.findByText('The satellite view is not ready. The street map shows.')).toBeInTheDocument();
    await waitFor(() => expect(styleNow().sources.openmaptiles).toBeDefined());
    expect(screen.queryByRole('button', { name: 'Satellite' })).toBeNull();
    expect(screen.queryByText('The street map is not ready yet.')).toBeNull();
  });

  it('keeps the satellite view after its first picture came: a later tile error is a tile that MapLibre retries', async () => {
    await renderWithRuntime(<MapCanvas pins={[]} />);
    await waitFor(() => expect(made).toHaveLength(1));
    act(() => made[0].handlers.load.forEach((handler) => handler()));
    fireEvent.click(await button('Satellite'));
    await waitFor(() => expect(styleNow().sources.satellite).toBeDefined());
    act(() => made[0].handlers.data.forEach((handler) => handler({ sourceId: 'satellite', tile: {} })));
    act(() => made[0].handlers.error.forEach((handler) => handler({ sourceId: 'satellite', error: new Error('one tile') })));
    expect(screen.queryByText('The satellite view is not ready. The street map shows.')).toBeNull();
    expect(styleNow().sources.satellite).toBeDefined();
  });
});
