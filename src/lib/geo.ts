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
/** A short link holds no coordinates: the screens ask for the full address. */
const SHORT_LINK = /maps\.app\.goo\.gl|goo\.gl\/maps/i;

const FORMS = [PLACE_DATA, AT_PART, QUERY_PART, PLAIN_PAIR];

/** Decimal degrees as a point, or null when a value is not a number or is out of range. */
function pointOf(lat: string, lng: string): GeoPoint | null {
  const point = { lat: Number(lat), lng: Number(lng) };
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return null;
  return Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180 ? point : null;
}

/**
 * Reads a pin from text that a person pasted (owner, 2026-10-18, fbk_017). It reads a pair of coordinates, or a Google Maps
 * address that holds them. A short link holds no coordinates, so it gives 'short_link'. Null: the text holds no pin.
 * Arabic-Indic digits, the Arabic decimal mark and the Arabic comma count too, as an Arabic keyboard types them.
 */
export function parseMapLink(text: string): GeoPoint | 'short_link' | null {
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
