import { describe, expect, it } from 'vitest';
import type { Task } from '../../../api/contract/entities';
import type { TaskDetail } from '../../../api/contract/views';
import { makeTask } from '../../../test/factories';
import { mayChangeOf, nextStep } from './nextStep';

type Can = TaskDetail['viewerCan'];
const NO_RIGHT: Can = {
  edit: false, editAll: false, complete: false, review: false, delete: false, setNeedsReview: false, contribute: false, newVersion: false,
  saveTemplate: false, take: false, help: false, editDetails: false, editDates: false, work: false, comment: false, upload: false,
};

/** A to-do with a lead, in progress, that the viewer may move. Each test changes only what it checks. */
function detail(task: Partial<Task> = {}, extra: { canMove?: boolean; waiting?: boolean; can?: Partial<Can> } = {}): { data: TaskDetail; can: Can } {
  const can = { ...NO_RIGHT, ...extra.can };
  const data = {
    task: makeTask({ status: 'in_progress', ownerId: 'usr_003', needsReview: false, ...task }),
    canMove: extra.canMove ?? true,
    waitingFor: extra.waiting ? { tasks: [{ id: 'tsk_002', title: 'Survey' }], stages: [] } : { tasks: [], stages: [] },
    viewerCan: can,
  } as unknown as TaskDetail;
  return { data, can };
}
const run = (built: { data: TaskDetail; can: Can }, makerId = 'usr_002') => nextStep(built.data, built.can, makerId);

describe('mayChangeOf', () => {
  it('is true for one change right and false for none', () => {
    expect(mayChangeOf(NO_RIGHT)).toBe(false);
    expect(mayChangeOf({ ...NO_RIGHT, editDetails: true })).toBe(true);
    expect(mayChangeOf({ ...NO_RIGHT, editDates: true })).toBe(true);
    expect(mayChangeOf({ ...NO_RIGHT, work: true })).toBe(true);
    expect(mayChangeOf({ ...NO_RIGHT, editAll: true })).toBe(true);
  });
});

describe('nextStep', () => {
  it.each([
    ['review', detail({ status: 'in_review' }, { can: { review: true } })],
    ['take', detail({ ownerId: null }, { can: { take: true } })],
    ['complete', detail({}, { can: { work: true } })],
    ['waiting', detail({ status: 'todo' }, { waiting: true })],
    ['needs_lead', detail({ ownerId: null, status: 'todo' })],
    ['wait_approval', detail({ status: 'in_review' })],
    ['new_version', detail({ status: 'done' }, { canMove: false, can: { newVersion: true, work: true } })],
    ['join', detail({ status: 'todo' }, { canMove: false, can: { help: true } })],
    ['none', detail({ status: 'todo' }, { canMove: false })],
  ] as const)('returns %s', (kind, built) => {
    expect(run(built)?.kind).toBe(kind);
  });

  it('keeps the order of the design', () => {
    // review beats take
    expect(run(detail({ ownerId: null }, { can: { review: true, take: true } }))?.kind).toBe('review');
    // take beats complete
    expect(run(detail({}, { can: { take: true } }))?.kind).toBe('take');
    // complete beats waiting: a waiting to-do never gives complete, but a free one with a lead does
    expect(run(detail({}, { waiting: true }))?.kind).toBe('waiting');
    expect(run(detail({}))?.kind).toBe('complete');
    // new_version beats join
    expect(run(detail({ status: 'done' }, { canMove: false, can: { newVersion: true, help: true } }))?.kind).toBe('new_version');
  });

  it('says Send to review only when the call lands in review', () => {
    expect(run(detail({ needsReview: true }))?.completeWord).toBe('sendToReview');
    expect(run(detail({ needsReview: true }, { can: { setNeedsReview: true } }))?.completeWord).toBe('markDone');
    expect(run(detail({ needsReview: false }))?.completeWord).toBe('markDone');
    // an office to-do led by its maker needs no review
    expect(run(detail({ projectId: null, stageId: null, needsReview: true, ownerId: 'usr_004' }), 'usr_004')?.completeWord).toBe('markDone');
    // an office to-do led by another person lands in review
    expect(run(detail({ projectId: null, stageId: null, needsReview: true, ownerId: 'usr_003' }), 'usr_004')?.completeWord).toBe('sendToReview');
  });

  it('gives complete only for To do or In progress, with a lead, with canMove and nothing to wait for', () => {
    expect(run(detail({ status: 'todo' }))?.kind).toBe('complete');
    expect(run(detail({ status: 'in_progress' }))?.kind).toBe('complete');
    expect(run(detail({ status: 'in_review' }))?.kind).toBe('wait_approval');
    expect(run(detail({ status: 'done' }, { can: { work: true } }))).toBeNull();
    expect(run(detail({}, { canMove: false }))?.kind).toBe('none');
    expect(run(detail({ ownerId: null }))?.kind).toBe('needs_lead');
    expect(run(detail({}, { waiting: true }))?.kind).toBe('waiting');
  });

  it('returns waiting when waitingFor has a task, and needs_lead for no lead and no take right', () => {
    const waiting = run(detail({}, { waiting: true }));
    expect(waiting?.kind).toBe('waiting');
    expect(waiting?.completeWord).toBeUndefined();
    expect(run(detail({ ownerId: null, status: 'todo' }))?.kind).toBe('needs_lead');
    expect(run(detail({ ownerId: null, status: 'todo' }, { can: { take: true } }))?.kind).toBe('take');
  });

  it('returns wait_approval for a to-do in review when canMove is true and review is false', () => {
    expect(run(detail({ status: 'in_review' }))?.kind).toBe('wait_approval');
    expect(run(detail({ status: 'in_review' }, { can: { review: true } }))?.kind).toBe('review');
    expect(run(detail({ status: 'in_review' }, { canMove: false }))?.kind).toBe('none');
  });

  it('uses mayChange for join and none', () => {
    expect(run(detail({ status: 'done' }, { canMove: false, can: { editDates: true, help: true } }))).toBeNull();
    expect(run(detail({ status: 'done' }, { canMove: false, can: { help: true } }))?.kind).toBe('join');
    expect(run(detail({ status: 'done' }, { canMove: false, can: { help: false } }))?.kind).toBe('none');
    expect(run(detail({ status: 'done' }, { canMove: false, can: { help: true, editAll: true } }))).toBeNull();
  });

  it('returns null when nothing applies', () => {
    expect(run(detail({ status: 'done' }, { canMove: false, can: { work: true } }))).toBeNull();
  });
});
