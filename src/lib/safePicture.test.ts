import { describe, expect, it } from 'vitest';
import { safePicture } from './safePicture';

describe('the safe picture check (it has its own file, so the first load does not carry the canvas code of picture.ts)', () => {
  it('shows only picture data and https addresses', () => {
    expect(safePicture('data:image/webp;base64,AAAA')).toBe('data:image/webp;base64,AAAA');
    expect(safePicture('https://example.com/a.png')).toBe('https://example.com/a.png');
    for (const bad of [null, undefined, '', 'javascript:alert(1)', 'http://example.com/a.png', 'data:image/svg+xml;base64,AAAA', '/a.png']) {
      expect(safePicture(bad), String(bad)).toBeNull();
    }
  });
});
