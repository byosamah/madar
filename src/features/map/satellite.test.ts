import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RasterSourceSpecification } from 'maplibre-gl';
import { ESRI_POWERED, loadSatelliteTile, satelliteStyle, satelliteUrl } from './satellite';

describe('the satellite view (owner, 2026-10-20)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('draws the Esri World Imagery tiles with the key, through the loader of Madar, and credits Esri and its sources', () => {
    const style = satelliteStyle('KEY 1');
    const source = style.sources.satellite as RasterSourceSpecification;
    expect(source.type).toBe('raster');
    expect(source.tiles).toEqual(['madar-satellite://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=KEY%201']);
    expect(source.tileSize).toBe(256);
    expect(source.attribution).toMatch(/^Source: Esri, /);
    expect(style.layers).toEqual([{ id: 'satellite', type: 'raster', source: 'satellite' }]);
    // Esri asks for this text on the map at all times while its pictures show.
    expect(ESRI_POWERED).toBe('Powered by Esri');
  });

  it('turns the address of the loader into the Esri address', () => {
    expect(satelliteUrl('madar-satellite://ibasemaps-api.arcgis.com/a/tile/1/2/3?token=K')).toBe('https://ibasemaps-api.arcgis.com/a/tile/1/2/3?token=K');
  });

  // The page sends no referrer (Referrer-Policy: no-referrer), and the key works only for the Madar hosts. A tile sends the origin
  // of the page, never its path.
  it('asks Esri for a tile with the origin of the page as the referrer, and gives MapLibre the picture', async () => {
    const picture = new Uint8Array([1, 2, 3]).buffer;
    const fetchTile = vi.fn(async () => new Response(picture, { status: 200, headers: { 'content-type': 'image/jpeg' } }));
    vi.stubGlobal('fetch', fetchTile);
    const abort = new AbortController();
    const result = await loadSatelliteTile({ url: 'madar-satellite://ibasemaps-api.arcgis.com/t/4/5/6?token=K' }, abort);
    expect(fetchTile).toHaveBeenCalledWith('https://ibasemaps-api.arcgis.com/t/4/5/6?token=K', { referrerPolicy: 'strict-origin', signal: abort.signal });
    expect(new Uint8Array(result.data)).toEqual(new Uint8Array([1, 2, 3]));
  });

  // Esri answers a bad or old key with a page of JSON and status 200, not with a picture.
  it('fails a tile that is no picture, so the map goes back to the street map', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":{"code":498}}', { status: 200, headers: { 'content-type': 'application/json' } })));
    await expect(loadSatelliteTile({ url: 'madar-satellite://ibasemaps-api.arcgis.com/t/1/1/1?token=K' }, new AbortController())).rejects.toThrow();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 403 })));
    await expect(loadSatelliteTile({ url: 'madar-satellite://ibasemaps-api.arcgis.com/t/1/1/1?token=K' }, new AbortController())).rejects.toThrow();
  });
});
