import { describe, expect, it } from 'vitest';
import { docxToHtml } from './docxHtml';
import { sampleDocx, storeZip } from './officeFixtures';

describe('docxToHtml (tsk_495)', () => {
  it('draws the text, the heading, the bold line, the table and the picture of a Word file', async () => {
    const out = await docxToHtml(await sampleDocx());
    if (out.kind !== 'html') throw new Error(`Expected html, got ${out.kind}.`);
    expect(out.html).toMatch(/<h1[^>]*>Site report<\/h1>/);
    expect(out.html).toContain('<strong>Notes of the last visit</strong>');
    expect(out.html).toMatch(/<td[^>]*><p[^>]*>Columns<\/p><\/td>/);
    expect(out.html).toMatch(/<td[^>]*><p[^>]*>12<\/p><\/td>/);
    expect(out.html).toMatch(/<img [^>]*src="data:image\/png;base64,/);
  });

  it('keeps Arabic text as it is', async () => {
    const out = await docxToHtml(await sampleDocx({ arabic: true }));
    if (out.kind !== 'html') throw new Error('Expected html.');
    expect(out.html).toContain('تقرير الموقع');
    expect(out.html).toContain('ملاحظات الزيارة الأخيرة');
  });

  it('makes no script, no handler, no link, no outside address and no vector picture from a hostile file', async () => {
    const out = await docxToHtml(await sampleDocx());
    if (out.kind !== 'html') throw new Error('Expected html.');
    const html = out.html.toLowerCase();
    // The hostile text is text: it shows, escaped, and never becomes a tag.
    expect(out.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(out.html).toContain('&lt;img src=x onerror=alert(2)&gt;');
    // The escaped hostile text holds the words "script" and "onerror", so the test looks for tags and addresses, not for those words.
    for (const part of ['<script', '<a ', 'href', 'javascript:', 'example.com', 'svg', 'http://', 'https://']) expect(html).not.toContain(part);
    // Only the PNG stays: the vector picture and the picture of an outside address are gone.
    expect(out.html.match(/<img/g)).toHaveLength(1);
    expect(out.html).not.toContain('<img src=x');
    // A picture that was left out leaves no empty paragraph behind.
    expect(out.html).not.toContain('<p dir="auto"></p>');
    // The text of the links stays.
    expect(out.html).toContain('Run this link');
    expect(out.html).toContain('Open the site');
  });

  it('says "bad" for a file that is no Word file, and "big" for a file that unpacks too large', async () => {
    expect((await docxToHtml(new TextEncoder().encode('plain text, no zip').buffer as ArrayBuffer)).kind).toBe('bad');
    const noDocument = storeZip([{ name: 'readme.txt', data: new TextEncoder().encode('hello') }]);
    expect((await docxToHtml(noDocument)).kind).toBe('bad');
    const big = await sampleDocx();
    const view = new DataView(big);
    for (let i = 0; i < big.byteLength - 4; i += 1) if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, 0xffffffff, true);
    expect((await docxToHtml(big)).kind).toBe('big');
  });

  it('says "empty" for a Word file with no text and no picture', async () => {
    const text = (value: string) => new TextEncoder().encode(value);
    const empty = storeZip([
      { name: '[Content_Types].xml', data: text('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>') },
      { name: '_rels/.rels', data: text('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>') },
      { name: 'word/document.xml', data: text('<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>') },
    ]);
    expect((await docxToHtml(empty)).kind).toBe('empty');
  });
});
