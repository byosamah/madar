import type { StyleSpecification } from 'maplibre-gl';
import { tileToken } from '../../app/remote/tileToken';

/**
 * The satellite view of the maps (owner, 2026-10-20): Esri World Imagery, with Madar's own key of the office's Esri account (ArcGIS
 * Location Platform, 2,000,000 basemap tiles a month at no cost, shared with Kutla). No free service with no account has pictures sharp
 * enough for a plot, and Esri's terms ask a business for an account.
 *
 * The browser never asks Esri: one of its edge addresses never answers from Saudi networks (measured by Kutla, 2026-10-12). It asks
 * our own route /satellite/<z>/<y>/<x> (server/http/pagesSatellite.ts), which adds the key, a Pages secret. A build shows the button
 * only with VITE_MADAR_SATELLITE=on in config/remote.<env>.env.
 */

/** The scheme of the satellite tiles in the style. MapLibre hands each tile of this scheme to loadSatelliteTile. */
export const SATELLITE_SCHEME = 'madar-satellite';

/** Esri asks for this text on the map at all times while its pictures show. It is a legal credit, so it stays English. */
export const ESRI_POWERED = 'Powered by Esri';

/** The sources of the pictures, as Esri lists them for its imagery. The small "i" of the map shows them. */
const SATELLITE_CREDIT = 'Source: Esri, Vantor, GeoEye, Earthstar Geographics, CNES/Airbus DS, USDA, USGS, AeroGRID, IGN, and the GIS User Community';

/** The deepest zoom that the route serves (MAX_ZOOM in server/http/pagesSatellite.ts). Deeper, MapLibre enlarges these tiles. */
const SATELLITE_MAX_ZOOM = 19;

export function satelliteStyle(): StyleSpecification {
  return {
    version: 8,
    name: 'Madar satellite',
    sources: { satellite: { type: 'raster', tiles: [`${SATELLITE_SCHEME}://tile/{z}/{y}/{x}`], tileSize: 256, maxzoom: SATELLITE_MAX_ZOOM, attribution: SATELLITE_CREDIT } },
    layers: [{ id: 'satellite', type: 'raster', source: 'satellite' }],
  };
}

/** The address of our own route for a tile of the style: madar-satellite://tile/3/2/5 is /satellite/3/2/5 of this site. */
export function satelliteUrl(url: string): string {
  return url.replace(`${SATELLITE_SCHEME}://tile/`, '/satellite/');
}

/**
 * Loads one satellite tile from our own route, with the sign-in token of the person (the route refuses a person who is signed out).
 * A tile that is not a picture fails, so a route with no key or an Esri that does not answer sends the map back to the street map.
 */
export async function loadSatelliteTile(params: { url: string }, abort: AbortController): Promise<{ data: ArrayBuffer }> {
  const token = await tileToken();
  const response = await fetch(satelliteUrl(params.url), { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: abort.signal });
  if (!response.ok || !(response.headers.get('content-type') ?? '').startsWith('image/')) throw new Error(`The satellite tile did not come (${response.status}).`);
  return { data: await response.arrayBuffer() };
}
