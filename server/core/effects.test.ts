import { afterEach, describe, expect, it } from 'vitest';
import type { SaveResult } from '../data/save';
import { CHAT_NOTICE_EFFECT, NOTICE_EFFECT, QUOTA_WARNING_EFFECT } from '../mail/notices';
import { REVOKE_EFFECT, SYNC_EFFECT, TIDY_EFFECT } from '../google/rows';
import { PUSH_CHAT_EFFECT, PUSH_EFFECT } from '../push/notify';
import { fakeDeps } from '../test/fakes/deps';
import type { Db, Query } from './ports';
import {
  AFTER_ANSWER_KINDS, CHAT_WAIT_MS, CLAIM_SQL, DONE_SQL, FAIL_SQL, OUTBOX_INSERT_SQL, outboxRowsOf, processOutbox, registerEffect, registerOutbox, WAIT_SQL, WAITED_KINDS, writeOutbox,
} from './effects';

const undo: (() => void)[] = [];
afterEach(() => {
  while (undo.length > 0) undo.pop()!();
});

const saved: SaveResult = { changed: true, kinds: new Set(['users']), projects: new Set(), office: true, people: new Set(), bytesWritten: 1, signals: [] };

/** A Db whose statements answer from a script: the claim gives the row of each id in "rows", or nothing. */
function scriptedDb(rows: Record<string, { kind: string; payload: unknown }>) {
  const seen: [string, unknown[] | undefined][] = [];
  const db: Db = {
    tx: () => Promise.reject(new Error('no tx here')),
    savepoint: () => Promise.reject(new Error('no savepoint here')),
    async statement<R>(_mode: 'read' | 'write', text: string, values?: unknown[]) {
      seen.push([text, values]);
      if (text === CLAIM_SQL) {
        const row = rows[String(values?.[0])];
        return (row ? [{ id: values?.[0], ...row, attempts: 1 }] : []) as R[];
      }
      return [] as R[];
    },
  };
  return { db, seen };
}

