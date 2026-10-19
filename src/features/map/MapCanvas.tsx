import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type * as MapLib from 'maplibre-gl';
import type { Map as MapLibreMap, Marker, Popup } from 'maplibre-gl';
import type { GeoPoint } from '../../api/contract/entities';
import { useLang } from '../../app/lang';
import { START_POINT, START_ZOOM, madarMapStyle, type MapTheme } from './mapStyle';

export type MapPin = { id: string; point: GeoPoint; label?: string };

export type MapCanvasProps = {
  pins: MapPin[];
  onPinClick?: (id: string) => void;
  /** One pin moves by a drag. A drag sends its new point to onPinMove. */
  draggablePin?: boolean;
  onPinMove?: (point: GeoPoint) => void;
  /** A tap or a click on the map. The pin picker sets its pin there. */
  onMapClick?: (point: GeoPoint) => void;
  /** 'pins' fits the view to every pin. 'start' centers on the first pin, or on Al Khobar when there is none. */
  fitTo?: 'pins' | 'start';
  /** A new point moves the view to it, with a zoom of at least 14. A search hit sets it. The pins do not move the view. */
  centerOn?: GeoPoint | null;
  /** The look of one pin. With none, a pin is a round dot. The content sits in a box of 44 px, the size of a touch target. */
  renderPin?: (pin: MapPin, selected: boolean) => ReactNode;
  /** The pin that is chosen. With renderPopup, its card opens next to it. */
  selectedId?: string | null;
  /** The card next to the chosen pin (a computer). A phone shows the card in a sheet, outside the map. */
  renderPopup?: (id: string) => ReactNode;
  /** The person closed the card by a press on the map. */
  onPopupClose?: () => void;
  /** True while the map does not start (no WebGL, or the tiles do not come). The screen then shows the card outside the map. */
  onFailedChange?: (failed: boolean) => void;
  /** A button beside the zoom opens the map full screen (owner, 2026-10-19). A browser with no full screen (iPhone) fills its window. */
  fullscreen?: boolean;
  /** A shorter map for a side panel (the project Overview). */
  compact?: boolean;
  /** The name of the map for a screen reader. With none, a view map is "Map of the projects". */
  label?: string;
};

/**
 * The credit of the free map, as OpenFreeMap sends it in its TileJSON (MapLibre shows one copy of the same text). The data is free
 * only with this credit (ODbL). It is the small button of MapLibre inside the map, not a line under it (owner, 2026-10-19).
 */
const MAP_CREDIT =
  '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';

let loading: Promise<typeof MapLib> | undefined;

/**
 * Loads MapLibre once (owner, 2026-10-18, fbk_017). The worker is a file of this build, so the page needs no blob worker in its
 * policy. The Arabic text plugin is a file of this build as well, never from a third party (owner, 2026-10-19). The tiles and the
 * glyphs come from OpenFreeMap (mapStyle.ts).
 */
/**
 * The address of a file with the release in it. A browser keeps an assets file for a year with the policy header of its first
 * fetch, and the map worker obeys its own header, not the page's. A new address each release makes the browser fetch the worker
 * again with the policy of this release (the owner's map showed no tiles under the old policy, 2026-10-19).
 */
export function releaseUrl(url: string, release: string | undefined): string {
  return `${url}?release=${encodeURIComponent(release ?? '0')}`;
}

function loadMapLib(): Promise<typeof MapLib> {
  loading ??= (async () => {
    const [lib, worker, rtl] = await Promise.all([
      import('maplibre-gl'),
      import('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'),
      // A path into node_modules: the package lists only src/index.js in its exports, so the built plugin file has no package name.
      import('../../../node_modules/@mapbox/mapbox-gl-rtl-text/dist/mapbox-gl-rtl-text.js?url'),
      import('maplibre-gl/dist/maplibre-gl.css'),
      import('./mapPopup.css'),
    ]);
    lib.setWorkerUrl(releaseUrl(worker.default, import.meta.env.VITE_MADAR_BUILD));
    lib.setRTLTextPlugin(new URL(rtl.default, window.location.href).href, true).catch(() => undefined);
    return lib;
  })();
  return loading;
}

/** A point with six decimals: about 10 cm, more than a pin needs. */
const roundPoint = (point: { lat: number; lng: number }): GeoPoint => ({ lat: Number(point.lat.toFixed(6)), lng: Number(point.lng.toFixed(6)) });

