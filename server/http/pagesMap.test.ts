import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contentTypeOf, MAP_MAX_RANGE, mapKey, rangeOf, serveMap } from './pagesMap';

type Range = { offset: number; length: number };

/** A fake R2 bucket. It keeps the objects of the test, reads a range as R2 does, and records each read. */
function fakeBucket(objects: Record<string, Uint8Array>, failure?: Error) {
  const reads: Array<{ key: string; range?: Range }> = [];
  return {
    reads,
    get: async (key: string, options?: { range?: Range }) => {
      if (failure) throw failure;
      reads.push({ key, range: options?.range });
      const data = objects[key];
      if (data === undefined) return null;
      const part = options?.range ? data.slice(options.range.offset, options.range.offset + options.range.length) : data;
      const body = new ReadableStream({ start: (controller) => (controller.enqueue(part), controller.close()) });
      return { body, size: data.byteLength, httpEtag: '"v1"' };
    },
  };
}

const PMTILES = new TextEncoder().encode('0123456789abcdef');
const FONT = new TextEncoder().encode('font');
const env = (bucket: unknown) => ({ MAP: bucket });
const get = (path: string, headers: Record<string, string> = {}, method = 'GET') =>
  new Request(`https://preview.madar-46r.pages.dev${path}`, { method, headers });

describe('the keys of the map route (server/http/pagesMap.ts)', () => {
  it('allows the PMTiles file, the RTL text plugin and the glyph files of both font stacks', () => {
    expect(mapKey('sa.pmtiles')).toBe('sa.pmtiles');
    expect(mapKey('rtl-text.js')).toBe('rtl-text.js');
    expect(mapKey('fonts/Noto Sans Regular/0-255.pbf')).toBe('fonts/Noto Sans Regular/0-255.pbf');
    expect(mapKey('fonts/Noto Sans Arabic Regular/256-511.pbf')).toBe('fonts/Noto Sans Arabic Regular/256-511.pbf');
  });

  // Noto Sans Regular holds the Arabic glyphs too: its range file 1536-1791 is the Arabic block (110 KB, checked 2026-10-18).
  it('allows the Arabic block of the Noto Sans Regular glyphs', () => {
    expect(mapKey('fonts/Noto Sans Regular/1536-1791.pbf')).toBe('fonts/Noto Sans Regular/1536-1791.pbf');
  });

  it('decodes the percent escapes of a font stack name', () => {
    expect(mapKey('fonts/Noto%20Sans%20Regular/0-255.pbf')).toBe('fonts/Noto Sans Regular/0-255.pbf');
  });

  it('refuses every other key, traversal included', () => {
    const refused = [
      '', 'sa.pmtiles/', 'other.pmtiles', '/sa.pmtiles', '../sa.pmtiles', 'fonts/../sa.pmtiles', 'fonts/%2e%2e/sa.pmtiles',
      'fonts/Noto Sans Regular/../../sa.pmtiles', 'fonts/Other Font/0-255.pbf', 'fonts/Noto Sans Regular/0-255.pbf.exe',
      'fonts/Noto Sans Regular/a-b.pbf', 'fonts/Noto Sans Regular/0-255.pbf?x=1', 'fonts/Noto Sans Regular//0-255.pbf',
      'rtl-text.js.map', '%E0%A4%A',
    ];
    for (const path of refused) expect(mapKey(path), path).toBeNull();
  });
});

describe('the byte range of a request', () => {
  it('reads a closed byte range as an offset and a length', () => {
    expect(rangeOf('bytes=0-16383')).toEqual({ offset: 0, length: 16384 });
    expect(rangeOf('bytes=100-199')).toEqual({ offset: 100, length: 100 });
  });

  it('refuses every other range form and a range over the largest read', () => {
    const refused: Array<string | null | undefined> = [
      undefined, null, '', 'items=0-1', 'bytes=-500', 'bytes=0-', 'bytes=0-1,5-6', 'bytes=5-4', `bytes=0-${MAP_MAX_RANGE}`,
    ];
    for (const header of refused) expect(rangeOf(header), String(header)).toBeNull();
  });

  it('allows a range of the largest read', () => {
    expect(rangeOf(`bytes=0-${MAP_MAX_RANGE - 1}`)).toEqual({ offset: 0, length: MAP_MAX_RANGE });
  });
});

describe('the content type of a key', () => {
  it('gives the type of each kind of file', () => {
    expect(contentTypeOf('sa.pmtiles')).toBe('application/octet-stream');
    expect(contentTypeOf('fonts/Noto Sans Regular/0-255.pbf')).toBe('application/x-protobuf');
    expect(contentTypeOf('rtl-text.js')).toBe('application/javascript');
  });
});