describe('effects after the commit (plan 4.12)', () => {
  it('runs after the answer only the mail kinds, the push kinds and the three Google Calendar kinds, by the names that mail/, push/ and google/ register (performance audit SRV-1; owner, 2026-10-08; fbk_022)', () => {
    expect([...AFTER_ANSWER_KINDS].sort()).toEqual([NOTICE_EFFECT, PUSH_EFFECT, QUOTA_WARNING_EFFECT, PUSH_CHAT_EFFECT, CHAT_NOTICE_EFFECT, REVOKE_EFFECT, SYNC_EFFECT, TIDY_EFFECT].sort());
  });

  it('waits 10 seconds only for the chat push and the chat mention mail', () => {
    expect([...WAITED_KINDS].sort()).toEqual([CHAT_NOTICE_EFFECT, PUSH_CHAT_EFFECT].sort());
    expect(CHAT_WAIT_MS).toBe(10_000);
    for (const kind of WAITED_KINDS) expect(AFTER_ANSWER_KINDS.has(kind)).toBe(true);
  });

  it('collects the outbox rows that each registered producer gives for a call, in the order they registered', async () => {
    const q = (async () => []) as Query;
    expect(await outboxRowsOf('users.create', { id: 'usr_012' }, saved, q, new Date('2026-10-01T06:00:00Z'))).toEqual([]);
    undo.push(registerOutbox('users.create', async (output) => [{ kind: 'auth.invite', payload: { userId: (output as { id: string }).id } }]));
    undo.push(registerOutbox('users.create', async () => [{ kind: 'mail.notice', payload: {} }]));
    expect(await outboxRowsOf('users.create', { id: 'usr_012' }, saved, q, new Date('2026-10-01T06:00:00Z'))).toEqual([
      { kind: 'auth.invite', payload: { userId: 'usr_012' } },
      { kind: 'mail.notice', payload: {} },
    ]);
  });

  it('writes the rows in one statement inside the transaction and gives their ids in order', async () => {
    const seen: unknown[][] = [];
    const q = (async (text: string, values?: unknown[]) => {
      seen.push([text, values]);
      return [{ id: '12' }, { id: '11' }];
    }) as Query;
    expect(await writeOutbox(q, [])).toEqual([]);
    expect(seen).toEqual([]);
    const ids = await writeOutbox(q, [{ kind: 'a', payload: { x: 1 } }, { kind: 'b', payload: {} }]);
    expect(ids).toEqual(['11', '12']);
    expect(seen).toEqual([[OUTBOX_INSERT_SQL, [JSON.stringify([{ kind: 'a', payload: { x: 1 } }, { kind: 'b', payload: {} }])]]]);
  });

  it('claims each row before work, runs its handler, and marks it done; a row another worker holds is skipped', async () => {
    const ran: unknown[] = [];
    undo.push(registerEffect('test.ok', async (payload) => {
      ran.push(payload);
    }));
    const { db, seen } = scriptedDb({ 1: { kind: 'test.ok', payload: { n: 1 } } });
    const deps = fakeDeps({ db });
    expect(await processOutbox(deps, ['1', '2'])).toEqual({ done: ['1'], failed: [] });
    expect(ran).toEqual([{ n: 1 }]);
    expect(seen).toEqual([[CLAIM_SQL, ['1']], [DONE_SQL, ['1']], [CLAIM_SQL, ['2']]]);
  });

  it('keeps a failed row with its error for the job, and a row of a kind that no track registered', async () => {
    undo.push(registerEffect('test.fail', async () => {
      throw new Error('Resend said 500');
    }));
    const { db, seen } = scriptedDb({ 1: { kind: 'test.fail', payload: {} }, 2: { kind: 'test.none', payload: {} } });
    const deps = fakeDeps({ db });
    expect(await processOutbox(deps, ['1', '2'])).toEqual({ done: [], failed: ['1', '2'] });
    expect(seen.filter(([text]) => text === FAIL_SQL)).toEqual([
      [FAIL_SQL, ['1', 'Resend said 500']],
      [FAIL_SQL, ['2', 'No effect handler is registered for test.none.']],
    ]);
    expect(deps.logs.map((line) => line.level)).toEqual(['warn', 'warn']);
  });

  it('holds a row whose handler says when to try again (retryAt, for example a full mail day) until then, and gives the attempt back', async () => {
    const retryAt = new Date('2026-10-05T00:00:00Z');
    undo.push(registerEffect('test.later', async () => {
      throw Object.assign(new Error('The daily mail quota is full.'), { retryAt });
    }));
    const { db, seen } = scriptedDb({ 1: { kind: 'test.later', payload: {} } });
    const deps = fakeDeps({ db });
    expect(await processOutbox(deps, ['1'])).toEqual({ done: [], failed: ['1'] });
    expect(seen.slice(1)).toEqual([[WAIT_SQL, ['1', 'The daily mail quota is full.', '2026-10-05T00:00:00.000Z']]]);
    expect(WAIT_SQL).toBe('update outbox set error = $2, claimed_until = $3::timestamptz, attempts = greatest(attempts - 1, 0) where id = $1');
  });

  it('takes producers for shared calls only: a server call never asks the producers, so its name does not compile', () => {
    // @ts-expect-error agents.remove is a server call; it writes its own rows with writeOutbox and runs processOutbox itself.
    expect(() => registerOutbox('agents.remove', async () => [])).toThrow(/agents.remove/);
    // @ts-expect-error users.resendInvite is a server call too.
    expect(() => registerOutbox('users.resendInvite', async () => [])).toThrow(/server call/);
  });

  it('refuses a second handler for one kind', () => {
    undo.push(registerEffect('test.once', async () => undefined));
    expect(() => registerEffect('test.once', async () => undefined)).toThrow(/test.once/);
  });

  it('claims with the statement of the plan: one more attempt, a 2 minute claim, never a done row or a row that another worker holds', () => {
    expect(CLAIM_SQL).toBe(
      "update outbox set claimed_until = now() + interval '2 minutes', attempts = attempts + 1 where id = $1 and done_at is null and (claimed_until is null or claimed_until < now()) returning *",
    );
  });
});
