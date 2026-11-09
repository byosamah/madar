import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ArgumentError } from './import';
import {
  ADMIN_SQL, companyRow, DIRECTORY_SQL, directoryOf, readDirectory, registerArguments, registerCompany, REGISTER_MAX_EMAILS,
} from './register-company';
import type { PgQuery } from './source';

const PEOPLE = [
  { id: 'usr_001', email: 'Hala@vado.test', name: 'Hala', role: 'admin', active: true },
  { id: 'usr_002', email: 'omar@vado.test', name: 'Omar', role: 'member', active: true },
  { id: 'usr_003', email: 'off@vado.test', name: 'Off', role: 'member', active: false },
];
const LINKED = [{ email: 'HALA@vado.test' }, { email: 'sara@vado.test' }];

function fakeQuery(o: { people?: Record<string, unknown>[]; linked?: Record<string, unknown>[]; admin?: Record<string, unknown>[] } = {}) {
  const texts: string[] = [];
  const query: PgQuery = async (text) => {
    texts.push(text);
    if (text === DIRECTORY_SQL.people) return o.people ?? PEOPLE;
    if (text === DIRECTORY_SQL.linked) return o.linked ?? LINKED;
    if (text === ADMIN_SQL) return o.admin ?? [{ name: 'Hala', email: 'hala@vado.test' }];
    return [];
  };
  return { query, texts };
}

describe('the company row and the directory of VADO (scripts/office/register-company.ts)', () => {
  it('gives the row ent_001: address vados, the two names, state active, no limit', () => {
    const row = companyRow({ name: 'Hala', email: 'hala@vado.test' }, new Date('2026-11-10T10:00:00Z'));
    expect(row).toEqual({
      id: 'ent_001', address: 'vados', name: "VADOs' Companies", nameAr: 'شركات فادو', state: 'active', limits: { people: null, storageBytes: null },
      createdAt: '2026-11-10T10:00:00.000Z', firstAdmin: { name: 'Hala', email: 'hala@vado.test' },
    });
  });

  it('reads the emails of the people who can sign in, lower case and once, and the first active Admin, inside one read-only snapshot', async () => {
    const { query, texts } = fakeQuery();
    const found = await readDirectory(query);
    expect(found.emails).toEqual(['hala@vado.test', 'omar@vado.test', 'off@vado.test', 'sara@vado.test']);
    expect(found.admin).toEqual({ name: 'Hala', email: 'hala@vado.test' });
    expect(texts[0]).toBe('begin read only');
    expect(texts.at(-1)).toBe('commit');
  });

  it('reads only humans who are not removed, from users and from the sign-in users that link to them, and only reads', () => {
    for (const text of [DIRECTORY_SQL.people, DIRECTORY_SQL.linked, ADMIN_SQL]) {
      expect(text).toContain("u.kind = 'human'");
      expect(text).toContain("'removed'");
      expect(text).not.toMatch(/\b(insert|update|delete|truncate|alter|drop|create|grant)\b/i);
      expect(text).not.toMatch(/password|encrypted/i);
    }
    expect(DIRECTORY_SQL.linked).toContain('a.deleted_at is null');
    expect(ADMIN_SQL).toContain("'admin'");
  });

  it('refuses an office with no people, an office with no active Admin, and more emails than one register holds, and rolls back a failed read', async () => {
    await expect(readDirectory(fakeQuery({ people: [], linked: [] }).query)).rejects.toThrow('no people');
    await expect(readDirectory(fakeQuery({ admin: [] }).query)).rejects.toThrow('no active Admin');
    // A failed read ends the snapshot with a rollback.
    const texts: string[] = [];
    await expect(readDirectory(async (text) => { texts.push(text); if (text === DIRECTORY_SQL.linked) throw new Error('the read failed'); return []; })).rejects.toThrow('the read failed');
    expect(texts.at(-1)).toBe('rollback');
    const many = Array.from({ length: REGISTER_MAX_EMAILS + 1 }, (_, i) => ({ id: `usr_${i}`, email: `p${i}@vado.test`, name: 'P', role: 'member', active: true }));
    await expect(readDirectory(fakeQuery({ people: many, linked: [] }).query)).rejects.toThrow(String(REGISTER_MAX_EMAILS));
    expect(directoryOf([], [])).toEqual([]);
  });
});

