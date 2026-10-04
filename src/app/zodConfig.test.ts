import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import './zodConfig';

describe('zod in the browser', () => {
  // zod tests for eval once with new Function. The deployed page has script-src 'self', so every page load reported a
  // Content-Security-Policy violation, although zod caught the error (deploy suite on the test copy, 2026-10-04).
  it('runs jitless, so it never tests for eval under the strict Content-Security-Policy', () => {
    expect(z.config().jitless).toBe(true);
  });

  it('is set by the first import of main.tsx, before any other module can parse', () => {
    const main = readFileSync('src/main.tsx', 'utf8');
    expect(main.split('\n').find((line) => line.startsWith('import '))).toBe("import './app/zodConfig';");
  });
});
