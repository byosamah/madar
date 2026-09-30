import { describe, expect, it } from 'vitest';
import { drawingPdf, renderSvg } from './assets';

describe('generated files', () => {
  it('writes a PDF whose cross-reference offsets point at each object', () => {
    const pdf = drawingPdf(['KH-26-001 Corniche Office Tower', 'Ground floor plan', 'Revision B']);
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    const xref = Number(/startxref\n(\d+)/.exec(pdf)?.[1]);
    expect(pdf.slice(xref).startsWith('xref')).toBe(true);
    const offsets = [...pdf.matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
    offsets.forEach((offset, i) => expect(pdf.slice(offset).startsWith(`${i + 1} 0 obj`)).toBe(true));
  });

  it('writes an SVG and escapes the text', () => {
    const svg = renderSvg('Villas & Pools', 'KH-26-002', 28, 1);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('Villas &amp; Pools');
  });
});
