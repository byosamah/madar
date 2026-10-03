import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkBundles } from './check-bundles.ts';

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
    expect(result.lines.join('\n')).toContain('buildSeed');
    expect(result.lines.join('\n')).toMatch(/2 files/);
  });

  it('fails a remote index.html with a relative ./assets/ path', () => {
    const result = checkBundles('remote', dist({ 'index.html': prototypeIndex, 'assets/index-abc.js': '' }));
    expect(result.ok).toBe(false);
    expect(result.lines.join('\n')).toContain('./assets/');
  });

  it('fails a remote build that carries the sample office', () => {
    const result = checkBundles('remote', dist({ 'index.html': remoteIndex, 'assets/seed.js': 'function buildSeed(){}' }));
    expect(result.ok).toBe(false);
    expect(result.lines.join('\n')).toContain('assets/seed.js');
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

  it('fails when the folder does not exist, so a missing build never passes', () => {
    const result = checkBundles('prototype', join(tmpdir(), 'madar-no-such-dist'));
    expect(result.ok).toBe(false);
  });
});
