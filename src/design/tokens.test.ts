import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Vitest runs from the repository root.
const css = readFileSync('src/design/tokens.css', 'utf8');

/** The value of a token inside one block of tokens.css. */
function token(block: string, name: string): string {
  const start = css.indexOf(`${block} {`);
  const body = css.slice(start, css.indexOf('}', start));
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(body);
  if (!match) throw new Error(`${name} is missing in ${block}`);
  return match[1].trim();
}

type Rgb = [number, number, number];
const hex = (value: string): Rgb => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16)) as Rgb;
function rgba(value: string): { rgb: Rgb; alpha: number } {
  const [r, g, b, a] = /rgba\(([^)]+)\)/.exec(value)![1].split(',').map(Number);
  return { rgb: [r, g, b], alpha: a };
}
const luminance = (rgb: Rgb) => {
  const [r, g, b] = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const over = (glass: { rgb: Rgb; alpha: number }, under: Rgb): Rgb =>
  glass.rgb.map((v, i) => Math.round(glass.alpha * v + (1 - glass.alpha) * under[i])) as Rgb;

// Anything can scroll under the tab bar: black, white, and the saturated colors of cover images.
const UNDER: Rgb[] = [[0, 0, 0], [255, 255, 255], [255, 0, 0], [0, 0, 255], [0, 128, 0], [255, 204, 0], [224, 102, 47]];

describe('text on frosted glass', () => {
  it('keeps the tab bar labels at 4.5:1 over any content, in light and dark (WCAG 1.4.3)', () => {
    for (const block of [':root', '[data-theme="dark"]']) {
      const glass = rgba(token(block, '--glass-bg'));
      for (const name of ['--c-label-2', '--c-glass-accent']) {
        const text = hex(token(block, name));
        const worst = Math.min(...UNDER.map((under) => contrast(text, over(glass, under))));
        expect(worst, `${name} in ${block}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe('chart marks', () => {
  it('keep 3:1 against the card in light and dark (WCAG 1.4.11)', () => {
    for (const block of [':root', '[data-theme="dark"]']) {
      const card = hex(token(block, '--c-card'));
      for (const name of ['--c-chart-muted', '--c-accent-fill', '--c-orange-text', '--c-label-2', '--c-red']) {
        const value = token(block, name);
        expect(contrast(hex(value), card), `${name} in ${block}`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
