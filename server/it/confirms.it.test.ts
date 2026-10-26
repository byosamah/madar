import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sqlData } from '../core/runCall';
import { CODE_TTL_MS, MAX_TRIES, codeHashOf } from '../mcp/confirms';
import { GuardStop, requireCode, tryCode, type TriedCode } from '../mcp/guard';
import { NOW, startOffice, type ItOffice } from './runCallOffice';

/**
 * The atomic try count of the email code guard on Postgres (security review fix of 2026-10-26; server/mcp/confirms.ts, server/mcp/guard.ts).
 * guard.lite.test.ts proves it on SQLite, where one writer runs at a time. Postgres runs two statements at once, so this suite proves the
 * same on the production engine [Docker]: parallel wrong codes against one confirmation leave it dead and never pass 5 tries. Each
 * parallel guess runs on an isolate of its own (its own connections) and commits its count before it compares, as tryCode does.
 */

const PERSON = 'usr_001';
const AGENT = 'usr_009';
const CALL = 'users.deactivate';
const RIGHT = '424242';

type Tries = { tries: number; used_at: string | null };

describe('the atomic try count of the email code, on the local database', () => {
  let office: ItOffice;
  /** Ten isolates, made once: each has its own connections, and a parallel guess takes one of them. */
  let isolates: ReturnType<ItOffice['isolate']>[];
  let n = 0;

  beforeAll(async () => {
    office = await startOffice('confirms');
    isolates = Array.from({ length: 10 }, () => office.isolate());
  }, 60_000);

  afterAll(async () => {
    await office?.close();
  });

  /** One live confirmation with its own input hash, so each test counts on a row of its own. */
  async function newRow(): Promise<{ id: string; inputHash: string }> {
    n += 1;
    const id = `cnf_it_${n}`;
    const inputHash = `hash-${n}`;
    await office.sql(
      'insert into agent_confirms (id, person_id, agent_id, call_name, input_hash, code_hash, expires_at, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8)',
      [id, PERSON, AGENT, CALL, inputHash, await codeHashOf(id, RIGHT), new Date(NOW.getTime() + CODE_TTL_MS).toISOString(), NOW.toISOString()],
    );
    return { id, inputHash };
  }

  const rowOf = async (id: string): Promise<Tries> => (await office.sql<Tries>('select tries, used_at from agent_confirms where id = $1', [id]))[0];

  /** One guess on an isolate of its own (slot 0 to 9): the count commits in a transaction of its own, then the code is compared. */
  const guess = (inputHash: string, code: string, slot = 0): Promise<TriedCode> =>
    tryCode(sqlData(isolates[slot]), { personId: PERSON, agentId: AGENT, call: CALL, inputHash, code, now: NOW });

  const kinds = (answers: TriedCode[]) => answers.map((answer) => answer.kind);

  it('counts 10 parallel wrong codes as 5 wrong answers and 5 dead answers, and leaves the row at 5 tries', async () => {
    const { id, inputHash } = await newRow();
    const guesses = Array.from({ length: 10 }, (_, i) => String(100_000 + i * 7919));
    expect(guesses).not.toContain(RIGHT);
    const answers = await Promise.all(guesses.map((code, slot) => guess(inputHash, code, slot)));
    expect(kinds(answers).filter((kind) => kind === 'wrong')).toHaveLength(MAX_TRIES);
    expect(kinds(answers).filter((kind) => kind === 'dead')).toHaveLength(10 - MAX_TRIES);
    expect(kinds(answers).filter((kind) => kind === 'right')).toHaveLength(0);
    expect((await rowOf(id)).tries).toBe(MAX_TRIES);
    // The row is dead: the right code fails too, and the row stays unused with 5 tries.
    expect(await guess(inputHash, RIGHT)).toEqual({ kind: 'dead' });
    expect(await rowOf(id)).toMatchObject({ tries: MAX_TRIES, used_at: null });
  }, 60_000);

  it('counts two parallel wrong codes as two tries, not one', async () => {
    const { id, inputHash } = await newRow();
    const answers = await Promise.all([guess(inputHash, '111111', 0), guess(inputHash, '222222', 1)]);
    expect(kinds(answers)).toEqual(['wrong', 'wrong']);
    expect((await rowOf(id)).tries).toBe(2);
  }, 60_000);

  it('never passes 5 tries when 9 wrong codes and the right code race: at most 5 reach the compare', async () => {
    const { id, inputHash } = await newRow();
    const codes = [...Array.from({ length: 9 }, (_, i) => String(200_000 + i * 7919)), RIGHT];
    const answers = await Promise.all(codes.map((code, slot) => guess(inputHash, code, slot)));
    const reached = answers.filter((answer) => answer.kind !== 'dead');
    expect(reached).toHaveLength(MAX_TRIES);
    expect((await rowOf(id)).tries).toBe(MAX_TRIES);
    // The right code wins only when it got one of the 5 tries. The row is then claimable once (the tries include the right one).
    const right = answers.find((answer) => answer.kind === 'right');
    if (right && right.kind === 'right') {
      const data = sqlData(isolates[0]);
      const claimed = await data.tx('write', async (t) => {
        await requireCode(t, { personId: PERSON, agentId: AGENT, agent: 'Claude', call: CALL, inputHash, act: { key: 'usersDeactivate', target: { name: 'x', nameAr: 'x' } }, tried: right, now: NOW });
        return true;
      });
      expect(claimed).toBe(true);
      expect((await rowOf(id)).used_at).not.toBeNull();
    } else {
      expect(await rowOf(id)).toMatchObject({ tries: MAX_TRIES, used_at: null });
    }
  }, 60_000);

  it('lets the right code win as the fifth try on Postgres, and the claim works with 5 tries in the row', async () => {
    const { id, inputHash } = await newRow();
    for (let i = 0; i < MAX_TRIES - 1; i += 1) expect(await guess(inputHash, `30000${i}`)).toEqual({ kind: 'wrong' });
    const right = await guess(inputHash, RIGHT);
    expect(right).toEqual({ kind: 'right', id });
    expect((await rowOf(id)).tries).toBe(MAX_TRIES);
    const data = sqlData(isolates[0]);
    await data.tx('write', (t) => requireCode(t, { personId: PERSON, agentId: AGENT, agent: 'Claude', call: CALL, inputHash, act: { key: 'usersDeactivate', target: { name: 'x', nameAr: 'x' } }, tried: right, now: NOW }));
    expect((await rowOf(id)).used_at).not.toBeNull();
    // The code works one time: a sixth call finds no live row.
    expect(await guess(inputHash, RIGHT)).toEqual({ kind: 'dead' });
  }, 60_000);

  it('lets only one of two parallel calls with the right code claim the row', async () => {
    const { id, inputHash } = await newRow();
    const [a, b] = await Promise.all([guess(inputHash, RIGHT, 0), guess(inputHash, RIGHT, 1)]);
    expect(kinds([a, b])).toEqual(['right', 'right']);
    expect((await rowOf(id)).tries).toBe(2);
    const act = { key: 'usersDeactivate' as const, target: { name: 'x', nameAr: 'x' } };
    const run = (tried: TriedCode, slot: number) => sqlData(isolates[slot]).tx('write', (t) =>
      requireCode(t, { personId: PERSON, agentId: AGENT, agent: 'Claude', call: CALL, inputHash, act, tried, now: NOW }))
      .then(() => 'ran' as const, (error: unknown) => (error instanceof GuardStop ? error.stop.kind : 'error'));
    const results = await Promise.all([run(a, 2), run(b, 3)]);
    expect([...results].sort()).toEqual(['invalid', 'ran']);
  }, 60_000);

  it('counts no try on a row of another input hash, another agent or an expired row', async () => {
    const { id, inputHash } = await newRow();
    const other = await tryCode(sqlData(isolates[0]), { personId: PERSON, agentId: 'usr_010', call: CALL, inputHash, code: '111111', now: NOW });
    expect(other).toEqual({ kind: 'dead' });
    const hash = await tryCode(sqlData(isolates[0]), { personId: PERSON, agentId: AGENT, call: CALL, inputHash: 'another-hash', code: '111111', now: NOW });
    expect(hash).toEqual({ kind: 'dead' });
    const late = await tryCode(sqlData(isolates[0]), { personId: PERSON, agentId: AGENT, call: CALL, inputHash, code: '111111', now: new Date(NOW.getTime() + CODE_TTL_MS + 1_000) });
    expect(late).toEqual({ kind: 'dead' });
    expect((await rowOf(id)).tries).toBe(0);
  }, 60_000);
});
