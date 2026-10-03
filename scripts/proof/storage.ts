// Z0a files probe on Supabase Storage (plan, section 2b, point 1): a private bucket on madar-test, a signed upload from a real browser
// page with an Arabic file name, the staging-then-copy step, and a signed download with the download file name.
// The signing runs inside the z0a-probe function with the injected secret key, as the server adapter will. The bucket goes at the end.
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium } from 'playwright';
import { decodeJwtPayload, parseContentDisposition } from './lib.ts';
import { SUPABASE_URL, probe, report, sleep } from './cloud.ts';

const BUCKET = 'z0a-probe-files';
const ARABIC_NAME = 'مخطط الطابق الأرضي.pdf';
const STORAGE = `${SUPABASE_URL}/storage/v1`;

type Upload = { status: number; body: string; error?: string };

function tokenLife(url: string): { seconds: number | null } {
  const token = new URL(url, STORAGE).searchParams.get('token');
  if (!token) return { seconds: null };
  const claims = decodeJwtPayload(token) as { exp?: number; iat?: number };
  return { seconds: claims.exp && claims.iat ? claims.exp - claims.iat : null };
}

async function signUpload(key: string, expiresIn?: number): Promise<string> {
  const signed = await probe('sign-upload', { bucket: BUCKET, key, expiresIn });
  if (signed.body.status !== 200) throw new Error(`sign-upload ${key}: ${JSON.stringify(signed.body)}`);
  return `${STORAGE}${signed.body.body.url}`;
}

async function signDownload(key: string, expiresIn: number): Promise<string> {
  const signed = await probe('sign-download', { bucket: BUCKET, key, expiresIn });
  if (signed.body.status !== 200) throw new Error(`sign-download ${key}: ${JSON.stringify(signed.body)}`);
  return `${STORAGE}${signed.body.body.signedURL}`;
}

function headersOf(res: Response) {
  const pick = ['content-type', 'content-disposition', 'x-content-type-options', 'content-security-policy', 'cache-control', 'access-control-allow-origin'];
  return Object.fromEntries(pick.map((h) => [h, res.headers.get(h)]));
}

