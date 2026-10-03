import { describe, expect, it } from 'vitest';
import { MAX_BATCH } from './wire';
import { Batcher } from './batcher';

type Item = { name: string; overview: boolean };
const item = (name: string, overview = false): Item => ({ name, overview });
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

  it('puts two overview calls in two requests, and keeps the other calls with them', async () => {
    const { sent, batcher } = setup();
    batcher.add(item('session.get'));
    batcher.add(item('projects.list', true));
    batcher.add(item('dashboard.get', true));
    batcher.add(item('notifications.count'));
    await tick();
    expect(sent).toEqual([['session.get', 'projects.list'], ['dashboard.get', 'notifications.count']]);
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
    batcher.add(item('c', true));
    batcher.add(item('d', true));
    await tick();
    expect(requests[0]).toBe(requests[1]);
    expect(requests[1]).toBe(requests[2]);
    expect(requests[3]).not.toBe(requests[2]);
  });
});
