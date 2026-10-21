import { screenGlow, type GlowLight } from './glow';
import { HUES, projectHue, type Hue } from './projectColor';

/**
 * A project's picture (owner's choice "Glow forms", 2026-10-01): the soft Glow light of the people pictures, with one
 * drawing symbol in ink. Each symbol turns, so one symbol gives up to four forms. No two projects share a picture.
 */
const TURNING = ['arch', 'door', 'wedge', 'dome', 'stair'] as const;
export type Symbol = (typeof TURNING)[number] | 'slab' | 'column';
export type Form = { symbol: Symbol; turn: number };

export const FORMS: Form[] = [
  ...TURNING.flatMap((symbol) => [0, 1, 2, 3].map((turn) => ({ symbol, turn }))),
  { symbol: 'slab', turn: 0 },
  { symbol: 'slab', turn: 1 },
  { symbol: 'column', turn: 0 },
];

/** A mark number names one form and the second light. The first light is the project's own color, so the picture matches it everywhere. */
export const MARK_COUNT = FORMS.length * HUES.length;

export function decodeMark(mark: number): { form: Form; light: Hue } {
  const n = ((mark % MARK_COUNT) + MARK_COUNT) % MARK_COUNT;
  return { form: FORMS[n % FORMS.length], light: HUES[Math.floor(n / FORMS.length)] };
}

/** A well mixed hash, so ids that differ in one digit still land far apart. */
function mixOf(text: string): number {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b) >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35) >>> 0;
  hash ^= hash >>> 16;
  return hash >>> 0;
}

// 97 shares no factor with 184 (8 x 23), so the walk below visits every mark once.
const STEP = 97;

/** The marks in the order this project tries them. Marks whose second light is the project's own color are left out. */
function* candidates(id: string): Generator<number> {
  const hue = projectHue(id);
  const start = mixOf(id) % MARK_COUNT;
  for (let k = 0; k < MARK_COUNT; k++) {
    const mark = (start + k * STEP) % MARK_COUNT;
    if (decodeMark(mark).light !== hue) yield mark;
  }
}

/** The mark of a project saved before marks existed. Fixed for the id. The office gives it a real mark when it loads. */
export function fallbackMark(id: string): number {
  return candidates(id).next().value as number;
}

export const markOf = (project: { id: string; mark?: number }): number => project.mark ?? fallbackMark(project.id);

/** The mark for a new project: the least used form first, and never a picture another project already has. */
export function pickMark(id: string, others: { id: string; mark?: number }[]): number {
  const hue = projectHue(id);
  const uses = new Array<number>(FORMS.length).fill(0);
  const taken = new Set<number>();
  for (const other of others) {
    if (other.id === id) continue;
    const mark = markOf(other) % MARK_COUNT;
    uses[mark % FORMS.length] += 1;
    if (projectHue(other.id) === hue) taken.add(mark);
  }
  let best = fallbackMark(id);
  let bestUses = Infinity;
  for (const mark of candidates(id)) {
    if (taken.has(mark)) continue;
    const count = uses[mark % FORMS.length];
    if (count < bestUses) {
      best = mark;
      bestUses = count;
      if (count === 0) break;
    }
  }
  return best;
}

/** The form as one closed path in a square box at (x, y) of side s. The turn is a rotation about the box center. */
export function formPath(form: Form, x: number, y: number, s: number): string {
  const h = s / 2;
  const q = s / 4;
  const r = (value: number) => Math.round(value * 100) / 100;
  switch (form.symbol) {
    case 'arch': return `M${r(x)} ${r(y + s)}V${r(y + h)}A${r(h)} ${r(h)} 0 0 1 ${r(x + s)} ${r(y + h)}V${r(y + s)}Z`;
    case 'door': return `M${r(x)} ${r(y)}H${r(x + s)}A${r(s)} ${r(s)} 0 0 1 ${r(x)} ${r(y + s)}Z`;
    case 'wedge': return `M${r(x)} ${r(y)}H${r(x + s)}L${r(x)} ${r(y + s)}Z`;
    case 'dome': return `M${r(x)} ${r(y + 3 * q)}A${r(h)} ${r(h)} 0 0 1 ${r(x + s)} ${r(y + 3 * q)}Z`;
    case 'stair': return `M${r(x)} ${r(y + s)}V${r(y + (2 * s) / 3)}H${r(x + s / 3)}V${r(y + s / 3)}H${r(x + (2 * s) / 3)}V${r(y)}H${r(x + s)}V${r(y + s)}Z`;
    case 'slab': return `M${r(x)} ${r(y + q)}H${r(x + s)}V${r(y + 3 * q)}H${r(x)}Z`;
    case 'column': {
      const radius = s * 0.43;
      return `M${r(x + h - radius)} ${r(y + h)}A${r(radius)} ${r(radius)} 0 1 0 ${r(x + h + radius)} ${r(y + h)}A${r(radius)} ${r(radius)} 0 1 0 ${r(x + h - radius)} ${r(y + h)}Z`;
    }
  }
}

/** The two soft lights behind the form: the project's own color and the mark's second light, placed from the id. */
export function markLights(id: string, mark: number): GlowLight[] {
  const n = mixOf(id);
  return [
    { hue: projectHue(id), x: 20 + (n % 20), y: 15 + ((n >>> 5) % 25), size: 75, share: 1 },
    { hue: decodeMark(mark).light, x: 85 - ((n >>> 10) % 20), y: 90 - ((n >>> 15) % 25), size: 70, share: 1 },
  ];
}

/** The background of the project tile in the screens. */
export function markGlow(id: string, mark: number): string {
  return screenGlow(markLights(id, mark));
}
