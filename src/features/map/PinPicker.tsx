import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GeoPoint } from '../../api/contract/entities';
import { TextField } from '../../components/Fields';
import { parseMapLink } from '../../lib/geo';

// The map loads in the real build only, in a chunk of its own. The flag itself, not REMOTE from mode.ts: the bundler folds this
// comparison. It drops the branch, so the prototype build keeps the paste field alone and no map code (fbk_017).
const MapCanvas = import.meta.env.VITE_MADAR_API === 'remote' ? lazy(() => import('./MapCanvas')) : null;

type Note = 'found' | 'short' | 'none';
const NOTE_KEYS = { found: 'map.paste.found', short: 'map.paste.short', none: 'map.paste.none' } as const;

/** The digits of a pin on the screen: six decimals, as the map stores them. */
export function coordinatesOf(point: GeoPoint): { latitude: number; longitude: number } {
  return { latitude: Number(point.lat.toFixed(6)), longitude: Number(point.lng.toFixed(6)) };
}

/**
 * The pin of a project (owner, 2026-10-18, fbk_017). The real build shows a small map: a tap sets the pin, and a drag moves it.
 * Both builds take a pasted Google Maps address or a pair of coordinates. A short link gets a message, because it holds no place.
 */
export function PinPicker({ value, onChange }: { value: GeoPoint | null; onChange: (point: GeoPoint | null) => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [note, setNote] = useState<Note | null>(null);
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

  return (
    <div className="flex flex-col gap-4">
      {MapCanvas && (
        <Suspense fallback={<div className="h-80" />}>
          <MapCanvas pins={pins} draggablePin onPinMove={onChange} onMapClick={onChange} fitTo="start" />
        </Suspense>
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
