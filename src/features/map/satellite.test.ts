import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RasterSourceSpecification } from 'maplibre-gl';
import { setTileTokenSource } from '../../app/remote/tileToken';
import { ESRI_POWERED, loadSatelliteTile, satelliteStyle, satelliteUrl } from './satellite';

describe('the satellite view (owner, 2026-10-20)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setTileTokenSource(async () => null);
  });

  it('asks only our own route for the tiles, with no key and no Esri address in the page, and credits Esri and its sources', () => {
    const style = satelliteStyle();
    const source = style.sources.satellite as RasterSourceSpecification;
    expect(source.type).toBe('raster');
    expect(source.tiles).toEqual(['madar-satellite://tile/{z}/{y}/{x}']);
    expect(source.tileSize).toBe(256);
    expect(source.maxzoom).toBe(19);
    expect(source.attribution).toMatch(/^Source: Esri, /);
    expect(JSON.stringify(style)).not.toMatch(/arcgis|token/);
    expect(style.layers).toEqual([{ id: 'satellite', type: 'raster', source: 'satellite' }]);
    // Esri asks for this text on the map at all times while its pictures show.
    expect(ESRI_POWERED).toBe('Powered by Esri');
  });

  it('turns the address of the style into the path of our own route', () => {
    expect(satelliteUrl('madar-satellite://tile/16/27610/43530')).toBe('/satellite/16/27610/43530');
  });

  // The route gives a tile only to a person who is signed in to the copy (server/http/pagesSatellite.ts).
  it('asks the route with the sign-in token of the person, and gives MapLibre the picture', async () => {
    setTileTokenSource(async () => 'a.b.c');
    const fetchTile = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/jpeg' } }));
    vi.stubGlobal('fetch', fetchTile);
    const abort = new AbortController();
    const result = await loadSatelliteTile({ url: 'madar-satellite://tile/4/5/6' }, abort);
    expect(fetchTile).toHaveBeenCalledWith('/satellite/4/5/6', { headers: { Authorization: 'Bearer a.b.c' }, signal: abort.signal });
    expect(new Uint8Array(result.data)).toEqual(new Uint8Array([1, 2, 3]));
  });

  // The route answers JSON for a refusal (no key, signed out, Esri down): no picture, so the map goes back to the street map.
  it('fails a tile that is no picture', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"no_map"}', { status: 404, headers: { 'content-type': 'application/json' } })));
    await expect(loadSatelliteTile({ url: 'madar-satellite://tile/1/1/1' }, new AbortController())).rejects.toThrow();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })));
    await expect(loadSatelliteTile({ url: 'madar-satellite://tile/1/1/1' }, new AbortController())).rejects.toThrow();
  });
});
