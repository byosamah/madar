import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as entities from './entities';
import * as limits from './limits';
import * as server from './server';

describe('the plain limits of the contract (performance audit BND-6)', () => {
  it('keep each name and value in entities.ts or server.ts, so every importer of the contract sees no change', () => {
    const names = Object.keys(limits).sort();
    expect(names).toEqual(['MAX_ATTACHMENTS', 'MAX_FILE_BYTES', 'MAX_HELPERS', 'MAX_PREREQUISITES', 'MAX_SHOT_BYTES', 'PASSWORD_SET_MARK', 'PICTURE_DATA', 'REACTIONS']);
    const contract: Record<string, unknown> = { ...entities, ...server };
    for (const name of names) expect(contract[name], name).toBe((limits as Record<string, unknown>)[name]);
  });

  it('keep the values of 2026-10-07', () => {
    expect(limits.REACTIONS).toEqual(['👍', '✅', '👀']);
    expect(limits.MAX_PREREQUISITES).toBe(20);
    expect(limits.MAX_HELPERS).toBe(10);
    expect(limits.MAX_ATTACHMENTS).toBe(10);
    expect(limits.MAX_FILE_BYTES).toBe(250 * 1024 * 1024);
    expect(limits.MAX_SHOT_BYTES).toBe(10 * 1024 * 1024);
    expect(limits.PASSWORD_SET_MARK).toBe('madar_password_set');
    expect(limits.PICTURE_DATA.test('data:image/webp;base64,AAAA')).toBe(true);
    expect(limits.PICTURE_DATA.test('data:image/gif;base64,AAAA')).toBe(false);
  });

  it('keep the reaction rule of the contract: the same three reactions, and no other', () => {
    for (const reaction of limits.REACTIONS) expect(entities.Reaction.parse(reaction)).toBe(reaction);
    expect(entities.Reaction.safeParse('🎉').success).toBe(false);
    expect(entities.Reaction.options).toEqual([...limits.REACTIONS]);
  });

  it('import no zod, so a screen that needs only a limit loads no schema', () => {
    const text = readFileSync('src/api/contract/limits.ts', 'utf8');
    expect(text).not.toMatch(/from ['"]zod/);
    expect(text).not.toMatch(/^import /m);
  });
});
