import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A screen test that runs the real-build map (VITE_MADAR_API 'remote') and replaces MapCanvas still starts the map loader, and the
 * real MapLibre makes a Worker, which jsdom has not. Each such file left "Worker is not defined" errors, and `npm test` ended with
 * exit code 1 while every test passed (2026-10-22). Such a file also replaces the library (`test/fakeMapLib.ts`).
 */
function testFiles(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) return testFiles(path);
    return /\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const REAL_BUILD = /stubEnv\('VITE_MADAR_API', 'remote'\)/;
const CANVAS_DOUBLE = /vi\.mock\('[^']*MapCanvas'/;
const LIBRARY_DOUBLE = /vi\.mock\('maplibre-gl'/;

describe('the map in screen tests', () => {
  const files = testFiles('src').filter((file) => {
    const text = readFileSync(file, 'utf8');
    return REAL_BUILD.test(text) && CANVAS_DOUBLE.test(text);
  });

  it('finds the tests that run the real-build map', () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  it.each(files)('%s also replaces the map library', (file) => {
    expect(readFileSync(file, 'utf8')).toMatch(LIBRARY_DOUBLE);
  });
});
