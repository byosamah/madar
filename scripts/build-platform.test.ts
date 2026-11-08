import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { platformSteps } from './build-platform.ts';

const read = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

describe('npm run build:platform', () => {
  it('checks the direction, types the screens and the server, builds with the platform config, and checks the platform bundle', () => {
    expect(platformSteps()).toEqual([
      ['node', 'scripts/check-rtl.ts'],
      ['npx', 'tsc', '-p', 'tsconfig.json'],
      ['npx', 'tsc', '-p', 'tsconfig.server.json'],
      ['npx', 'vite', 'build', '-c', 'vite.platform.config.ts'],
      ['node', 'scripts/check-bundles.ts', 'platform'],
    ]);
  });

  it('builds platform.html into dist-platform, which the root build never writes', () => {
    const config = read('vite.platform.config.ts');
    expect(config).toContain("outDir: 'dist-platform'");
    expect(config).toContain("input: 'platform.html'");
    expect(config).toContain('publicDir: false');
    expect(read('.gitignore')).toContain('dist-platform/');
    expect(read('platform.html')).toContain('/src/platform/main.tsx');
  });
});

describe('the headers of the platform site', () => {
  const lines = read('config/headers.platform').split('\n').filter((line) => !line.trimStart().startsWith('#'));
  const csp = lines.find((line) => line.trim().startsWith('Content-Security-Policy:')) ?? '';

  it('allow the own origin only: no host in any source, and no script from elsewhere', () => {
    expect(csp).not.toBe('');
    expect(csp).not.toMatch(/https?:|wss?:/);
    for (const directive of ['default-src', 'script-src', 'connect-src']) expect(csp).toMatch(new RegExp(`${directive} 'self'(;|$)`));
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });

  it('refuse a frame, a guess of the type, a referrer and a search engine', () => {
    const text = lines.join('\n');
    for (const header of ['X-Frame-Options: DENY', 'X-Content-Type-Options: nosniff', 'Referrer-Policy: no-referrer', 'X-Robots-Tag: noindex, nofollow']) expect(text).toContain(header);
  });
});
