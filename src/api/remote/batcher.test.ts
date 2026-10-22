import { describe, expect, it } from 'vitest';
import { BATCH_BUDGET, MAX_BATCH, callCost } from './wire';
import { Batcher } from './batcher';

type Item = { name: string; cost: number; after?: Item };
/** cost: the cost of the call for the budget of a request. BATCH_BUDGET is a call that takes the whole budget (it fits alone). */
const item = (name: string, cost = 0): Item => ({ name, cost });
/** A read that must run after a write, in the request of that write (performance audit FET-3). */
const follower = (name: string, after: Item, cost = 0): Item => ({ name, cost, after });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(place?: (item: Item, request: object) => Promise<void> | null) {
  const sent: string[][] = [];
  const batcher = new Batcher<Item>({ send: (items) => sent.push(items.map((i) => i.name)), place });
  return { sent, batcher };
}

describe('the batcher (client map 4.1)', () => {
  it('sends the calls of one moment in one request, in order', async () => {
    const { sent, batcher } = setup();
    batcher.add(item('session.get'));
    batcher.add(item('projects.get'));
    batcher.add(item('notifications.count'));
    expect(sent).toEqual([]);
    await tick();
    expect(sent).toEqual([['session.get', 'projects.get', 'notifications.count']]);
  });

  it('sends calls of two moments in two requests', async () => {
    const { sent, batcher } = setup();
    batcher.add(item('a'));
    await tick();
    batcher.add(item('b'));
    await tick();
    expect(sent).toEqual([['a'], ['b']]);
  });

  it(`sends at most ${MAX_BATCH} calls in one request, and sends a full request at once`, async () => {
    const { sent, batcher } = setup();
    for (let n = 0; n < MAX_BATCH; n += 1) batcher.add(item(`c${n}`));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toHaveLength(MAX_BATCH);
    batcher.add(item('last'));
    await tick();
    expect(sent).toEqual([sent[0], ['last']]);
  });

  it('puts two calls that take the whole budget in two requests, and keeps the other calls with them', async () => {
    const { sent, batcher } = setup();
    batcher.add(item('session.get'));
    batcher.add(item('projects.list', BATCH_BUDGET));
    batcher.add(item('dashboard.get', BATCH_BUDGET));
    batcher.add(item('notifications.count'));
    await tick();
    expect(sent).toEqual([['session.get', 'projects.list'], ['dashboard.get', 'notifications.count']]);
  });

  it('keeps one overview call in a request for the calls of a screen, whatever their cost (the cold start does not change)', async () => {
    const { sent, batcher } = setup();
    batcher.add(item('session.get'));
    batcher.add(item('tasks.list', callCost('tasks.list', { filter: 'mine' })));
    batcher.add(item('tasks.list', callCost('tasks.list', { filter: 'review_for_me' })));
    batcher.add(item('projects.list', callCost('projects.list', {})));
    batcher.add(item('notifications.count'));
    await tick();
    expect(sent).toEqual([['session.get', 'tasks.list'], ['tasks.list'], ['projects.list', 'notifications.count']]);
  });

  it('puts the follow reads in the request of their write while their cost adds up to the budget (perf2 savetrip)', async () => {
    const { sent, batcher } = setup();
    const write = item('tasks.update');
    batcher.add(write);
    batcher.add(follower('a', write, 10));
    batcher.add(follower('b', write, 10));
    batcher.add(follower('c', write, 10));
    batcher.add(follower('d', write, 1));
    batcher.add(follower('e', write));
    await tick();
    // The fourth follow read would pass 30. It starts a request of its own, and the follow read after it (cost 0) joins that one.
    expect(sent).toEqual([['tasks.update', 'a', 'b', 'c', 'e'], ['d']]);
  });

  it('keeps the order of the calls and starts the next request with the follow read that did not fit', async () => {
    const { sent, batcher } = setup();
    const write = item('tasks.update');
    batcher.add(write);
    batcher.add(follower('projects.list', write, callCost('projects.list', {})));
    batcher.add(follower('mine', write, callCost('tasks.list', { filter: 'mine' })));
    batcher.add(follower('events.list', write, callCost('events.list', {})));
    batcher.add(follower('review', write, callCost('tasks.list', { filter: 'review_for_me' })));
    await tick();
    // projects.list (20), mine (1) and review (1) fit with the write; events.list (15) passes 30 and goes as any other call.
    expect(sent).toEqual([['tasks.update', 'projects.list', 'mine', 'review'], ['events.list']]);
  });

  it('puts a cheap follow read in the request of its write beside a costly call, and a follow read over the budget in the next one', async () => {
    const { sent, batcher } = setup();
    const write = item('tasks.update');
    batcher.add(item('projects.list', 20));
    batcher.add(write);
    batcher.add(follower('tasks.list', write, 1));
    batcher.add(follower('tasks.list', write, 1));
    batcher.add(follower('dashboard.get', write, 10));
    await tick();
    expect(sent).toEqual([['projects.list', 'tasks.update', 'tasks.list', 'tasks.list'], ['dashboard.get']]);
  });

  it('keeps a plain overview call out of the request that follow reads filled', async () => {
    const { sent, batcher } = setup();
    const write = item('tasks.update');
    batcher.add(write);
    batcher.add(follower('tasks.list', write, 1));
    batcher.add(item('dashboard.get', 10));
    await tick();
    expect(sent).toEqual([['tasks.update', 'tasks.list'], ['dashboard.get']]);
  });

  it('holds back a call that must wait, and adds it again when the wait ends', async () => {
    let release: () => void = () => undefined;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    let held = true;
    const { sent, batcher } = setup((i) => (i.name === 'later' && held ? wait : null));
    batcher.add(item('first'));
    batcher.add(item('later'));
    await tick();
    expect(sent).toEqual([['first']]);
    held = false;
    release();
    await tick();
    await tick();
    expect(sent).toEqual([['first'], ['later']]);
  });

  it('gives place() the request that the call joins', async () => {
    const requests: object[] = [];
    const { batcher } = setup((_i, request) => { requests.push(request); return null; });
    batcher.add(item('a'));
    batcher.add(item('b'));
    batcher.add(item('c', BATCH_BUDGET));
    batcher.add(item('d', BATCH_BUDGET));
    await tick();
    expect(requests[0]).toBe(requests[1]);
    expect(requests[1]).toBe(requests[2]);
    expect(requests[3]).not.toBe(requests[2]);
  });

  it('puts a read that follows a write into the request of that write, after it (performance audit FET-3)', async () => {
    const { sent, batcher } = setup();
    const write = item('tasks.complete');
    batcher.add(item('session.get'));
    batcher.add(write);
    batcher.add(follower('tasks.get', write));
    batcher.add(follower('tasks.list', write));
    await tick();
    expect(sent).toEqual([['session.get', 'tasks.complete', 'tasks.get', 'tasks.list']]);
  });

  it('keeps a follower in the request of its write when a later call started a new request', async () => {
    const { sent, batcher } = setup();
    const write = item('tasks.complete');
    batcher.add(item('projects.list', BATCH_BUDGET));
    batcher.add(write);
    batcher.add(item('dashboard.get', BATCH_BUDGET));
    batcher.add(follower('tasks.get', write));
    await tick();
    expect(sent).toEqual([['projects.list', 'tasks.complete', 'tasks.get'], ['dashboard.get']]);
  });

  it('places a follower that does not fit with its write as any other call: a full request or a cost over the budget', async () => {
    const { sent, batcher } = setup();
    const write = item('tasks.complete');
    batcher.add(item('projects.list', BATCH_BUDGET));
    batcher.add(write);
    batcher.add(follower('tasks.list', write, BATCH_BUDGET));
    await tick();
    expect(sent).toEqual([['projects.list', 'tasks.complete'], ['tasks.list']]);
    const full = setup();
    const second = item('tasks.move');
    for (let n = 0; n < MAX_BATCH - 2; n += 1) full.batcher.add(item(`c${n}`));
    full.batcher.add(second);
    full.batcher.add(follower('tasks.get', second));
    // The queue reached MAX_BATCH, so it went at once; the follower comes in the next one.
    full.batcher.add(follower('tasks.list', second));
    await tick();
    expect(full.sent.map((request) => request.length)).toEqual([MAX_BATCH, 1]);
    expect(full.sent[1]).toEqual(['tasks.list']);
  });

  it('places a follower as any other call when its write waits for its story', async () => {
    let release: () => void = () => undefined;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    let held = true;
    const write = item('tasks.complete');
    const { sent, batcher } = setup((i) => (i === write && held ? wait : null));
    batcher.add(write);
    batcher.add(follower('tasks.get', write));
    await tick();
    expect(sent).toEqual([['tasks.get']]);
    held = false;
    release();
    await tick();
    await tick();
    expect(sent).toEqual([['tasks.get'], ['tasks.complete']]);
  });
});
