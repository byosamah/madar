import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { INTER_SOURCE, LICENCE_FILE, SUBSET_FILE, subsetArgs } from './subset-inter.ts';

// Vitest runs from the repository root.
const SUBSET_SHA256 = '05f8c1cea3b79d63437b26c3386b8c477ac8c1d799b8f05967d70d509033fcea';

/** The table tags that a WOFF2 file names by number (the WOFF2 specification, section 5.1). */
const KNOWN_TAGS = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'];

/** The tables of a WOFF2 font. The cmap, fvar and GSUB tables are never transformed, so their bytes are the plain tables. */
function woff2Tables(file: Buffer): Map<string, Buffer> {
  expect(file.toString('latin1', 0, 4)).toBe('wOF2');
  const count = file.readUInt16BE(12);
  const compressed = file.readUInt32BE(20);
  let at = 48;
  const base128 = () => {
    let value = 0;
    for (let i = 0; i < 5; i += 1) {
      const byte = file[at++];
      value = value * 128 + (byte & 0x7f);
      if ((byte & 0x80) === 0) return value;
    }
    throw new Error('A WOFF2 number is too long.');
  };
  const entries: { tag: string; length: number }[] = [];
  for (let i = 0; i < count; i += 1) {
    const flags = file[at++];
    const tag = (flags & 0x3f) === 63 ? file.toString('latin1', at, (at += 4)) : KNOWN_TAGS[flags & 0x3f];
    const version = flags >> 6;
    const length = base128();
    const transformed = tag === 'glyf' || tag === 'loca' ? version !== 3 : version !== 0;
    entries.push({ tag, length: transformed ? base128() : length });
  }
  const data = brotliDecompressSync(file.subarray(at, at + compressed));
  const tables = new Map<string, Buffer>();
  let offset = 0;
  for (const entry of entries) {
    tables.set(entry.tag, data.subarray(offset, offset + entry.length));
    offset += entry.length;
  }
  return tables;
}

/** The characters that a cmap table maps to a glyph (subtables of format 4). */
function mappedCharacters(cmap: Buffer): number[] {
  const codes = new Set<number>();
  for (let i = 0; i < cmap.readUInt16BE(2); i += 1) {
    const sub = cmap.readUInt32BE(4 + i * 8 + 4);
    expect(cmap.readUInt16BE(sub)).toBe(4);
    const segments = cmap.readUInt16BE(sub + 6) / 2;
    const ends = sub + 14;
    const starts = ends + segments * 2 + 2;
    const deltas = starts + segments * 2;
    const ranges = deltas + segments * 2;
    for (let s = 0; s < segments; s += 1) {
      const [end, start, delta, range] = [cmap.readUInt16BE(ends + s * 2), cmap.readUInt16BE(starts + s * 2), cmap.readInt16BE(deltas + s * 2), cmap.readUInt16BE(ranges + s * 2)];
      for (let code = start; code <= end && code !== 0xffff; code += 1) {
        const glyph = range === 0 ? (code + delta) & 0xffff : cmap.readUInt16BE(ranges + s * 2 + range + (code - start) * 2);
        if (glyph !== 0) codes.add(code);
      }
    }
  }
  return [...codes].sort((a, b) => a - b);
}

const tagsAt = (table: Buffer, list: number, size: number, count: number) => Array.from({ length: count }, (_, i) => table.toString('latin1', list + i * size, list + i * size + 4));

describe('the Inter subset of the digits and the middle dot (performance audit BND-M2)', () => {
  it('runs pyftsubset on the pinned Inter file, with every layout feature and every name record', () => {
    expect(INTER_SOURCE).toBe('node_modules/@fontsource-variable/inter/files/inter-latin-opsz-normal.woff2');
    expect(SUBSET_FILE).toBe('src/design/inter/inter-digits-dot.woff2');
    expect(subsetArgs(INTER_SOURCE, SUBSET_FILE)).toEqual([
      INTER_SOURCE,
      '--unicodes=U+0030-0039,U+00B7',
      '--layout-features=*',
      '--name-IDs=*',
      '--flavor=woff2',
      `--output-file=${SUBSET_FILE}`,
    ]);
  });

  it('keeps the subset file byte for byte as the script made it with fontTools 4.63', () => {
    expect(createHash('sha256').update(readFileSync(SUBSET_FILE)).digest('hex')).toBe(SUBSET_SHA256);
  });

  it('holds only the digits 0 to 9 and the middle dot, with the wght and opsz axes and the tabular figures', () => {
    const subset = woff2Tables(readFileSync(SUBSET_FILE));
    expect(mappedCharacters(subset.get('cmap')!)).toEqual([0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0xb7]);
    const fvar = subset.get('fvar')!;
    expect(tagsAt(fvar, fvar.readUInt16BE(4), fvar.readUInt16BE(10), fvar.readUInt16BE(8)).sort()).toEqual(['opsz', 'wght']);
    const gsub = subset.get('GSUB')!;
    const features = gsub.readUInt16BE(6);
    expect(tagsAt(gsub, features + 2, 6, gsub.readUInt16BE(features))).toContain('tnum');
    // The source file holds far more, so the reader reads real tables.
    expect(mappedCharacters(woff2Tables(readFileSync(INTER_SOURCE)).get('cmap')!).length).toBeGreaterThan(200);
  });

  it('keeps the OFL licence of Inter next to the subset', () => {
    expect(LICENCE_FILE).toBe('src/design/inter/OFL.txt');
    expect(readFileSync(LICENCE_FILE, 'utf8')).toBe(readFileSync('node_modules/@fontsource-variable/inter/LICENSE', 'utf8'));
    expect(readFileSync(LICENCE_FILE, 'utf8')).toContain('SIL Open Font License, Version 1.1');
  });

  it('is the file of the Madar Dot and Madar Digits faces, with the ranges, weights and swap of before', () => {
    const css = readFileSync('src/design/tokens.css', 'utf8');
    const faces = [...css.matchAll(/@font-face \{[^}]*\}/g)].map((m) => m[0]);
    for (const [family, range] of [['Madar Dot', 'U+00B7'], ['Madar Digits', 'U+0030-0039']]) {
      const face = faces.find((f) => f.includes(`font-family: "${family}";`));
      expect(face, family).toContain('src: url("./inter/inter-digits-dot.woff2") format("woff2-variations");');
      expect(face).toContain('font-weight: 100 900;');
      expect(face).toContain('font-display: swap;');
      expect(face).toContain(`unicode-range: ${range};`);
    }
  });
});
