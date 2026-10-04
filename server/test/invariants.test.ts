import { describe, expect, it } from 'vitest';
import type { Event } from '../../src/api/contract/entities';
import type { State } from '../../src/api/store';
import { makeTask, makeWorld, STAMP } from '../../src/test/factories';
import type { ChangeSignal } from '../core/types';
import { callProblems, checksumSql, type CallCheck } from './invariants';

function event(id: string, seq: number, over: Partial<Event> = {}): Event {
  return {
    id, seq, actorId: 'usr_001', projectId: 'prj_001', targetType: 'task', targetId: 'tsk_001', verb: 'created', diff: {}, correlationId: 'sty_a',
    createdAt: STAMP, undoneBy: null, ...over,
  } as Event;
}

function office(): State {
  const state = makeWorld();
  state.tasks.tsk_001 = makeTask();
  state.events.evt_001 = event('evt_001', 1);
  return state;
}

function signal(over: Partial<ChangeSignal> = {}): ChangeSignal {
  return {
    v: 1, id: 'sig_1', channel: 'office', seq: 1, projects: ['prj_001'], office: false, kinds: ['events', 'tasks'], people: [], storyId: 'sty_b', actorId: 'usr_001',
    ...over,
  } as ChangeSignal;
}

/** A write that changes the task and adds one event, with its office signal. */
function goodWrite(): CallCheck {
  const before = office();
  const after = structuredClone(before);
  after.tasks.tsk_001.title = 'New title';
  after.events.evt_002 = event('evt_002', 2, { verb: 'updated', correlationId: 'sty_b' });
  return { name: 'tasks.update', readOnly: false, ok: true, beforeSum: 'a', afterSum: 'b', before, after, signals: [signal()] };
}

describe('the free checks of each db-mode call (TM 3.5, checks 2 to 5)', () => {
  it('passes a good write', () => {
    expect(callProblems(goodWrite())).toEqual([]);
  });

  it('finds a failed call that wrote a row or sent a signal', () => {
    const before = office();
    const failed: CallCheck = { name: 'tasks.update', readOnly: false, ok: false, beforeSum: 'a', afterSum: 'b', before, after: before, signals: [signal()] };
    expect(callProblems(failed)).toEqual([
      'tasks.update failed, and it still changed the database.',
      'tasks.update failed, and it still sent 1 change signal(s).',
    ]);
  });

  it('finds a read that wrote a row or sent a signal', () => {
    const before = office();
    const read: CallCheck = { name: 'tasks.get', readOnly: true, ok: true, beforeSum: 'a', afterSum: 'b', before, after: before, signals: [signal()] };
    expect(callProblems(read)).toEqual([
      'tasks.get is a read, and it changed the database.',
      'tasks.get is a read, and it sent 1 change signal(s).',
    ]);
  });

  it('finds an event that changed or went away, and allows undoneBy of a new undo event', () => {
    const changed = goodWrite();
    changed.after.events.evt_001.verb = 'deleted';
    expect(callProblems(changed)).toEqual(['tasks.update changed the event evt_001. The History only grows.']);

    const gone = goodWrite();
    delete gone.after.events.evt_001;
    expect(callProblems(gone)).toEqual(['tasks.update removed the event evt_001. The History only grows.']);

    const undo = goodWrite();
    undo.after.events.evt_002 = event('evt_002', 2, { verb: 'undone', undoes: 'evt_001', correlationId: 'sty_b' });
    undo.after.events.evt_001.undoneBy = 'evt_002';
    expect(callProblems(undo)).toEqual([]);
  });

  it('finds a saved change without its signal, a signal without a change, and a signal for the wrong project', () => {
    const silent = goodWrite();
    silent.signals = [];
    expect(callProblems(silent)).toEqual(['tasks.update saved a change and sent no change signal.']);

    const noisy = goodWrite();
    noisy.after = noisy.before;
    expect(callProblems(noisy)).toEqual(['tasks.update saved no change and still sent 1 change signal(s).']);

    const wrong = goodWrite();
    wrong.signals = [signal({ projects: ['prj_009'] })];
    expect(callProblems(wrong)).toEqual(['tasks.update sent a signal for the projects prj_009, but the change touched prj_001.']);

    const twice = goodWrite();
    twice.signals = [signal(), signal({ id: 'sig_2' })];
    expect(callProblems(twice)).toEqual([
      'tasks.update sent signals with more than one id.',
      'tasks.update sent more than one signal on the channel office.',
    ]);
  });

  it('builds one checksum statement over every table of the schema', () => {
    const sql = checksumSql(['users', 'events', 'office_meta']);
    expect(sql).toContain('from users t');
    expect(sql).toContain('from office_meta t');
    expect(() => checksumSql(['users; drop table x'])).toThrow();
  });
});
