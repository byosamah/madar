import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkBundles, SEED_MARKERS } from './check-bundles.ts';

const dirs: string[] = [];

/** A small dist folder with the given files. */
function dist(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'madar-dist-'));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, text);
  }
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const remoteIndex = '<html><head><script type="module" src="/assets/index-abc.js"></script></head></html>';
const prototypeIndex = '<html><head><script type="module" src="./assets/index-abc.js"></script></head></html>';

describe('checkBundles', () => {
  it('passes a clean remote build and prints what it searched', () => {
    const result = checkBundles('remote', dist({ 'index.html': remoteIndex, 'assets/index-abc.js': 'console.log(1)' }));
    expect(result.ok).toBe(true);
    for (const marker of SEED_MARKERS) expect(result.lines.join('\n')).toContain(marker);
    expect(result.lines.join('\n')).toMatch(/2 files/);
  });

  it('fails a remote index.html with a relative ./assets/ path', () => {
    const result = checkBundles('remote', dist({ 'index.html': prototypeIndex, 'assets/index-abc.js': '' }));
    expect(result.ok).toBe(false);
    expect(result.lines.join('\n')).toContain('./assets/');
  });

  it('fails a remote build that carries the sample office, even after minification renames buildSeed', () => {
    // Minified: the function names are gone, but the string literals of the seed stay.
    const minified = 'const Te=[{n:"Hala Nasser",a:!0,d:"Architect",g:"female"},{n:"Faisal Al-Harbi",d:"Architect",g:"male"}];function ke(e){return Te.map(e)}';
    const result = checkBundles('remote', dist({ 'index.html': remoteIndex, 'assets/index-x1.js': minified }));
    expect(result.ok).toBe(false);
    expect(result.lines.join('\n')).toContain('assets/index-x1.js');
  });

  it('searches for text that the sample office really holds', () => {
    const seed = readFileSync(new URL('../src/data/seed.ts', import.meta.url), 'utf8');
    expect(SEED_MARKERS.length).toBeGreaterThan(0);
    for (const marker of SEED_MARKERS) expect(seed).toContain(`'${marker}'`);
  });

  it('passes a clean prototype build and prints what it searched', () => {
    const result = checkBundles('prototype', dist({ 'index.html': prototypeIndex, 'assets/index-abc.js': 'buildSeed()' }));
    expect(result.ok).toBe(true);
    expect(result.lines.join('\n')).toContain('supabase');
    expect(result.lines.join('\n')).toContain('_headers');
  });

  it('fails a prototype dist with a _headers file', () => {
    const result = checkBundles('prototype', dist({ 'index.html': prototypeIndex, _headers: '/*\n  X-Frame-Options: DENY' }));
    expect(result.ok).toBe(false);
    expect(result.lines.join('\n')).toContain('_headers');
  });

  it('fails a prototype dist that names supabase in any case', () => {
    const result = checkBundles('prototype', dist({ 'index.html': prototypeIndex, 'assets/a.js': 'new SupabaseClient()' }));
    expect(result.ok).toBe(false);
    expect(result.lines.join('\n')).toContain('assets/a.js');
  });

  // The server bundles run on the real office, so they hold no sample office and no settleFuture (cleanup 2026-10-06).
  it('passes a clean server bundle and prints what it searched', () => {
    const result = checkBundles('server', dist({ 'api.js': 'export default app;', 'mcp.js': '', 'jobs.js': '' }));
    expect(result.ok).toBe(true);
    expect(result.lines.join('\n')).toContain('settleFuture');
    for (const marker of SEED_MARKERS) expect(result.lines.join('\n')).toContain(marker);
  });

  it('fails a server bundle that holds the sample office or settleFuture', () => {
    const seed = checkBundles('server', dist({ 'api.js': 'const people = [{ name: "Hala Nasser" }];' }));
    expect(seed.ok).toBe(false);
    expect(seed.lines.join('\n')).toContain('api.js');
    const settle = checkBundles('server', dist({ 'jobs.js': 'function settleFuture(state, at) { return state; }' }));
    expect(settle.ok).toBe(false);
    expect(settle.lines.join('\n')).toContain('jobs.js');
  });

  it('fails when the folder does not exist, so a missing build never passes', () => {
    const result = checkBundles('prototype', join(tmpdir(), 'madar-no-such-dist'));
    expect(result.ok).toBe(false);
  });
});
