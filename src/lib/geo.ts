import type { GeoPoint } from '../api/contract/entities';

const NUMBER = '(-?\\d+(?:\\.\\d+)?)';
/** The "!3d lat !4d lng" data of a place address. It is the most exact form, so it wins. */
const PLACE_DATA = new RegExp(`!3d${NUMBER}!4d${NUMBER}`);
/** The "@lat,lng,zoom" part of a Google Maps address. */
const AT_PART = new RegExp(`@${NUMBER},${NUMBER}`);
/** The "q=lat,lng" and "ll=lat,lng" query parts. */
const QUERY_PART = new RegExp(`[?&](?:q|ll)=${NUMBER},${NUMBER}`);
/** A plain pair of coordinates that is the whole text, latitude first. */
const PLAIN_PAIR = new RegExp(`^${NUMBER}\\s*,\\s*${NUMBER}$`);
/** A short link holds no coordinates: the server follows it to the full address (/maplink), or the screens ask for the full address. */
export const SHORT_LINK = /maps\.app\.goo\.gl|goo\.gl\/maps/i;

const FORMS = [PLACE_DATA, AT_PART, QUERY_PART, PLAIN_PAIR];

/** Decimal degrees as a point, or null when a value is not a number or is out of range. */
function pointOf(lat: string, lng: string): GeoPoint | null {
  const point = { lat: Number(lat), lng: Number(lng) };
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return null;
  return Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180 ? point : null;
}

/**
 * The pair of numbers in a text, with no area check. A short link gives 'short_link'. Null: the text holds no pair.
 * Arabic-Indic digits, the Arabic decimal mark and the Arabic comma count too, as an Arabic keyboard types them.
 */
export function parseMapPoint(text: string): GeoPoint | 'short_link' | null {
  const western = text.trim()
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/٫/g, '.')
    .replace(/،/g, ',');
  if (SHORT_LINK.test(western)) return 'short_link';
  for (const form of FORMS) {
    const match = form.exec(western);
    if (match) return pointOf(match[1], match[2]);
  }
  return null;
}

/** The box of Saudi Arabia (PRJ-02): a point inside it is a place of the office. A swapped pair lands far outside it. */
export function inSaudi(point: GeoPoint): boolean {
  return point.lat >= 16 && point.lat <= 33 && point.lng >= 34 && point.lng <= 56;
}

/** The same two numbers in the other order. */
export const swapPoint = (point: GeoPoint): GeoPoint => ({ lat: point.lng, lng: point.lat });

/**
 * Reads a pin from text that a person pasted (owner, 2026-10-18, fbk_017). It reads a pair of coordinates, or a Google Maps
 * address that holds them. A short link holds no coordinates, so it gives 'short_link'. A pair outside Saudi Arabia gives
 * 'outside' and sets no pin: a swapped pair is the usual cause (audit 2026-10-19, PRJ-02). Null: the text holds no pin.
 */
export function parseMapLink(text: string): GeoPoint | 'short_link' | 'outside' | null {
  const found = parseMapPoint(text);
  if (found === null || found === 'short_link') return found;
  return inSaudi(found) ? found : 'outside';
}

/** A point as text for a person: Latin digits and a Latin comma in both languages, so the order never turns round. */
export function pointText(point: GeoPoint): string {
  return `${Number(point.lat.toFixed(6))}, ${Number(point.lng.toFixed(6))}`;
}

/** The Google Maps address of a pin: one tap opens the place, with directions (audit 2026-10-19, PRJ-04). */
export function googleMapsUrl(point: GeoPoint): string {
  return `https://www.google.com/maps?q=${Number(point.lat.toFixed(6))},${Number(point.lng.toFixed(6))}`;
}

/**
 * The place of a project from its links (audit 2026-10-19, PRJ-04): the first location link that holds coordinates inside Saudi
 * Arabia. A project with no pin of its own (old data) shows this place, and a saved location link sets the pin with it.
 */
export function pinFromLinks(links: readonly { kind: string; url: string }[] | undefined): GeoPoint | null {
  for (const link of links ?? []) {
    if (link.kind !== 'location') continue;
    const found = parseMapLink(link.url);
    if (found !== null && typeof found === 'object') return found;
  }
  return null;
}