export async function storageStep(): Promise<void> {
  const out: Record<string, unknown> = {};
  out.bucket = (await probe('bucket-create', { bucket: BUCKET, fileSizeLimit: 1024 * 1024 })).body;

  // A page on a real local origin, like the screens at http://127.0.0.1:5173.
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><meta charset="utf-8"><title>Z0a</title><p>probe</p>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const browser = await chromium.launch();
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  await page.goto(origin);

  // The browser sends the file with XMLHttpRequest, as the upload adapter will (plan 5.2, step 2).
  const put = (url: string, name: string, type: string, bytes: number, text = '%PDF-1.4 Z0a probe\n'): Promise<Upload> =>
    page.evaluate(
      ({ url, name, type, bytes, text }) =>
        new Promise<Upload>((resolve) => {
          const body = bytes > text.length ? text + 'x'.repeat(bytes - text.length) : text;
          const file = new File([body], name, { type });
          const xhr = new XMLHttpRequest();
          xhr.open('PUT', url);
          xhr.setRequestHeader('content-type', file.type);
          xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText.slice(0, 300) });
          xhr.onerror = () => resolve({ status: xhr.status, body: '', error: 'network or CORS error' });
          xhr.send(file);
        }),
      { url, name, type, bytes, text },
    );

  try {
    // 1. Signed upload link: its life, and whether the API takes a shorter one.
    const stagingUrl = await signUpload('up/intent-1');
    out.uploadLinkLife = tokenLife(stagingUrl);
    out.uploadLinkLifeAsked600 = tokenLife(await signUpload('up/intent-life', 600));

    // 2. The browser upload of a file with an Arabic name to the staging key.
    out.browserUpload = await put(stagingUrl, ARABIC_NAME, 'application/pdf', 2048);
    out.stagingInfo = (await probe('info', { bucket: BUCKET, key: 'up/intent-1' })).body;

    // 3. Staging key, then copy to the final key, then remove the staging key (plan 2b, point 1).
    const finalKey = 'prj-z0a/fil-1/1';
    out.copy = (await probe('copy', { bucket: BUCKET, from: 'up/intent-1', to: finalKey })).body.status;
    out.removeStaging = (await probe('remove', { bucket: BUCKET, keys: ['up/intent-1'] })).body.status;
    const finalBefore = (await probe('info', { bucket: BUCKET, key: finalKey })).body.body;

    // 4. A second PUT with the same signed link after the copy must not change the confirmed version.
    out.secondPut = await put(stagingUrl, 'other.pdf', 'application/pdf', 4096, '%PDF-1.4 a different body\n');
    const finalAfter = (await probe('info', { bucket: BUCKET, key: finalKey })).body.body;
    out.finalUnchanged = finalBefore?.size === finalAfter?.size && finalBefore?.etag === finalAfter?.etag;
    out.stagingAfterSecondPut = (await probe('info', { bucket: BUCKET, key: 'up/intent-1' })).body.status;
    await probe('remove', { bucket: BUCKET, keys: ['up/intent-1', 'up/intent-life'] });

    // 5. A file over the bucket limit (1 MB here; 50 MB on the free plan) is refused at upload.
    out.tooBig = await put(await signUpload('up/intent-big'), 'big.pdf', 'application/pdf', 2 * 1024 * 1024);
    out.tooBigStored = (await probe('info', { bucket: BUCKET, key: 'up/intent-big' })).body.status;

    // 6. A type that the link does not fix: the upload takes any Content-Type, so the server must check it.
    out.otherType = await put(await signUpload('up/intent-type'), 'x.pdf', 'image/png', 1024);
    out.otherTypeInfo = (await probe('info', { bucket: BUCKET, key: 'up/intent-type' })).body.body?.content_type ?? null;

    // 7. Signed download with the download file name.
    const link = await signDownload(finalKey, 600);
    out.downloadLinkLife = tokenLife(link);
    const named = `${link}&download=${encodeURIComponent(ARABIC_NAME)}`;
    const res = await fetch(named);
    const disposition = res.headers.get('content-disposition');
    out.download = { status: res.status, headers: headersOf(res), parsed: parseContentDisposition(disposition), bytes: (await res.arrayBuffer()).byteLength };
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.evaluate((href) => {
        const a = document.createElement('a');
        a.href = href;
        document.body.append(a);
        a.click();
      }, named),
    ]);
    out.browserSuggestedName = download.suggestedFilename();
    out.browserNameMatches = download.suggestedFilename() === ARABIC_NAME;
    out.browserFetch = await page.evaluate(async (href) => {
      try {
        const r = await fetch(href);
        return { status: r.status, bytes: (await r.blob()).size, disposition: r.headers.get('content-disposition') };
      } catch (e) {
        return { error: String(e) };
      }
    }, named);
    const plain = await fetch(link);
    out.noDownloadParameter = { status: plain.status, headers: headersOf(plain) };
    await plain.arrayBuffer();

    // 8. An HTML and an SVG file served from a signed link: what the Storage origin sends.
    for (const [key, name, type, text] of [
      ['up/intent-html', 'page.html', 'text/html', '<!doctype html><script>document.title="ran"</script>'],
      ['up/intent-svg', 'pic.svg', 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'],
    ] as const) {
      const up = await put(await signUpload(key), name, type, text.length, text);
      const r = await fetch(await signDownload(key, 60));
      out[`served_${type}`] = { upload: up.status, status: r.status, headers: headersOf(r) };
      await r.arrayBuffer();
    }

    // 9. An expired download link.
    const short = await signDownload(finalKey, 2);
    await sleep(4000);
    const expired = await fetch(short);
    out.expiredLink = { status: expired.status, body: (await expired.text()).slice(0, 200) };
  } finally {
    await browser.close();
    server.close();
    // The empty step of the Storage API runs in the background, so the delete waits for it.
    for (let i = 0; i < 12; i++) {
      out.bucketDelete = (await probe('bucket-delete', { bucket: BUCKET })).body;
      if ((out.bucketDelete as { deleted?: number }).deleted === 200) break;
      await sleep(5000);
    }
    report('storage', out);
  }
}
