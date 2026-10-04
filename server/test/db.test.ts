import { describe, expect, it } from 'vitest';
import type { Event } from '../../src/api/contract/entities';
import { makeTask, makeWorld, STAMP } from '../../src/test/factories';
import { downChanges } from './db';

const event = (id: string, over: Partial<Event> = {}): Event => ({
  id, seq: 1, projectId: 'prj_001', actorId: 'usr_001', actorKind: 'human', actingForId: 'usr_001', correlationId: 'cor_a', verb: 'created',
  targetType: 'task', targetId: 'tsk_001', before: null, after: null, createdAt: STAMP, undoneBy: null, ...over,
});

describe('the write-down of the test edits (TM 3.3, step 2)', () => {
  it('writes nothing when the mirror equals the image, also with keys in another order and a missing optional list', () => {
    const image = makeWorld();
    image.teams = {};
    const mirror = structuredClone(image);
    delete mirror.teams;
    const { prj_001: project } = mirror.projects;
    mirror.projects.prj_001 = Object.fromEntries(Object.entries(project).reverse()) as typeof project;
    expect(downChanges(image, mirror)).toEqual({ tables: [], counters: {}, removedCounters: [] });
  });

  it('finds new, changed and removed records, and the counters', () => {
    const image = makeWorld();
    image.tasks.tsk_001 = makeTask();
    const mirror = structuredClone(image);
    mirror.tasks.tsk_002 = makeTask({ id: 'tsk_002' });
    mirror.users.usr_004.name = 'Omar Renamed';
    delete mirror.stages.stg_001;
    mirror.counters.tsk = 2;
    delete mirror.counters.usr;
    const { tables, counters, removedCounters } = downChanges(image, mirror);
    const by = Object.fromEntries(tables.map((t) => [t.spec.table, { deleted: t.deleted, upserts: t.upserts.map((row) => row.id) }]));
    expect(by).toEqual({ users: { deleted: [], upserts: ['usr_004'] }, stages: { deleted: ['stg_001'], upserts: [] }, tasks: { deleted: [], upserts: ['tsk_002'] } });
    expect(counters).toEqual({ tsk: 2 });
    expect(removedCounters).toEqual(['usr']);
  });

  it('marks a change of an old event, and ignores undoneBy, which the database never keeps', () => {
    const image = makeWorld();
    image.events.evt_001 = event('evt_001');
    const filled = structuredClone(image);
    filled.events.evt_001.undoneBy = 'evt_009';
    expect(downChanges(image, filled).tables).toEqual([]);

    const edited = structuredClone(image);
    edited.events.evt_001.createdAt = '2026-09-01T09:00:00.000+03:00';
    const [change] = downChanges(image, edited).tables;
    expect(change).toMatchObject({ touchesOld: true, deleted: [] });

    const added = structuredClone(image);
    added.events.evt_002 = event('evt_002', { seq: 2 });
    expect(downChanges(image, added).tables[0]).toMatchObject({ touchesOld: false });
  });
});
