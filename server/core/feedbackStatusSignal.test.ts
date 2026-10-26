import { beforeAll, describe, expect, it } from 'vitest';
import type { Feedback } from '../../src/api/contract/entities';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { fakeDeps } from '../test/fakes/deps';
import { memoryData } from './memoryData';
import { createRunCall } from './runCall';

/**
 * The change signals and the answers of a rejected report (fbk_067, owner 2026-10-26). The reason is for the sender, in one notice, and for
 * the people who hold the report right. A signal tells only kinds and ids, so it never carries the reason, the message or the report id.
 */

const NOW = new Date('2026-10-04T06:00:00Z');
const ADMIN = 'usr_001';
const SENDER = 'usr_003';
const OUTSIDER = 'usr_004';
const REASON = 'We do not plan this SIGNAL-9917.';
const MESSAGE = 'The board does not scroll SIGNAL-5523.';
const SIGNAL_KEYS = new Set(['v', 'id', 'channel', 'seq', 'projects', 'office', 'kinds', 'people', 'storyId', 'actorId']);

let seed: State;
beforeAll(async () => {
  seed = await buildSeed('2026-10-04', async () => undefined);
  const report: Feedback = {
    id: 'fbk_001', kind: 'bug', message: MESSAGE, page: '/projects', screenshots: [], status: 'new', createdBy: SENDER,
    createdAt: '2026-10-03T08:00:00.000Z', doneBy: null, doneAt: null,
  };
  seed.feedback = { fbk_001: report };
  seed.counters.fbk = 1;
});

function runner() {
  const mem = memoryData(structuredClone(seed));
  const deps = fakeDeps({ db: mem.db });
  deps.clock.set(NOW);
  const run = createRunCall({ data: () => mem.data() });
  const batch = () => ({ storyRefs: new Map<string, string>(), overviewCalls: 0 });
  const call = async (userId: string, name: string, input: unknown) => {
    const sent = deps.signal.sent.length;
    const result = await run(deps, { principal: { userId }, name, input, batch: batch() });
    return { result, signals: deps.signal.sent.slice(sent) };
  };
  return { mem, call };
}

describe('a rejected report', () => {
  it('sends signals with kinds and ids only: never the reason, the message or the report id', async () => {
    const { call } = runner();
    const { result, signals } = await call(ADMIN, 'feedback.setStatus', { id: 'fbk_001', status: 'rejected', reason: REASON });
    expect(result.ok).toBe(true);
    expect(signals.length).toBeGreaterThan(0);
    for (const signal of signals) {
      const text = JSON.stringify(signal);
      for (const hidden of [REASON, 'SIGNAL-9917', MESSAGE, 'SIGNAL-5523', 'fbk_001']) expect(text).not.toContain(hidden);
      for (const key of Object.keys(signal)) expect(SIGNAL_KEYS.has(key), key).toBe(true);
    }
  });

  it('gives the reason to the sender in the notice list, and to no other person who reads notices', async () => {
    const { call } = runner();
    await call(ADMIN, 'feedback.setStatus', { id: 'fbk_001', status: 'rejected', reason: REASON });
    const sender = await call(SENDER, 'notifications.list', {});
    expect(JSON.stringify(sender.result.ok ? sender.result.output : null)).toContain(REASON);
    for (const userId of [OUTSIDER, 'usr_002', 'usr_005']) {
      const other = await call(userId, 'notifications.list', {});
      expect(other.result.ok, userId).toBe(true);
      expect(JSON.stringify(other.result.ok ? other.result.output : null), userId).not.toContain('SIGNAL-9917');
    }
  });

  it('refuses a person without the report right with the plain refusal, and no reason in the answer', async () => {
    const { mem, call } = runner();
    for (const userId of [SENDER, OUTSIDER]) {
      const { result, signals } = await call(userId, 'feedback.setStatus', { id: 'fbk_001', status: 'rejected', reason: REASON });
      expect(result.ok, userId).toBe(false);
      expect(JSON.stringify(result), userId).not.toContain('SIGNAL-9917');
      expect(JSON.stringify(result), userId).not.toContain('SIGNAL-5523');
      expect(signals, userId).toEqual([]);
    }
    expect(mem.tables.state.feedback!.fbk_001.status).toBe('new');
  });

  it('keeps the reason out of feedback.list for a person without the report right', async () => {
    const { call } = runner();
    await call(ADMIN, 'feedback.setStatus', { id: 'fbk_001', status: 'rejected', reason: REASON });
    for (const userId of [SENDER, OUTSIDER]) {
      const { result } = await call(userId, 'feedback.list', { status: 'rejected' });
      expect(result.ok, userId).toBe(false);
      expect(JSON.stringify(result), userId).not.toContain('SIGNAL-9917');
    }
  });
});
