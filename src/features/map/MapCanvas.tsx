import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type * as MapLib from 'maplibre-gl';
import type { Map as MapLibreMap, Marker } from 'maplibre-gl';
import type { GeoPoint } from '../../api/contract/entities';
import { useLang } from '../../app/lang';
import { MAP_PATHS, START_POINT, START_ZOOM, madarMapStyle, type MapTheme } from './mapStyle';

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
};

let loading: Promise<typeof MapLib> | undefined;

/**
 * Loads MapLibre once (owner, 2026-10-18, fbk_017). The worker is a file of this build, so the page needs no blob worker in its
 * policy. The pmtiles protocol reads the map file, and the Arabic text plugin comes from the own address.
 */
function loadMapLib(): Promise<typeof MapLib> {
  loading ??= (async () => {
    const [lib, pmtiles, worker] = await Promise.all([
      import('maplibre-gl'),
      import('pmtiles'),
      import('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'),
      import('maplibre-gl/dist/maplibre-gl.css'),
    ]);
    lib.setWorkerUrl(worker.default);
    lib.setRTLTextPlugin(MAP_PATHS.rtlText, true).catch(() => undefined);
    lib.addProtocol('pmtiles', new pmtiles.Protocol().tile);
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

/**
 * The one MapLibre wrapper of Madar (owner, 2026-10-18, fbk_017). The map box has a fixed height: MapLibre sets its own box to
 * position relative, so an absolute box would collapse. The box sits inside a sheet with data-vaul-no-drag, so a drag on the map
 * does not close the sheet. The controls sit on the start side of the language.
 */
export default function MapCanvas({ pins, onPinClick, draggablePin = false, onPinMove, onMapClick, fitTo = 'start', centerOn }: MapCanvasProps) {
  const { t } = useTranslation();
  const lang = useLang();
  const theme = useSyncExternalStore(subscribeTheme, themeNow);
  const box = useRef<HTMLDivElement>(null);
  const [mapLib, setMapLib] = useState<typeof MapLib | null>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const shownStyle = useRef('');
  // The latest props and words, so a marker or a map event never calls an old handler.
  const latest = useRef({ theme, lang, pins, onPinClick, onPinMove, onMapClick, pinWord: t('map.canvas.pin') });
  useEffect(() => {
    latest.current = { theme, lang, pins, onPinClick, onPinMove, onMapClick, pinWord: t('map.canvas.pin') };
  });
  const pinsKey = JSON.stringify(pins.map((pin) => [pin.id, pin.point.lat, pin.point.lng, pin.label ?? '']));

  // The map is made once, when the box is on the page.
  useEffect(() => {
    let cancelled = false;
    let made: MapLibreMap | undefined;
    void loadMapLib().then((lib) => {
      const element = box.current;
      if (cancelled || !element) return;
      const { theme: now, lang: language, pins: first } = latest.current;
      const start = first[0]?.point ?? START_POINT;
      made = new lib.Map({
        container: element,
        style: madarMapStyle(now, language),
        center: [start.lng, start.lat],
        zoom: first.length > 0 ? 13 : START_ZOOM,
        attributionControl: false,
      });
      shownStyle.current = `${now}-${language}`;
      made.addControl(new lib.NavigationControl({ showCompass: false }), language === 'ar' ? 'bottom-right' : 'bottom-left');
      made.on('click', (event) => latest.current.onMapClick?.(roundPoint(event.lngLat)));
      setMapLib(lib);
      setMap(made);
    });
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
    const { pins: list, pinWord } = latest.current;
    const markers: Marker[] = list.map((pin) => {
      const element = document.createElement('button');
      element.type = 'button';
      element.setAttribute('aria-label', pin.label ?? pinWord);
      element.style.cssText = 'width:22px;height:22px;padding:0;border-radius:50%;background:var(--c-accent);border:3px solid var(--c-card);box-shadow:0 1px 4px rgba(0,0,0,0.3);cursor:pointer';
      element.addEventListener('click', () => latest.current.onPinClick?.(pin.id));
      const marker = new mapLib.Marker({ element, draggable: draggablePin }).setLngLat([pin.point.lng, pin.point.lat]).addTo(map);
      marker.on('dragend', () => latest.current.onPinMove?.(roundPoint(marker.getLngLat())));
      return marker;
    });
    if (fitTo === 'pins' && list.length > 0) {
      const bounds = new mapLib.LngLatBounds();
      for (const pin of list) bounds.extend([pin.point.lng, pin.point.lat]);
      map.fitBounds(bounds, { padding: 48, maxZoom: 14, duration: 0 });
    }
    return () => {
      for (const marker of markers) marker.remove();
    };
  }, [map, mapLib, pinsKey, draggablePin, fitTo]);

  return (
    <div className="flex flex-col gap-2">
      <div ref={box} data-vaul-no-drag role="region" aria-label={t(draggablePin ? 'map.canvas.label' : 'map.canvas.labelView')} className="h-80 w-full overflow-hidden rounded-card" />
      <p className="text-footnote text-ink-2">{t('map.canvas.attribution')}</p>
    </div>
  );
}
