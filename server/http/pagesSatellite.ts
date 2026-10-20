import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { COPY_HOSTS, copyOfPageHost, type Copy } from '../core/serverHost';
import type { PagesEnv } from './pagesForward';

/**
 * GET /satellite/<z>/<y>/<x>: one satellite tile of the maps, through our own edge (owner, 2026-10-20). The Esri satellite host
 * answers from four edge addresses, and one of them never finishes the secure handshake from Saudi networks (measured by Kutla,
 * 2026-10-12): a browser sends every tile of a host over one connection, so a bad pick stalls the whole map. Cloudflare reaches Esri
 * well, so this function asks Esri, with a time limit and one more try, and the browser asks only its own site.
 *
 * The key is Madar's own Esri key (owner, 2026-10-20): the Pages secret ESRI_KEY. It never reaches a page, a URL
 * of the browser or a log. Only a person signed in to the copy of the host gets a tile, so the route is no open way to Esri. The
 * tile is not stored on our side; the browser keeps it for the day, as Esri allows. Esri's terms ask for "Powered by Esri" on the
 * map while the pictures show (src/features/map/satellite.ts).
 */

export const IMAGERY = 'https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer';
/**
 * The key works only with the referrer that its Esri settings list: https://madar.vado.sa. The server sends it for both copies,
 * because the browser never asks Esri.
 */
export const ESRI_REFERER = 'https://madar.vado.sa';

/** The maps never ask for more than zoom 19 (SATELLITE_MAX_ZOOM in src/features/map/satellite.ts). */
const MAX_ZOOM = 19;
const TIMEOUT_MS = 8000;
const MAX_BYTES = 2_000_000;
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
/** An Esri key is letters, digits, `_`, `-`, `.` and `=`: nothing that could end the token in a URL. */
const KEY_SHAPE = /^[A-Za-z0-9_.=-]{20,300}$/;
const TILE_PATH = /^\/satellite\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})$/;
const BEARER = /^bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i;
const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };

const answer = (body: unknown, status: number): Response => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

export type SatelliteDeps = { fetch: typeof fetch; keySet: (copy: Copy) => JWTVerifyGetKey };

/** The key set of Supabase Auth of each copy, made once for each function instance. */
const keySets = new Map<Copy, JWTVerifyGetKey>();
function keySetOf(copy: Copy): JWTVerifyGetKey {
  let set = keySets.get(copy);
  if (!set) {
    set = createRemoteJWKSet(new URL(`${COPY_HOSTS[copy].supabaseUrl}/auth/v1/.well-known/jwks.json`));
    keySets.set(copy, set);
  }
  return set;
}

/**
 * True for a browser token of a person of this copy, with the rules of the api function (server/auth/verify.ts): ES256 only, the
 * issuer of the copy, the audience and role "authenticated", a sub, and no client_id (an agent token). A key set that does not load
 * throws, so the route answers 503 and never treats an outage as a refusal.
 */
async function isPerson(header: string | null, copy: Copy, keySet: JWTVerifyGetKey): Promise<boolean> {
  const match = header === null ? null : BEARER.exec(header.trim());
  if (!match) return false;
  try {
    const { payload } = await jwtVerify(match[1], keySet, {
      issuer: `${COPY_HOSTS[copy].supabaseUrl}/auth/v1`, audience: 'authenticated', algorithms: ['ES256'], clockTolerance: 5,
    });
    return (payload.client_id === undefined || payload.client_id === null) && payload.role === 'authenticated' && typeof payload.sub === 'string' && payload.sub !== '';
  } catch (error) {
    if (error instanceof errors.JOSEError && !(error instanceof errors.JWKSTimeout)) return false;
    throw error;
  }
}

type Got = { kind: 'tile'; type: string; bytes: ArrayBuffer } | { kind: 'none' } | { kind: 'failed' };

/** Ask Esri, at most twice: a reset, a time-out and a 5xx get one more try; a 404 and any other answer end it. */
async function askEsri(url: string, run: typeof fetch): Promise<Got> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await run(url, { headers: { referer: ESRI_REFERER }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (response.status >= 500) continue;
      if (response.status === 404) return { kind: 'none' };
      const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      // Esri can answer 200 with a JSON error (a bad key), so the type decides, not the status.
      if (!response.ok || !TYPES.has(type)) return { kind: 'failed' };
      const bytes = await response.arrayBuffer();
      return bytes.byteLength > 0 && bytes.byteLength <= MAX_BYTES ? { kind: 'tile', type, bytes } : { kind: 'failed' };
    } catch {
      // A reset or a time-out: one more try.
    }
  }
  return { kind: 'failed' };
}

const whole = (value: string, max: number): number | null => (Number(value) <= max ? Number(value) : null);

export async function satelliteTile(request: Request, env: PagesEnv, deps: SatelliteDeps = { fetch, keySet: keySetOf }): Promise<Response> {
  const url = new URL(request.url);
  const copy = copyOfPageHost(url.hostname);
  if (!copy) return answer({ error: 'not_found' }, 404);
  if (request.method !== 'GET') return answer({ error: 'method_not_allowed' }, 405);
  const parts = url.search === '' ? TILE_PATH.exec(url.pathname) : null;
  const z = parts ? whole(parts[1], MAX_ZOOM) : null;
  const span = z === null ? 0 : 2 ** z - 1;
  const y = parts && z !== null ? whole(parts[2], span) : null;
  const x = parts && z !== null ? whole(parts[3], span) : null;
  if (z === null || y === null || x === null) return answer({ error: 'bad_tile' }, 400);
  let person: boolean;
  try {
    person = await isPerson(request.headers.get('authorization'), copy, deps.keySet(copy));
  } catch {
    return answer({ error: 'sign_in_check_failed' }, 503);
  }
  if (!person) return answer({ error: 'signed_out' }, 401);
  const key = typeof env.ESRI_KEY === 'string' ? env.ESRI_KEY.trim() : '';
  if (!KEY_SHAPE.test(key)) return answer({ error: 'no_map' }, 404);
  const got = await askEsri(`${IMAGERY}/tile/${z}/${y}/${x}?token=${key}`, deps.fetch);
  if (got.kind === 'none') return answer({ error: 'no_tile' }, 404);
  // Never pass Esri's own answer on: an error page could name the key.
  if (got.kind === 'failed') return answer({ error: 'tile_unavailable' }, 502);
  return new Response(got.bytes, { headers: { 'content-type': got.type, 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff' } });
}
