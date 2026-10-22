import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The prototype dev server (plain `npx vite`) showed an empty page with "Cannot access 'lazy' before initialization" (2026-10-22).
 * In dev, `vite.config.ts` points `./screenLoaders` at `screenLoaders.static.ts`, which imports every screen. lazyOverlay.tsx took
 * `reloadOnFailedImport` from screens.ts, so its imports reached the screens, a screen reached Menu.tsx, and Menu.tsx called
 * `lazyOverlay` while lazyOverlay.tsx still waited for its own imports. Vite's dev copy of React is CommonJS, so `lazy` was a const
 * of lazyOverlay.tsx that was not set yet. A build packs the files in another order, so only dev broke.
 */

const STATIC_FROM = /^(?:import|export)\s+(?!type\s)[^;]*?from\s+'(\.[^']+)'/gm;
const DEV_ALIAS: Record<string, string> = { 'src/app/screenLoaders': 'src/app/screenLoaders.static' };

/** The file of a relative import, with the alias of the dev server. */
function fileOf(from: string, spec: string): string | null {
  const base = normalize(join(dirname(from), spec));
  const target = DEV_ALIAS[base] ?? base;
  for (const ending of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
    if (/\.tsx?$/.test(target + ending) && existsSync(target + ending)) return target + ending;
  }
  return null;
}

/** Every file that the static imports of `start` reach, `start` itself only when an import comes back to it. */
function reached(start: string): Set<string> {
  const seen = new Set<string>();
  const queue = [start];
  while (queue.length > 0) {
    const file = queue.pop()!;
    for (const match of readFileSync(file, 'utf8').matchAll(STATIC_FROM)) {
      const next = fileOf(file, match[1]);
      if (next && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

describe('the import loop of the prototype dev server', () => {
  it('the walk follows the dev alias to the screens', () => {
    expect(reached('src/app/screens.ts')).toContain('src/components/Menu.tsx');
  });

  it('lazyOverlay.tsx reaches no file that imports it back', () => {
    expect(reached('src/app/lazyOverlay.tsx')).not.toContain('src/app/lazyOverlay.tsx');
  });
});
