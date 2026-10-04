import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DB_MODE_SKIP, skipReason } from './db-mode.skip';

const ROOT = new URL('../../', import.meta.url);

describe('the db-mode skip list', () => {
  it('gives a reason for each line, and names a test file of src/api', () => {
    expect(DB_MODE_SKIP.length).toBeGreaterThan(0);
    for (const entry of DB_MODE_SKIP) {
      expect(entry.reason.length).toBeGreaterThan(20);
      expect(entry.file).toMatch(/^src\/api\/.+\.test\.ts$/);
    }
  });

  it('has no line twice', () => {
    const keys = DB_MODE_SKIP.map((entry) => `${entry.file}|${entry.test ?? '*'}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('skips a whole file, or one test by its full name', () => {
    expect(skipReason('/repo/src/api/handlers/system.test.ts', 'session.resetSampleData puts the sample data back')).toMatch(/resetSampleData/);
    expect(skipReason('/repo/src/api/handlers/people.test.ts', 'session calls returns the current user and the preview list')).toMatch(/persistent/);
    expect(skipReason('/repo/src/api/handlers/people.test.ts', 'session calls returns the current user')).toBeUndefined();
    expect(skipReason('/repo/src/api/handlers/people.test.ts', 'session calls switches the current user')).toBeUndefined();
    expect(skipReason('/repo/src/api/handlers/tasks.test.ts', 'anything')).toBeUndefined();
  });

  it('names only tests that exist, so a renamed test cannot leave a line that hides nothing', () => {
    for (const entry of DB_MODE_SKIP) {
      expect(existsSync(new URL(entry.file, ROOT)), entry.file).toBe(true);
      if (entry.test === undefined) continue;
      const titles = [...readFileSync(new URL(entry.file, ROOT), 'utf8').matchAll(/\bit\('((?:[^'\\]|\\.)*)'/g)].map((m) => m[1].replace(/\\'/g, "'"));
      expect(titles.some((title) => entry.test === title || entry.test!.endsWith(` ${title}`)), entry.test).toBe(true);
    }
  });

  it('skips a line that waits for the file of another track only while that file is missing', () => {
    const waiting = DB_MODE_SKIP.filter((entry) => entry.until !== undefined);
    for (const entry of waiting) expect(entry.until).toMatch(/^server\/.+\.ts$/);
    const entry = { file: 'src/api/handlers/x.test.ts', reason: 'It needs the work of another track.' };
    expect(skipReason('/repo/src/api/handlers/x.test.ts', 'a test', [{ ...entry, until: 'server/test/db.ts' }])).toBeUndefined();
    expect(skipReason('/repo/src/api/handlers/x.test.ts', 'a test', [{ ...entry, until: 'server/no/such/file.ts' }])).toMatch(/another track/);
  });
});
