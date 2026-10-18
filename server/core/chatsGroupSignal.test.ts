import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { fakeDeps } from '../test/fakes/deps';
import { memoryData } from './memoryData';
import { createRunCall } from './runCall';

/**
 * The change signals of a group message with a file (fbk_011, security review 2026-10-18). A signal says only which kinds of data
 * changed and for whom: it carries no file id, no file name and no text. A person who may not view a file learns nothing of it from
 * the signal of a message that holds it.
 */

// usage.get is not built here (as in chatsArchiveSignal.test.ts). serverCallMap.ts copies each call at import, so the mock comes first.
vi.mock('../calls/usage', async () => {
  const { notBuiltAsync } = await import('./notBuilt');
  return { usageGet: () => notBuiltAsync('usage.get'), usageRetryEffect: () => notBuiltAsync('usage.retryEffect') };
});

const NOW = new Date('2026-10-04T06:00:00Z');
const ADMIN = 'usr_001';
const SIGNAL_KEYS = new Set(['v', 'id', 'channel', 'seq', 'projects', 'office', 'kinds', 'people', 'storyId', 'actorId']);

let seed: State;
beforeAll(async () => {
  seed = await buildSeed('2026-10-04', async () => undefined);
});

describe('the signals of chats.send in a group, with a file', () => {
  it('carry no file id, no file name and no text', async () => {
    const office = structuredClone(seed);
    const file = Object.values(office.files).find((f) => f.projectId !== null && office.projects[f.projectId].leaderId !== null)!;
    const leader = office.projects[file.projectId!].leaderId!;
    const member = Object.values(office.members).find((m) => m.projectId === file.projectId && m.userId !== leader && office.users[m.userId]?.active)!.userId;
    const mem = memoryData(office);
    const deps = fakeDeps({ db: mem.db });
    deps.clock.set(NOW);
    const run = createRunCall({ data: () => mem.data() });
    const batch = () => ({ storyRefs: new Map<string, string>(), overviewCalls: 0 });
    const made = await run(deps, { principal: { userId: ADMIN }, name: 'chats.createGroup', input: { name: 'Plan team', memberIds: [leader, member] }, batch: batch() });
    if (!made.ok) throw new Error(`createGroup failed: ${made.error.message}`);
    const group = (made.output as { id: string }).id;
    const sent = await run(deps, {
      principal: { userId: ADMIN }, name: 'chats.send', input: { conversationId: group, body: 'SIGNAL-BODY-5521', fileIds: [file.id] }, batch: batch(),
    });
    if (!sent.ok) throw new Error(`send failed: ${sent.error.message}`);
    expect(sent.signals?.length ?? 0).toBeGreaterThan(0);
    for (const signal of sent.signals ?? []) {
      const text = JSON.stringify(signal);
      expect(text).not.toContain(file.id);
      expect(text).not.toContain(file.name);
      expect(text).not.toContain('SIGNAL-BODY-5521');
      // The fields of a signal (wire.ts) hold ids of people and projects and the kinds of data, and nothing else.
      for (const key of Object.keys(signal)) expect(SIGNAL_KEYS.has(key), key).toBe(true);
    }
    // The office signal names nobody: no member of the group and no project (as the signal of a direct message).
    const everyone = (sent.signals ?? []).find((signal) => signal.channel === 'office')!;
    expect(everyone.people).toEqual([]);
    expect(everyone.projects).toEqual([]);
    expect(everyone.kinds).toEqual(['chatReads', 'messages']);
  });
});
