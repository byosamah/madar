import { Suspense, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GeoPoint } from '../../api/contract/entities';
import { useLang } from '../../app/lang';
import { Button } from '../../components/Button';
import { TextField } from '../../components/Fields';
import { googleMapsUrl, inSaudi, parseMapPoint, pointText, swapPoint } from '../../lib/geo';
import { gated } from '../../lib/nominatimGate';
import { parseResults, searchUrl, shortName, simplerQuery, type PlaceHit } from '../../lib/placeSearch';
import { resolveShortLink, shortLinkIn } from '../../lib/shortLink';
import { lazyMapCanvas } from './mapLib';

// The map loads in the real build only, in a chunk of its own. The flag itself, not REMOTE from mode.ts: the bundler folds this
// comparison. It drops the branch, so the prototype build keeps the paste field alone and no map code (fbk_017).
const MapCanvas = import.meta.env.VITE_MADAR_API === 'remote' ? lazyMapCanvas() : null;
// The short link needs the server function /maplink, which the prototype does not have.
const HAS_SERVER = import.meta.env.VITE_MADAR_API === 'remote';

/** What the one field says about its text. 'outside' keeps the numbers that it read, for the swap. */
type Note = null | 'reading' | 'short' | 'none' | 'stillOutside' | { kind: 'outside'; raw: GeoPoint };

/** The least time between the starts of two searches, as the OpenStreetMap policy asks. */
const SEARCH_GAP_MS = 1000;

/** What the last place search showed. */
type Outcome = { kind: 'idle' } | { kind: 'none' } | { kind: 'failed' } | { kind: 'hits'; hits: PlaceHit[] };

/**
 * The pin of a project in one field (owner, 2026-10-18, fbk_017; one field since the audit of 2026-10-19, PRJ-13). The field takes a
 * Google Maps link or two coordinates and reads them at once. It takes a place name and searches when the person presses Enter
 * (never while the person types). A short link goes to the server, which follows it (PRJ-03). Under the field, the real build
 * shows a small map: a tap sets the pin, and a drag moves it. The result line names the place and gives a link to check it.
 * The prototype build has no map and no search: the field only reads a link or coordinates.
 */
