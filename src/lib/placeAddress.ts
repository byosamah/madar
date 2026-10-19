import type { GeoPoint } from '../api/contract/entities';
import { gated } from './nominatimGate';
import { parseReverse, reverseUrl } from './placeSearch';

/** The longest time that a screen waits for the address of a place. Then the pin saves with no address. */
export const ADDRESS_WAIT_MS = 5000;

/**
 * The address of a point, for the Location of a project (owner, 2026-10-19). The real build asks OpenStreetMap Nominatim once, through
 * the gate of the search, with no key and no header. It never throws: a failed or slow lookup gives an empty text, and the pin
 * saves with no address. The prototype has no network lookup, so it gives an empty text: a screen then shows "Pinned on the map", never raw numbers.
 */
export async function addressOf(point: GeoPoint, lang: 'en' | 'ar'): Promise<string> {
  // The flag itself, so the bundler folds it, as in PinPicker.tsx.
  if (import.meta.env.VITE_MADAR_API !== 'remote') return '';
  try {
    return await gated(async () => {
      const control = new AbortController();
      const timer = setTimeout(() => control.abort(), ADDRESS_WAIT_MS);
      try {
        const response = await fetch(reverseUrl(point, lang), { signal: control.signal });
        if (!response.ok) return '';
        return parseReverse(await response.json());
      } finally {
        clearTimeout(timer);
      }
    });
  } catch {
    return '';
  }
}
