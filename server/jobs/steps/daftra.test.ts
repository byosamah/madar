import { describe, expect, it, vi } from 'vitest';
import type { Payment } from '../../../src/api/contract/entities';
import type { State } from '../../../src/api/store';
import { sharedCalls } from '../../../src/api/sharedCalls';
import { fakeDaftra, type FakeDaftra, type FakeInvoice } from '../../daftra/fakeDaftra';
import { DAFTRA_INTERNAL_CALLS, DAFTRA_PAID_CALL } from '../../daftra/paidCall';
import { daftraOffice, okOf } from '../../daftra/testOffice';
import { serverCallMap } from '../../core/serverCallMap';
import { readLiteOffice } from '../../data/lite/office';
import { DAFTRA_MAX_CALLS, DAFTRA_MAX_MS, daftra, paidActorOf, problemOf, queuesOf } from './daftra';
import { DaftraError } from '../../daftra/client';

/**
 * The daftra step of the 15-minute job (the Daftra link, owner 2026-10-26; one Daftra account for each sub-company), run on the sample office on
 * node:sqlite with a fake Daftra for each account. No test reaches Daftra. The real step returns at once on the office object path, so each test
 * passes `onOffice` (the daftraOffice helper does); the test of the return at once does not.
 *
 * pay_003 (320,000, due 2026-10-14) is of prj_001, client cli_001, sub-company MAZJ. pay_006 (120,000, due 2026-10-30) is of prj_002, Vado.
 * The run is at 2026-10-26 09:00 Riyadh.
 */

const TODAY = '2026-10-26';
const link = (account: string, invoiceId: string, o: { linkedBy?: string; linkedAt?: string } = {}) => ({
  account, invoiceId, invoiceNo: `N${invoiceId}`, total: 5, issuedOn: '2026-10-20', linkedBy: o.linkedBy ?? 'usr_011', linkedAt: o.linkedAt ?? '2026-10-20T10:00:00.000+03:00',
});
const pay = (seed: State, id: string, over: Partial<Payment>): void => {
  seed.payments![id] = {
    id, projectId: 'prj_001', name: id, amount: 5, dueDate: '2026-12-30', receivedOn: null, note: '', createdBy: 'usr_011', createdAt: '2026-10-01T09:00:00.000+03:00', ...over,
  };
};
const invoice = (id: string, clientId: string, over: Partial<FakeInvoice> = {}): FakeInvoice => ({
  id, no: `N${id}`, clientId, total: 5, date: '2026-10-20', created: '2026-10-20 09:00:00', ...over,
});
const PAID_ON_22: Partial<FakeInvoice> = { paymentStatus: 2, payments: [{ date: '2026-10-21 00:00:00', amount: 5 }, { date: '2026-10-22 00:00:00', amount: 5 }] };

async function build(o: { mazj?: FakeInvoice[]; vado?: FakeInvoice[]; edit?: (seed: State) => void; vadoOnly?: boolean } = {}) {
  const mazj = fakeDaftra({ account: 'MAZJ', clients: [{ id: '842', name: 'Gulf Crest Holding' }], invoices: o.mazj ?? [] });
  const vado = fakeDaftra({ account: 'VADO', clients: [{ id: '55', name: 'Dune Line Developments' }], invoices: o.vado ?? [] });
  const t = await daftraOffice({ fakes: [mazj, vado], ...(o.edit ? { edit: o.edit } : {}) });
  return { t, mazj, vado };
}

/** pay_003 has the MAZJ invoice 1830 and pay_006 the Vado invoice 7. */
const linkedBoth = (seed: State) => {
  seed.payments!.pay_003.daftra = link('MAZJ', '1830');
  seed.payments!.pay_006.daftra = link('VADO', '7', { linkedAt: '2026-10-21T10:00:00.000+03:00' });
};

