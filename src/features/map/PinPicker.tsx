import { lazy, Suspense, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GeoPoint } from '../../api/contract/entities';
import { useLang } from '../../app/lang';
import { Button } from '../../components/Button';
import { TextField } from '../../components/Fields';
import { parseMapLink } from '../../lib/geo';
import { parseResults, searchUrl, type PlaceHit } from '../../lib/placeSearch';

// The map loads in the real build only, in a chunk of its own. The flag itself, not REMOTE from mode.ts: the bundler folds this
// comparison. It drops the branch, so the prototype build keeps the paste field alone and no map code (fbk_017).
const MapCanvas = import.meta.env.VITE_MADAR_API === 'remote' ? lazy(() => import('./MapCanvas')) : null;

type Note = 'found' | 'short' | 'none';
const NOTE_KEYS = { found: 'map.paste.found', short: 'map.paste.short', none: 'map.paste.none' } as const;

/** The least time between the starts of two searches, as the OpenStreetMap policy asks. */
const SEARCH_GAP_MS = 1000;

/** What the last place search showed. */
type Outcome = { kind: 'idle' } | { kind: 'none' } | { kind: 'failed' } | { kind: 'hits'; hits: PlaceHit[] };

/** The digits of a pin on the screen: six decimals, as the map stores them. */
export function coordinatesOf(point: GeoPoint): { latitude: number; longitude: number } {
  return { latitude: Number(point.lat.toFixed(6)), longitude: Number(point.lng.toFixed(6)) };
}

/**
 * The place search of the pin picker (Task 12b, fbk_017). It asks OpenStreetMap only when the person presses Search or Enter.
 * It never asks while the person types, and one search runs at a time. The OpenStreetMap policy allows one request each second,
 * so the next search waits until a second has passed since the start of the last one.
 */
function PlaceSearch({ onPick }: { onPick: (point: GeoPoint) => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const [query, setQuery] = useState('');
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  async function search() {
    const text = query.trim();
    if (text === '' || running.current) return;
    running.current = true;
    setBusy(true);
    const started = Date.now();
    try {
      const response = await fetch(searchUrl(text, lang));
      if (!response.ok) throw new Error(String(response.status));
      const hits = parseResults(await response.json());
      setOutcome(hits.length > 0 ? { kind: 'hits', hits } : { kind: 'none' });
    } catch {
      setOutcome({ kind: 'failed' });
    } finally {
      setTimeout(() => {
        running.current = false;
        setBusy(false);
      }, Math.max(0, SEARCH_GAP_MS - (Date.now() - started)));
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <TextField
        id="map-search"
        label={t('map.search.label')}
        hint={t('map.search.hint')}
        value={query}
        dir="auto"
        autoComplete="off"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          void search();
        }}
      />
      <Button className="self-start" disabled={busy || query.trim() === ''} onClick={() => void search()}>
        {t('map.search.button')}
      </Button>
      {outcome.kind === 'none' && <p role="status" className="text-subheadline text-ink-2">{t('map.search.none')}</p>}
      {outcome.kind === 'failed' && <p role="status" className="text-subheadline text-late">{t('map.search.failed')}</p>}
      {outcome.kind === 'hits' && (
        <ul aria-label={t('map.search.results')} className="hairline flex flex-col">
          {outcome.hits.map((hit, index) => (
            <li key={index}>
              <button
                type="button"
                onClick={() => onPick({ lat: Number(hit.lat.toFixed(6)), lng: Number(hit.lng.toFixed(6)) })}
                className="pressable flex min-h-11 w-full items-center py-2 text-start text-subheadline text-ink hover:bg-fill/50"
              >
                <bdi dir="auto">{hit.name}</bdi>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The pin of a project (owner, 2026-10-18, fbk_017). The real build shows a small map: a tap sets the pin, and a drag moves it.
 * The real build also searches a place by name (Task 12b). Both builds take a pasted Google Maps address or a pair of coordinates.
 * A short link gets a message, because it holds no place.
 */
export function PinPicker({ value, onChange }: { value: GeoPoint | null; onChange: (point: GeoPoint | null) => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [note, setNote] = useState<Note | null>(null);
  const [view, setView] = useState<GeoPoint | null>(null);
  const pins = value ? [{ id: 'pin', point: value }] : [];

  function paste(next: string) {
    setText(next);
    if (next.trim() === '') {
      setNote(null);
      return;
    }
    const found = parseMapLink(next);
    if (found === 'short_link') setNote('short');
    else if (found === null) setNote('none');
    else {
      setNote('found');
      onChange(found);
    }
  }

  // A search hit sets the pin and moves the map. A new object moves the map even to a point that it already shows.
  function pick(point: GeoPoint) {
    setView({ ...point });
    onChange(point);
  }

  return (
    <div className="flex flex-col gap-4">
      {MapCanvas && (
        <>
          <PlaceSearch onPick={pick} />
          <Suspense fallback={<div className="h-80" />}>
            <MapCanvas pins={pins} draggablePin onPinMove={onChange} onMapClick={onChange} fitTo="start" centerOn={view} />
          </Suspense>
        </>
      )}
      {value && <p className="text-subheadline text-ink-2">{t('map.pin.value', coordinatesOf(value))}</p>}
      <TextField
        id="map-paste"
        label={t('map.paste.label')}
        hint={t('map.paste.hint')}
        value={text}
        dir="auto"
        autoComplete="off"
        onChange={(event) => paste(event.target.value)}
      />
      {note && <p role="status" className={`text-subheadline ${note === 'found' ? 'text-done' : 'text-ink-2'}`}>{t(NOTE_KEYS[note])}</p>}
    </div>
  );
}
