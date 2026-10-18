import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { madarMapStyle } from './mapStyle';

// Vitest runs from the repository root. The colors of the map must be tokens of tokens.css, in the block of their theme.
const css = readFileSync('src/design/tokens.css', 'utf8');

/** The values of all tokens inside one block of tokens.css, upper case. */
function tokenValuesOf(block: string): string[] {
  const start = css.indexOf(`${block} {`);
  if (start < 0) throw new Error(`${block} is missing in tokens.css`);
  const body = css.slice(start, css.indexOf('}', start));
  return [...body.matchAll(/--[\w-]+:\s*([^;]+);/g)].map((match) => match[1].trim().toUpperCase());
}

/** Every hex color in a style, upper case. */
const hexColorsOf = (value: unknown): string[] => [...JSON.stringify(value).matchAll(/#[0-9A-Fa-f]{6}\b/g)].map((match) => match[0].toUpperCase());

describe('madarMapStyle (fbk_017)', () => {
  it('uses only the token colors of the light theme', () => {
    const tokens = tokenValuesOf(':root');
    const colors = hexColorsOf(madarMapStyle('light', 'en'));
    expect(colors.length).toBeGreaterThan(0);
    expect(colors.filter((color) => !tokens.includes(color))).toEqual([]);
  });

  it('uses only the token colors of the dark theme', () => {
    const tokens = tokenValuesOf('[data-theme="dark"]');
    const colors = hexColorsOf(madarMapStyle('dark', 'ar'));
    expect(colors.length).toBeGreaterThan(0);
    expect(colors.filter((color) => !tokens.includes(color))).toEqual([]);
  });

  it('has no layer of the points of interest (shops, icons)', () => {
    for (const theme of ['light', 'dark'] as const) {
      const layers = madarMapStyle(theme, 'en').layers;
      expect(layers.filter((layer) => 'source-layer' in layer && layer['source-layer'] === 'pois')).toEqual([]);
      expect(layers.filter((layer) => layer.id.includes('poi'))).toEqual([]);
    }
  });

  it('reads the map file and the glyphs from the own address, never from a third party', () => {
    const style = madarMapStyle('light', 'en');
    const source = style.sources.protomaps as { type: string; url: string };
    expect(source.type).toBe('vector');
    expect(source.url).toBe(`pmtiles://${window.location.origin}/map/sa.pmtiles`);
    expect(style.glyphs).toBe(`${window.location.origin}/map/fonts/{fontstack}/{range}.pbf`);
  });

  it('writes the labels in the screen language, with the Arabic name first when the screens are in Arabic', () => {
    const arabic = JSON.stringify(madarMapStyle('light', 'ar'));
    const english = JSON.stringify(madarMapStyle('light', 'en'));
    expect(arabic).toContain('name:ar');
    expect(english).not.toContain('name:ar');
  });

  // The map uploads the glyph files of Noto Sans Regular only (proof.md, Map basemap probe). The Devanagari font sits inside
  // a case on the script of a label. The Saudi extract holds no such label, so that font never draws.
  it('asks the glyph route only for Noto Sans Regular and the Devanagari case, in both themes and languages', () => {
    for (const theme of ['light', 'dark'] as const) {
      for (const lang of ['en', 'ar'] as const) {
        const names = [...JSON.stringify(madarMapStyle(theme, lang)).matchAll(/"Noto Sans[^"]*"/g)].map((match) => match[0].slice(1, -1));
        expect([...new Set(names)].sort(), `${theme} ${lang}`).toEqual(['Noto Sans Devanagari Regular v1', 'Noto Sans Regular']);
      }
    }
  });
});