export function PinPicker({ value, onChange, onPlace }: {
  value: GeoPoint | null;
  onChange: (point: GeoPoint | null) => void;
  /** The name of the place when a search hit set the pin, else null. The sheet keeps it for the pin line of the form. */
  onPlace?: (name: string | null) => void;
}) {
  const { t } = useTranslation();
  const lang = useLang();
  const [text, setText] = useState('');
  const [note, setNote] = useState<Note>(null);
  const [view, setView] = useState<GeoPoint | null>(null);
  const [place, setPlace] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  // The number of the last paste: the answer of an older short link is dropped.
  const reading = useRef(0);
  const pins = value ? [{ id: 'pin', point: value }] : [];

  /** A new place from the field: the pin moves, and the map follows. */
  function use(point: GeoPoint, name: string | null = null) {
    setPlace(name);
    onPlace?.(name);
    setView({ ...point });
    onChange(point);
  }

  function edit(next: string) {
    setText(next);
    setOutcome({ kind: 'idle' });
    setPlace(null);
    onPlace?.(null);
    reading.current += 1;
    if (next.trim() === '') {
      setNote(null);
      return;
    }
    const found = parseMapPoint(next);
    if (found === 'short_link') {
      readShortLink(next);
    } else if (found === null) {
      // A name: the real build waits for Enter. The prototype cannot search, so it says so at once.
      setNote(MapCanvas ? null : 'none');
    } else if (inSaudi(found)) {
      setNote(null);
      use(found);
    } else {
      setNote({ kind: 'outside', raw: found });
    }
  }

  function readShortLink(next: string) {
    const link = shortLinkIn(next);
    if (!HAS_SERVER || !link) {
      setNote('short');
      return;
    }
    setNote('reading');
    const mine = reading.current;
    void resolveShortLink(link).then((long) => {
      if (mine !== reading.current) return;
      const found = long ? parseMapPoint(long) : null;
      if (found && found !== 'short_link' && inSaudi(found)) {
        setNote(null);
        use(found);
      } else {
        setNote('short');
      }
    });
  }

  function swap(raw: GeoPoint) {
    const swapped = swapPoint(raw);
    if (!inSaudi(swapped)) {
      setNote('stillOutside');
      return;
    }
    setNote(null);
    setText(pointText(swapped));
    use(swapped);
  }

  /** One request to OpenStreetMap, through the gate that the address lookup shares: one at a time, one second apart. */
  function ask(query: string): Promise<PlaceHit[]> {
    return gated(async () => {
      const response = await fetch(searchUrl(query, lang));
      if (!response.ok) throw new Error(String(response.status));
      return parseResults(await response.json());
    });
  }

  /**
   * Searches a name. When nothing is found, it searches once more with a shorter name (no district word, no city); the gate holds
   * that request until the gap that the OpenStreetMap policy asks has passed. One search runs at a time.
   */
  async function search() {
    const query = text.trim();
    if (query === '' || running.current || parseMapPoint(query) !== null) return;
    running.current = true;
    setBusy(true);
    const started = Date.now();
    try {
      let hits = await ask(query);
      const shorter = simplerQuery(query);
      if (hits.length === 0 && shorter) hits = await ask(shorter);
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

  const moved = (point: GeoPoint) => {
    setPlace(null);
    onPlace?.(null);
    onChange(point);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <TextField
          id="map-find"
          label={t(MapCanvas ? 'map.find.label' : 'map.find.labelPaste')}
          hint={t(MapCanvas ? 'map.find.hint' : 'map.find.hintPaste')}
          value={text}
          dir="auto"
          autoComplete="off"
          enterKeyHint={MapCanvas ? 'search' : undefined}
          aria-busy={busy || undefined}
          onChange={(event) => edit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || !MapCanvas) return;
            event.preventDefault();
            void search();
          }}
        />
        {note === 'reading' && <p role="status" className="text-subheadline text-ink-2">{t('map.paste.reading')}</p>}
        {(note === 'short' || note === 'none' || note === 'stillOutside') && (
          <p role="status" className="text-subheadline text-ink-2">{t(note === 'short' ? 'map.paste.short' : note === 'none' ? 'map.paste.none' : 'map.paste.stillOutside')}</p>
        )}
        {typeof note === 'object' && note && (
          <div className="flex flex-col items-start gap-2">
            <p role="status" className="text-subheadline text-ink-2">{t('map.paste.outside')}</p>
            <Button onClick={() => swap(note.raw)}>{t('map.paste.swap')}</Button>
          </div>
        )}
        {outcome.kind === 'none' && <p role="status" className="text-subheadline text-ink-2">{t('map.search.none')}</p>}
        {outcome.kind === 'failed' && <p role="status" className="text-subheadline text-late">{t('map.search.failed')}</p>}
        {outcome.kind === 'hits' && (
          <ul aria-label={t('map.search.results')} className="hairline flex flex-col">
            {outcome.hits.map((hit, index) => (
              <li key={index}>
                <button
                  type="button"
                  onClick={() => {
                    use({ lat: Number(hit.lat.toFixed(6)), lng: Number(hit.lng.toFixed(6)) }, shortName(hit.name));
                    setOutcome({ kind: 'idle' });
                  }}
                  className="pressable flex min-h-11 w-full items-center py-2 text-start text-subheadline text-ink hover:bg-fill/50"
                >
                  <bdi dir="auto">{hit.name}</bdi>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {MapCanvas && (
        <Suspense fallback={<div className="h-80" />}>
          <MapCanvas pins={pins} draggablePin onPinMove={moved} onMapClick={moved} fitTo="start" centerOn={view} />
        </Suspense>
      )}
      {value && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-subheadline text-ink">
          <span>{place ? <>{t('map.pinned.place')} <bdi dir="auto">{place}</bdi></> : t('map.pinned.map')}</span>
          <a href={googleMapsUrl(value)} target="_blank" rel="noopener noreferrer" className="pressable inline-flex min-h-11 items-center text-link underline underline-offset-2">
            {t('map.pin.open')}
          </a>
        </p>
      )}
    </div>
  );
}
