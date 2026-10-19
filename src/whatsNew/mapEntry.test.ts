import { describe, expect, it } from 'vitest';
import { ar, en } from '../i18n/trees';

describe("the map entry of What's new (the Location is the address of the pin, 2026-10-19)", () => {
  const body = (tree: typeof en) => (tree as unknown as { whatsNew: { items: Record<string, { body: string }> } }).whatsNew.items['2026-10-23-8'].body;

  it('says that the Location of a project is its pin and that the address comes from the map, in English', () => {
    expect(body(en)).toContain('The Location of a project is its pin.');
    expect(body(en)).toContain('Madar takes the address from the map.');
  });

  it('says it in Arabic too', () => {
    expect(body(ar)).toContain('موقع المشروع هو دبوسه على الخريطة');
    expect(body(ar)).toContain('عنوانه من الخريطة');
  });
});
