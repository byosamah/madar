import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { MadarMark } from '../../src/components/MadarMark';

/**
 * The app icons and the web manifest of Madar (TASKS.md, Logo, point 3), made from the MadarMark component, never by hand:
 *   npm run icons   (the same as: npx tsx scripts/icons/make-icons.tsx)
 * It renders the tile in the light tokens of src/design/tokens.css, takes a Playwright screenshot of each size, and writes the PNGs
 * and public/manifest.webmanifest, and scripts/icons/icons.sha256 (the digest of the page of each PNG, outside public/). Run it
 * again after a change of the mark or of the tokens: make-icons.test.ts compares icons.sha256 with the current pages.
 * - apple-touch-icon (180 px) fills the square: iOS rounds the corners itself, and a see-through corner turns black there.
 * - 192 and 512 px keep the 30% corners of the tile, with see-through corners (manifest purpose "any"; the mail header uses 192).
 * - The maskable 512 px icon (manifest purpose "maskable", for Android) is full bleed: the glow fills the square to every edge, and
 *   Android cuts it to its own circle or squircle. The form sits inside the central safe zone (a circle of 80% of the size) at
 *   45% of that zone, the share it has in the tile, so a launcher that keeps only the safe zone shows the tile's proportions.
 */

export type IconShape = 'square' | 'tile' | 'maskable';
export const ICONS: { file: string; size: number; shape: IconShape }[] = [
  { file: 'icons/apple-touch-icon.png', size: 180, shape: 'square' },
  { file: 'icons/madar-192.png', size: 192, shape: 'tile' },
  { file: 'icons/madar-512.png', size: 512, shape: 'tile' },
  { file: 'icons/madar-maskable-512.png', size: 512, shape: 'maskable' },
];

/** The safe zone of a maskable icon: a circle of this share of the size, around the center (W3C manifest, "maskable"). */
export const MASKABLE_SAFE_ZONE = 0.8;
/** The size of the form in the maskable icon: 45% (its share in the tile) of the safe zone. */
export const MASKABLE_FORM = 0.36;

/** The custom properties of the light :root block of tokens.css. */
export function tokenValues(css: string): Record<string, string> {
  const start = css.indexOf(':root {');
  const body = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const NEEDED = ['--glow-a', '--glow-b', '--glow-c', '--c-panel', '--c-ink'];

/**
 * One page that holds only the mark at the icon size. The square and the maskable shapes drop the corners and the ring with an
 * !important rule; the maskable shape also draws the form smaller (MASKABLE_FORM).
 */
export function iconPage(size: number, shape: IconShape, tokens: Record<string, string>): string {
  for (const name of NEEDED) if (!tokens[name]) throw new Error(`tokens.css has no ${name} in :root.`);
  const vars = NEEDED.map((name) => `${name}:${tokens[name]}`).join(';');
  const form = `${MASKABLE_FORM * 100}% !important`;
  const square = shape === 'tile' ? '' : '[data-madar-mark]{border-radius:0 !important;box-shadow:none !important}';
  const smaller = shape === 'maskable' ? `[data-madar-mark] svg{width:${form};height:${form}}` : '';
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<style>:root{${vars}}html,body{margin:0;background:transparent}${square}${smaller}</style>`,
    `</head><body>${renderToStaticMarkup(<MadarMark size={size} />)}</body></html>`,
  ].join('');
}

/** One line per icon, "<sha256 of its page>  <file>", as sha256sum writes it. Any change of the tile changes a line. */
export function iconDigests(tokens: Record<string, string>): string {
  return ICONS.map((icon) => `${createHash('sha256').update(iconPage(icon.size, icon.shape, tokens)).digest('hex')}  ${icon.file}\n`).join('');
}

/** The web manifest. Its links are relative to its own address, so the prototype and the remote build both find the icons. */
export function manifestOf(tokens: Record<string, string>) {
  return {
    name: 'Madar',
    short_name: 'Madar',
    start_url: './',
    scope: './',
    display: 'standalone',
    theme_color: tokens['--c-bg'],
    background_color: tokens['--c-bg'],
    icons: ICONS.filter((icon) => icon.shape !== 'square').map((icon) => ({
      src: icon.file, sizes: `${icon.size}x${icon.size}`, type: 'image/png', purpose: icon.shape === 'maskable' ? 'maskable' : 'any',
    })),
  };
}

async function main(): Promise<void> {
  const { chromium } = await import('@playwright/test');
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const tokens = tokenValues(readFileSync(join(root, 'src/design/tokens.css'), 'utf8'));
  const browser = await chromium.launch();
  try {
    for (const icon of ICONS) {
      const page = await browser.newPage({ viewport: { width: icon.size, height: icon.size }, deviceScaleFactor: 1 });
      await page.setContent(iconPage(icon.size, icon.shape, tokens));
      const out = join(root, 'public', icon.file);
      mkdirSync(dirname(out), { recursive: true });
      await page.locator('[data-madar-mark]').screenshot({ path: out, omitBackground: true });
      await page.close();
      console.log(`wrote public/${icon.file} (${icon.size} px, ${icon.shape})`);
    }
  } finally {
    await browser.close();
  }
  writeFileSync(join(root, 'public/manifest.webmanifest'), `${JSON.stringify(manifestOf(tokens), null, 2)}\n`);
  console.log('wrote public/manifest.webmanifest');
  writeFileSync(join(root, 'scripts/icons/icons.sha256'), iconDigests(tokens));
  console.log('wrote scripts/icons/icons.sha256');
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
