import type { PagesEnv } from './pagesForward';

/**
 * The same-origin route of the street map (fbk_017, probe of 2026-10-18). The Pages Function under /map sends each
 * request to the R2 bucket of the MAP binding. Only the keys of the map pass; every other path answers 404. Without the
 * binding, every request answers 404 with map_not_ready, so the route does nothing until the owner OKs the upload.
 */

/** The address prefix of the route. The keys follow it. */
export const MAP_PREFIX = '/map/';
/** The largest read of one request (8 MiB). A PMTiles read is far shorter. */
export const MAP_MAX_RANGE = 8 * 1024 * 1024;
/** How long a browser keeps a map file (one day). */
const MAP_CACHE_CONTROL = 'public, max-age=86400';

/** A byte range: the first byte and the number of bytes. */
export type MapRange = { offset: number; length: number };

/** The part of an R2 object that the route uses. */
export type MapObject = { body: ReadableStream | null; size: number; httpEtag?: string };
/** The part of an R2 bucket that the route uses. */
export type MapBucket = { get(key: string, options?: { range?: MapRange }): Promise<MapObject | null> };

const FONT_FILE = /^fonts\/(Noto Sans Regular|Noto Sans Arabic Regular)\/\d{1,6}-\d{1,6}\.pbf$/;

/**
 * The R2 key of a path below /map/, or null for a path the route does not serve. Only the PMTiles file, the RTL text plugin
 * and the glyph files of the two font stacks pass. The path is decoded first, and the strict pattern refuses every dot
 * segment, every slash and every other name.
 */
export function mapKey(path: string): string | null {
  let key: string;
  try {
    key = decodeURIComponent(path);
  } catch {
    return null;
  }
  if (key === 'sa.pmtiles' || key === 'rtl-text.js' || FONT_FILE.test(key)) return key;
  return null;
}

/**
 * The byte range of a Range header in the form bytes=first-last, or null. Only a closed range passes, with a first byte
 * that is not after the last one and a length of at most MAP_MAX_RANGE.
 */
export function rangeOf(header: string | null | undefined): MapRange | null {
  const match = header ? /^bytes=(\d+)-(\d+)$/.exec(header) : null;
  if (!match) return null;
  const first = Number(match[1]);
  const last = Number(match[2]);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || last < first) return null;
  const length = last - first + 1;
  if (length > MAP_MAX_RANGE) return null;
  return { offset: first, length };
}

/** The content type of a key. The glyphs are protocol buffers, the RTL plugin is a script. */
export function contentTypeOf(key: string): string {
  if (key.endsWith('.pmtiles')) return 'application/octet-stream';
  if (key.endsWith('.pbf')) return 'application/x-protobuf';
  return 'application/javascript';
}

/** The bucket of the MAP binding, when the env has one that can read. */
function bucketOf(env: PagesEnv): MapBucket | undefined {
  const value = env.MAP as { get?: unknown } | undefined;
  return value !== null && typeof value === 'object' && typeof value.get === 'function' ? (value as MapBucket) : undefined;
}

/** A short answer in plain text. Errors are never cached. */
function text(body: string, status: number, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { 'cache-control': 'no-store', ...headers } });
}

/** Answers one request to the map route. A GET reads the R2 object; a Range header reads only that part. */
export async function serveMap(request: Request, env: PagesEnv = {}): Promise<Response> {
  if (request.method !== 'GET') return text('Method not allowed.', 405, { allow: 'GET' });
  const bucket = bucketOf(env);
  if (bucket === undefined) return text('map_not_ready', 404);
  const url = new URL(request.url);
  const key = url.pathname.startsWith(MAP_PREFIX) ? mapKey(url.pathname.slice(MAP_PREFIX.length)) : null;
  if (key === null) return text('Not found.', 404);
  const header = request.headers.get('range');
  const range = header === null ? undefined : (rangeOf(header) ?? undefined);
  if (header !== null && range === undefined) return text('bad_range', 416);

  let object: MapObject | null;
  try {
    object = await bucket.get(key, range ? { range } : undefined);
  } catch {
    return text('map_read_failed', 502);
  }
  if (object === null) return text('Not found.', 404);

  const headers = new Headers({ 'accept-ranges': 'bytes', 'cache-control': MAP_CACHE_CONTROL, 'content-type': contentTypeOf(key) });
  if (object.httpEtag) headers.set('etag', object.httpEtag);
  if (range === undefined) {
    headers.set('content-length', String(object.size));
    return new Response(object.body, { status: 200, headers });
  }
  if (range.offset >= object.size) return text('bad_range', 416, { 'content-range': `bytes */${object.size}` });
  const last = Math.min(range.offset + range.length, object.size) - 1;
  headers.set('content-range', `bytes ${range.offset}-${last}/${object.size}`);
  headers.set('content-length', String(last - range.offset + 1));
  return new Response(object.body, { status: 206, headers });
}
