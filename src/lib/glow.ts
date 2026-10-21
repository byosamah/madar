import { HUES, type Hue } from './projectColor';

/**
 * One soft light of a Glow picture (owner's choice, 2026-10-01): its hue, the place of its center and its size (in % of the box),
 * and its strength as a share of --avatar-glow. The screens and the pictures for agents (server/mcp/pictures.ts) draw the same lights.
 */
export type GlowLight = { hue: Hue; x: number; y: number; size: number; share: number };

function hashOf(id: string): number {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash;
}

/**
 * The two lights of a person or a group (owner, 2026-10-01: "one color instead of two"): two soft lights of the same project hue,
 * placed from the id, so the picture keeps its depth.
 */
export function personLights(id: string): GlowLight[] {
  const n = hashOf(id);
  const hue = HUES[n % HUES.length];
  return [
    { hue, x: 20 + (n % 20), y: 15 + ((n >>> 4) % 25), size: 75, share: 1 },
    { hue, x: 85 - ((n >>> 2) % 20), y: 90 - ((n >>> 6) % 25), size: 70, share: 0.6 },
  ];
}

/** The lights as a CSS background over a ground: color gives the color of one light at its strength. */
export function glowCss(lights: GlowLight[], color: (light: GlowLight) => string, ground: string): string {
  return [
    ...lights.map((light) => `radial-gradient(${light.size}% ${light.size}% at ${light.x}% ${light.y}%, ${color(light)} 0%, transparent 100%)`),
    ground,
  ].join(', ');
}

/** The screen form: each light in its project hue at a share of --avatar-glow (lower in dark mode), over the panel. */
export function screenGlow(lights: GlowLight[]): string {
  const strength = (share: number) => (share === 1 ? 'var(--avatar-glow)' : `calc(var(--avatar-glow) * ${share})`);
  return glowCss(lights, (light) => `color-mix(in srgb, var(--p-${light.hue}-fg) ${strength(light.share)}, transparent)`, 'var(--c-panel)');
}