describe('the step returns at once', () => {
  it('with no Daftra account in the config: no request, no read', async () => {
    const t = await daftraOffice();
    expect(await t.step()).toEqual({ skipped: 'no_config' });
  });

  it('on the office object path (SQLite) when it is not turned on for a test: no request, nothing written', async () => {
    const { t, mazj, vado } = await build({ edit: linkedBoth, mazj: [invoice('1830', '842', PAID_ON_22)] });
    expect(await daftra(t.deps as never, new Date('2026-10-26T06:00:00Z'))).toEqual({ skipped: 'office' });
    expect(mazj.requests.length + vado.requests.length).toBe(0);
    expect((await t.payment('pay_003'))?.receivedOn).toBeNull();
  });
});

describe('the paid check', () => {
  it('sets Received to the day of the last Daftra payment, through the internal call, with an event that names Daftra', async () => {
    const { t, mazj } = await build({ edit: linkedBoth, mazj: [invoice('1830', '842', PAID_ON_22)], vado: [invoice('7', '55')] });
    const report = await t.step();
    expect(report).toMatchObject({ accounts: 2, calls: 2, paid: 1, filled: 0, left: 0, problems: [] });
    expect((await t.payment('pay_003'))?.receivedOn).toBe('2026-10-22');
    expect((await t.payment('pay_006'))?.receivedOn).toBeNull();
    const events = (await t.db.statement('read', "select doc from events where json_extract(doc, '$.verb') like 'payment.received%'")) as { doc: Record<string, unknown> }[];
    expect(events).toHaveLength(1);
    expect(events[0].doc).toMatchObject({
      verb: 'payment.received_daftra', targetType: 'payment', targetId: 'pay_003', projectId: 'prj_001', actorId: 'usr_011',
      before: { receivedOn: null }, after: { receivedOn: '2026-10-22' },
    });
    expect(mazj.requests.every((request) => request.method === 'GET')).toBe(true);
  });

  it('reads the account that is stored in the payment, not the account of the project now', async () => {
    // pay_003 is of a MAZJ project but was linked in the VADO account (the sub-company changed after the link).
    const { t, mazj, vado } = await build({
      edit: (seed) => { seed.payments!.pay_003.daftra = link('VADO', '7'); },
      vado: [invoice('7', '55', PAID_ON_22)], mazj: [invoice('7', '842')],
    });
    await t.step();
    expect(vado.paths()).toEqual(['invoices/7.json']);
    expect(mazj.requests).toEqual([]);
    expect((await t.payment('pay_003'))?.receivedOn).toBe('2026-10-22');
  });

  it('never sets a day after today: a paid day in the future gives today; a paid invoice with no payment row gives today', async () => {
    const { t } = await build({
      edit: linkedBoth,
      mazj: [invoice('1830', '842', { paymentStatus: 2, payments: [{ date: '2026-12-01 00:00:00', amount: 5 }] })],
      vado: [invoice('7', '55', { paymentStatus: 2, payments: [] })],
    });
    await t.step();
    expect((await t.payment('pay_003'))?.receivedOn).toBe(TODAY);
    expect((await t.payment('pay_006'))?.receivedOn).toBe(TODAY);
  });

  it('leaves a payment alone while Daftra says the invoice is not paid (a part payment is not paid), and keeps the link', async () => {
    const { t } = await build({ edit: linkedBoth, mazj: [invoice('1830', '842', { paymentStatus: 1, payments: [{ date: '2026-10-22 00:00:00', amount: 1 }] })], vado: [invoice('7', '55')] });
    expect(await t.step()).toMatchObject({ calls: 2, paid: 0 });
    expect((await t.payment('pay_003'))?.receivedOn).toBeNull();
    expect((await t.payment('pay_003'))?.daftra).toMatchObject({ invoiceId: '1830' });
  });

  it('is safe to run twice: the second run reads nothing for a payment that is received, and adds no event', async () => {
    const { t, mazj } = await build({ edit: linkedBoth, mazj: [invoice('1830', '842', PAID_ON_22)], vado: [invoice('7', '55')] });
    await t.step();
    const reads = mazj.requests.length;
    const second = await t.step();
    expect(second).toMatchObject({ paid: 0 });
    expect(mazj.requests.length).toBe(reads);
    const events = (await t.db.statement('read', "select count(*) as n from events where json_extract(doc, '$.verb') = 'payment.received_daftra'")) as { n: number }[];
    expect(events[0].n).toBe(1);
  });

  it('is done by the person who linked it while active, else by the first active Admin', async () => {
    const { t } = await build({
      edit: (seed) => {
        linkedBoth(seed);
        seed.users.usr_011.active = false;
        seed.payments!.pay_006.daftra = link('VADO', '7', { linkedBy: 'usr_005' });
      },
      mazj: [invoice('1830', '842', PAID_ON_22)], vado: [invoice('7', '55', PAID_ON_22)],
    });
    await t.step();
    const actors = (await t.db.statement('read', "select json_extract(doc, '$.targetId') as target, json_extract(doc, '$.actorId') as actor from events where json_extract(doc, '$.verb') = 'payment.received_daftra' order by target")) as { target: string; actor: string }[];
    // usr_011 is off, so the first active Admin (usr_001) sets pay_003; usr_005 is active and linked pay_006.
    expect(actors).toEqual([{ target: 'pay_003', actor: 'usr_001' }, { target: 'pay_006', actor: 'usr_005' }]);
  });

  it('keeps the next run for a payment when no active person can set it: a warning, no event', async () => {
    const { t } = await build({
      edit: (seed) => {
        linkedBoth(seed);
        for (const user of Object.values(seed.users)) if (user.systemRole === 'admin') user.active = false;
        seed.users.usr_011.active = false;
      },
      mazj: [invoice('1830', '842', PAID_ON_22)],
    });
    expect(await t.step()).toMatchObject({ paid: 0 });
    expect((await t.payment('pay_003'))?.receivedOn).toBeNull();
    expect(t.deps.logs.some((line) => line.level === 'warn' && /no active person/.test(line.message))).toBe(true);
  });

  it('leaves a payment of an account that the copy has no key for, with no request', async () => {
    const { t, mazj, vado } = await build({ edit: (seed) => { seed.payments!.pay_003.daftra = link('BUNAH', '1'); } });
    expect(await t.step()).toMatchObject({ calls: 0, paid: 0, left: 0 });
    expect(mazj.requests.length + vado.requests.length).toBe(0);
  });

  it('sets nothing when the payment changed after the read: the internal call checks again under the lock', async () => {
    const { t } = await build({ edit: linkedBoth });
    const call = (input: Record<string, unknown>) =>
      t.internal(t.deps as never, { principal: { userId: 'usr_011' }, name: DAFTRA_PAID_CALL, input: { id: 'pay_003', account: 'MAZJ', invoiceId: '1830', receivedOn: '2026-10-22', ...input }, batch: { storyRefs: new Map(), overviewCalls: 0 } });
    // Another invoice id, another account, and a payment that does not exist: all quiet no-ops.
    for (const input of [{ invoiceId: '999' }, { account: 'VADO' }, { id: 'pay_404' }]) expect(okOf(await call(input))).toEqual({ received: false });
    expect((await t.payment('pay_003'))?.receivedOn).toBeNull();
    expect(okOf(await call({}))).toEqual({ received: true });
    // Already received: a quiet no-op, the day stays.
    expect(okOf(await call({ receivedOn: '2026-10-23' }))).toEqual({ received: false });
    expect((await t.payment('pay_003'))?.receivedOn).toBe('2026-10-22');
    // A person unlinks it before the write: no-op.
    await t.db.statement('write', "update payments set doc = json_remove(json_set(doc, '$.receivedOn', null), '$.daftra') where id = 'pay_003'");
    expect(okOf(await call({}))).toEqual({ received: false });
  });

  it('the call has no Undo, and an Undo of the event says that Daftra set it', async () => {
    const { t } = await build({ edit: linkedBoth, mazj: [invoice('1830', '842', PAID_ON_22)], vado: [invoice('7', '55')] });
    await t.step();
    const [event] = (await t.db.statement('read', "select doc from events where json_extract(doc, '$.verb') = 'payment.received_daftra'")) as { doc: { id: string } }[];
    // The person that the job acted as (the one who linked it) gets the reason. The Admin may not undo the change of another person at all.
    expect(await t.call('usr_011', 'events.undo', { eventId: event.doc.id })).toMatchObject({ ok: false, error: { code: 'conflict', details: { reason: 'daftra_final' } } });
    expect(await t.call('usr_001', 'events.undo', { eventId: event.doc.id })).toMatchObject({ ok: false });
    expect((await t.payment('pay_003'))?.receivedOn).toBe('2026-10-22');
  });
});

