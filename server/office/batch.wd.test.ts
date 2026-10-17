import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { everyCall } from '../core/everyCall';
import { startLive } from './test/live/harness';

const TODAY = new Date().toISOString().slice(0, 10);
const seedOf = () => buildSeed(TODAY, async () => undefined);
const withMail = (seed: State): State => {
  const prefs = seed.users.usr_003.preferences;
  seed.users.usr_003 = { ...seed.users.usr_003, preferences: { ...prefs, email: { ...prefs.email, task_assigned: true } } };
  return seed;
};

describe('the batch call into the office object on local workerd', () => {
  let live: Awaited<ReturnType<typeof startLive>>;
  beforeAll(async () => {
    live = await startLive();
  }, 120_000);
  afterAll(async () => {
    await live?.server.close();
  });

  it('answers a batch from the office object, with the session of the person', async () => {
    await live.fresh(await seedOf());
    const { status, body } = await live.batch('usr_005', [{ name: 'session.get', input: {} }]);
    expect(status).toBe(200);
    expect(body.results[0]).toMatchObject({ i: 0, ok: true, output: { user: { id: 'usr_005' } } });
  });

  it('refuses a batch with no token before the office object', async () => {
    const response = await live.worker().fetch('/api/batch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ v: 1, calls: [] }) });
    expect(response.status).toBe(401);
  });

  it('runs the entries in the order sent, so a read after a write sees the write', async () => {
    const seed = await seedOf();
    await live.fresh(seed);
    const move = everyCall(seed).find((c) => c.name === 'tasks.move')!;
    const id = (move.input as { id: string }).id;
    const { body } = await live.batch(move.actorId, [{ name: move.name, input: move.input }, { name: 'tasks.get', input: { id } }]);
    expect((body.results[1] as { output: { task: { status: string } } }).output.task.status).toBe('in_progress');
  });

  it('sends the mail of a new task after the answer, through the network port of the Worker', async () => {
    await live.fresh(withMail(await seedOf()));
    const { status } = await live.batch('usr_001', [{ name: 'tasks.create', input: { projectId: 'prj_001', title: 'Site photos', ownerId: 'usr_003', description: '', flagged: false } }]);
    expect(status).toBe(200);
    await vi.waitFor(async () => expect((await live.net()).mails.map((m) => m.tag)).toContain('notice'), { timeout: 5_000 });
  });

  it('gives a file link to the network port of the Worker', async () => {
    await live.fresh(await seedOf());
    const { body } = await live.batch('usr_001', [{ name: 'files.link', input: { id: 'fil_001', variant: 'full', disposition: 'inline' } }]);
    expect(body.results[0]).toMatchObject({ ok: true, output: { url: expect.stringContaining('blob_seed_001') } });
    expect((await live.net()).files).toContainEqual({ op: 'presignGet', key: 'blob_seed_001' });
  });

  it('runs two batches that arrive at one time one after the other', async () => {
    const seed = await seedOf();
    await live.fresh(seed);
    const oldMax = Math.max(...Object.values(seed.events).map((event) => event.seq));
    const c = everyCall(seed).find((one) => one.name === 'tasks.update')!;
    const [a, b] = await Promise.all([live.batch(c.actorId, [{ name: c.name, input: c.input }]), live.batch(c.actorId, [{ name: c.name, input: c.input }])]);
    expect([a.body.results[0].ok, b.body.results[0].ok]).toEqual([true, true]);
    const fresh = Object.values((await live.readBack()).events).map((event) => event.seq).filter((seq) => seq > oldMax).sort((x, y) => x - y);
    expect(fresh).toEqual(fresh.map((_, i) => oldMax + 1 + i));
  });

  it('a refused write sends no signal and writes no outbox row', async () => {
    await live.fresh(await seedOf());
    const { body: ticketBody } = await live.batch('usr_002', [{ name: 'live.ticket', input: {} }]);
    const socket = live.open((ticketBody.results[0] as { output: { ticket: string } }).output.ticket);
    await socket.opened;
    const outbox = await live.rows('select count(*) as n from outbox');
    const { body } = await live.batch('usr_005', [{ name: 'projects.delete', input: { id: 'prj_001' } }]);
    expect(body.results[0]).toMatchObject({ ok: false });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(socket.got).toEqual([]);
    expect(await live.rows('select count(*) as n from outbox')).toEqual(outbox);
    socket.ws.close();
  });

  it('counts the rows, the requests and the calls of a write on the day row', async () => {
    const seed = await seedOf();
    await live.fresh(seed);
    const move = everyCall(seed).find((c) => c.name === 'tasks.move')!;
    await live.batch(move.actorId, [{ name: move.name, input: move.input }, { name: 'session.get', input: {} }]);
    const [day] = await live.rows<{ rows_read: number; rows_written: number; requests: number; calls: number }>('select rows_read, rows_written, requests, calls from usage_day');
    expect(day.requests).toBeGreaterThanOrEqual(1);
    expect(day.calls).toBe(2);
    expect(day.rows_written).toBeGreaterThan(0);
    expect(day.rows_read).toBeGreaterThan(0);
  });
});
