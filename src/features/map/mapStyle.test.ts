import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAP_COLORS, madarMapStyle } from './mapStyle';

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

  it('reads the tiles and the glyphs from OpenFreeMap only: free, no account, no key (owner, 2026-10-19)', () => {
    const style = madarMapStyle('light', 'en');
    const source = style.sources.openmaptiles as { type: string; url: string };
    expect(source.type).toBe('vector');
    expect(source.url).toBe('https://tiles.openfreemap.org/planet');
    expect(style.glyphs).toBe('https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf');
    // No other address and no key in the style.
    const hosts = [...JSON.stringify(style).matchAll(/https?:\/\/[^/"]+/g)].map((match) => match[0]);
    expect([...new Set(hosts)]).toEqual(['https://tiles.openfreemap.org']);
    expect(JSON.stringify(style)).not.toMatch(/key=|token|api_key/i);
    expect(Object.keys(style.sources)).toEqual(['openmaptiles']);
  });

  it('draws water, parks, buildings, roads with casings, borders and labels, in Madar colors', () => {
    const style = madarMapStyle('light', 'en');
    const ids = style.layers.map((layer) => layer.id);
    for (const id of ['background', 'water', 'park', 'building', 'road-motorway-casing', 'road-motorway', 'boundary', 'place-city', 'road-label-major']) expect(ids).toContain(id);
    // Every casing is under every road fill, so a junction has no seam.
    expect(ids.lastIndexOf('road-motorway-casing')).toBeLessThan(ids.indexOf('road-service'));
    // The labels draw last.
    expect(ids.indexOf('water-label')).toBeGreaterThan(ids.indexOf('road-motorway'));
  });

  it('writes the labels in the screen language, with the Arabic name first when the screens are in Arabic', () => {
    const arabic = JSON.stringify(madarMapStyle('light', 'ar'));
    const english = JSON.stringify(madarMapStyle('light', 'en'));
    expect(arabic).toContain('name:ar');
    expect(english).not.toContain('name:ar');
    expect(english).toContain('name:en');
  });

  it('keeps the letters of an Arabic label joined: no letter spacing on an Arabic screen', () => {
    expect(JSON.stringify(madarMapStyle('light', 'ar'))).not.toMatch(/"text-letter-spacing":0\.\d/);
    expect(JSON.stringify(madarMapStyle('light', 'en'))).toMatch(/"text-letter-spacing":0\.\d/);
  });

  // OpenFreeMap serves the glyphs of Noto Sans Regular and Noto Sans Bold, and both hold the Arabic block (probe of 2026-10-19).
  it('asks the glyph route only for Noto Sans Regular and Noto Sans Bold, in both themes and languages', () => {
    for (const theme of ['light', 'dark'] as const) {
      for (const lang of ['en', 'ar'] as const) {
        const names = [...JSON.stringify(madarMapStyle(theme, lang)).matchAll(/"Noto Sans[^"]*"/g)].map((match) => match[0].slice(1, -1));
        expect([...new Set(names)].sort(), `${theme} ${lang}`).toEqual(['Noto Sans Bold', 'Noto Sans Regular']);
      }
    }
  });

  it('keeps the light theme on the page grey, the glow blue water and the glow mint parks, and the dark theme on the dark tokens', () => {
    expect(MAP_COLORS.light).toMatchObject({ land: '#F4F4F7', water: '#CCE0FF', green: '#CFF2E2', road: '#FFFFFF' });
    expect(MAP_COLORS.dark).toMatchObject({ land: '#0D0D10', water: '#1B2A44' });
  });
});