describe('the internal call cannot be reached by a person or an agent', () => {
  it('is in no public map: the call name answers not_found for every person and agent, and the sweeps do not name it', async () => {
    const { t } = await build({ edit: linkedBoth });
    expect(serverCallMap.has(DAFTRA_PAID_CALL)).toBe(false);
    expect(DAFTRA_PAID_CALL in sharedCalls).toBe(false);
    expect([...DAFTRA_INTERNAL_CALLS.keys()]).toEqual([DAFTRA_PAID_CALL]);
    const input = { id: 'pay_003', account: 'MAZJ', invoiceId: '1830', receivedOn: '2026-10-22' };
    for (const result of [await t.call('usr_001', DAFTRA_PAID_CALL, input), await t.call('usr_011', DAFTRA_PAID_CALL, input), await t.callAs({ userId: 'usr_009', agent: { clientId: 'c' } }, DAFTRA_PAID_CALL, input)]) {
      expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
    }
    expect((await t.payment('pay_003'))?.receivedOn).toBeNull();
  });
});

describe('the budget of a run (20 Daftra calls, 60 seconds, all accounts together)', () => {
  const many = (count: number, account: string) => (seed: State) => {
    for (let n = 0; n < count; n += 1) {
      pay(seed, `pay_${account === 'MAZJ' ? 2 : 3}${String(n).padStart(2, '0')}`, {
        projectId: account === 'MAZJ' ? 'prj_001' : 'prj_002', daftra: link(account, String((account === 'MAZJ' ? 2000 : 3000) + n), { linkedAt: `2026-10-0${1 + (n % 9)}T10:00:00.000+03:00` }),
      });
    }
  };
  const invoices = (count: number, base: number, clientId: string) => Array.from({ length: count }, (_, n) => invoice(String(base + n), clientId));

  it('makes at most 20 calls and leaves the rest for the next run', async () => {
    const { t, mazj } = await build({ edit: many(30, 'MAZJ'), mazj: invoices(30, 2000, '842') });
    const report = await t.step();
    expect(DAFTRA_MAX_CALLS).toBe(20);
    expect(report).toMatchObject({ calls: 20, left: 10 });
    expect(mazj.requests).toHaveLength(20);
  });

  it('lets the accounts take turns: a long queue of one account never starves another', async () => {
    const { t, mazj, vado } = await build({
      edit: (seed) => { many(30, 'MAZJ')(seed); many(3, 'VADO')(seed); },
      mazj: invoices(30, 2000, '842'), vado: invoices(3, 3000, '55'),
    });
    const report = await t.step();
    expect(report).toMatchObject({ calls: 20, left: 13 });
    expect(vado.requests).toHaveLength(3);
    expect(mazj.requests).toHaveLength(17);
  });

  // Code review 2026-10-26: the paid check must never starve. The invoice read longest ago goes first, so over the runs every link gets its turn.
  it('checks every linked invoice over the runs: the next run starts with the invoices that the last run did not reach', async () => {
    const { t, mazj } = await build({ edit: many(30, 'MAZJ'), mazj: invoices(30, 2000, '842') });
    await t.step();
    const first = mazj.paths();
    expect(first).toHaveLength(20);
    mazj.requests.length = 0;
    t.deps.clock.set(new Date('2026-10-26T06:15:00Z'));
    await t.step();
    const second = mazj.paths();
    expect(second).toHaveLength(20);
    // The 10 invoices that run 1 did not reach come first in run 2, then the oldest of run 1 again.
    const unread = Array.from({ length: 30 }, (_, n) => `invoices/${2000 + n}.json`).filter((path) => !first.includes(path));
    expect(unread).toHaveLength(10);
    expect(new Set(second.slice(0, 10))).toEqual(new Set(unread));
    expect(new Set([...first, ...second]).size).toBe(30);
  });

  it('moves an invoice that Daftra no longer has to the back of the line, so it never blocks the others', async () => {
    // Invoice 2000 (the oldest link) is gone from Daftra.
    const { t, mazj } = await build({ edit: many(21, 'MAZJ'), mazj: invoices(21, 2000, '842').filter((one) => one.id !== '2000') });
    await t.step();
    mazj.requests.length = 0;
    t.deps.clock.set(new Date('2026-10-26T06:15:00Z'));
    await t.step();
    const second = mazj.paths();
    expect(second[0]).not.toBe('invoices/2000.json');
    expect(second.indexOf('invoices/2000.json')).toBeGreaterThan(0);
  });

  it('fills the cache of an account before its paid checks, so a busy account still gets its suggestions', async () => {
    const { t, mazj } = await build({ edit: many(30, 'MAZJ'), mazj: [...invoices(30, 2000, '842'), invoice('1900', '842', { created: '2026-10-24 10:00:00' })] });
    okOf(await t.call('usr_011', 'daftra.matchClient', { paymentId: 'pay_003', daftraClientId: '842' }));
    mazj.requests.length = 0;
    const report = await t.step();
    expect(report).toMatchObject({ calls: 20, filled: 1 });
    expect(mazj.paths()[0]).toBe('invoices.json?client_id=842&created_from=2026-08-15&limit=50');
  });

  it('stops at 60 seconds: after the clock passes the limit no new call starts', async () => {
    let now = 0;
    const { t, mazj } = await build({ edit: many(10, 'MAZJ'), mazj: invoices(10, 2000, '842') });
    const slow = mazj.fetch;
    (t.deps as unknown as { daftraFetch: typeof fetch }).daftraFetch = async (input, init) => {
      now += 25_000;
      return slow(input, init);
    };
    const report = await t.step({ nowMs: () => now });
    expect(DAFTRA_MAX_MS).toBe(60_000);
    // 0 s, 25 s, 50 s start a call; at 75 s the budget is over.
    expect(report).toMatchObject({ calls: 3, left: 7 });
  });

  it('holds no transaction open during a Daftra call', async () => {
    const { t, mazj, vado } = await build({ edit: linkedBoth, mazj: [invoice('1830', '842', PAID_ON_22)], vado: [invoice('7', '55')] });
    let open = 0;
    const original = t.db.tx.bind(t.db);
    vi.spyOn(t.db, 'tx').mockImplementation(((mode: 'read' | 'write', work: never) => {
      open += 1;
      return original(mode, work).finally(() => { open -= 1; });
    }) as never);
    const seen: number[] = [];
    const routes = [mazj, vado];
    (t.deps as unknown as { daftraFetch: typeof fetch }).daftraFetch = async (input, init) => {
      seen.push(open);
      const url = new URL(String(input instanceof Request ? input.url : input));
      return (routes.find((fake) => fake.site === url.host) as FakeDaftra).fetch(input, init);
    };
    expect(await t.step()).toMatchObject({ calls: 2, paid: 1 });
    expect(seen).toEqual([0, 0]);
  });
});

