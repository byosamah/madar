import { glowCss, personLights, type GlowLight } from './glow';
import { projectHue, type Hue } from './projectColor';
import { decodeMark, formPath, markLights, markOf } from './projectMark';
import { isProjectShape } from './projectShape';

/**
 * The pictures of the screens as an agent gets them (owner, 2026-10-21): the same lights and forms, with the colors of the light
 * theme of tokens.css in place of the CSS variables. A report is a white page, so an agent gets the light theme only, as the report
 * design guide does (src/api/reportDesign.ts). pictureLook.test.ts checks each value against tokens.css.
 */
export const LIGHT_LOOK = {
  panel: '#FFFFFF',
  ink: '#1D1D1F',
  /** --avatar-glow of the light theme, as a share. */
  glow: 0.35,
  hues: {
    blue: { fg: '#1A56DB', bg: '#E8F0FE' },
    orange: { fg: '#C2410C', bg: '#FDF2E9' },
    green: { fg: '#047857', bg: '#E7F6EE' },
    purple: { fg: '#7E22CE', bg: '#F3E8FF' },
    pink: { fg: '#BE185D', bg: '#FCE7F3' },
    teal: { fg: '#0F766E', bg: '#E0F5F5' },
    amber: { fg: '#A16207', bg: '#FEF6E1' },
    indigo: { fg: '#4338CA', bg: '#EAEBFF' },
  } satisfies Record<Hue, { fg: string; bg: string }>,
} as const;

/** The side of the project tile in the screens (ProjectTile), in pixels. */
const TILE = 34;

const round = (value: number) => Math.round(value * 1000) / 1000;

/** The strength of one light in the light theme, from 0 to 1. */
const alphaOf = (light: GlowLight) => round(LIGHT_LOOK.glow * light.share);

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * The glow of a person as a CSS background in the light theme. The screens show it in a circle: under the profile picture, so its
 * see-through parts show the glow, or under the initials in ink.
 */
export function personGlowCss(id: string): string {
  return glowCss(personLights(id), (light) => rgba(LIGHT_LOOK.hues[light.hue].fg, alphaOf(light)), LIGHT_LOOK.panel);
}

/** The project color (redesign spec 2.3): its hue name, which names the tokens --p-<name>-fg and --p-<name>-bg, and their light values. */
export function projectColorLook(id: string): { name: Hue; fg: string; bg: string } {
  const name = projectHue(id);
  return { name, ...LIGHT_LOOK.hues[name] };
}

/**
 * The project tile (ProjectTile) as one SVG drawing of 34 px: the panel, the two lights, the ring and the form. The ids inside it
 * hold the project id, so many tiles can sit in one page. The sub-company badge is not in it: the screens put it on the tile.
 * A project with its own shape (owner, 2026-10-26) gets that path in the place of the form: scaled from the box of 18 to the form box, with
 * no turn. The shape goes into the text only when it passes the pattern of the contract, so a stored string that breaks it never gets here.
 */
export function tileSvg(project: { id: string; mark?: number; shape?: string | null }): string {
  const mark = markOf(project);
  const { form } = decodeMark(mark);
  const key = `t-${project.id.replace(/[^\w-]/g, '')}`;
  const [first, second] = markLights(project.id, mark);
  const gradient = (light: GlowLight, id: string) => {
    const { fg } = LIGHT_LOOK.hues[light.hue];
    return `<radialGradient id="${id}" cx="${light.x / 100}" cy="${light.y / 100}" r="${light.size / 100}">`
      + `<stop offset="0" stop-color="${fg}" stop-opacity="${alphaOf(light)}"/><stop offset="1" stop-color="${fg}" stop-opacity="0"/></radialGradient>`;
  };
  // Rounded by 30% of the side, as rounded-[30%]. The ring is 1 px inside the edge, ink at 10%, at any size of the drawing.
  // The form is 45% of the side, in the middle.
  const radius = round(TILE * 0.3);
  const box = (fill: string) => `<rect width="${TILE}" height="${TILE}" rx="${radius}" fill="${fill}"/>`;
  const side = round(TILE * 0.45);
  const start = round((TILE - side) / 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${TILE} ${TILE}" width="${TILE}" height="${TILE}">`
    + `<defs>${gradient(first, `${key}-a`)}${gradient(second, `${key}-b`)}</defs>`
    // CSS paints its first light on top, so the drawing paints it last.
    + `${box(LIGHT_LOOK.panel)}${box(`url(#${key}-b)`)}${box(`url(#${key}-a)`)}`
    + `<rect x="0.5" y="0.5" width="${TILE - 1}" height="${TILE - 1}" rx="${round(radius - 0.5)}" fill="none" stroke="${LIGHT_LOOK.ink}" stroke-opacity="0.1" vector-effect="non-scaling-stroke"/>`
    + (project.shape && isProjectShape(project.shape)
      ? `<path d="${project.shape}" transform="translate(${start} ${start}) scale(${round(side / 18)})" fill="${LIGHT_LOOK.ink}" fill-opacity="0.86"/>`
      : `<path d="${formPath(form, start, start, side)}" transform="rotate(${form.turn * 90} ${TILE / 2} ${TILE / 2})" fill="${LIGHT_LOOK.ink}" fill-opacity="0.86"/>`)
    + '</svg>';
}
