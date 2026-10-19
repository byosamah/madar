import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
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

  it('keeps the text on the signature ink at 4.5:1, in light and dark', () => {
    for (const block of [':root', '[data-theme="dark"]']) {
      expect(contrast(hex(token(block, '--on-sig')), hex(token(block, '--sig-from'))), block).toBeGreaterThanOrEqual(4.5);
    }
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

describe('the glow drift', () => {
  it('moves only by transform, once every 8 seconds, and stops under Reduce motion', () => {
    const keyframes = css.slice(css.indexOf('@keyframes glow-drift'), css.indexOf('}\n}', css.indexOf('@keyframes glow-drift')));
    expect(keyframes).toMatch(/transform:/);
    expect(keyframes).not.toMatch(/opacity|background|left|top/);
    expect(css).toMatch(/animation: glow-drift 8s ease-in-out infinite;/);
    expect(css).toMatch(/animation: glow-drift-2 8s ease-in-out infinite;/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\n  \.glow::before,\n  \.glow::after \{\n    animation: none;/);
  });
});

describe('floating layers', () => {
  it('keep a solid panel background, so menus and popups never show the page through them', () => {
    expect(css).toMatch(/\.float \{\n\s+background: var\(--c-panel\);/);
  });
});

// The owner (2026-10-05): in the Arabic screens, English text also sits on the right (and Arabic text on the left in English).
describe('text with its own direction', () => {
  // Chrome and Safari know only -webkit-match-parent (CSS.supports is false for match-parent in Chrome); Firefox takes match-parent.
  it('takes its side from the page: dir="auto", dir="ltr" and <bdi> keep only the order of the letters', () => {
    expect(css).toMatch(
      /body \[dir="auto"\],\n\s+body \[dir="ltr"\],\n\s+body bdi \{\n\s+text-align: -webkit-match-parent;\n\s+text-align: match-parent;\n\s+\}/,
    );
    // The rule sits outside a comment: the last comment before it is closed.
    const before = css.slice(0, css.indexOf('body [dir="auto"]'));
    expect(before.lastIndexOf('*/')).toBeGreaterThan(before.lastIndexOf('/*'));
  });
});

describe('the font stacks', () => {
  // The owner's font since 2026-10-05: Thmanyah Sans for Arabic and English (font.thmanyah.com, free, licence in each file).
  const FACE = /@font-face \{[^}]*\}/g;
  const faces = [...css.matchAll(FACE)].map((m) => m[0]);
  const stacks = [...css.replace(FACE, '').matchAll(/(?:--font-sans|font-family):\s*([^;]+);/g)].map((m) => m[1].trim());

  it('put "Thmanyah Sans" first in every stack (after the dot), with Inter and IBM Plex Sans Arabic after it as the fallback', () => {
    expect(stacks).toEqual([
      '"Madar Dot", "Thmanyah Sans", "Inter Variable", "IBM Plex Sans Arabic", system-ui, -apple-system, "Segoe UI", sans-serif',
      '"Madar Dot", "Thmanyah Sans", "Inter Variable", "IBM Plex Sans Arabic", system-ui, -apple-system, "Segoe UI", sans-serif',
      '"Madar Dot", "Thmanyah Sans", "IBM Plex Sans Arabic", "Inter Variable", system-ui, -apple-system, "Segoe UI", sans-serif',
      '"Madar Digits", var(--font-sans)',
    ]);
  });

  // The Thmanyah middle dot is wide and round, so "5 أكتوبر · مراجعة" read like an Arabic zero. IBM Plex Sans Arabic has no
  // middle dot, so the Arabic screens drew the Inter dot before Thmanyah too (owner, 2026-10-05).
  it('takes only the middle dot from Inter, first in every stack', () => {
    const dot = faces.filter((face) => face.includes('font-family: "Madar Dot";'));
    expect(dot).toHaveLength(1);
    expect(dot[0]).toContain('src: url("./inter/inter-digits-dot.woff2") format("woff2-variations");');
    expect(dot[0]).toContain('unicode-range: U+00B7;');
  });

  it('load Thmanyah Sans in the weights the screens use, and show the fallback until the file arrives', () => {
    const thmanyah = faces.filter((face) => face.includes('font-family: "Thmanyah Sans";'));
    expect(thmanyah.map((face) => [/font-weight: ([\d ]+);/.exec(face)?.[1], /url\("([^"]+)"\)/.exec(face)?.[1]])).toEqual([
      ['400', './fonts/thmanyahsans-Regular.otf'],
      ['500 600', './fonts/thmanyahsans-Medium.otf'],
      ['700', './fonts/thmanyahsans-Bold.otf'],
    ]);
    for (const face of thmanyah) expect(face).toContain('font-display: swap;');
  });

  // The weight ladder: Bold for headings only, Medium for the emphasis in rows, labels and buttons (font-semibold asks 600),
  // Regular for body text. Without it, every font-semibold spot took the Bold file and most of the screen looked bold.
  it('give Bold only to the heading styles: every text style with its own weight is a heading and asks 700', () => {
    const weights = Object.fromEntries([...css.matchAll(/--text-([a-z0-9-]+)--font-weight:\s*(\d+);/g)].map((m) => [m[1], m[2]]));
    expect(weights).toEqual({
      'page-title': '700',
      section: '700',
      'large-title': '700',
      'title-1': '700',
      'title-2': '700',
      'title-3': '700',
      headline: '700',
    });
  });

  // The licence forbids any change to the files: no woff2 conversion, no subset. A new version from Thmanyah changes these hashes.
  it('keep the font files byte for byte as Thmanyah ships them (version 1.003)', () => {
    const sha = (name: string) => createHash('sha256').update(readFileSync(`src/design/fonts/${name}`)).digest('hex');
    expect(readdirSync('src/design/fonts').sort()).toEqual(['thmanyahsans-Bold.otf', 'thmanyahsans-Medium.otf', 'thmanyahsans-Regular.otf']);
    expect(sha('thmanyahsans-Regular.otf')).toBe('f45a420632384b42a37ec9b24298ddc6502faa52d55d973144779262ebc023dc');
    expect(sha('thmanyahsans-Medium.otf')).toBe('f2762ffbe17351193e3d630dd10f0c3a965e6c873998dfdeda2bd0dcad7985c6');
    expect(sha('thmanyahsans-Bold.otf')).toBe('72cc27021cc1a503e5c03b072df8b16d55c78983e5fd73a4cdf92b5a600af2f7');
  });

  // The licence allows the font only inside the built product, so no plain public path serves a font file.
  it('serve no font file from public/', () => {
    const files = readdirSync('public', { recursive: true }).map(String);
    expect(files.filter((name) => /\.(otf|ttf|woff2?)$/i.test(name))).toEqual([]);
  });

  // Thmanyah Sans has no tabular figures (no tnum feature, and a 1 is narrower than a 0), so counts and timers would jump.
  it('give the number spots the digits of Inter only, and keep Thmanyah Sans for their other letters', () => {
    const digits = faces.filter((face) => face.includes('font-family: "Madar Digits";'));
    expect(digits).toHaveLength(1);
    expect(digits[0]).toContain('src: url("./inter/inter-digits-dot.woff2") format("woff2-variations");');
    expect(digits[0]).toContain('unicode-range: U+0030-0039;');
    expect(css).toMatch(/\.tabular \{\n\s+font-family: "Madar Digits", var\(--font-sans\);\n\s+font-variant-numeric: tabular-nums;/);
  });

  it('load no other font: the only faces are Thmanyah Sans (3 weights), the Inter dot and the Inter digits', () => {
    expect(faces.map((face) => /font-family: "([^"]+)";/.exec(face)?.[1])).toEqual([
      'Thmanyah Sans', 'Thmanyah Sans', 'Thmanyah Sans', 'Madar Dot', 'Madar Digits',
    ]);
  });
});

// The owner (2026-10-19): typed text and chat text follow their own language; names and labels keep the side of the page.
describe('the side of text with its own direction', () => {
  it('lets typed text and chat text follow their own language', () => {
    expect(css).toMatch(/body textarea\[dir="auto"\],\s*body input\[dir="auto"\],\s*body \.natural-side\[dir="auto"\] \{\s*text-align: start;/);
    expect(css).toMatch(/body \[dir="auto"\],\s*body \[dir="ltr"\],\s*body bdi \{\s*text-align: -webkit-match-parent;/);
  });
});

describe('the names-you mark (chat design item 4)', () => {
  it('has its two tokens in light and dark', () => {
    expect(token(':root', '--c-mention-bg')).toBe('#F4EDFF');
    expect(token(':root', '--c-mention-bar')).toBe('#7E22CE');
    expect(token('[data-theme="dark"]', '--c-mention-bg')).toBe('#2D2442');
    expect(token('[data-theme="dark"]', '--c-mention-bar')).toBe('#C29BFF');
  });
  it('keeps the text 4.5:1 and the bar 3:1 on the tint, in light and dark', () => {
    for (const block of [':root', '[data-theme="dark"]']) {
      const tint = hex(token(block, '--c-mention-bg'));
      for (const name of ['--c-ink', '--c-ink-2', '--c-link']) expect(contrast(hex(token(block, name)), tint), `${name} in ${block}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(hex(token(block, '--c-mention-bar')), tint)).toBeGreaterThanOrEqual(3);
    }
  });
});
