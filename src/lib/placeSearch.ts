import type { GeoPoint } from '../api/contract/entities';

/** A place that the search found: its name and its point (Task 12b, fbk_017). */
export type PlaceHit = { name: string; lat: number; lng: number };

/** The most hits that one search shows. */
export const MAX_HITS = 5;

/** The search address of OpenStreetMap for one query: Saudi Arabia only, names in the language of the screen. */
export function searchUrl(query: string, lang: 'en' | 'ar'): string {
  return `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(query)}&countrycodes=sa&limit=${MAX_HITS}&accept-language=${lang}`;
}

/** A number from a number or from its text. Anything else gives NaN. */
function numberOf(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return Number.NaN;
}

/** The hits of one answer. A row with no name, or with a point out of range, is dropped. */
export function parseResults(json: unknown): PlaceHit[] {
  if (!Array.isArray(json)) return [];
  const hits: PlaceHit[] = [];
  for (const row of json) {
    if (typeof row !== 'object' || row === null) continue;
    const { display_name: name, lat, lon } = row as Record<string, unknown>;
    const latitude = numberOf(lat);
    const longitude = numberOf(lon);
    if (typeof name !== 'string' || name.trim() === '') continue;
    if (!(Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180)) continue;
    hits.push({ name, lat: latitude, lng: longitude });
    if (hits.length === MAX_HITS) break;
  }
  return hits;
}

/** The words of a district, and the cities of the office, that a second search leaves out (audit 2026-10-19, PRJ-19). */
const LEAVE_OUT = /(?:^|[\s,،.])(?:حي|الحي|district|dist|saudi arabia|السعودية|al[\s-]?khobar|khobar|الخبر|dammam|الدمام|dhahran|الظهران)(?=$|[\s,،.])/gi;

/**
 * A shorter form of a query, for the second search when the first finds nothing: without the word district and without the
 * city. Null when the query does not change, or nothing is left.
 */
export function simplerQuery(query: string): string | null {
  const shorter = query.replace(LEAVE_OUT, ' ').replace(/[,،.]/g, ' ').replace(/\s+/g, ' ').trim();
  return shorter === '' || shorter === query.trim() ? null : shorter;
}

/** The first two parts of a long place name of OpenStreetMap: "Corniche, Al Khobar". */
export function shortName(name: string): string {
  return name.split(',').slice(0, 2).map((part) => part.trim()).join(', ');
}

/** The most characters that the Location of a project may hold (the same limit as the server). */
const ADDRESS_MAX = 120;

/** A number with at most six decimals, as text. */
const degrees = (value: number) => String(Number(value.toFixed(6)));

/**
 * The address of OpenStreetMap for the place of one point: street level, with names in the language of the screen. The Location
 * of a project is the address of its pin (owner, 2026-10-19).
 */
export function reverseUrl(point: GeoPoint, lang: 'en' | 'ar'): string {
  return `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${degrees(point.lat)}&lon=${degrees(point.lng)}&zoom=17&accept-language=${lang}`;
}

/** The first text that the address holds under one of these names. */
function firstOf(address: Record<string, unknown>, names: readonly string[]): string {
  for (const name of names) {
    const value = address[name];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return '';
}

/**
 * A short address from the answer of a reverse lookup: the road and the city ("King Fahd Road, Dammam"), not the long display name.
 * A place with no city gives its district instead. A place with no road gives the district and the city. A place with none of them
 * gives an empty text. Never more than 120 characters.
 */
export function parseReverse(json: unknown): string {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return '';
  const { address } = json as Record<string, unknown>;
  if (typeof address !== 'object' || address === null || Array.isArray(address)) return '';
  const parts = address as Record<string, unknown>;
  const road = firstOf(parts, ['road', 'pedestrian', 'footway']);
  const city = firstOf(parts, ['city', 'town', 'village', 'municipality']);
  const district = firstOf(parts, ['suburb', 'neighbourhood', 'city_district', 'quarter']);
  const chosen = road ? [road, city || district] : [district, city];
  const unique = chosen.filter((part, index) => part !== '' && chosen.indexOf(part) === index);
  return unique.join(', ').slice(0, ADDRESS_MAX).trim();
}
