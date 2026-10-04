import { describe, expect, it } from 'vitest';
import { DB_MODE_SKIP, skipReason } from './db-mode.skip';

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
});
