import { describe, expect, it } from 'vitest';
import { fakeFiles, type FakeFiles } from '../test/fakes/files';
import { confirmThumb, confirmUpload } from './confirm';

/**
 * The preflight check of an uploaded object (plan 5.2, step 3; proof.md, Z0a item 6; task F2): the staging object, then the copy on
 * its final key, both against the intent. A mismatch refuses the call and removes the object.
 */

const STAGING = 'up/upl-a/file';
const FINAL = 'prj-001/upl-a/file';
const WANT = { size: 12, mimeType: 'application/pdf' };

/** Storage refuses a copy onto a key that holds an object (KeyAlreadyExists), so the fake here does too. */
function storageCopy(files: FakeFiles): FakeFiles {
  const copy = files.copy.bind(files);
  files.copy = async (from, to) => {
    if (files.objects.has(to)) {
      files.calls.push({ op: 'copy', key: `${from}>${to}` });
      throw new Error('Storage copy failed with 400 (KeyAlreadyExists).');
    }
    await copy(from, to);
  };
  return files;
}

function setup(objects: Record<string, { size: number; mimeType: string }> = {}) {
  const files = storageCopy(fakeFiles());
  for (const [key, value] of Object.entries(objects)) files.objects.set(key, value);
  const removed: string[][] = [];
  const remove = async (keys: string[]) => {
    removed.push(keys);
    await files.remove(keys);
  };
  const run = () => confirmUpload(files, { staging: STAGING, final: FINAL, field: 'uploadId', want: WANT, maxBytes: 50, remove });
  return { files, removed, run };
}

const ops = (files: FakeFiles) => files.calls.map((c) => c.op);

