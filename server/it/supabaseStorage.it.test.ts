import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { supabaseStorageFilesPort } from '../files/supabaseStorage';
import { localClient } from './migrate';

/**
 * The default store on the local Supabase Storage (plan 2b, point 1; proof.md, Z0a item 6; task F1). It needs the local stack
 * (`supabase start`, then `supabase db reset` from this worktree) and the Docker lock. It talks only to 127.0.0.1.
 */

const ROOT = join(import.meta.dirname, '..', '..');
const SUPABASE_URL = 'http://127.0.0.1:54321';
const BUCKET = 'madar-files';
const ARABIC_NAME = 'مخطط الطابق الأرضي.pdf';
/** Every key of this file sits under these folders, so the clean-up step finds them. */
const RUN = `t${Date.now().toString(36)}`;

let admin: pg.Client;
let port: ReturnType<typeof supabaseStorageFilesPort>;

function secretKey(): string {
  const status = JSON.parse(execFileSync('npx', ['supabase', 'status', '-o', 'json'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) as Record<string, string>;
  return status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;
}

function claims(link: string): { exp: number; iat: number } {
  const token = new URL(link).searchParams.get('token') ?? '';
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as { exp: number; iat: number };
}

async function put(url: string, type: string, body: BodyInit, extra: Record<string, string> = {}): Promise<{ status: number; text: string }> {
  const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': type, ...extra }, body });
  return { status: response.status, text: await response.text() };
}

beforeAll(async () => {
  admin = await localClient();
  port = supabaseStorageFilesPort({ supabaseUrl: SUPABASE_URL, secretKey: secretKey(), bucket: BUCKET });
}, 60_000);

afterAll(async () => {
  const { rows } = await admin.query<{ name: string }>('select name from storage.objects where bucket_id = $1 and (name like $2 or name like $3)', [BUCKET, `up/${RUN}%`, `${RUN}%`]);
  if (rows.length > 0) await port.remove(rows.map((r) => r.name));
  await admin.end();
});

describe('the bucket madar-files on the local stack', () => {
  it('is private with a 50 MB file limit (migration 20261004000500)', async () => {
    const { rows } = await admin.query('select public, file_size_limit from storage.buckets where id = $1', [BUCKET]);
    expect(rows).toEqual([{ public: false, file_size_limit: '52428800' }]);
  });
});

describe('the Supabase Storage store on the local stack', () => {
  const staging = `up/${RUN}-1/file`;

  it('signs an upload link that lives 2 hours, and expiresAt reports that life', async () => {
    const before = Date.now();
    const link = await port.presignPut(staging, { mimeType: 'application/pdf' });
    const life = claims(link.url);
    expect(life.exp - life.iat).toBe(7200);
    expect(Math.abs(new Date(link.expiresAt).getTime() - (before + 7200_000))).toBeLessThan(60_000);
    expect(link.headers).toEqual({ 'Content-Type': 'application/pdf' });
  });

  let firstLink = '';

  it('takes the browser PUT, and head reads the size and the type', async () => {
    firstLink = (await port.presignPut(staging, { mimeType: 'application/pdf' })).url;
    expect((await put(firstLink, 'application/pdf', '%PDF-1.4 first')).status).toBe(200);
    expect(await port.head(staging)).toEqual({ size: 14, mimeType: 'application/pdf' });
  });

  it('refuses a second PUT to a staging key that holds an object, also with x-upsert: true (no upsert)', async () => {
    // The same link again, as a second browser tab or an attacker with the link would send it before files.upload.
    const second = await put(firstLink, 'application/pdf', 'a different and longer body');
    expect(second.status, second.text).not.toBe(200);
    const forced = await put(firstLink, 'application/pdf', 'a different and longer body', { 'x-upsert': 'true' });
    expect(forced.status, forced.text).not.toBe(200);
    expect(await port.head(staging)).toEqual({ size: 14, mimeType: 'application/pdf' });
  });

  it('copies the staging object to the final key; a later PUT to the old link leaves the final object unchanged', async () => {
    const finalKey = `${RUN}/fil-1/1/file`;
    const link = await port.presignPut(`up/${RUN}-2/file`, { mimeType: 'application/pdf' });
    expect((await put(link.url, 'application/pdf', 'first body')).status).toBe(200);
    await port.copy(`up/${RUN}-2/file`, finalKey);
    await port.remove([`up/${RUN}-2/file`]);
    expect(await port.head(`up/${RUN}-2/file`)).toBeNull();
    await put(link.url, 'application/pdf', 'a longer second body');
    expect(await port.head(finalKey)).toEqual({ size: 10, mimeType: 'application/pdf' });
  });

  it('keeps a file key and a thumb key of one version side by side', async () => {
    for (const [key, type] of [[`${RUN}/fil-3/1/file`, 'image/png'], [`${RUN}/fil-3/1/thumb`, 'image/webp']] as const) {
      const link = await port.presignPut(key, { mimeType: type });
      expect((await put(link.url, type, 'img')).status).toBe(200);
    }
    expect(await port.head(`${RUN}/fil-3/1/file`)).toEqual({ size: 3, mimeType: 'image/png' });
    expect(await port.head(`${RUN}/fil-3/1/thumb`)).toEqual({ size: 3, mimeType: 'image/webp' });
  });

  it('reads the stored type in lower case without parameters', async () => {
    const link = await port.presignPut(`up/${RUN}-4/file`, { mimeType: 'text/html' });
    expect((await put(link.url, 'TEXT/HTML; charset=utf-8', '<p>x</p>')).status).toBe(200);
    expect((await port.head(`up/${RUN}-4/file`))?.mimeType).toBe('text/html');
  });

  it('signs a 10-minute download link that saves the file with its Arabic name', async () => {
    const link = await port.presignGet(`${RUN}/fil-1/1/file`, { disposition: 'attachment', filename: ARABIC_NAME, mimeType: 'application/pdf' });
    const life = claims(link.url);
    expect(life.exp - life.iat).toBe(600);
    const response = await fetch(link.url);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('first body');
    const header = response.headers.get('content-disposition') ?? '';
    expect(header).toMatch(/^attachment;/);
    expect(decodeURIComponent(header.split("UTF-8''")[1] ?? '')).toBe(ARABIC_NAME);
  });

  it('serves an inline PDF without an attachment header, for the preview', async () => {
    const link = await port.presignGet(`${RUN}/fil-1/1/file`, { disposition: 'inline', filename: 'plan.pdf', mimeType: 'application/pdf' });
    const response = await fetch(link.url);
    await response.arrayBuffer();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition') ?? '').not.toMatch(/^attachment/);
  });

  it('serves an HTML or an SVG file as an attachment, also when the screen asks for inline', async () => {
    for (const [key, type, name] of [[`up/${RUN}-4/file`, 'TEXT/HTML; charset=utf-8', 'page.html'], [`${RUN}/fil-5/1/file`, 'image/svg+xml', 'pic.svg']] as const) {
      if (key.endsWith('fil-5/1/file')) {
        const up = await port.presignPut(key, { mimeType: type });
        expect((await put(up.url, type, '<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>')).status).toBe(200);
      }
      const link = await port.presignGet(key, { disposition: 'inline', filename: name, mimeType: type });
      expect(new URL(link.url).searchParams.get('download')).toBe(name);
      const response = await fetch(link.url);
      await response.arrayBuffer();
      expect(response.headers.get('content-disposition'), type).toMatch(/^attachment;/);
    }
  });

  it('refuses a file over 50 MB at the upload, and stores nothing', async () => {
    const key = `up/${RUN}-big/file`;
    const link = await port.presignPut(key, { mimeType: 'application/pdf' });
    const big = await put(link.url, 'application/pdf', new Uint8Array(50 * 1024 * 1024 + 1));
    expect(big.status).not.toBe(200);
    expect(big.text).toMatch(/413|EntityTooLarge|Payload too large|exceeded the maximum allowed size/i);
    expect(await port.head(key)).toBeNull();
  }, 60_000);

  it('removes objects, takes a missing key as removed, and head then returns null', async () => {
    await port.remove([`${RUN}/fil-3/1/file`, `${RUN}/fil-3/1/thumb`, `${RUN}/fil-404/1/file`]);
    expect(await port.head(`${RUN}/fil-3/1/file`)).toBeNull();
    expect(await port.head(`${RUN}/fil-3/1/thumb`)).toBeNull();
  });
});