describe('a problem in one account', () => {
  it('stops that account for this run, goes on with the others, and shows the problem in daftra.status', async () => {
    const { t, mazj, vado } = await build({
      edit: (seed) => { linkedBoth(seed); pay(seed, 'pay_300', { daftra: link('MAZJ', '1831') }); },
      mazj: [invoice('1830', '842', PAID_ON_22), invoice('1831', '842')], vado: [invoice('7', '55', PAID_ON_22)],
    });
    mazj.mode = 401;
    const report = await t.step();
    // MAZJ answers 401 at the first call, so its second payment is not tried. Vado is read and set.
    expect(mazj.requests).toHaveLength(1);
    expect(report).toMatchObject({ calls: 2, paid: 1, left: 1, problems: [{ account: 'MAZJ', problem: 'bad_key' }] });
    expect((await t.payment('pay_006'))?.receivedOn).toBe('2026-10-22');
    expect((await t.payment('pay_003'))?.receivedOn).toBeNull();
    expect(okOf(await t.call('usr_011', 'daftra.status', {}))).toEqual({
      ready: true,
      accounts: [{ name: 'MAZJ', lastReadAt: null, problem: 'bad_key' }, { name: 'VADO', lastReadAt: '2026-10-26T09:00:00.000+03:00', problem: null }],
    });
    expect(vado.requests).toHaveLength(1);
  });

  it('maps the Daftra errors to bad_key, refused and unreachable, and a missing invoice to no problem', async () => {
    const make = (code: ConstructorParameters<typeof DaftraError>[0]) => problemOf(new DaftraError(code));
    expect(make('bad_key')).toBe('bad_key');
    expect(make('refused')).toBe('refused');
    for (const code of ['rate_limited', 'server', 'timeout', 'unreachable', 'bad_answer'] as const) expect(make(code), code).toBe('unreachable');
    expect(make('not_found')).toBeNull();
    for (const [mode, expected] of [[403, 'refused'], [500, 'unreachable'], ['network', 'unreachable'], ['junk', 'unreachable']] as const) {
      const { t, mazj } = await build({ edit: linkedBoth, mazj: [invoice('1830', '842')] });
      mazj.mode = mode;
      expect(((await t.step()) as { problems: unknown[] }).problems[0]).toEqual({ account: 'MAZJ', problem: expected });
    }
  });

  it('keeps the time of the last good read when a later run has a problem, and a good run clears the problem', async () => {
    const { t, mazj } = await build({ edit: linkedBoth, mazj: [invoice('1830', '842')], vado: [invoice('7', '55')] });
    await t.step();
    const state = async () => okOf(await t.call('usr_011', 'daftra.status', {})).accounts as { name: string; lastReadAt: string | null; problem: string | null }[];
    expect((await state())[0]).toEqual({ name: 'MAZJ', lastReadAt: '2026-10-26T09:00:00.000+03:00', problem: null });
    t.deps.clock.set(new Date('2026-10-26T06:15:00Z'));
    mazj.mode = 500;
    await t.step();
    expect((await state())[0]).toEqual({ name: 'MAZJ', lastReadAt: '2026-10-26T09:00:00.000+03:00', problem: 'unreachable' });
    t.deps.clock.set(new Date('2026-10-26T06:30:00Z'));
    mazj.mode = 'ok';
    await t.step();
    expect((await state())[0]).toEqual({ name: 'MAZJ', lastReadAt: '2026-10-26T09:30:00.000+03:00', problem: null });
  });

  it('a missing invoice in Daftra is no problem of the account, and the other payments go on', async () => {
    const { t } = await build({ edit: linkedBoth, mazj: [], vado: [invoice('7', '55', PAID_ON_22)] });
    expect(await t.step()).toMatchObject({ calls: 2, paid: 1, problems: [] });
    expect((await t.payment('pay_006'))?.receivedOn).toBe('2026-10-22');
  });
});