describe('confirmUpload', () => {
  it('checks the staging object, copies it, checks the copy, and removes the staging key', async () => {
    const { files, removed, run } = setup({ [STAGING]: { size: 12, mimeType: 'application/pdf' } });
    await run();
    expect(ops(files)).toEqual(['head', 'head', 'copy', 'head', 'remove']);
    expect(files.calls[0].key).toBe(FINAL);
    expect([...files.objects.keys()]).toEqual([FINAL]);
    expect(removed).toEqual([[STAGING]]);
  });

  it('compares with the stored type: a download-only type is stored as application/octet-stream', async () => {
    const files = fakeFiles();
    files.objects.set(STAGING, { size: 5, mimeType: 'application/octet-stream' });
    await confirmUpload(files, { staging: STAGING, final: FINAL, field: 'uploadId', want: { size: 5, mimeType: 'TEXT/HTML; charset=utf-8' }, maxBytes: 50, remove: (k) => files.remove(k) });
    expect(files.objects.has(FINAL)).toBe(true);
  });

  it('refuses a PUT of text/html under an application/pdf intent and removes it, so it never gets a link', async () => {
    const { files, removed, run } = setup({ [STAGING]: { size: 12, mimeType: 'application/octet-stream' } });
    await expect(run()).rejects.toMatchObject({ code: 'invalid_input', details: { fields: ['uploadId'] } });
    expect(ops(files)).not.toContain('copy');
    expect(removed).toEqual([[STAGING]]);
    expect(files.objects.size).toBe(0);
  });

  it('refuses a size that differs from the intent, and removes the object', async () => {
    const { files, removed, run } = setup({ [STAGING]: { size: 13, mimeType: 'application/pdf' } });
    await expect(run()).rejects.toMatchObject({ code: 'invalid_input' });
    expect(removed).toEqual([[STAGING]]);
    expect(files.objects.size).toBe(0);
  });

  it('refuses an object over the store limit with file_too_large and the limit, and removes it', async () => {
    const { files, run } = setup({ [STAGING]: { size: 51, mimeType: 'application/pdf' } });
    await expect(run()).rejects.toMatchObject({ code: 'invalid_input', details: { fields: ['uploadId'], reason: 'file_too_large', limit: 50 } });
    expect(files.objects.size).toBe(0);
  });

  it('checks the final object after the copy too, and removes both keys when the copy differs', async () => {
    const { files, removed, run } = setup({ [STAGING]: { size: 12, mimeType: 'application/pdf' } });
    // A store whose copy result differs from the staging object it checked (for example a second PUT that won a race).
    files.copy = async (from, to) => {
      files.calls.push({ op: 'copy', key: `${from}>${to}` });
      files.objects.set(to, { size: 12, mimeType: 'image/png' });
    };
    await expect(run()).rejects.toMatchObject({ code: 'invalid_input' });
    expect(removed).toEqual([[STAGING, FINAL]]);
    expect(files.objects.size).toBe(0);
  });

  it('takes a matching final object when the staging key is gone, so a retry after the copy works', async () => {
    const { files, run } = setup({ [FINAL]: { size: 12, mimeType: 'application/pdf' } });
    await run();
    expect(ops(files)).toEqual(['head', 'remove']);
    expect(files.objects.has(FINAL)).toBe(true);
  });

  it('takes the final object with no copy when a second PUT left a staging object too, and the final object stays the same', async () => {
    // A retry after a busy lock, a staging removal that failed, or a head on the final key that timed out after a good copy.
    const { files, removed, run } = setup({ [STAGING]: { size: 12, mimeType: 'application/pdf' }, [FINAL]: { size: 12, mimeType: 'application/pdf' } });
    const confirmed = files.objects.get(FINAL);
    await run();
    expect(ops(files)).toEqual(['head', 'remove']);
    expect(files.objects.get(FINAL)).toBe(confirmed);
    expect(removed).toEqual([[STAGING]]);
    expect([...files.objects.keys()]).toEqual([FINAL]);
  });

  it('never copies over a final object, even when the staging object differs from it', async () => {
    const { files, run } = setup({ [STAGING]: { size: 12, mimeType: 'image/png' }, [FINAL]: { size: 12, mimeType: 'application/pdf' } });
    await run();
    expect(ops(files)).not.toContain('copy');
    expect(files.objects.get(FINAL)).toEqual({ size: 12, mimeType: 'application/pdf' });
  });

  it('refuses when nothing arrived', async () => {
    const { run } = setup();
    await expect(run()).rejects.toMatchObject({ code: 'invalid_input', message: 'The file did not arrive. Upload it again.' });
  });

  it('still confirms when the staging key cannot be removed: the job deletes old staging objects', async () => {
    const { files } = setup({ [STAGING]: { size: 12, mimeType: 'application/pdf' } });
    const removeFails = async () => {
      throw new Error('The store is down.');
    };
    await expect(confirmUpload(files, { staging: STAGING, final: FINAL, field: 'uploadId', want: WANT, maxBytes: 50, remove: removeFails })).resolves.toBeUndefined();
    expect(files.objects.has(FINAL)).toBe(true);
  });
});

describe('confirmThumb', () => {
  const THUMB_STAGING = 'up/upl-a/thumb';
  const THUMB_FINAL = 'prj-001/upl-a/thumb';
  const thumb = (files: FakeFiles) => confirmThumb(files, { staging: THUMB_STAGING, final: THUMB_FINAL, field: 'uploadId', remove: (k) => files.remove(k) });

  it('takes an inline-safe picture of 10 MB or less', async () => {
    const files = fakeFiles();
    files.objects.set(THUMB_STAGING, { size: 300, mimeType: 'image/webp' });
    expect(await thumb(files)).toBe(true);
    expect([...files.objects.keys()]).toEqual([THUMB_FINAL]);
  });

  it('gives no thumb when none arrived', async () => {
    expect(await thumb(fakeFiles())).toBe(false);
  });

  it('refuses a thumb that is not an inline-safe picture, or too big, and removes it', async () => {
    for (const object of [{ size: 300, mimeType: 'application/octet-stream' }, { size: 300, mimeType: 'text/plain' }, { size: 10 * 1024 * 1024 + 1, mimeType: 'image/png' }, { size: 0, mimeType: 'image/png' }]) {
      const files = fakeFiles();
      files.objects.set(THUMB_STAGING, object);
      await expect(thumb(files)).rejects.toMatchObject({ code: 'invalid_input' });
      expect(files.objects.size).toBe(0);
    }
  });
});
