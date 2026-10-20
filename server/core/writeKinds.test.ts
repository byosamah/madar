import { beforeAll, describe, expect, it } from 'vitest';
import { isRead } from '../../src/api/remote/keys';
import type { Kind } from '../../src/api/remote/wire';
import type { State } from '../../src/api/store';
import { PERSONAL_KINDS } from '../../src/app/readMap';
import { WRITE_KINDS } from '../../src/app/writeKinds';
import { buildSeed } from '../../src/data/seed';
import { trapOffice, writeSweep } from '../data/loaders/sweep';
import { fakeDeps } from '../test/fakes/deps';
import { everyCall } from './everyCall';
import { memoryData } from './memoryData';
import { createRunCall } from './runCall';
import { serverCallMap } from './serverCallMap';
import type { Principal } from './types';

/**
 * The pin of WRITE_KINDS (src/app/writeKinds.ts, performance audit FET-3). A screen reloads, in the request of its own write, the
 * reads that the kinds of the write touch. Each write of everyCall (on the sample office) and of the write sweep (on the trap
 * office) runs once in memory, and the kinds that the screen of the actor gets must be in its line: the kinds of the office
 * signal and of the actor's own person signal, and a personal kind only when the signal names the actor. A missing kind costs
 * no old list (the signals still reload it, as before), only the round trip that the line saves.
 */

const NOW = new Date('2026-10-04T06:00:00Z');
const AGENT = 'usr_009';

let seed: State;
beforeAll(async () => {
  seed = await buildSeed('2026-10-04', async () => undefined);
});

type Seen = Map<string, Set<Kind>>;

/** Runs a list of calls in order on one office, and adds the kinds that the actor's screen got for each write that answered. */
async function runAll(office: State, list: { name: string; input: unknown; actorId: string }[], seen: Seen): Promise<void> {
  const mem = memoryData(office);
  const deps = fakeDeps({ db: mem.db });
  deps.clock.set(NOW);
  const run = createRunCall({ data: () => mem.data() });
  for (const { name, input, actorId } of list) {
    const principal: Principal = actorId === AGENT ? { userId: actorId, agent: { clientId: 'cli-test' } } : { userId: actorId };
    const result = await run(deps, { principal, name, input, batch: { storyRefs: new Map(), overviewCalls: 0 } });
    if (isRead(name) || !result.ok) continue;
    const kinds = seen.get(name) ?? new Set<Kind>();
    seen.set(name, kinds);
    for (const signal of result.signals ?? []) {
      for (const kind of signal.kinds) if (!PERSONAL_KINDS.has(kind) || signal.people.includes(actorId)) kinds.add(kind);
    }
  }
}

describe('WRITE_KINDS, the kinds that a write of the screen can name (performance audit FET-3)', () => {
  it('has a line for every write that the server runs on the list of every call', () => {
    const writes = everyCall(seed).map((c) => c.name).filter((name) => !isRead(name));
    expect(writes.filter((name) => !(name in WRITE_KINDS))).toEqual([]);
  });

  it('names only writes that the server knows', () => {
    const known = new Set(serverCallMap.keys());
    expect(Object.keys(WRITE_KINDS).filter((name) => isRead(name) || !known.has(name))).toEqual([]);
  });

  it('holds every kind that the actor screen got from each write, over the sample office and the trap office', async () => {
    const seen: Seen = new Map();
    await runAll(seed, everyCall(seed), seen);
    const trap = trapOffice(seed);
    await runAll(trap, writeSweep(trap).map(([name, input, actorId]) => ({ name, input, actorId })), seen);
    // Most writes ran with a change. A write that changed nothing in both runs gets its line from its handler.
    expect(seen.size).toBeGreaterThan(60);
    const missing: Record<string, Kind[]> = {};
    for (const [name, kinds] of seen) {
      const line = new Set<Kind>(WRITE_KINDS[name] ?? []);
      const out = [...kinds].filter((kind) => !line.has(kind)).sort();
      if (out.length > 0) missing[name] = out;
    }
    expect(missing).toEqual({});
  }, 60_000);
});
