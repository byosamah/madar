import type { Event, EventTarget } from '../../../src/api/contract/entities';
import { REFERENCES } from '../../../src/api/references';
import { OFFICE_COLLECTIONS } from '../../core/types';
import type { TableCollection } from '../tables';
import type { Load } from './build';
import { eventTargets, tasksOf } from './steps';

/**
 * The story loader (plan 4.6): events.undo and events.undoStory. An Undo decides on absence in many places (AM 6, rows 3 to 6),
 * so it loads:
 * - the event, and every event of its story (settle, dropNotices, the cover rule);
 * - every event of each target of those events (the later changes that block an Undo, AM 6 row 4);
 * - the current row of each target, and every task of each project of the story (stage tag, dependents, open tasks);
 * - each task, file or comment target that a "before" names (assertReferencesExist, AM 6 row 6);
 * - for the Undo of a create, the first row that still points at the target, for each field of REFERENCES (AM 6 row 3; plan 4.13 A1);
 * - the notices of the story (dropNotices, AM 6 row 5).
 */

type Input = Record<string, unknown>;
const OFFICE = new Set<string>(OFFICE_COLLECTIONS);

/** The state key of each target type, for the row that must not count itself (references.ts). */
const OWN: Partial<Record<EventTarget, TableCollection>> = {
  task: 'tasks', update: 'updates', comment: 'comments', file: 'files', tracker: 'tracker', payment: 'payments', feedback: 'feedback',
};

export async function storyCall(L: Load, input: Input): Promise<void> {
  let correlationId = typeof input.correlationId === 'string' ? input.correlationId : undefined;
  if (typeof input.eventId === 'string') {
    await L.byKey('events', [input.eventId]);
    correlationId = L.get<Event>('events', input.eventId)?.correlationId;
  }
  if (!correlationId) return;
  const story = (await L.select({ c: 'events', where: [{ col: 'correlation_id', in: [correlationId] }] })) as Event[];

  const targets = new Map<string, Set<string>>();
  for (const event of story) targets.set(event.targetType, (targets.get(event.targetType) ?? new Set()).add(event.targetId));
  for (const [targetType, ids] of targets) {
    await L.select({ c: 'events', where: [{ col: 'target_type', eq: targetType }, { col: 'target_id', in: [...ids] }] });
  }
  // The office task of each change of the story, and every change of that task: the view rule reads the task, or the last copy of
  // a deleted one (owner, 2026-10-06).
  const office = [...new Set(story.flatMap((event) => (event.officeTaskId ? [event.officeTaskId] : [])))];
  if (office.length > 0) await L.select({ c: 'events', where: [{ col: 'target_type', eq: 'task' }, { col: 'target_id', in: office }] });
  await L.byKey('tasks', office);
  const events = L.list<Event>('events');
  await eventTargets(L, events);
  await tasksOf(L, events.flatMap((event) => (event.projectId ? [event.projectId] : [])));

  for (const event of story) {
    const before = (event.before ?? {}) as Record<string, unknown>;
    await L.byKey('tasks', [typeof before.taskId === 'string' ? before.taskId : undefined]);
    await L.byKey('files', [typeof before.coverFileId === 'string' ? before.coverFileId : undefined]);
    if (event.targetType === 'comment' && typeof before.targetId === 'string') {
      await L.byKey(before.targetType === 'task' ? 'tasks' : 'updates', [before.targetId]);
    }
  }

  for (const event of story) {
    if (event.before !== null) continue;
    const own = OWN[event.targetType];
    for (const ref of REFERENCES[event.targetType]) {
      const c = ref.collection as TableCollection;
      if (OFFICE.has(c)) continue;
      L.addRows(c, await L.src.referencing(c, ref.path, event.targetId, c === own ? event.targetId : null));
    }
  }

  await L.select({ c: 'notifications', where: [{ col: 'correlation_id', in: [correlationId] }] });
}