describe('the cache', () => {
  async function matched() {
    const world = await build({
      mazj: [invoice('1830', '842', { total: 320_000 })], vado: [invoice('7', '55', { total: 120_000 })],
    });
    okOf(await world.t.call('usr_011', 'daftra.matchClient', { paymentId: 'pay_003', daftraClientId: '842' }));
    okOf(await world.t.call('usr_011', 'daftra.matchClient', { paymentId: 'pay_006', daftraClientId: '55' }));
    world.mazj.requests.length = 0;
    world.vado.requests.length = 0;
    return world;
  }

  it('reads the invoices of each matched client with an open payment due within 30 days or past due, from 60 days before the oldest due day', async () => {
    const { t, mazj, vado } = await matched();
    // A new invoice appears in Daftra after the match.
    mazj.invoices.push(invoice('1900', '842', { total: 5, created: '2026-10-24 10:00:00' }));
    const report = await t.step();
    expect(report).toMatchObject({ calls: 2, filled: 2, paid: 0 });
    expect(mazj.paths()).toEqual(['invoices.json?client_id=842&created_from=2026-08-15&limit=50']);
    expect(vado.paths()).toEqual(['invoices.json?client_id=55&created_from=2026-08-31&limit=50']);
    const cached = (await t.db.statement('read', "select id from daftra_invoices where account = 'MAZJ' order by id")) as { id: string }[];
    expect(cached.map((row) => row.id)).toEqual(['1830', '1900']);
  });

  it('feeds the suggestion of the sheet', async () => {
    const { t, mazj } = await matched();
    // The accountant changes the amount of the payment in the sheet's own flow: a new invoice with the new total shows only after a read.
    okOf(await t.call('usr_011', 'payments.update', { id: 'pay_003', patch: { amount: 5 } }));
    expect(okOf(await t.call('usr_011', 'daftra.paymentLink', { paymentId: 'pay_003' }))).toMatchObject({ suggested: null });
    mazj.invoices.push(invoice('1900', '842', { total: 5, created: '2026-10-24 10:00:00' }));
    await t.step();
    expect(okOf(await t.call('usr_011', 'daftra.paymentLink', { paymentId: 'pay_003' }))).toMatchObject({ suggested: { id: '1900', total: 5 } });
  });

  it('skips a client whose open payments are all later than 30 days, a client with no match, and a payment that has an invoice or a received day', async () => {
    const { t, mazj, vado } = await build({
      edit: (seed) => {
        // pay_003: due in 40 days. pay_006: received. Nothing else of MAZJ and Vado is open.
        seed.payments!.pay_003.dueDate = '2026-12-05';
        seed.payments!.pay_006.receivedOn = '2026-10-25';
        // An open payment of a project with a client that has no match.
        pay(seed, 'pay_400', { projectId: 'prj_007', dueDate: '2026-10-20' });
      },
    });
    okOf(await t.call('usr_011', 'daftra.matchClient', { paymentId: 'pay_003', daftraClientId: '842' }));
    mazj.requests.length = 0;
    expect(await t.step()).toMatchObject({ calls: 0, filled: 0 });
    expect(mazj.requests.length + vado.requests.length).toBe(0);
  });

  it('reads a past-due payment that is far back: from 60 days before its due day', async () => {
    const { t, mazj } = await build({ edit: (seed) => { seed.payments!.pay_003.dueDate = '2026-03-01'; } });
    okOf(await t.call('usr_011', 'daftra.matchClient', { paymentId: 'pay_003', daftraClientId: '842' }));
    mazj.requests.length = 0;
    await t.step();
    expect(mazj.paths()).toEqual(['invoices.json?client_id=842&created_from=2025-12-31&limit=50']);
  });

  it('takes the account of the project: the same Madar client under two sub-companies reads two accounts', async () => {
    const { t, mazj, vado } = await build({ edit: (seed) => { seed.projects.prj_009.subCompanyId = seed.projects.prj_002.subCompanyId; pay(seed, 'pay_500', { projectId: 'prj_009', dueDate: '2026-10-20' }); } });
    okOf(await t.call('usr_011', 'daftra.matchClient', { paymentId: 'pay_003', daftraClientId: '842' }));
    okOf(await t.call('usr_011', 'daftra.matchClient', { paymentId: 'pay_500', daftraClientId: '55' }));
    mazj.requests.length = 0;
    vado.requests.length = 0;
    await t.step();
    // pay_003 reads client 842 in MAZJ. pay_500 and pay_006 read client 55 in Vado (once: two payments of one client are one read).
    expect(mazj.paths()).toEqual(['invoices.json?client_id=842&created_from=2026-08-15&limit=50']);
    expect(vado.paths()).toEqual(['invoices.json?client_id=55&created_from=2026-08-21&limit=50']);
  });
});

