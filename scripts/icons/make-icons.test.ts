import { existsSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { MADAR_DOORS } from '../../src/components/MadarMark';
import { ICONS, iconDigests, iconPage, manifestOf, MASKABLE_FORM, MASKABLE_SAFE_ZONE, tokenValues } from './make-icons';

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

/** Every pixel of an 8-bit RGB or RGBA PNG (color type 2 or 6, no interlace), with the five row filters undone. RGB gives alpha 255. */
function rgba(file: string): { width: number; height: number; at: (x: number, y: number) => [number, number, number, number] } {
  const data = readFileSync(file);
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  expect([data[24], data[28]], 'an 8-bit PNG with no interlace').toEqual([8, 0]);
  expect([2, 6], 'RGB or RGBA').toContain(data[25]);
  const bpp = data[25] === 6 ? 4 : 3;
  const idat: Buffer[] = [];
  for (let at = 8; at < data.length; ) {
    const length = data.readUInt32BE(at);
    if (data.toString('latin1', at + 4, at + 8) === 'IDAT') idat.push(data.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i += 1) {
      const x = raw[y * (stride + 1) + 1 + i];
      const a = i >= bpp ? out[y * stride + i - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + i] : 0;
      const c = i >= bpp && y > 0 ? out[(y - 1) * stride + i - bpp] : 0;
      const p = a + b - c;
      const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      const add = [0, a, b, (a + b) >> 1, paeth][filter];
      expect(add, `filter ${filter}`).not.toBeUndefined();
      out[y * stride + i] = (x + add) & 255;
    }
  }
  const at = (x: number, y: number) => {
    const px = [...out.subarray(y * stride + x * bpp, y * stride + (x + 1) * bpp)];
    return (bpp === 4 ? px : [...px, 255]) as [number, number, number, number];
  };
  return { width, height, at };
}

describe('the app icons', () => {
  it('are the 180 px apple-touch-icon, the 192 and 512 px icons of the manifest, and the 512 px maskable icon for Android', () => {
    expect(ICONS).toEqual([
      { file: 'icons/apple-touch-icon.png', size: 180, shape: 'square' },
      { file: 'icons/madar-192.png', size: 192, shape: 'tile' },
      { file: 'icons/madar-512.png', size: 512, shape: 'tile' },
      { file: 'icons/madar-maskable-512.png', size: 512, shape: 'maskable' },
    ]);
  });

  it('make the maskable icon full bleed: the glow reaches every edge, with no corner, no ring and no see-through pixel', () => {
    const page = iconPage(512, 'maskable', tokens);
    expect(page).toMatch(/border-radius:0\s*!important/);
    expect(page).toMatch(/box-shadow:none\s*!important/);
    const icon = rgba('public/icons/madar-maskable-512.png');
    for (const [x, y] of [[0, 0], [511, 0], [0, 511], [511, 511], [256, 0], [0, 256]]) expect(icon.at(x, y)[3], `alpha at ${x},${y}`).toBe(255);
  });

  it('keep the form of the maskable icon inside the central 80% safe zone, at the share of the tile icon (45% of that zone)', () => {
    expect(MASKABLE_SAFE_ZONE).toBe(0.8);
    expect(MASKABLE_FORM).toBeCloseTo(0.45 * MASKABLE_SAFE_ZONE, 5);
    expect(iconPage(512, 'maskable', tokens)).toContain(`width:${MASKABLE_FORM * 100}% !important`);
    // The ink of the doors is the only dark part of the icon; the glow and the panel are light.
    const icon = rgba('public/icons/madar-maskable-512.png');
    let far = 0;
    let ink = 0;
    for (let y = 0; y < icon.height; y += 1) {
      for (let x = 0; x < icon.width; x += 1) {
        const [r, g, b] = icon.at(x, y);
        if (0.2126 * r + 0.7152 * g + 0.0722 * b > 128) continue;
        ink += 1;
        far = Math.max(far, Math.hypot(x + 0.5 - icon.width / 2, y + 0.5 - icon.height / 2));
      }
    }
    expect(ink).toBeGreaterThan(1000);
    // The safe zone is a circle of 40% of the size around the center; the farthest door corner sits at about 25%.
    expect(far).toBeLessThanOrEqual((MASKABLE_SAFE_ZONE / 2) * icon.width);
    expect(far).toBeGreaterThan(0.2 * icon.width);
  });

  it('exist in public/ at their size; the apple-touch-icon fills the square (iOS rounds it), the others keep the 30% corners', () => {
    for (const icon of ICONS) {
      const path = `public/${icon.file}`;
      expect(existsSync(path), path).toBe(true);
      const info = png(path);
      expect({ file: icon.file, width: info.width, height: info.height }).toEqual({ file: icon.file, width: icon.size, height: icon.size });
      expect(info.cornerAlpha, icon.file).toBe(icon.shape === 'tile' ? 0 : 255);
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
  it('names Madar, opens standalone, takes its colors from the tokens and lists the two "any" icons and the maskable one', () => {
    const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
    expect(manifest).toEqual(manifestOf(tokens));
    expect(manifest).toMatchObject({ name: 'Madar', short_name: 'Madar', display: 'standalone', theme_color: tokens['--c-bg'], background_color: tokens['--c-bg'] });
    expect(manifest.icons).toEqual([
      { src: 'icons/madar-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'icons/madar-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: 'icons/madar-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ]);
  });

  it('is linked from index.html with the apple-touch-icon, and the tab icon stays', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(html).toContain('<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />');
    expect(html).toMatch(/<link rel="icon" type="image\/svg\+xml" href="data:image\/svg\+xml,/);
  });
});
