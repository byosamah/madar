import { describe, expect, it } from 'vitest';
import { drawingPdf, renderSvg, sceneOf } from './assets';

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

describe('sceneOf (2026-10-06)', () => {
  it('holds the shapes that renderSvg draws, so a PNG of the test office shows the same scene', () => {
    const scene = sceneOf(28, 1);
    const svg = renderSvg('Villas & Pools', 'KH-26-002', 28, 1);
    expect(scene.blocks).toHaveLength(5);
    for (const block of scene.blocks) {
      const [h, s, l] = block.fill;
      expect(svg).toContain(`<rect x="${block.x}" y="${block.y}" width="${block.width}" height="${block.height}" fill="hsl(${h} ${s}% ${l}%)"/>`);
    }
    expect(svg).toContain(`stop-color="hsl(${scene.sky[0].join(' ').replace(/ (\d+) (\d+)$/, ' $1% $2%')})"`);
    expect(svg).toContain(`<rect y="${scene.ground.y}" width="1600" height="${900 - scene.ground.y}" fill="hsl(${scene.ground.fill[0]} ${scene.ground.fill[1]}% ${scene.ground.fill[2]}%)"/>`);
  });
});