describe('the queues and the actor (pure)', () => {
  it('puts the paid checks first and the cache fills after them, for each account, and drops an account that is not configured', async () => {
    const { t } = await build({ edit: linkedBoth });
    const snapshot = await t.db.tx('read', (q) => readLiteOffice(t.db, q));
    const linked = [{ ...t.seed.payments!.pay_003, daftra: link('MAZJ', '1') }, { ...t.seed.payments!.pay_006, daftra: link('BUNAH', '2') }];
    const queues = queuesOf({
      office: snapshot, accounts: ['MAZJ', 'VADO'], linked, open: [t.seed.payments!.pay_006], matches: new Map([['VADO/cli_002', '55']]),
    });
    expect(queues.get('MAZJ')).toEqual([{ kind: 'paid', payment: linked[0] }]);
    expect(queues.get('VADO')).toEqual([{ kind: 'cache', daftraClientId: '55', from: '2026-08-31' }]);
    expect(queues.has('BUNAH')).toBe(false);
  });

  it('puts the cache fills of an account before its paid checks, and the paid checks by the time of their last read, never read first', async () => {
    const { t } = await build({ edit: linkedBoth });
    const snapshot = await t.db.tx('read', (q) => readLiteOffice(t.db, q));
    const linked = ['1', '2', '3'].map((id) => ({ ...t.seed.payments!.pay_003, id: `pay_9${id}`, daftra: link('MAZJ', id) }));
    const checked = new Map([['MAZJ:1', '2026-10-26T06:00:00.000Z'], ['MAZJ:2', '2026-10-25T06:00:00.000Z']]);
    const queues = queuesOf({
      office: snapshot, accounts: ['MAZJ'], linked, open: [t.seed.payments!.pay_003], matches: new Map([['MAZJ/cli_001', '842']]), checked,
    });
    expect(queues.get('MAZJ')!.map((item) => (item.kind === 'cache' ? 'cache' : item.payment.daftra.invoiceId))).toEqual(['cache', '3', '2', '1']);
  });

  it('picks the person who linked while active, else the first active Admin, else nobody', async () => {
    const { t } = await build();
    const snapshot = await t.db.tx('read', (q) => readLiteOffice(t.db, q));
    expect(paidActorOf(snapshot, 'usr_011')).toBe('usr_011');
    expect(paidActorOf(snapshot, 'usr_009')).toBe('usr_001');
    expect(paidActorOf(snapshot, 'usr_404')).toBe('usr_001');
  });
});

