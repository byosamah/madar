import { existsSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { MADAR_DOORS } from '../../src/components/MadarMark';
import { ICONS, iconDigests, iconPage, manifestOf, tokenValues } from './make-icons';

/**
 * The app icons and the web manifest (TASKS.md, Logo, point 3): PNGs of the light glow tile, made by make-icons.tsx (never by
 * hand), and the manifest with the colors of the tokens. The checks read the committed files. icons.sha256 holds the digest of the
 * page that made each PNG, so a change of a token, of MADAR_GLOW, of MADAR_DOORS or of MadarMark without a new run of the script
 * fails here.
 */
const css = readFileSync('src/design/tokens.css', 'utf8');
const tokens = tokenValues(css);

/** Width, height and the color type of a PNG, and the alpha of its top corner pixel (the first pixel of a row is never filtered). */
function png(file: string): { width: number; height: number; colorType: number; cornerAlpha: number } {
  const data = readFileSync(file);
  expect(data.subarray(1, 4).toString('latin1')).toBe('PNG');
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  const colorType = data[25];
  const idat: Buffer[] = [];
  for (let at = 8; at < data.length; ) {
    const length = data.readUInt32BE(at);
    if (data.toString('latin1', at + 4, at + 8) === 'IDAT') idat.push(data.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const pixels = inflateSync(Buffer.concat(idat));
  return { width, height, colorType, cornerAlpha: colorType === 6 ? pixels[4] : 255 };
}

describe('the app icons', () => {
  it('are the 180 px apple-touch-icon and the 192 and 512 px icons of the manifest', () => {
    expect(ICONS).toEqual([
      { file: 'icons/apple-touch-icon.png', size: 180, shape: 'square' },
      { file: 'icons/madar-192.png', size: 192, shape: 'tile' },
      { file: 'icons/madar-512.png', size: 512, shape: 'tile' },
    ]);
  });

  it('exist in public/ at their size; the apple-touch-icon fills the square (iOS rounds it), the others keep the 30% corners', () => {
    for (const icon of ICONS) {
      const path = `public/${icon.file}`;
      expect(existsSync(path), path).toBe(true);
      const info = png(path);
      expect({ file: icon.file, width: info.width, height: info.height }).toEqual({ file: icon.file, width: icon.size, height: icon.size });
      expect(info.cornerAlpha, icon.file).toBe(icon.shape === 'square' ? 255 : 0);
    }
  });

  it('draw the MadarMark tile in the light tokens, with no font, no remote file and no Tailwind', () => {
    const page = iconPage(192, 'tile', tokens);
    expect(page).toContain(MADAR_DOORS);
    expect(page).toContain('data-madar-mark');
    for (const name of ['--glow-a', '--glow-b', '--glow-c', '--c-panel', '--c-ink']) expect(page).toContain(`${name}:${tokens[name]}`);
    expect(page).not.toMatch(/https?:\/\//);
    expect(iconPage(180, 'square', tokens)).toMatch(/border-radius:0\s*!important/);
  });

  it('read the light values of the tokens', () => {
    expect(tokens['--glow-a']).toBe('#CCE0FF');
    expect(tokens['--c-panel']).toBe('#FFFFFF');
    expect(tokens['--c-bg']).toBe('#F4F4F7');
  });
});

describe('npm run icons', () => {
  it('runs the icon script', () => {
    const scripts = (JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }).scripts;
    expect(scripts.icons).toBe('tsx scripts/icons/make-icons.tsx');
  });
});

describe('the digests of the icon pages', () => {
  it('match the committed icons.sha256, so the PNGs come from the current tokens and the current mark', () => {
    expect(readFileSync('scripts/icons/icons.sha256', 'utf8')).toBe(iconDigests(tokens));
  });

  it('change with every token the tile uses and with the shape', () => {
    const now = iconDigests(tokens);
    for (const name of ['--glow-a', '--glow-b', '--glow-c', '--c-panel', '--c-ink']) {
      expect(iconDigests({ ...tokens, [name]: '#123456' }), name).not.toBe(now);
    }
    expect(now.split('\n').filter(Boolean)).toHaveLength(ICONS.length);
    for (const icon of ICONS) expect(now).toMatch(new RegExp(`^[0-9a-f]{64}  ${icon.file}$`, 'm'));
  });
});

describe('the web manifest', () => {
  it('names Madar, opens standalone, takes its colors from the tokens and lists the two icons', () => {
    const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
    expect(manifest).toEqual(manifestOf(tokens));
    expect(manifest).toMatchObject({ name: 'Madar', short_name: 'Madar', display: 'standalone', theme_color: tokens['--c-bg'], background_color: tokens['--c-bg'] });
    expect(manifest.icons).toEqual([
      { src: 'icons/madar-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'icons/madar-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ]);
  });

  it('is linked from index.html with the apple-touch-icon, and the tab icon stays', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(html).toContain('<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />');
    expect(html).toMatch(/<link rel="icon" type="image\/svg\+xml" href="data:image\/svg\+xml,/);
  });
});