/** The theme of the page: the data-theme of the root element, which the appearance sync sets. */
function subscribeTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}
const themeNow = (): MapTheme => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

/** The round dot of a pin with no look of its own (the pin picker): the accent color with a ring, in a box of 44 px. */
function Dot({ label }: { label: string }) {
  return (
    <span role="img" aria-label={label} className="grid size-11 place-items-center">
      <span className="size-6 rounded-full border-[3px] border-card bg-accent shadow-md" />
    </span>
  );
}

/**
 * The one MapLibre wrapper of Madar (owner, 2026-10-18, fbk_017). The map box has a fixed height: MapLibre sets its own box to
 * position relative, so an absolute box would collapse. The box sits inside a sheet with data-vaul-no-drag, so a drag on the map
 * does not close the sheet. The controls sit on the start side of the language. A pin is a React tree in a MapLibre marker (a
 * portal), so it can use the project tile. When the map cannot start or the tiles do not load, the box says so in one line.
 */
export default function MapCanvas({ pins, onPinClick, draggablePin = false, onPinMove, onMapClick, fitTo = 'start', centerOn, renderPin, selectedId = null, renderPopup, onPopupClose, onFailedChange, fullscreen = false, compact = false, label }: MapCanvasProps) {
  const { t } = useTranslation();
  const lang = useLang();
  const theme = useSyncExternalStore(subscribeTheme, themeNow);
  const box = useRef<HTMLDivElement>(null);
  const [mapLib, setMapLib] = useState<typeof MapLib | null>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [failed, setFailed] = useState(false);
  const [hosts, setHosts] = useState<{ id: string; element: HTMLElement }[]>([]);
  const [popupHost, setPopupHost] = useState<HTMLElement | null>(null);
  const shownStyle = useRef('');
  useEffect(() => onFailedChange?.(failed), [failed, onFailedChange]);
  // The latest props and words, so a marker or a map event never calls an old handler.
  const latest = useRef({ theme, lang, pins, onPinClick, onPinMove, onMapClick, onPopupClose, fullscreen });
  useEffect(() => {
    latest.current = { theme, lang, pins, onPinClick, onPinMove, onMapClick, onPopupClose, fullscreen };
  });
  const pinsKey = JSON.stringify(pins.map((pin) => [pin.id, pin.point.lat, pin.point.lng, pin.label ?? '']));

  // The map is made once, when the box is on the page.
  useEffect(() => {
    let cancelled = false;
    let made: MapLibreMap | undefined;
    loadMapLib().then((lib) => {
      const element = box.current;
      if (cancelled || !element) return;
      const { theme: now, lang: language, pins: first } = latest.current;
      const start = first[0]?.point ?? START_POINT;
      try {
        made = new lib.Map({
          container: element,
          style: madarMapStyle(now, language),
          center: [start.lng, start.lat],
          zoom: first.length > 0 ? 13 : START_ZOOM,
          attributionControl: false,
        });
      } catch {
        // A browser with no WebGL cannot draw the map.
        setFailed(true);
        return;
      }
      shownStyle.current = `${now}-${language}`;
      const near = language === 'ar' ? 'bottom-right' : 'bottom-left';
      made.addControl(new lib.NavigationControl({ showCompass: false }), near);
      if (latest.current.fullscreen) made.addControl(new lib.FullscreenControl({}), near);
      made.addControl(new lib.AttributionControl({ compact: true, customAttribution: MAP_CREDIT }), language === 'ar' ? 'bottom-left' : 'bottom-right');
      made.on('click', (event) => latest.current.onMapClick?.(roundPoint(event.lngLat)));
      // An error before the first load is a map that does not start (the tiles or the style do not come). Later errors retry by themselves.
      let started = false;
      made.on('load', () => {
        started = true;
        setFailed(false);
      });
      made.on('error', () => {
        if (!started) setFailed(true);
      });
      setMapLib(lib);
      setMap(made);
    }, () => setFailed(true));
    return () => {
      cancelled = true;
      made?.remove();
    };
  }, []);

  // A change of the theme or the language changes the style. The pins stay, because they are not part of the style.
  useEffect(() => {
    if (!map) return;
    const key = `${theme}-${lang}`;
    if (shownStyle.current === key) return;
    shownStyle.current = key;
    map.setStyle(madarMapStyle(theme, lang));
  }, [map, theme, lang]);

  // A new centerOn point moves the view to it. The pins stay where they are.
  useEffect(() => {
    if (!map || !centerOn) return;
    map.easeTo({ center: [centerOn.lng, centerOn.lat], zoom: Math.max(map.getZoom(), 14), duration: 0 });
  }, [map, centerOn]);

  // The pins: one marker for each. The markers are made again when the pins change, not while one is dragged.
  useEffect(() => {
    if (!map || !mapLib) return;
    const { pins: list } = latest.current;
    const made: { id: string; element: HTMLElement; marker: Marker }[] = list.map((pin) => {
      const element = document.createElement('div');
      const marker = new mapLib.Marker({ element, draggable: draggablePin }).setLngLat([pin.point.lng, pin.point.lat]).addTo(map);
      marker.on('dragend', () => latest.current.onPinMove?.(roundPoint(marker.getLngLat())));
      return { id: pin.id, element, marker };
    });
    setHosts(made.map(({ id, element }) => ({ id, element })));
    if (fitTo === 'pins' && list.length > 0) {
      const bounds = new mapLib.LngLatBounds();
      for (const pin of list) bounds.extend([pin.point.lng, pin.point.lat]);
      map.fitBounds(bounds, { padding: 72, maxZoom: 14, duration: 0 });
    }
    return () => {
      for (const { marker } of made) marker.remove();
      setHosts([]);
    };
  }, [map, mapLib, pinsKey, draggablePin, fitTo]);

  // The card of the chosen pin opens next to it. A pin out of the view moves into it first.
  const chosen = renderPopup && selectedId ? pins.find((pin) => pin.id === selectedId) : undefined;
  const chosenLat = chosen?.point.lat;
  const chosenLng = chosen?.point.lng;
  useEffect(() => {
    if (!map || !mapLib || chosenLat === undefined || chosenLng === undefined) return;
    const element = document.createElement('div');
    const popup: Popup = new mapLib.Popup({ closeButton: false, closeOnClick: true, maxWidth: 'none', offset: 28, className: 'madar-popup' })
      .setLngLat([chosenLng, chosenLat])
      .setDOMContent(element)
      .addTo(map);
    // Only a press on the map closes the card for the person. A change of the chosen pin removes the old card and says nothing.
    let silent = false;
    popup.on('close', () => {
      if (!silent) latest.current.onPopupClose?.();
    });
    if (!map.getBounds().contains([chosenLng, chosenLat])) map.easeTo({ center: [chosenLng, chosenLat], duration: 0 });
    setPopupHost(element);
    return () => {
      silent = true;
      popup.remove();
      setPopupHost(null);
    };
  }, [map, mapLib, chosenLat, chosenLng]);

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        {/* MapLibre places pins, cards and controls in a left to right box: on an Arabic screen (dir="rtl") they land far away. The cards set the language direction again. */}
        <div ref={box} dir="ltr" data-vaul-no-drag role="region" aria-label={label ?? t(draggablePin ? 'map.canvas.label' : 'map.canvas.labelView')} className={`w-full overflow-hidden rounded-card ${compact ? 'h-56' : draggablePin ? 'h-80' : 'h-96 sm:h-[30rem]'}`} />
        {failed && (
          <p role="status" className="absolute inset-0 grid place-items-center rounded-card bg-fill p-6 text-center text-subheadline text-ink-2">
            {t('map.canvas.failed')}
          </p>
        )}
      </div>
      {hosts.map(({ id, element }) => {
        const pin = pins.find((item) => item.id === id);
        if (!pin) return null;
        const label = pin.label ?? t('map.canvas.pin');
        return createPortal(
          renderPin ? (
            <button type="button" aria-label={label} aria-pressed={selectedId === id} onClick={() => onPinClick?.(id)} className="pressable grid size-11 place-items-center">
              {renderPin(pin, selectedId === id)}
            </button>
          ) : (
            <Dot label={label} />
          ),
          element,
          id,
        );
      })}
      {popupHost && chosen && renderPopup && createPortal(<div dir={lang === 'ar' ? 'rtl' : 'ltr'}>{renderPopup(chosen.id)}</div>, popupHost)}
    </div>
  );
}
