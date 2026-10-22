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

  it('allows one id for the named part and one for the office task part of a save, and never lets the two parts meet', () => {
    // A save with a project part and an office task part (review 2026-10-06): the office signal names the actor and the story,
    // and the people of the office task get a person signal with its own id and no names.
    const mixed = (): CallCheck => {
      const check = goodWrite();
      check.before.tasks.tsk_009 = makeTask({ id: 'tsk_009', projectId: null, stageId: null, ownerId: 'usr_003' });
      check.after.tasks.tsk_009 = { ...makeTask({ id: 'tsk_009', projectId: null, stageId: null, ownerId: 'usr_003' }), title: 'Office title' };
      check.after.events.evt_003 = event('evt_003', 3, { projectId: null, targetId: 'tsk_009', officeTaskId: 'tsk_009', correlationId: 'sty_b' });
      const hidden = { id: 'sig_2', storyId: undefined, actorId: undefined };
      check.signals = [signal(), signal({ ...hidden, channel: 'person:usr_003', people: ['usr_003'] })];
      return check;
    };
    expect(callProblems(mixed())).toEqual([]);

    const sameId = mixed();
    sameId.signals[1] = { ...sameId.signals[1], id: 'sig_1' };
    expect(callProblems(sameId)).toEqual(['tasks.update sent the office task part with the id of a signal that names the actor and the story.']);

    const loud = mixed();
    loud.signals[0] = { ...loud.signals[0], storyId: undefined, actorId: undefined, id: 'sig_2' };
    loud.signals.pop();
    expect(callProblems(loud)).toEqual(['tasks.update sent a signal with no names on the office channel.']);

    const third = mixed();
    third.signals.push(signal({ id: 'sig_3', storyId: undefined, actorId: undefined, channel: 'person:usr_001', people: ['usr_001'] }));
    expect(callProblems(third)).toEqual(['tasks.update sent signals with more than one id.']);
  });

  it('knows the part of a hidden project: person signals to its people only, with one id of their own, and none on the office channel (hidden projects, wave D3)', () => {
    // prj_001 is hidden: the leader usr_002, the team usr_003, the Admin usr_001. usr_004 is an outsider.
    const hiddenWrite = (): CallCheck => {
      const check = goodWrite();
      for (const state of [check.before, check.after]) state.projects.prj_001 = { ...state.projects.prj_001, access: { hidden: true, viewerIds: [] } };
      const own = (user: string) => signal({ id: 'sig_h', channel: `person:${user}`, people: [user] });
      check.signals = ['usr_001', 'usr_002', 'usr_003'].map(own);
      return check;
    };
    expect(callProblems(hiddenWrite())).toEqual([]);

    const onOffice = hiddenWrite();
    onOffice.signals.push(signal({ id: 'sig_h' }));
    expect(callProblems(onOffice)).toContain('tasks.update named a hidden project on the office channel.');

    const outsider = hiddenWrite();
    outsider.signals.push(signal({ id: 'sig_h', channel: 'person:usr_004', people: ['usr_004'] }));
    expect(callProblems(outsider)).toContain('tasks.update told usr_004 about the hidden project prj_001, and usr_004 does not view it.');

    const missing = hiddenWrite();
    missing.signals.pop();
    expect(callProblems(missing)).toContain('tasks.update did not tell usr_003 about the hidden project prj_001.');
  });

  it('builds one checksum statement over every table of the schema, with the schema in each name, so no search_path counts', () => {
    const sql = checksumSql('madar_w2', ['users', 'events', 'office_meta']);
    expect(sql).toContain('from madar_w2.users t');
    expect(sql).toContain('from madar_w2.office_meta t');
    expect(sql).not.toMatch(/from (users|events|office_meta) t/);
    expect(() => checksumSql('madar_w2', ['users; drop table x'])).toThrow();
    expect(() => checksumSql('public; drop table x', ['users'])).toThrow();
  });
});
