import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MADAR_DOORS } from '../components/MadarMark';
import { ReportDesign } from './contract/views';
import { REPORT_DESIGN } from './reportDesign';

/** The values of one CSS block, by name: the custom properties between its braces. */
function declarations(block: string): Map<string, string> {
  return new Map([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]));
}

const TOKENS = readFileSync('src/design/tokens.css', 'utf8');
/** The light values: the first root block of the file, which starts at the line's beginning. */
const LIGHT = declarations(/^:root \{([\s\S]*?)^\}/m.exec(TOKENS)![1]);
/** The desktop sizes: the root block inside the 1024 px media query. */
const DESKTOP = declarations(/@media \(min-width: 1024px\) \{\s*:root \{([^}]*)\}/.exec(TOKENS)![1]);

/** Each colour of the guide, with the token it copies. A new colour needs a row here. */
const COLOR_TOKENS: Record<string, string> = {
  ink: '--c-ink',
  inkSecondary: '--c-ink-2',
  hairline: '--c-hairline',
  accent: '--sig-from',
};

/** Each size of the guide, with the desktop token it copies. */
const SIZE_TOKENS: Record<string, string> = {
  title: '--size-title-1',
  heading: '--size-title-2',
  body: '--size-body',
  caption: '--size-caption',
};

describe('REPORT_DESIGN, the design guide of the office report (fbk_016)', () => {
  it('is a valid answer part of the report schema', () => {
    expect(ReportDesign.safeParse(REPORT_DESIGN).success).toBe(true);
  });

  it('copies each colour from the light values of tokens.css, and has no colour without a token', () => {
    expect(Object.keys(REPORT_DESIGN.colors).sort()).toEqual(Object.keys(COLOR_TOKENS).sort());
    for (const [key, token] of Object.entries(COLOR_TOKENS)) {
      expect(LIGHT.get(token), token).toBeDefined();
      expect(REPORT_DESIGN.colors[key], key).toBe(LIGHT.get(token));
    }
  });

  it('keeps the page white, as the token of the card and the panel', () => {
    expect(REPORT_DESIGN.page.background).toBe(LIGHT.get('--c-card'));
    expect(REPORT_DESIGN.page.background).toBe('#FFFFFF');
  });

  it('copies each size from the desktop values of tokens.css', () => {
    expect(Object.keys(REPORT_DESIGN.type.sizes).sort()).toEqual(Object.keys(SIZE_TOKENS).sort());
    for (const [key, token] of Object.entries(SIZE_TOKENS)) {
      expect(REPORT_DESIGN.type.sizes[key], key).toBe(DESKTOP.get(token));
    }
  });

  it('draws the mark with the same path as the Madar logo', () => {
    expect(REPORT_DESIGN.brand.mark.path).toBe(MADAR_DOORS);
    expect(REPORT_DESIGN.brand.mark.viewBox).toBe('0 0 18 18');
    expect(REPORT_DESIGN.brand.name).toBe('Madar');
    expect(REPORT_DESIGN.brand.nameAr).toBe('مدار');
  });

  it('names Thmanyah Sans as the brand font, with a free fallback that the document may use', () => {
    expect(REPORT_DESIGN.type.family).toContain('Thmanyah Sans');
    expect(REPORT_DESIGN.type.fallback).toContain('IBM Plex Sans Arabic');
  });

  it('gives short rules, each of 25 words or less, with no dash', () => {
    expect(REPORT_DESIGN.rules.length).toBeGreaterThan(0);
    for (const rule of REPORT_DESIGN.rules) {
      expect(rule, rule).not.toMatch(/[\u2013\u2014]/);
      expect(rule.split(/\s+/).length, rule).toBeLessThanOrEqual(25);
    }
  });

  it('has no dash in any text of the guide', () => {
    expect(JSON.stringify(REPORT_DESIGN)).not.toMatch(/[\u2013\u2014]/);
  });
});
