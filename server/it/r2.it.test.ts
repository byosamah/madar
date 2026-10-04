import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { r2FilesPort } from '../files/r2';
import { minioEnv, startMinio, stopMinio } from './minio';

/**
 * The R2 store against MinIO, an S3 server that stands in for R2 (plan 5.2, task F1). It needs Docker and the Docker lock.
 * It talks only to 127.0.0.1.
 */

const BUCKET = 'madar-files';
const ARABIC_NAME = 'مخطط الطابق الأرضي.pdf';
const MINUTE = 60_000;

const port = (o: { now?: () => Date } = {}) => r2FilesPort({ ...minioEnv(BUCKET), ...o });

async function put(url: string, type: string, body: string): Promise<number> {
  const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': type }, body });
  await response.arrayBuffer();
  return response.status;
}

beforeAll(async () => {
  await startMinio([BUCKET]);
}, 120_000);

afterAll(() => {
  stopMinio();
});

describe('the R2 store on MinIO', () => {
  it('takes a PUT on the signed upload link with the signed type, and head reads its size and type', async () => {
    const link = await port().presignPut('up/upl-1/file', { mimeType: 'application/pdf' });
    expect(await put(link.url, link.headers['Content-Type'], '%PDF-1.4 test')).toBe(200);
    expect(await port().head('up/upl-1/file')).toEqual({ size: 13, mimeType: 'application/pdf' });
  });

  it('refuses a PUT with another Content-Type than the signed one', async () => {
    const link = await port().presignPut('up/upl-2/file', { mimeType: 'application/pdf' });
    expect(await put(link.url, 'text/html', '<script>1</script>')).toBe(403);
    expect(await port().head('up/upl-2/file')).toBeNull();
  });

  it('keeps an upload link for 10 minutes and refuses it after', async () => {
    const nineMinutesAgo = await port({ now: () => new Date(Date.now() - 9 * MINUTE) }).presignPut('up/upl-3/file', { mimeType: 'image/png' });
    expect(await put(nineMinutesAgo.url, 'image/png', 'png')).toBe(200);
    const elevenMinutesAgo = await port({ now: () => new Date(Date.now() - 11 * MINUTE) }).presignPut('up/upl-4/file', { mimeType: 'image/png' });
    expect(await put(elevenMinutesAgo.url, 'image/png', 'png')).toBe(403);
    expect(await port().head('up/upl-4/file')).toBeNull();
  });

  it('copies the staging object to its final key, and a second PUT to the staging link leaves the final object unchanged', async () => {
    const link = await port().presignPut('up/upl-5/file', { mimeType: 'application/pdf' });
    expect(await put(link.url, 'application/pdf', 'first body')).toBe(200);
    await port().copy('up/upl-5/file', 'prj-001/fil-001/1/file');
    await port().remove(['up/upl-5/file']);
    expect(await put(link.url, 'application/pdf', 'a longer second body')).toBe(200);
    expect(await port().head('prj-001/fil-001/1/file')).toEqual({ size: 10, mimeType: 'application/pdf' });
  });

  it('serves a download link with the Arabic file name in the RFC 6266 form, for 10 minutes', async () => {
    const download = await port().presignGet('prj-001/fil-001/1/file', { disposition: 'attachment', filename: ARABIC_NAME, mimeType: 'application/pdf' });
    const response = await fetch(download.url);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('first body');
    const header = response.headers.get('content-disposition') ?? '';
    expect(header).toMatch(/^attachment; filename="[^"]*"; filename\*=UTF-8''/);
    expect(decodeURIComponent(header.split("UTF-8''")[1])).toBe(ARABIC_NAME);
    const old = await port({ now: () => new Date(Date.now() - 11 * MINUTE) }).presignGet('prj-001/fil-001/1/file', { disposition: 'inline', filename: 'a.pdf', mimeType: 'application/pdf' });
    const expired = await fetch(old.url);
    await expired.arrayBuffer();
    expect(expired.status).toBe(403);
  });

  it('serves an HTML file as attachment even when the screen asks for inline', async () => {
    const link = await port().presignPut('prj-001/fil-002/1/file', { mimeType: 'text/html' });
    expect(await put(link.url, 'text/html', '<script>document.title = "ran"</script>')).toBe(200);
    const download = await port().presignGet('prj-001/fil-002/1/file', { disposition: 'inline', filename: 'page.html', mimeType: 'TEXT/HTML; charset=utf-8' });
    const response = await fetch(download.url);
    await response.arrayBuffer();
    expect(response.headers.get('content-disposition')).toMatch(/^attachment; /);
  });

  it('removes objects, takes a missing key as removed, and head then returns null', async () => {
    await port().remove(['prj-001/fil-001/1/file', 'prj-001/fil-002/1/file', 'prj-009/fil-009/1/file']);
    expect(await port().head('prj-001/fil-001/1/file')).toBeNull();
    expect(await port().head('prj-001/fil-002/1/file')).toBeNull();
  });
});
