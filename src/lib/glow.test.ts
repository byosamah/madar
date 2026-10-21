import { describe, expect, it } from 'vitest';
import { glowOf } from '../components/Avatar';
import { personLights, screenGlow } from './glow';
import { HUES, projectHue } from './projectColor';
import { decodeMark, markGlow, markLights } from './projectMark';

/** The glow of a person as the screens wrote it before the shared rule (owner, 2026-10-01). The new rule must give the same text. */
function oldPersonGlow(id: string): string {
  let n = 0;
  for (const ch of id) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = HUES[n % HUES.length];
  const light = (strength: string) => `color-mix(in srgb, var(--p-${hue}-fg) ${strength}, transparent)`;
  return [
    `radial-gradient(75% 75% at ${20 + (n % 20)}% ${15 + ((n >>> 4) % 25)}%, ${light('var(--avatar-glow)')} 0%, transparent 100%)`,
    `radial-gradient(70% 70% at ${85 - ((n >>> 2) % 20)}% ${90 - ((n >>> 6) % 25)}%, ${light('calc(var(--avatar-glow) * 0.6)')} 0%, transparent 100%)`,
    'var(--c-panel)',
  ].join(', ');
}

const IDS = Array.from({ length: 60 }, (_, i) => [`usr_${String(i).padStart(3, '0')}`, `prj_${String(i * 7).padStart(3, '0')}`, `cnv_${i}x`]).flat();

describe('the shared glow rule (owner, 2026-10-21: the screens and the agent pictures draw the same lights)', () => {
  it('gives the person glow of the screens the same text as before', () => {
    for (const id of IDS) {
      expect(glowOf(id), id).toBe(oldPersonGlow(id));
      expect(screenGlow(personLights(id)), id).toBe(oldPersonGlow(id));
    }
  });

  it('gives the project tile two lights: the project color first, the mark light second, both at full strength', () => {
    for (const id of IDS) {
      for (const mark of [0, 7, 51, 183]) {
        const [first, second] = markLights(id, mark);
        expect(first.hue, id).toBe(projectHue(id));
        expect(second.hue, id).toBe(decodeMark(mark).light);
        expect([first.size, second.size, first.share, second.share]).toEqual([75, 70, 1, 1]);
        expect(markGlow(id, mark)).toBe(screenGlow([first, second]));
        expect(markGlow(id, mark)).toContain(`radial-gradient(75% 75% at ${first.x}% ${first.y}%, color-mix(in srgb, var(--p-${first.hue}-fg) var(--avatar-glow), transparent) 0%, transparent 100%)`);
        expect(markGlow(id, mark).endsWith(', var(--c-panel)')).toBe(true);
      }
    }
  });
});