describe('the log and the answer of the step never hold a key or a site', () => {
  it('holds for every failure mode of Daftra: the log names the account, the code and the status', async () => {
    const { t, mazj, vado } = await build({ edit: linkedBoth, mazj: [invoice('1830', '842', PAID_ON_22)], vado: [invoice('7', '55')] });
    const reports: unknown[] = [];
    for (const mode of [401, 403, 500, 'network', 'junk', 'ok'] as FakeDaftra['mode'][]) {
      mazj.mode = mode;
      vado.mode = mode;
      reports.push(await t.step());
    }
    const everything = `${JSON.stringify(reports)} ${t.logText()} ${JSON.stringify(t.deps.signal.sent)}`;
    for (const secret of [mazj.apiKey, mazj.site, vado.apiKey, vado.site]) expect(everything).not.toContain(secret);
    expect(t.logText()).toMatch(/"step":"daftra","account":"MAZJ","code":"bad_key","status":401/);
  });

  it('holds for the signals of the paid write: they name payments and events, never Daftra', async () => {
    const { t } = await build({ edit: linkedBoth, mazj: [invoice('1830', '842', PAID_ON_22)], vado: [invoice('7', '55')] });
    await t.step();
    expect(t.deps.signal.sent.length).toBeGreaterThan(0);
    expect(JSON.stringify(t.deps.signal.sent)).not.toMatch(/daftra|invoice|MAZJ/i);
  });
});
