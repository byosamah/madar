import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { r2FilesPort, type R2Env } from './r2';

const ENV: R2Env = { accountId: 'acc123', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret-example', bucket: 'madar-files' };
const NOW = new Date('2026-10-04T09:30:00.000Z');

/** An independent check of an AWS SigV4 query signature (the S3 form that R2 and MinIO read), so the test does not trust aws4fetch. */
function sigV4Valid(method: string, link: string, headers: Record<string, string>, secret: string): boolean {
  const url = new URL(link);
  const params = [...url.searchParams.entries()].filter(([k]) => k !== 'X-Amz-Signature');
  const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  const query = params.map(([k, v]) => [enc(k), enc(v)]).sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('&');
  const signed = url.searchParams.get('X-Amz-SignedHeaders')!.split(';');
  const all: Record<string, string> = { host: url.host, ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])) };
  const canonicalHeaders = signed.map((h) => `${h}:${all[h].trim()}\n`).join('');
  const canonical = [method, url.pathname, query, canonicalHeaders, signed.join(';'), 'UNSIGNED-PAYLOAD'].join('\n');
  const datetime = url.searchParams.get('X-Amz-Date')!;
  const [, date, region, service] = url.searchParams.get('X-Amz-Credential')!.split('/');
  const scope = `${date}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', datetime, scope, createHash('sha256').update(canonical).digest('hex')].join('\n');
  let key: Buffer = createHmac('sha256', `AWS4${secret}`).update(date).digest();
  for (const part of [region, service, 'aws4_request']) key = createHmac('sha256', key).update(part).digest();
  return createHmac('sha256', key).update(toSign).digest('hex') === url.searchParams.get('X-Amz-Signature');
}

function port(fetchImpl?: typeof fetch) {
  return r2FilesPort({ ...ENV, now: () => NOW, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
}

describe('the R2 store: signed upload links (plan 5.2)', () => {
  it('signs a PUT on the EU endpoint for 10 minutes, with only Content-Type signed beside the host', async () => {
    const put = await port().presignPut('up/upl-1/file', { mimeType: 'application/pdf', size: 10 });
    const url = new URL(put.url);
    expect(url.origin).toBe('https://acc123.eu.r2.cloudflarestorage.com');
    expect(url.pathname).toBe('/madar-files/up/upl-1/file');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': 'AKIDEXAMPLE/20261004/auto/s3/aws4_request',
      'X-Amz-Date': '20261004T093000Z',
      'X-Amz-Expires': '600',
      'X-Amz-SignedHeaders': 'content-type;host',
    });
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(put.headers).toEqual({ 'Content-Type': 'application/pdf' });
    expect(put.expiresAt).toBe('2026-10-04T09:40:00.000Z');
    expect(sigV4Valid('PUT', put.url, { 'content-type': 'application/pdf' }, ENV.secretAccessKey)).toBe(true);
  });

  it('signs application/octet-stream as the upload type for every download-only type, and the clean type for a safe one', async () => {
    for (const mimeType of ['text/html', 'application/xhtml+xml', 'image/svg+xml', 'text/xsl', 'image/png;x=1, text/html', 'x']) {
      const put = await port().presignPut('up/upl-1/file', { mimeType });
      expect(put.headers, mimeType).toEqual({ 'Content-Type': 'application/octet-stream' });
      expect(sigV4Valid('PUT', put.url, { 'content-type': 'application/octet-stream' }, ENV.secretAccessKey), mimeType).toBe(true);
      expect(sigV4Valid('PUT', put.url, { 'content-type': 'text/html' }, ENV.secretAccessKey), mimeType).toBe(false);
    }
    const png = await port().presignPut('up/upl-1/file', { mimeType: 'Image/PNG' });
    expect(png.headers).toEqual({ 'Content-Type': 'image/png' });
    expect(sigV4Valid('PUT', png.url, { 'content-type': 'image/png' }, ENV.secretAccessKey)).toBe(true);
  });

  it('makes a signature that fails for another Content-Type, another key or another secret', async () => {
    const put = await port().presignPut('up/upl-1/file', { mimeType: 'application/pdf' });
    expect(sigV4Valid('PUT', put.url, { 'content-type': 'text/html' }, ENV.secretAccessKey)).toBe(false);
    expect(sigV4Valid('PUT', put.url.replace('upl-1', 'upl-2'), { 'content-type': 'application/pdf' }, ENV.secretAccessKey)).toBe(false);
    expect(sigV4Valid('PUT', put.url, { 'content-type': 'application/pdf' }, 'other')).toBe(false);
    expect(sigV4Valid('GET', put.url, { 'content-type': 'application/pdf' }, ENV.secretAccessKey)).toBe(false);
  });

  it('never signs the secret into the link', async () => {
    const put = await port().presignPut('up/upl-1/file', { mimeType: 'image/png' });
    const get = await port().presignGet('a/b/1/file', { disposition: 'inline', filename: 'a.png', mimeType: 'image/png' });
    for (const link of [put.url, get.url]) expect(link).not.toContain(ENV.secretAccessKey);
  });

  it('refuses a key outside the key rules before it signs', async () => {
    await expect(port().presignPut('../x', { mimeType: 'image/png' })).rejects.toThrow(/not a valid object key/);
    await expect(port().presignGet('a b', { disposition: 'inline', filename: 'a', mimeType: 'image/png' })).rejects.toThrow(/not a valid object key/);
  });
});

describe('the R2 store: signed download links (plan 5.2)', () => {
  it('signs a GET for 10 minutes with response-content-disposition in the RFC 6266 form, for an Arabic name', async () => {
    const get = await port().presignGet('prj-001/fil-001/1/file', { disposition: 'attachment', filename: 'مخطط الطابق الأرضي.pdf', mimeType: 'application/pdf' });
    const url = new URL(get.url);
    expect(url.searchParams.get('response-content-disposition')).toBe(
      `attachment; filename="____ ______ ______.pdf"; filename*=UTF-8''%D9%85%D8%AE%D8%B7%D8%B7%20%D8%A7%D9%84%D8%B7%D8%A7%D8%A8%D9%82%20%D8%A7%D9%84%D8%A3%D8%B1%D8%B6%D9%8A.pdf`,
    );
    expect(url.searchParams.get('X-Amz-Expires')).toBe('600');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
    expect(get.expiresAt).toBe('2026-10-04T09:40:00.000Z');
    expect(sigV4Valid('GET', get.url, {}, ENV.secretAccessKey)).toBe(true);
  });

  it('keeps inline for a PDF or a picture when the screen asks for inline', async () => {
    const get = await port().presignGet('prj-001/fil-001/1/file', { disposition: 'inline', filename: 'plan.pdf', mimeType: 'application/pdf' });
    expect(new URL(get.url).searchParams.get('response-content-disposition')).toBe(`inline; filename="plan.pdf"; filename*=UTF-8''plan.pdf`);
  });

  it('gives attachment to HTML, SVG, XHTML, XSL, every XML type and every comma type, also when the screen asks for inline', async () => {
    for (const mimeType of ['text/html', 'TEXT/HTML; charset=utf-8', 'image/svg+xml', 'application/xhtml+xml', 'text/xml', 'application/rss+xml', 'text/xsl', 'TEXT/XSL; charset=utf-8', 'image/png;x=1, text/html', 'text/plain, text/html']) {
      const get = await port().presignGet('prj-001/fil-001/1/file', { disposition: 'inline', filename: 'page.html', mimeType });
      expect(new URL(get.url).searchParams.get('response-content-disposition'), mimeType).toMatch(/^attachment; /);
      expect(sigV4Valid('GET', get.url, {}, ENV.secretAccessKey)).toBe(true);
    }
  });
});

describe('the R2 store: object checks', () => {
  type Seen = { method: string; url: string; headers: Headers };
  function recording(answer: (seen: Seen) => Response | Promise<Response>) {
    const seen: Seen[] = [];
    const fetchImpl = (async (input: Request | string | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const one = { method: request.method, url: request.url, headers: request.headers };
      seen.push(one);
      return answer(one);
    }) as typeof fetch;
    return { seen, fetchImpl };
  }

  it('head returns the size and the type in lower case without parameters, or null for a missing object', async () => {
    const { seen, fetchImpl } = recording((s) =>
      s.url.includes('missing') ? new Response(null, { status: 404 }) : new Response(null, { status: 200, headers: { 'content-length': '2048', 'content-type': 'Application/PDF; x=1' } }),
    );
    expect(await port(fetchImpl).head('up/upl-1/file')).toEqual({ size: 2048, mimeType: 'application/pdf' });
    expect(await port(fetchImpl).head('up/missing/file')).toBeNull();
    expect(seen[0]).toMatchObject({ method: 'HEAD', url: 'https://acc123.eu.r2.cloudflarestorage.com/madar-files/up/upl-1/file' });
    expect(seen[0].headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 /);
  });

  it('head keeps a comma type whole, so it never equals the clean type of the intent', async () => {
    const { fetchImpl } = recording(() => new Response(null, { status: 200, headers: { 'content-length': '5', 'content-type': 'image/png;x=1, text/html' } }));
    expect(await port(fetchImpl).head('up/upl-1/file')).toEqual({ size: 5, mimeType: 'image/png;x=1, text/html' });
  });

  it('head gives up after its timeout (3 s by default), so a slow store fails the preflight and never the lock', async () => {
    const fetchImpl = ((_input: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = (init?.signal ?? (_input as Request).signal) as AbortSignal;
        signal.addEventListener('abort', () => reject(signal.reason));
      })) as typeof fetch;
    const started = Date.now();
    await expect(port(fetchImpl).head('up/upl-1/file', { timeoutMs: 50 })).rejects.toThrow(/did not answer in 50 ms/);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('copy sends the copy source of the same bucket, and fails on an error body with status 200', async () => {
    const { seen, fetchImpl } = recording(() => new Response('<CopyObjectResult><ETag>"x"</ETag></CopyObjectResult>', { status: 200 }));
    await port(fetchImpl).copy('up/upl-1/file', 'prj-001/fil-001/1/file');
    expect(seen[0]).toMatchObject({ method: 'PUT', url: 'https://acc123.eu.r2.cloudflarestorage.com/madar-files/prj-001/fil-001/1/file' });
    expect(seen[0].headers.get('x-amz-copy-source')).toBe('/madar-files/up/upl-1/file');
    const failing = recording(() => new Response('<Error><Code>InternalError</Code></Error>', { status: 200 }));
    await expect(port(failing.fetchImpl).copy('up/upl-1/file', 'prj-001/fil-001/1/file')).rejects.toThrow(/copy failed/);
  });

  it('remove deletes each key, takes a missing key as removed, and sends nothing for no keys', async () => {
    const { seen, fetchImpl } = recording((s) => new Response(null, { status: s.url.endsWith('gone/file') ? 404 : 204 }));
    await port(fetchImpl).remove([]);
    expect(seen).toHaveLength(0);
    await port(fetchImpl).remove(['a/b/1/file', 'a/b/1/thumb', 'gone/file']);
    expect(seen.map((s) => `${s.method} ${new URL(s.url).pathname}`).sort()).toEqual(['DELETE /madar-files/a/b/1/file', 'DELETE /madar-files/a/b/1/thumb', 'DELETE /madar-files/gone/file']);
  });

  it('an error names the step and the status, never the secret', async () => {
    const { fetchImpl } = recording(() => new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 }));
    const error = await port(fetchImpl).remove(['a/b/1/file']).catch((e: Error) => e);
    expect(String(error)).toMatch(/R2 remove failed with 403/);
    expect(String(error)).not.toContain(ENV.secretAccessKey);
  });

  it('uses another endpoint only when the env names one (MinIO in the tests)', async () => {
    const put = await r2FilesPort({ ...ENV, endpoint: 'http://127.0.0.1:9100', now: () => NOW }).presignPut('up/upl-1/file', { mimeType: 'image/png' });
    expect(new URL(put.url).origin).toBe('http://127.0.0.1:9100');
    expect(new URL(put.url).pathname).toBe('/madar-files/up/upl-1/file');
  });
});
