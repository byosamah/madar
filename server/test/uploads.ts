import type { FakeFiles } from './fakes/files';

/**
 * The file data of db mode (TM 3.3 and 3.6; task D2). The mirror store sends files.upload and feedback.send the way the remote
 * screens do (plan 5.2): the upload start, the upload of each file to its signed link, then the call with the upload IDs. Here
 * the upload is a write into the fake file store of the test (server/test/fakes/files.ts), and the store also keeps the content,
 * so t.store.persister and feedback.screenshot give the test its data back. The upload steps are the real ones of track F; only
 * the in-memory unit tests of dbApi.test.ts put stand-ins in their place (uploadStandIns.ts).
 */

/** The host of every link of the fake file store. */
const FAKE_HOST = 'files.test';

const contentByStore = new WeakMap<FakeFiles, Map<string, Blob>>();

/**
 * The content of the fake store, by object key. The first call wraps copy and remove of the store, so a copy takes the content
 * with it and a remove takes it away.
 */
export function storedContent(files: FakeFiles): Map<string, Blob> {
  let content = contentByStore.get(files);
  if (content) return content;
  const blobs = new Map<string, Blob>();
  content = blobs;
  contentByStore.set(files, blobs);
  const { copy, remove } = files;
  files.copy = async (from, to) => {
    await copy(from, to);
    const blob = blobs.get(from);
    if (blob) blobs.set(to, blob);
  };
  files.remove = async (keys) => {
    await remove(keys);
    for (const key of keys) blobs.delete(key);
  };
  return blobs;
}

/** The object key of a link of the fake store: https://files.test/put/<key> or https://files.test/get/<key>?... */
export function keyOfLink(link: string): string {
  const url = new URL(link);
  const match = /^\/(?:put|get)\/(.+)$/.exec(url.pathname);
  if (url.host !== FAKE_HOST || !match) throw new Error(`db mode: ${link} is not a link of the fake file store.`);
  return decodeURIComponent(match[1]);
}

/** What the browser does with a signed upload link: the object arrives at its key, with its type and size. */
export function browserPut(files: FakeFiles, put: string | { url: string; headers?: Record<string, string> }, blob: Blob): void {
  // The screens send the Content-Type header of the signed link (src/api/remote/upload.ts), which may differ from the blob's type.
  const [link, sent] = typeof put === 'string' ? [put, undefined] : [put.url, put.headers?.['Content-Type']];
  const key = keyOfLink(link);
  files.objects.set(key, { size: blob.size, mimeType: sent ?? (blob.type || 'application/octet-stream') });
  storedContent(files).set(key, blob);
}
