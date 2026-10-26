import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { personLights } from './glow';
import { HUES, projectHue } from './projectColor';
import { decodeMark, formPath, markLights, markOf } from './projectMark';
import { OWNER_SHAPES } from '../test/projectShapes';
import { LIGHT_LOOK, personGlowCss, projectColorLook, tileSvg } from './pictureLook';

/** The values of the first root block of tokens.css: the light theme. */
const TOKENS = readFileSync('src/design/tokens.css', 'utf8');
const LIGHT = new Map([.../^:root \{([\s\S]*?)^\}/m.exec(TOKENS)![1].matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]));

describe('the pictures for agents in the light theme (owner, 2026-10-21)', () => {
  it('copies the panel, the ink, the glow strength and each project hue from the light values of tokens.css', () => {
    expect(LIGHT_LOOK.panel).toBe(LIGHT.get('--c-panel'));
    expect(LIGHT_LOOK.ink).toBe(LIGHT.get('--c-ink'));
    expect(`${LIGHT_LOOK.glow * 100}%`).toBe(LIGHT.get('--avatar-glow'));
    expect(Object.keys(LIGHT_LOOK.hues)).toEqual([...HUES]);
    for (const hue of HUES) {
      expect(LIGHT_LOOK.hues[hue].fg, hue).toBe(LIGHT.get(`--p-${hue}-fg`));
      expect(LIGHT_LOOK.hues[hue].bg, hue).toBe(LIGHT.get(`--p-${hue}-bg`));
    }
  });

  it('writes the person glow of the screens with the light colors: the same places and sizes, 35% and 21% strength, on white', () => {
    const [first, second] = personLights('usr_002');
    const { fg } = LIGHT_LOOK.hues[first.hue];
    const [r, g, b] = [1, 3, 5].map((at) => parseInt(fg.slice(at, at + 2), 16));
    expect(personGlowCss('usr_002')).toBe(
      `radial-gradient(75% 75% at ${first.x}% ${first.y}%, rgba(${r}, ${g}, ${b}, 0.35) 0%, transparent 100%), `
      + `radial-gradient(70% 70% at ${second.x}% ${second.y}%, rgba(${r}, ${g}, ${b}, 0.21) 0%, transparent 100%), #FFFFFF`,
    );
    expect(personGlowCss('usr_002')).not.toContain('var(');
  });

  it('gives the project color as the hue name of the screens and its two light values', () => {
    for (const id of ['prj_001', 'prj_002', 'prj_014']) {
      const hue = projectHue(id);
      expect(projectColorLook(id)).toEqual({ name: hue, fg: LIGHT_LOOK.hues[hue].fg, bg: LIGHT_LOOK.hues[hue].bg });
    }
  });

  it('draws the project tile as one SVG: the panel, both lights of the mark, the ring and the turned form in ink', () => {
    const project = { id: 'prj_003', mark: 42 };
    const svg = tileSvg(project);
    const [first, second] = markLights(project.id, 42);
    const { form } = decodeMark(42);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 34 34" width="34" height="34">')).toBe(true);
    expect(svg).toContain(`<radialGradient id="t-prj_003-a" cx="${first.x / 100}" cy="${first.y / 100}" r="0.75"><stop offset="0" stop-color="${LIGHT_LOOK.hues[first.hue].fg}" stop-opacity="0.35"/>`);
    expect(svg).toContain(`<radialGradient id="t-prj_003-b" cx="${second.x / 100}" cy="${second.y / 100}" r="0.7"><stop offset="0" stop-color="${LIGHT_LOOK.hues[second.hue].fg}" stop-opacity="0.35"/>`);
    // The first light of the CSS sits on top, so it is painted last, over the second light and the panel.
    expect(svg.indexOf('fill="#FFFFFF"')).toBeLessThan(svg.indexOf('url(#t-prj_003-b)'));
    expect(svg.indexOf('fill="url(#t-prj_003-b)"')).toBeLessThan(svg.indexOf('fill="url(#t-prj_003-a)"'));
    expect(svg).toContain('rx="10.2"');
    // The ring stays 1 px at any size, as the ring of the screens (ring-1), also when a document draws the tile larger.
    expect(svg).toContain('stroke="#1D1D1F" stroke-opacity="0.1" vector-effect="non-scaling-stroke"');
    expect(svg).toContain(`<path d="${formPath(form, 9.35, 9.35, 15.3)}" transform="rotate(${form.turn * 90} 17 17)" fill="#1D1D1F" fill-opacity="0.86"/>`);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).not.toContain('var(');
    expect(svg.length).toBeLessThan(1_000);
  });

  it('uses the mark that the screens use for a project saved before marks, and keeps the ids of two tiles apart', () => {
    expect(tileSvg({ id: 'prj_009' })).toBe(tileSvg({ id: 'prj_009', mark: markOf({ id: 'prj_009' }) }));
    expect(tileSvg({ id: 'prj_009' })).not.toContain('t-prj_001-a');
    // A character that an XML id may not hold leaves the id.
    expect(tileSvg({ id: 'prj"<9', mark: 1 })).toContain('id="t-prj9-a"');
  });
});

describe('the project tile with its own shape (owner, 2026-10-26)', () => {
  it('draws the shape in the place of the form, scaled from the box of 18 to the form box, with no turn', () => {
    const svg = tileSvg({ id: 'prj_003', mark: 42, shape: OWNER_SHAPES.kutla });
    const { form } = decodeMark(42);
    // The form box is 45% of 34 = 15.3, from 9.35. The scale is 15.3 / 18 = 0.85.
    expect(svg).toContain(`<path d="${OWNER_SHAPES.kutla}" transform="translate(9.35 9.35) scale(0.85)" fill="#1D1D1F" fill-opacity="0.86"/>`);
    expect(svg).not.toContain('rotate(');
    expect(svg).not.toContain(formPath(form, 9.35, 9.35, 15.3));
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  it('keeps the panel, both lights and the ring exactly as they are', () => {
    const plain = tileSvg({ id: 'prj_003', mark: 42 });
    const shaped = tileSvg({ id: 'prj_003', mark: 42, shape: OWNER_SHAPES.madar });
    const frame = (svg: string) => svg.slice(0, svg.lastIndexOf('<path'));
    expect(frame(shaped)).toBe(frame(plain));
  });

  it('takes all three shapes of the owner', () => {
    for (const shape of Object.values(OWNER_SHAPES)) expect(tileSvg({ id: 'prj_003', mark: 42, shape })).toContain(`d="${shape}"`);
  });

  it('draws the form for a shape that is null or missing', () => {
    const plain = tileSvg({ id: 'prj_003', mark: 42 });
    expect(tileSvg({ id: 'prj_003', mark: 42, shape: null })).toBe(plain);
    expect(tileSvg({ id: 'prj_003', mark: 42, shape: undefined })).toBe(plain);
  });

  it('never puts a refused string in the drawing: it falls back to the form', () => {
    const plain = tileSvg({ id: 'prj_003', mark: 42 });
    for (const shape of ['', 'M0 0"/><script>alert(1)</script>', 'M0 0" onload="x', '<svg/>', 'L1 1', `M${'1'.repeat(2000)}`]) {
      const svg = tileSvg({ id: 'prj_003', mark: 42, shape });
      expect(svg, shape).toBe(plain);
      expect(svg).not.toContain('<script');
      expect(svg).not.toContain('onload');
    }
  });
});
