import { describe, expect, it } from 'vitest';
import { scrubText, scrubUrl } from './urlScrub';

describe('scrubUrl', () => {
  it('keeps the origin, the path and the tab of a project page', () => {
    expect(scrubUrl('https://madar.vado.sa/projects/prj_1?tab=files&task=tsk_9#x')).toBe('https://madar.vado.sa/projects/prj_1?tab=files');
  });

  it('drops the whole fragment, so no Google code or state goes out', () => {
    expect(scrubUrl('https://madar.vado.sa/settings#google=finish&code=abc&state=def')).toBe('https://madar.vado.sa/settings');
  });

  it('drops a search text', () => {
    expect(scrubUrl('https://madar.vado.sa/search?q=client%20name')).toBe('https://madar.vado.sa/search');
  });

  it('drops the signature of a file link', () => {
    expect(scrubUrl('https://a.eu.r2.cloudflarestorage.com/madar-files/k?X-Amz-Signature=1')).toBe('https://a.eu.r2.cloudflarestorage.com/madar-files/k');
  });

  it('gives a text that is no address back as it is', () => {
    expect(scrubUrl('not a url')).toBe('not a url');
    expect(scrubUrl('')).toBe('');
  });

  it('scrubs a path with a query and no host', () => {
    expect(scrubUrl('/settings?x=1#google=finish&code=abc')).toBe('/settings');
    expect(scrubUrl('/projects/prj_1?tab=tasks&task=t1')).toBe('/projects/prj_1?tab=tasks');
  });
});

describe('scrubText', () => {
  it('scrubs each address inside a message', () => {
    expect(scrubText('Failed https://x.test/a?sig=1 now')).toBe('Failed https://x.test/a now');
  });

  it('keeps the mark after an address', () => {
    expect(scrubText('Load failed (https://x.test/a?sig=1).')).toBe('Load failed (https://x.test/a).');
    expect(scrubText('Go to https://x.test/a?sig=1, then stop')).toBe('Go to https://x.test/a, then stop');
  });

  it('scrubs two addresses', () => {
    expect(scrubText('a https://x.test/a?s=1 b http://y.test/b#h c')).toBe('a https://x.test/a b http://y.test/b c');
  });

  it('keeps a text with no address', () => {
    expect(scrubText('Something broke')).toBe('Something broke');
  });
});
