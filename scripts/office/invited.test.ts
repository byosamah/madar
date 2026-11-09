import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PASSWORD_SET_MARK } from '../../src/api/contract/server';
import { INVITE_LINKS_SQL } from '../../server/calls/people';
import { formatInvited, INVITED_SQL, invitedArguments, invitedPeople } from './invited';
import { ArgumentError } from './import';
import type { PgQuery } from './source';

/** One row of the read, as pg gives it: the people of the office with the state of their sign-in. */
const row = (id: string, email: string, accepted: boolean, more: Record<string, unknown> = {}) => ({ id, email, name: `Person ${id}`, active: true, removed: false, accepted, ...more });

describe('the list of open invitations (scripts/office/invited.ts)', () => {
  it('lists only the people in state Invited, with their ids and emails', async () => {
    const texts: string[] = [];
    const query: PgQuery = async (text) => {
      texts.push(text);
      return text === INVITED_SQL ? [row('usr_001', 'a@vado.test', true), row('usr_002', 'b@vado.test', false), row('usr_003', 'c@vado.test', true)] : [];
    };
    const people = await invitedPeople(query);
    expect(people).toEqual([{ id: 'usr_002', email: 'b@vado.test', name: 'Person usr_002', active: true, removed: false }]);
    // One read-only snapshot, closed again.
    expect(texts[0]).toBe('begin read only');
    expect(texts.at(-1)).toBe('commit');
  });

  it('says Invited as users.invites does: a person with no sign-in link, an unconfirmed email, or no saved password is Invited', () => {
    // The same mark and the same tables as users.invites and the sign-in export: the SQL names them.
    expect(INVITED_SQL).toContain(`'${PASSWORD_SET_MARK}'`);
    expect(INVITED_SQL).toContain('email_confirmed_at is not null');
    expect(INVITED_SQL).toContain('a.deleted_at is null');
    expect(INVITED_SQL).toContain('u.auth_user_id');
    // users.invites reads the people with kind human only, and so does this script.
    expect(INVITE_LINKS_SQL).toContain("kind = 'human'");
    expect(INVITED_SQL).toContain("u.kind = 'human'");
  });

  it('only reads: no insert, update, delete or other write, and no secret name in the text', () => {
    expect(INVITED_SQL).not.toMatch(/\b(insert|update|delete|truncate|alter|drop|create|grant)\b/i);
    expect(INVITED_SQL).not.toMatch(/password_hash|encrypted_password/i);
  });

  it('rolls the snapshot back when the read fails', async () => {
    const texts: string[] = [];
    await expect(invitedPeople(async (text) => {
      texts.push(text);
      if (text === INVITED_SQL) throw new Error('the read failed');
      return [];
    })).rejects.toThrow('the read failed');
    expect(texts.at(-1)).toBe('rollback');
  });

  it('prints one JSON document: the count, and each person with id, email, name, active and removed. It prints nothing else', () => {
    const people = [{ id: 'usr_002', email: 'b@vado.test', name: 'Person usr_002', active: true, removed: false }];
    const out = formatInvited(people, '2026-11-10T10:00:00.000Z');
    expect(JSON.parse(out)).toEqual({ madeAt: '2026-11-10T10:00:00.000Z', count: 1, people });
    expect(out.endsWith('\n')).toBe(false);
  });

  it('takes --env production only with the typed word, test or local with none, and refuses any other value (exit code 2)', () => {
    expect(invitedArguments(['--env', 'production'])).toEqual({ env: 'production', typed: true });
    expect(invitedArguments(['--env', 'test'])).toEqual({ env: 'test', typed: false });
    expect(invitedArguments(['--env', 'local'])).toEqual({ env: 'local', typed: false });
    for (const bad of [[], ['--env'], ['--env', 'staging'], ['--env', 'Production']]) expect(() => invitedArguments(bad), bad.join(' ')).toThrow(ArgumentError);
    const script = fileURLToPath(new URL('./invited.ts', import.meta.url));
    const run = (args: string[], input = '') => spawnSync(process.execPath, ['--import', 'tsx', script, ...args], { encoding: 'utf8', input, timeout: 60_000 });
    const refused = run(['--env', 'staging']);
    expect([refused.status, refused.stderr]).toEqual([2, expect.stringContaining('--env')]);
    // The wrong typed word: exit 1, nothing read, nothing printed to stdout.
    const wrongWord = run(['--env', 'production'], 'yes\n');
    expect([wrongWord.status, wrongWord.stdout, wrongWord.stderr]).toEqual([1, '', expect.stringContaining('The typed word was not production. Nothing changed.')]);
  });
});