describe('the register op call of the script', () => {
  const call = async (o: { status?: number; body?: string } = {}) => {
    const seen: { url: string; header: string | null; body: { row: { id: string }; emails: string[]; keepExisting?: boolean } }[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      seen.push({ url, header: new Headers(init?.headers).get('x-madar-ops-secret'), body: JSON.parse(String(init?.body)) });
      return new Response(o.body ?? '{"ok":true}', { status: o.status ?? 200 });
    }) as unknown as typeof fetch;
    const lines: string[] = [];
    const run = () => registerCompany({ base: 'https://madar.vado.sa', secret: 'the-ops-secret', query: fakeQuery().query, now: new Date('2026-11-10T10:00:00Z'), send: fetcher, log: (line) => lines.push(line) });
    return { seen, lines, run };
  };

  it('posts one platform-register with keepExisting, the ops secret in the header only, and prints counts and names but never an email or the secret', async () => {
    const { seen, lines, run } = await call();
    await run();
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe('https://madar.vado.sa/api/office/platform-register');
    expect(seen[0].header).toBe('the-ops-secret');
    expect(seen[0].body).toMatchObject({ row: { id: 'ent_001', address: 'vados', state: 'active' }, keepExisting: true });
    expect(seen[0].body.emails).toHaveLength(4);
    const text = lines.join('\n');
    expect(text).toContain('ent_001');
    expect(text).toContain('4 emails');
    expect(text).not.toMatch(/@/);
    expect(text).not.toContain('the-ops-secret');
  });

  it('is safe to run twice: the second run sends the same body (the Worker keeps the row that is there)', async () => {
    const { seen, run } = await call();
    await run();
    await run();
    expect(seen[1].body).toEqual(seen[0].body);
  });

  it('names a refusal of the Worker without the secret and without an email', async () => {
    const { run } = await call({ status: 409, body: '{"error":{"message":"Another company holds hala@vado.test"}}' });
    const error = await run().then(() => undefined, (e: unknown) => e as Error);
    expect(error?.message).toContain('platform-register answered 409');
    expect(error?.message).not.toContain('the-ops-secret');
  });
});

describe('the arguments of the script', () => {
  it('needs --to, takes production with the typed word, and accepts test or local with none', () => {
    expect(registerArguments(['--to', 'https://madar.vado.sa'])).toMatchObject({ target: { copy: 'production', base: 'https://madar.vado.sa' }, typed: true });
    expect(registerArguments(['--to', 'http://127.0.0.1:8792'])).toMatchObject({ target: { copy: 'local' }, typed: false });
    for (const bad of [[], ['--to'], ['--to', 'https://example.com'], ['--to', 'nonsense']]) expect(() => registerArguments(bad), bad.join(' ')).toThrow(ArgumentError);
  });

  it('exits with code 2 for a refused argument, and with code 1 and nothing on stdout for a wrong typed word', () => {
    const script = fileURLToPath(new URL('./register-company.ts', import.meta.url));
    const run = (args: string[], input = '') => spawnSync(process.execPath, ['--import', 'tsx', script, ...args], { encoding: 'utf8', input, timeout: 60_000 });
    const refused = run(['--to', 'https://example.com']);
    expect([refused.status, refused.stderr]).toEqual([2, expect.stringContaining('not a Madar copy')]);
    const wrongWord = run(['--to', 'https://madar.vado.sa'], 'yes\n');
    expect([wrongWord.status, wrongWord.stdout, wrongWord.stderr]).toEqual([1, '', expect.stringContaining('The typed word was not production. Nothing changed.')]);
  });
});
