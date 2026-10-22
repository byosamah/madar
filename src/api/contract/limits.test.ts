import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as entities from './entities';
import * as limits from './limits';
import * as server from './server';

describe('the plain limits of the contract (performance audit BND-6)', () => {
  it('keep each name and value in entities.ts or server.ts, so every importer of the contract sees no change', () => {
    const names = Object.keys(limits).sort();
    expect(names).toEqual(['DEFAULT_STALE_DAYS', 'GROUP_LOG_MAX', 'GROUP_MAX', 'GROUP_NAME_MAX', 'MAX_ATTACHMENTS', 'MAX_FILE_BYTES', 'MAX_HELPERS', 'MAX_PREREQUISITES', 'MAX_PROJECT_VIEWERS', 'MAX_SHOT_BYTES', 'MEETING_KINDS', 'MEETING_LIMITS', 'NOTIFY_LEVELS', 'PASSWORD_SET_MARK', 'PICTURE_DATA', 'REACTIONS']);
    const contract: Record<string, unknown> = { ...entities, ...server };
    for (const name of names) expect(contract[name], name).toBe((limits as Record<string, unknown>)[name]);
  });

  it('keep the values of 2026-10-07', () => {
    expect(limits.REACTIONS).toEqual(['👍', '✅', '👀']);
    expect(limits.MAX_PREREQUISITES).toBe(20);
    expect(limits.MAX_HELPERS).toBe(10);
    expect(limits.MAX_PROJECT_VIEWERS).toBe(50);
    expect(limits.MAX_ATTACHMENTS).toBe(10);
    expect(limits.MAX_FILE_BYTES).toBe(250 * 1024 * 1024);
    expect(limits.MAX_SHOT_BYTES).toBe(10 * 1024 * 1024);
    expect(limits.PASSWORD_SET_MARK).toBe('madar_password_set');
    expect(limits.DEFAULT_STALE_DAYS).toBe(30);
    expect(limits.PICTURE_DATA.test('data:image/webp;base64,AAAA')).toBe(true);
    expect(limits.PICTURE_DATA.test('data:image/gif;base64,AAAA')).toBe(false);
  });

  it('keep the group limits of 2026-10-18: 50 people at most, and a name of 60 letters at most', () => {
    expect(limits.GROUP_MAX).toBe(50);
    expect(limits.GROUP_NAME_MAX).toBe(60);
  });

  it('keep the reaction rule of the contract: the three quick reactions, any other one emoji, and no text', () => {
    for (const reaction of limits.REACTIONS) expect(entities.Reaction.parse(reaction)).toBe(reaction);
    expect(entities.Reaction.safeParse('🎉').success).toBe(true);
    expect(entities.Reaction.safeParse('ok').success).toBe(false);
  });

  it('keep the rule and the prototype store free of schema values, so a screen that calls can() loads no schema', () => {
    // The task panel prefetch calls can() (features/project/reads.ts), and Home shows the task panel: the first load of the
    // real build holds permissions.ts. A value import of store.ts or of the schema files there puts every zod schema into it.
    const valueImports = (file: string) =>
      readFileSync(file, 'utf8').split('\n').filter((line) => /^import (?!type )/.test(line));
    expect(valueImports('src/api/permissions.ts').filter((line) => /'\.\/(store|contract\/(entities|server|views))'/.test(line))).toEqual([]);
    expect(valueImports('src/api/store.ts').filter((line) => /'\.\/contract\/(entities|server|views)'/.test(line))).toEqual([]);
  });

  it('import no zod, so a screen that needs only a limit loads no schema', () => {
    const text = readFileSync('src/api/contract/limits.ts', 'utf8');
    expect(text).not.toMatch(/from ['"]zod/);
    expect(text).not.toMatch(/^import /m);
  });
});
