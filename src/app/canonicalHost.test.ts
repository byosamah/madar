import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalUrl } from './canonicalHost';

describe('one address for the real screens (owner, 2026-10-05)', () => {
  it('sends www.<host> to <host>, with the same path, query and hash', () => {
    expect(canonicalUrl('https://www.madar.vado.sa/welcome?token_hash=abc&type=invite#x')).toBe('https://madar.vado.sa/welcome?token_hash=abc&type=invite#x');
    expect(canonicalUrl('https://www.madar.vado.sa/')).toBe('https://madar.vado.sa/');
  });

  it('keeps every other address', () => {
    expect(canonicalUrl('https://madar.vado.sa/projects')).toBeNull();
    expect(canonicalUrl('https://madar-46r.pages.dev/')).toBeNull();
    expect(canonicalUrl('http://127.0.0.1:4174/sign-in')).toBeNull();
    expect(canonicalUrl('https://preview.madar-46r.pages.dev/')).toBeNull();
  });

  it('runs in main.tsx before the start, and only in the real build', () => {
    const main = readFileSync('src/main.tsx', 'utf8');
    expect(main).toMatch(/const canonical = REMOTE \? canonicalUrl\(window\.location\.href\) : null;/);
    expect(main.indexOf('location.replace(canonical)')).toBeLessThan(main.indexOf('void main()'));
  });
});
