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
const over = (layer: { rgb: Rgb; alpha: number }, under: Rgb): Rgb =>
  layer.rgb.map((v, i) => Math.round(layer.alpha * v + (1 - layer.alpha) * under[i])) as Rgb;
const luminance = (rgb: Rgb) => {
  const [r, g, b] = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

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

describe('status text', () => {
  it('keeps 4.5:1 on the card and on a hovered row, in light and dark (WCAG 1.4.3)', () => {
    for (const block of [':root', '[data-theme="dark"]']) {
      const card = hex(token(block, '--c-card'));
      const hovered = over(rgba(token(block, '--c-fill')), card);
      for (const name of ['--c-red-text', '--c-orange-text', '--c-green-text']) {
        const text = hex(token(block, name));
        expect(contrast(text, card), `${name} on the card in ${block}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(text, hovered), `${name} on a hovered row in ${block}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe('calm palette', () => {
  it('keeps every project tile text at 4.5:1 and every line at 3:1, in light and dark', () => {
    for (const block of [':root', '[data-theme="dark"]']) {
      const panel = hex(token(block, '--c-panel'));
      for (const hue of ['blue', 'orange', 'green', 'purple', 'pink', 'teal', 'amber', 'indigo']) {
        const bg = hex(token(block, `--p-${hue}-bg`));
        const fg = hex(token(block, `--p-${hue}-fg`));
        expect(contrast(fg, bg), `${hue} tile in ${block}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(fg, panel), `${hue} line in ${block}`).toBeGreaterThanOrEqual(3);
      }
      for (const [text, bg] of [['--c-attn-text', '--c-attn-bg'], ['--c-late-text', '--c-late-bg'], ['--c-ink-2', '--c-panel'], ['--c-link', '--c-panel']]) {
        expect(contrast(hex(token(block, text)), hex(token(block, bg))), `${text} in ${block}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps white text on the signature gradient at 4.5:1 at both ends', () => {
    for (const name of ['--sig-from', '--sig-to']) expect(contrast([255, 255, 255], hex(token(':root', name))), name).toBeGreaterThanOrEqual(4.5);
  });
});

describe('text on the glow', () => {
  it('keeps the Next for you label and context at 4.5:1 on the brightest glow tints', () => {
    for (const tint of ['--glow-a', '--glow-b', '--glow-c']) {
      const bg = hex(token(':root', tint));
      for (const text of ['--sig-text', '--c-glow-ink-2']) expect(contrast(hex(token(':root', text)), bg), `${text} on ${tint}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
