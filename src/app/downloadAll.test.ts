import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MadarApi } from '../api/calls';
import { ApiError } from '../api/errors';
import { parseZip } from '../test/zipRead';
import { DownloadAllError, downloadAll } from './files';

type Call = { name: string; input: Record<string, unknown> };

/** The remote api: files.link gives a link for each id. `broken` makes the link of one id fail. */
function remoteApi(o: { broken?: string } = {}) {
  const calls: Call[] = [];
  const api = {
    call: async (name: string, input: Record<string, unknown>) => {
      calls.push({ name, input });
      if (name === 'files.link') {
        if (input.id === o.broken) throw new ApiError('forbidden', 'No.', { reason: 'forbidden' });
        return { url: `https://store.test/${String(input.id)}`, expiresAt: 'x', name: `${String(input.id)}.pdf`, mimeType: 'application/pdf', size: 1 };
      }
      throw new Error(`unexpected ${name}`);
    },
    run: async () => { throw new Error('not used'); },
  } as unknown as MadarApi;
  return { api, calls };
}

/** A fetch stub: the body of a link is the text "body of <id>". `status` maps an id to a non-200 answer. */
function fetchStub(status: Record<string, number> = {}) {
  const asked: { url: string; init?: RequestInit }[] = [];
  const stub = vi.fn(async (url: string, init?: RequestInit) => {
    asked.push({ url, init });
    const id = url.split('/').pop() as string;
    const code = status[id] ?? 200;
    // Not a Response: its blob() makes a Node Blob, and the Blob of jsdom reads that as the text "[object Blob]".
    return { ok: code === 200, status: code, blob: async () => new Blob([code === 200 ? `body of ${id}` : 'no']) };
  });
  return { fetch: stub as unknown as typeof fetch, asked };
}

const ITEMS = [
  { id: 'fil_a', name: 'SITE PLAN.pdf' },
  { id: 'fil_b', name: 'مخطط الدور.pdf' },
  { id: 'fil_c', name: 'ANNEX.pdf' },
];

let saved: { blob: Blob; name: string }[] = [];
let revoked: string[] = [];

beforeEach(() => {
  saved = [];
  revoked = [];
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    saved.push({ blob: blob as Blob, name: '' });
    return `blob:zip-${saved.length}`;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => { revoked.push(url); });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
    saved[saved.length - 1].name = this.download;
  });
});

afterEach(() => vi.useRealTimers());

describe('downloadAll in the real build', () => {
  it('asks for a download link of each file one after another, fetches it, and saves one ZIP file', async () => {
    const { api, calls } = remoteApi();
    const { fetch, asked } = fetchStub();
    const progress: [number, number][] = [];
    await downloadAll(api, ITEMS, 'Plans 2026-10-22.zip', (n, total) => progress.push([n, total]), { remote: true, fetch });

    expect(calls).toEqual(ITEMS.map((item) => ({ name: 'files.link', input: { id: item.id, variant: 'full', disposition: 'attachment' } })));
    expect(asked.map((a) => a.url)).toEqual(ITEMS.map((item) => `https://store.test/${item.id}`));
    expect(progress).toEqual([[1, 3], [2, 3], [3, 3]]);
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe('Plans 2026-10-22.zip');
    const zip = await parseZip(saved[0].blob);
    expect(zip.entries.map((entry) => entry.name)).toEqual(['SITE PLAN.pdf', 'مخطط الدور.pdf', 'ANNEX.pdf']);
    expect(zip.entries.map((entry) => new TextDecoder().decode(entry.bytes))).toEqual(['body of fil_a', 'body of fil_b', 'body of fil_c']);
  });

  it('does not send the cookies of the page to the store', async () => {
    const { api } = remoteApi();
    const { fetch, asked } = fetchStub();
    await downloadAll(api, ITEMS, 'x.zip', undefined, { remote: true, fetch });
    expect(asked.every((a) => a.init?.credentials === 'omit')).toBe(true);
  });

  it('releases the object URL a moment after the save', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const { api } = remoteApi();
    await downloadAll(api, ITEMS, 'x.zip', undefined, { remote: true, fetch: fetchStub().fetch });
    expect(revoked).toEqual([]);
    vi.advanceTimersByTime(1000);
    expect(revoked).toEqual(['blob:zip-1']);
  });

  it('stops at the first file that fails, names it, and saves nothing', async () => {
    const { api } = remoteApi();
    const { fetch, asked } = fetchStub({ fil_b: 403 });
    const run = downloadAll(api, ITEMS, 'x.zip', undefined, { remote: true, fetch });
    await expect(run).rejects.toBeInstanceOf(DownloadAllError);
    await expect(run).rejects.toMatchObject({ fileName: 'مخطط الدور.pdf' });
    expect(asked.map((a) => a.url)).toEqual(['https://store.test/fil_a', 'https://store.test/fil_b']);
    expect(saved).toHaveLength(0);
  });

  it('names the file when its link is refused, and keeps the cause', async () => {
    const { api } = remoteApi({ broken: 'fil_c' });
    const run = downloadAll(api, ITEMS, 'x.zip', undefined, { remote: true, fetch: fetchStub().fetch });
    await expect(run).rejects.toMatchObject({ fileName: 'ANNEX.pdf' });
    await expect(run).rejects.toMatchObject({ cause: expect.any(ApiError) });
    expect(saved).toHaveLength(0);
  });

  it('names the file when the network fails', async () => {
    const { api } = remoteApi();
    const fetch = vi.fn(async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof globalThis.fetch;
    await expect(downloadAll(api, ITEMS, 'x.zip', undefined, { remote: true, fetch })).rejects.toMatchObject({ fileName: 'SITE PLAN.pdf' });
  });

  it('gives a name with a path character a dash, and adds the ending .zip', async () => {
    const { api } = remoteApi();
    await downloadAll(api, ITEMS, 'AB/12: Design', undefined, { remote: true, fetch: fetchStub().fetch });
    expect(saved[0].name).toBe('AB-12- Design.zip');
  });

  it('lets the error for a total over 4 GB through as it is', async () => {
    const { api } = remoteApi();
    const huge = { size: 5_000_000_000, slice: () => new Blob([]), type: '' };
    const fetch = vi.fn(async () => ({ ok: true, blob: async () => huge })) as unknown as typeof globalThis.fetch;
    await expect(downloadAll(api, ITEMS, 'x.zip', undefined, { remote: true, fetch })).rejects.toMatchObject({ name: 'ZipTooLargeError' });
  });
});

describe('downloadAll in the prototype', () => {
  it('reads the stored data of each file with files.get and saves one ZIP file', async () => {
    const calls: Call[] = [];
    const api = {
      call: async (name: string, input: Record<string, unknown>) => {
        calls.push({ name, input });
        return { blob: new Blob([`data of ${String(input.id)}`]), file: { file: { name: 'ignored.pdf' } } };
      },
    } as unknown as MadarApi;
    const fetch = vi.fn() as unknown as typeof globalThis.fetch;
    await downloadAll(api, ITEMS, 'x.zip', undefined, { remote: false, fetch });
    expect(calls.map((call) => call.name)).toEqual(['files.get', 'files.get', 'files.get']);
    expect(fetch).not.toHaveBeenCalled();
    const zip = await parseZip(saved[0].blob);
    expect(zip.entries.map((entry) => entry.name)).toEqual(['SITE PLAN.pdf', 'مخطط الدور.pdf', 'ANNEX.pdf']);
    expect(zip.entries.map((entry) => new TextDecoder().decode(entry.bytes))).toEqual(['data of fil_a', 'data of fil_b', 'data of fil_c']);
  });
});