describe('the map route answers (serveMap)', () => {
  it('answers 404 with map_not_ready when the MAP binding is missing', async () => {
    const answer = await serveMap(get('/map/sa.pmtiles'), {});
    expect(answer.status).toBe(404);
    expect(await answer.text()).toBe('map_not_ready');
  });

  it('answers 404 with map_not_ready when the binding cannot read', async () => {
    const answer = await serveMap(get('/map/sa.pmtiles'), { MAP: {} });
    expect(answer.status).toBe(404);
    expect(await answer.text()).toBe('map_not_ready');
  });

  it('sends a range read to R2 and answers 206 with that range', async () => {
    const bucket = fakeBucket({ 'sa.pmtiles': PMTILES });
    const answer = await serveMap(get('/map/sa.pmtiles', { range: 'bytes=0-3' }), env(bucket));
    expect(answer.status).toBe(206);
    expect(await answer.text()).toBe('0123');
    expect(answer.headers.get('content-range')).toBe('bytes 0-3/16');
    expect(answer.headers.get('content-length')).toBe('4');
    expect(answer.headers.get('accept-ranges')).toBe('bytes');
    expect(answer.headers.get('cache-control')).toBe('public, max-age=86400');
    expect(answer.headers.get('content-type')).toBe('application/octet-stream');
    expect(answer.headers.get('etag')).toBe('"v1"');
    expect(bucket.reads).toEqual([{ key: 'sa.pmtiles', range: { offset: 0, length: 4 } }]);
  });

  it('answers the whole file with 200 when the request has no range', async () => {
    const bucket = fakeBucket({ 'sa.pmtiles': PMTILES });
    const answer = await serveMap(get('/map/sa.pmtiles'), env(bucket));
    expect(answer.status).toBe(200);
    expect(await answer.text()).toBe('0123456789abcdef');
    expect(answer.headers.get('content-length')).toBe('16');
    expect(bucket.reads).toEqual([{ key: 'sa.pmtiles', range: undefined }]);
  });

  it('clips a range that runs past the end of the file', async () => {
    const bucket = fakeBucket({ 'sa.pmtiles': PMTILES });
    const answer = await serveMap(get('/map/sa.pmtiles', { range: 'bytes=12-99' }), env(bucket));
    expect(answer.status).toBe(206);
    expect(await answer.text()).toBe('cdef');
    expect(answer.headers.get('content-range')).toBe('bytes 12-15/16');
    expect(answer.headers.get('content-length')).toBe('4');
  });

  it('answers 416 when the range starts past the end of the file', async () => {
    const answer = await serveMap(get('/map/sa.pmtiles', { range: 'bytes=20-30' }), env(fakeBucket({ 'sa.pmtiles': PMTILES })));
    expect(answer.status).toBe(416);
    expect(answer.headers.get('content-range')).toBe('bytes */16');
  });

  it('answers 416 for a range the route does not read, without an R2 read', async () => {
    const bucket = fakeBucket({ 'sa.pmtiles': PMTILES });
    const answer = await serveMap(get('/map/sa.pmtiles', { range: 'bytes=5-2' }), env(bucket));
    expect(answer.status).toBe(416);
    expect(bucket.reads).toEqual([]);
  });

  it('answers 404 for a key the route does not allow, without an R2 read', async () => {
    const bucket = fakeBucket({ 'sa.pmtiles': PMTILES });
    for (const path of ['/map/other.pmtiles', '/map/fonts/Other Font/0-255.pbf', '/sa.pmtiles', '/map']) {
      const answer = await serveMap(get(path), env(bucket));
      expect(answer.status, path).toBe(404);
      expect(await answer.text(), path).toBe('Not found.');
    }
    expect(bucket.reads).toEqual([]);
  });

  it('answers 404 when R2 has no such object', async () => {
    const answer = await serveMap(get('/map/rtl-text.js'), env(fakeBucket({})));
    expect(answer.status).toBe(404);
    expect(await answer.text()).toBe('Not found.');
  });

  it('serves a glyph file with its own content type', async () => {
    const answer = await serveMap(get('/map/fonts/Noto%20Sans%20Regular/0-255.pbf'), env(fakeBucket({ 'fonts/Noto Sans Regular/0-255.pbf': FONT })));
    expect(answer.status).toBe(200);
    expect(answer.headers.get('content-type')).toBe('application/x-protobuf');
    expect(await answer.text()).toBe('font');
  });

  it('answers 405 for a method other than GET, without an R2 read', async () => {
    const bucket = fakeBucket({ 'sa.pmtiles': PMTILES });
    const answer = await serveMap(get('/map/sa.pmtiles', {}, 'POST'), env(bucket));
    expect(answer.status).toBe(405);
    expect(answer.headers.get('allow')).toBe('GET');
    expect(bucket.reads).toEqual([]);
  });

  it('answers 502 when the R2 read fails', async () => {
    const answer = await serveMap(get('/map/sa.pmtiles'), env(fakeBucket({}, new Error('R2 is down'))));
    expect(answer.status).toBe(502);
    expect(await answer.text()).toBe('map_read_failed');
  });
});

it('the Pages Function under /map calls serveMap', () => {
  const text = readFileSync(new URL('../../functions/map/[[path]].ts', import.meta.url), 'utf8');
  expect(text).toMatch(/export const onRequest = \(\{ request, env \}[^\n]*=> serveMap\(request, env\);/);
});
