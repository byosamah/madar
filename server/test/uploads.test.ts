import { describe, expect, it } from 'vitest';
import { fakeFiles } from './fakes/files';
import { browserPut, keyOfLink, storedContent } from './uploads';

describe('the file data of db mode (task D2)', () => {
  it('reads the object key of a link of the fake file store, and refuses any other link', () => {
    expect(keyOfLink('https://files.test/put/up/upl_1')).toBe('up/upl_1');
    expect(keyOfLink('https://files.test/get/prj-001/a%20b/1?disposition=inline')).toBe('prj-001/a b/1');
    expect(() => keyOfLink('https://evil.example/put/up/upl_1')).toThrow(/not a link of the fake file store/);
  });

  it('keeps the content of each object: a browser upload puts it, a copy takes it along, a remove takes it away', async () => {
    const files = fakeFiles();
    browserPut(files, 'https://files.test/put/up/upl_1', new Blob(['abc'], { type: 'image/png' }));
    expect(files.objects.get('up/upl_1')).toEqual({ size: 3, mimeType: 'image/png' });
    await files.copy('up/upl_1', 'final/1');
    expect(await storedContent(files).get('final/1')?.text()).toBe('abc');
    await files.remove(['up/upl_1']);
    expect(storedContent(files).has('up/upl_1')).toBe(false);
    expect(storedContent(files).has('final/1')).toBe(true);
  });
});

describe('the browser upload of the mirror', () => {
  it('puts the file with the Content-Type of the signed link, as the screens do (src/api/remote/upload.ts)', () => {
    const files = fakeFiles();
    // Track F stores a type that may not show in the browser as application/octet-stream (server/files/links.ts, storedMimeType).
    browserPut(files, { url: 'https://files.test/put/up/upl_2', headers: { 'Content-Type': 'application/octet-stream' } }, new Blob(['<svg/>'], { type: 'image/svg+xml' }));
    expect(files.objects.get('up/upl_2')).toEqual({ size: 6, mimeType: 'application/octet-stream' });
  });
});
