import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { icoOf } from './ico';

const png192 = readFileSync(new URL('../../public/icons/madar-192.png', import.meta.url));

/** public/favicon.ico: the Madar logo for the tools that ask a site for /favicon.ico (owner, 2026-10-05: the MCP icon). */
describe('icoOf', () => {
  it('wraps one PNG in an icon file: a header with one entry, then the PNG as it is', () => {
    const ico = icoOf(png192, 192);
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)]).toEqual([0, 1, 1]);
    expect([ico[6], ico[7], ico.readUInt16LE(10), ico.readUInt16LE(12)]).toEqual([192, 192, 1, 32]);
    expect([ico.readUInt32LE(14), ico.readUInt32LE(18)]).toEqual([png192.length, 22]);
    expect(ico.subarray(22).equals(png192)).toBe(true);
  });

  it('writes 0 for a size of 256, as the icon format asks', () => {
    const ico = icoOf(png192, 256);
    expect([ico[6], ico[7]]).toEqual([0, 0]);
  });

  it('refuses a file that is not a PNG, and a size the format cannot hold', () => {
    expect(() => icoOf(Buffer.from('not a png'), 192)).toThrow(/PNG/);
    expect(() => icoOf(png192, 300)).toThrow(/size/);
  });

  it('matches public/favicon.ico, so the file never drifts from the 192 px logo', () => {
    const file = readFileSync(new URL('../../public/favicon.ico', import.meta.url));
    expect(file.equals(icoOf(png192, 192))).toBe(true);
  });
});
