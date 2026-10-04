import { describe, expect, it } from 'vitest';
import { supabaseStorageFilesPort } from './supabaseStorage';

const SECRET = 'sb_secret_test_value';
const NOW = new Date('2026-10-04T09:30:00.000Z');
const BASE = 'http://127.0.0.1:54321';

type Seen = { method: string; url: string; headers: Headers; body: string };

/** A JWT with this payload, as Storage gives in a signed link (the test reads only exp and iat). */
function token(payload: Record<string, unknown>): string {
  const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part(payload)}.c2ln`;
}

function store(answer: (seen: Seen) => Response | Promise<Response>) {
  const seen: Seen[] = [];
  const fetchImpl = (async (input: Request | string | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const one = { method: request.method, url: request.url, headers: request.headers, body: request.body ? await request.text() : '' };
    seen.push(one);
    return answer(one);
  }) as typeof fetch;
  const port = supabaseStorageFilesPort({ supabaseUrl: `${BASE}/`, secretKey: SECRET, bucket: 'madar-files', fetch: fetchImpl, now: () => NOW });
  return { seen, port };
}

const exp = Math.floor(NOW.getTime() / 1000) + 7200;

describe('the Supabase Storage store: signed upload links (plan 2b, point 1; proof.md, Z0a item 6)', () => {
  it('signs the staging key with object/upload/sign, with the secret key and without upsert', async () => {
    const { seen, port } = store(() => Response.json({ url: `/object/upload/sign/madar-files/up/upl-1/file?token=${token({ exp, iat: exp - 7200 })}` }));
    const put = await port.presignPut('up/upl-1/file', { mimeType: 'application/pdf', size: 2048 });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: 'POST', url: `${BASE}/storage/v1/object/upload/sign/madar-files/up/upl-1/file` });
    expect(seen[0].headers.get('apikey')).toBe(SECRET);
    expect(seen[0].headers.get('authorization')).toBe(`Bearer ${SECRET}`);
    // Never upsert: a second PUT must not replace the staging object between the check and the copy.
    expect(seen[0].headers.has('x-upsert')).toBe(false);
    expect(seen[0].body).not.toMatch(/upsert/i);
    expect(put.url.startsWith(`${BASE}/storage/v1/object/upload/sign/madar-files/up/upl-1/file?token=`)).toBe(true);
    expect(put.headers).toEqual({ 'Content-Type': 'application/pdf' });
  });

  it('asks the upload for application/octet-stream for every download-only type, and the clean type for a safe one', async () => {
    const signed = () => store(() => Response.json({ url: `/object/upload/sign/madar-files/up/upl-1/file?token=${token({ exp, iat: exp - 7200 })}` }));
    for (const mimeType of ['text/html', 'application/xhtml+xml', 'image/svg+xml', 'text/xml', 'text/xsl', 'image/png;x=1, text/html', 'x']) {
      expect((await signed().port.presignPut('up/upl-1/file', { mimeType })).headers, mimeType).toEqual({ 'Content-Type': 'application/octet-stream' });
    }
    expect((await signed().port.presignPut('up/upl-1/file', { mimeType: 'Image/PNG' })).headers).toEqual({ 'Content-Type': 'image/png' });
  });

  it('reports the real life of the upload link: 2 hours, from the token', async () => {
    const { port } = store(() => Response.json({ url: `/object/upload/sign/madar-files/up/upl-1/file?token=${token({ exp, iat: exp - 7200 })}` }));
    expect((await port.presignPut('up/upl-1/file', { mimeType: 'image/png' })).expiresAt).toBe('2026-10-04T11:30:00.000Z');
  });

  it('falls back to 2 hours from now when the token does not say', async () => {
    const { port } = store(() => Response.json({ url: '/object/upload/sign/madar-files/up/upl-1/file?token=opaque' }));
    expect((await port.presignPut('up/upl-1/file', { mimeType: 'image/png' })).expiresAt).toBe('2026-10-04T11:30:00.000Z');
  });

  it('refuses a key outside the key rules before it calls Storage', async () => {
    const { seen, port } = store(() => Response.json({}));
    await expect(port.presignPut('../etc', { mimeType: 'image/png' })).rejects.toThrow(/not a valid object key/);
    expect(seen).toHaveLength(0);
  });
});

describe('the Supabase Storage store: the address of the links for the browser (whole-product check after wave 4)', () => {
  // A local function sees SUPABASE_URL=http://kong:8000, a name that only the Docker network knows. The browser must get the
  // address of the Mac, or every upload and download fails with ERR_NAME_NOT_RESOLVED.
  const INNER = 'http://kong:8000';
  function split(answer: (seen: Seen) => Response) {
    const seen: Seen[] = [];
    const fetchImpl = (async (input: Request | string | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const one = { method: request.method, url: request.url, headers: request.headers, body: request.body ? await request.text() : '' };
      seen.push(one);
      return answer(one);
    }) as typeof fetch;
    const port = supabaseStorageFilesPort({ supabaseUrl: INNER, publicUrl: `${BASE}/`, secretKey: SECRET, bucket: 'madar-files', fetch: fetchImpl, now: () => NOW });
    return { seen, port };
  }

  it('signs an upload on SUPABASE_URL and gives the browser the link on publicUrl', async () => {
    const { seen, port } = split(() => Response.json({ url: `/object/upload/sign/madar-files/up/upl-1/file?token=${token({ exp })}` }));
    const put = await port.presignPut('up/upl-1/file', { mimeType: 'image/png' });
    expect(seen[0].url).toBe(`${INNER}/storage/v1/object/upload/sign/madar-files/up/upl-1/file`);
    expect(put.url.startsWith(`${BASE}/storage/v1/object/upload/sign/madar-files/up/upl-1/file?token=`)).toBe(true);
  });

  it('signs a download on SUPABASE_URL and gives the browser the link on publicUrl', async () => {
    const { seen, port } = split(() => Response.json({ signedURL: '/object/sign/madar-files/prj-001/fil-001/1/file?token=abc' }));
    const get = await port.presignGet('prj-001/fil-001/1/file', { disposition: 'inline', filename: 'plan.png', mimeType: 'image/png' });
    expect(seen[0].url).toBe(`${INNER}/storage/v1/object/sign/madar-files/prj-001/fil-001/1/file`);
    expect(get.url).toBe(`${BASE}/storage/v1/object/sign/madar-files/prj-001/fil-001/1/file?token=abc`);
  });

  it('gives the links on SUPABASE_URL when no publicUrl is set, as on a hosted project', async () => {
    const { port } = store(() => Response.json({ signedURL: '/object/sign/madar-files/a/file?token=abc' }));
    expect((await port.presignGet('prj-001/fil-001/1/file', { disposition: 'inline', filename: 'a.png', mimeType: 'image/png' })).url.startsWith(`${BASE}/storage/v1/`)).toBe(true);
  });
});

describe('the Supabase Storage store: signed download links', () => {
  const signed = () => store((s) => Response.json({ signedURL: `${new URL(s.url).pathname.replace('/storage/v1', '')}?token=abc` }));

  it('signs for 10 minutes, and an attachment carries download=<file name>, percent-encoded', async () => {
    const { seen, port } = signed();
    const get = await port.presignGet('prj-001/fil-001/1/file', { disposition: 'attachment', filename: 'مخطط الطابق الأرضي.pdf', mimeType: 'application/pdf' });
    expect(seen[0]).toMatchObject({ method: 'POST', url: `${BASE}/storage/v1/object/sign/madar-files/prj-001/fil-001/1/file` });
    expect(JSON.parse(seen[0].body)).toEqual({ expiresIn: 600 });
    expect(get.url).toBe(`${BASE}/storage/v1/object/sign/madar-files/prj-001/fil-001/1/file?token=abc&download=${encodeURIComponent('مخطط الطابق الأرضي.pdf')}`);
    expect(new URL(get.url).searchParams.get('download')).toBe('مخطط الطابق الأرضي.pdf');
    expect(get.expiresAt).toBe('2026-10-04T09:40:00.000Z');
  });

  it('keeps an inline PDF or picture without download, for the preview', async () => {
    const { port } = signed();
    const get = await port.presignGet('prj-001/fil-001/1/file', { disposition: 'inline', filename: 'plan.pdf', mimeType: 'application/pdf' });
    expect(new URL(get.url).searchParams.has('download')).toBe(false);
  });

  it('always signs HTML, SVG, XHTML, XSL, every XML type and every comma type with download, in any case and with parameters', async () => {
    for (const mimeType of ['text/html', 'TEXT/HTML; charset=utf-8', 'image/svg+xml', 'application/xhtml+xml', 'text/xml', 'application/atom+xml', 'text/xsl', 'TEXT/XSL; charset=utf-8', 'image/png;x=1, text/html', 'text/plain, text/html', 'x']) {
      const { port } = signed();
      const get = await port.presignGet('prj-001/fil-001/1/file', { disposition: 'inline', filename: 'page.html', mimeType });
      expect(new URL(get.url).searchParams.get('download'), mimeType).toBe('page.html');
    }
  });

  it('puts a safe name in download: no folder parts, never empty', async () => {
    const { port } = signed();
    const get = await port.presignGet('prj-001/fil-001/1/file', { disposition: 'attachment', filename: '../../x/../a.pdf', mimeType: 'application/pdf' });
    expect(new URL(get.url).searchParams.get('download')).toBe('a.pdf');
  });
});

describe('the Supabase Storage store: object checks', () => {
  it('head reads object/info: the size, and the type in lower case without parameters', async () => {
    const { seen, port } = store(() => Response.json({ name: 'up/upl-1/file', size: 2048, content_type: 'TEXT/HTML; charset=utf-8', etag: '"e"' }));
    expect(await port.head('up/upl-1/file')).toEqual({ size: 2048, mimeType: 'text/html' });
    expect(seen[0]).toMatchObject({ method: 'GET', url: `${BASE}/storage/v1/object/info/madar-files/up/upl-1/file` });
  });

  it('head keeps a comma type whole, so it never equals the clean type of the intent', async () => {
    for (const type of ['image/png;x=1, text/html', 'text/plain, text/html']) {
      const { port } = store(() => Response.json({ size: 5, content_type: type }));
      expect(await port.head('up/upl-1/file'), type).toEqual({ size: 5, mimeType: type });
    }
  });

  it('head also reads the metadata form of object/info', async () => {
    const { port } = store(() => Response.json({ metadata: { size: 10, mimetype: 'image/png' } }));
    expect(await port.head('up/upl-1/file')).toEqual({ size: 10, mimeType: 'image/png' });
  });

  it('head returns null for a missing object, in both forms that Storage uses', async () => {
    const missing404 = store(() => Response.json({ statusCode: '404', error: 'not_found', message: 'Object not found' }, { status: 404 }));
    expect(await missing404.port.head('up/upl-1/file')).toBeNull();
    const missing400 = store(() => Response.json({ statusCode: '404', error: 'not_found', message: 'Object not found' }, { status: 400 }));
    expect(await missing400.port.head('up/upl-1/file')).toBeNull();
  });

  it('head gives up after its timeout', async () => {
    const { port } = store((s) => new Promise<Response>(() => void s));
    await expect(port.head('up/upl-1/file', { timeoutMs: 50 })).rejects.toThrow(/did not answer in 50 ms/);
  });

  it('copy sends the bucket and both keys to object/copy', async () => {
    const { seen, port } = store(() => Response.json({ Key: 'madar-files/prj-001/fil-001/1/file' }));
    await port.copy('up/upl-1/file', 'prj-001/fil-001/1/file');
    expect(seen[0]).toMatchObject({ method: 'POST', url: `${BASE}/storage/v1/object/copy` });
    expect(JSON.parse(seen[0].body)).toEqual({ bucketId: 'madar-files', sourceKey: 'up/upl-1/file', destinationKey: 'prj-001/fil-001/1/file' });
    expect(seen[0].headers.has('x-upsert')).toBe(false);
  });

  it('remove sends the keys in groups of at most 1000, and nothing for no keys', async () => {
    const { seen, port } = store(() => Response.json([]));
    await port.remove([]);
    expect(seen).toHaveLength(0);
    const keys = Array.from({ length: 1001 }, (_, i) => `a/b/${i + 1}/file`);
    await port.remove(keys);
    expect(seen.map((s) => [s.method, s.url, (JSON.parse(s.body) as { prefixes: string[] }).prefixes.length])).toEqual([
      ['DELETE', `${BASE}/storage/v1/object/madar-files`, 1000],
      ['DELETE', `${BASE}/storage/v1/object/madar-files`, 1],
    ]);
  });

  it('an error names the step, the status and the Storage code, never the secret key', async () => {
    const { port } = store(() => Response.json({ statusCode: '403', error: 'Unauthorized', message: `bad key ${SECRET}` }, { status: 403 }));
    const error = await port.copy('up/upl-1/file', 'a/b/1/file').catch((e: Error) => e);
    expect(String(error)).toMatch(/Storage copy failed with 403 \(Unauthorized\)/);
    expect(String(error)).not.toContain(SECRET);
  });
});
