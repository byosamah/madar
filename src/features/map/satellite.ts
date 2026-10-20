import type { StyleSpecification } from 'maplibre-gl';

/**
 * The satellite view of the maps (owner, 2026-10-20): Esri World Imagery, with the key of the office's free Esri developer account
 * (ArcGIS Location Platform, 2,000,000 basemap tiles a month at no cost). No free service with no account has pictures sharp enough
 * for a plot, and Esri's terms ask a business for an account. The key is public (every page holds it) and works only for the Madar
 * hosts that the account lists. It comes from VITE_ESRI_KEY in config/remote.<env>.env.
 */
export const SATELLITE_SOURCE = {
  host: 'https://ibasemaps-api.arcgis.com',
  tiles: 'https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
} as const;

/** The scheme of the satellite tiles in the style. MapLibre hands each tile of this scheme to loadSatelliteTile. */
export const SATELLITE_SCHEME = 'madar-satellite';

/** Esri asks for this text on the map at all times while its pictures show. It is a legal credit, so it stays English. */
export const ESRI_POWERED = 'Powered by Esri';

/** The sources of the pictures, as Esri lists them for its imagery. The small "i" of the map shows them. */
const SATELLITE_CREDIT = 'Source: Esri, Vantor, GeoEye, Earthstar Geographics, CNES/Airbus DS, USDA, USGS, AeroGRID, IGN, and the GIS User Community';

/** The deepest zoom with pictures in Esri's tiles for the cities of the office. Deeper, MapLibre enlarges the tiles of this zoom. */
const SATELLITE_MAX_ZOOM = 19;

export function satelliteStyle(key: string): StyleSpecification {
  const tiles = `${SATELLITE_SOURCE.tiles.replace('https://', `${SATELLITE_SCHEME}://`)}?token=${encodeURIComponent(key)}`;
  return {
    version: 8,
    name: 'Madar satellite',
    sources: { satellite: { type: 'raster', tiles: [tiles], tileSize: 256, maxzoom: SATELLITE_MAX_ZOOM, attribution: SATELLITE_CREDIT } },
    layers: [{ id: 'satellite', type: 'raster', source: 'satellite' }],
  };
}

export function satelliteUrl(url: string): string {
  return url.replace(`${SATELLITE_SCHEME}://`, 'https://');
}

/**
 * Loads one satellite tile. The page sends no referrer (Referrer-Policy: no-referrer), and the key works only for the Madar hosts,
 * so this request alone sends the origin of the page, never its path. Esri answers a bad or old key with JSON and status 200: a tile
 * that is not a picture fails, and the map goes back to the street map.
 */
export async function loadSatelliteTile(params: { url: string }, abort: AbortController): Promise<{ data: ArrayBuffer }> {
  const response = await fetch(satelliteUrl(params.url), { referrerPolicy: 'strict-origin', signal: abort.signal });
  if (!response.ok || !(response.headers.get('content-type') ?? '').startsWith('image/')) throw new Error(`The satellite tile did not come (${response.status}).`);
  return { data: await response.arrayBuffer() };
}
