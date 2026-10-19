import type { Event, EventTarget, Task, User } from './contract/entities';
import { ApiError, notFound } from './errors';
import { isReferenced } from './references';
import { nextId, type State } from './store';

export type EventContext = { state: State; actor: User; stamp: string; authority?: User; correlationId?: string };
export type EventMeta = { projectId: string | null; verb: string; targetType: EventTarget; targetId: string; causeEventId?: string };

export const COLLECTION: Record<EventTarget, keyof State | null> = {
  project: 'projects', member: 'members', stage: 'stages', deadline: 'deadlines', task: 'tasks', update: 'updates',
  comment: 'comments', file: 'files', client: 'clients', user: 'users', settings: null, stageTemplate: 'stageTemplates', taskTemplate: 'taskTemplates', tracker: 'tracker', payment: 'payments', feedback: 'feedback', team: 'teams',
  projectTemplate: 'projectTemplates', subCompany: 'subCompanies', meeting: 'meetings',
};

/** Changes that follow from other changes. The project's stage tag follows its tasks, so it has no Undo of its own: it moves again with them. */
export const DERIVED = new Set(['project.stage_changed']);

export const NOT_UNDOABLE = new Set(['project.created', 'project.deleted', 'project.stages_changed', 'undo', ...DERIVED]);

/**
 * Changes that Madar makes to other tasks because of a person's change: a done task that opens again, and a date that moves.
 * In a story, the person may take them back with the change that caused them (audit 2026-10-03, API-1).
 */
export const FOLLOW_ON = new Set(['task.reopened', 'task.dates_shifted']);

type Fields = Record<string, unknown>;
const fieldsOf = (value: unknown): Fields | undefined => (value !== null && typeof value === 'object' ? (value as Fields) : undefined);

/**
 * The office task of a change: the task itself, the task of a comment, or the task of a file, when that task has no project
 * (owner, 2026-10-06). The record comes from the state, or from the event for a record that the change made or removed.
 */
function officeTaskOf(state: State, input: { targetType: EventTarget; targetId: string; before: unknown; after: unknown }): string | undefined {
  const record = (key: keyof State): Fields | undefined =>
    fieldsOf((state[key] as Record<string, unknown> | undefined)?.[input.targetId]) ?? fieldsOf(input.after) ?? fieldsOf(input.before);
  // A task that is gone keeps its office link through its last copy, so a later change of its comment stays private (review 2026-10-06).
  const officeTask = (taskId: unknown): string | undefined => {
    if (typeof taskId !== 'string') return undefined;
    const task = state.tasks[taskId] ?? lastTaskCopy(state, taskId);
    return task && task.projectId === null ? taskId : undefined;
  };
  if (input.targetType === 'task') {
    const task = record('tasks') ?? lastTaskCopy(state, input.targetId);
    return task && task.projectId === null ? input.targetId : undefined;
  }
  if (input.targetType === 'comment') {
    const comment = record('comments');
    return comment?.targetType === 'task' ? officeTask(comment.targetId) : undefined;
  }
  if (input.targetType === 'file') {
    const file = record('files');
    return file && file.projectId === null && typeof file.taskId === 'string' ? file.taskId : undefined;
  }
  return undefined;
}

/**
 * The meeting of a change of a meeting that has no project (fbk_022, owner 2026-10-19): the target itself. The live meeting tells, else
 * the whole record that a create or a remove event keeps. Only the people of that meeting read the event.
 */
function officeMeetingOf(state: State, input: { targetType: EventTarget; targetId: string; before: unknown; after: unknown }): string | undefined {
  if (input.targetType !== 'meeting') return undefined;
  const record = fieldsOf(state.meetings?.[input.targetId]) ?? fieldsOf(input.after) ?? fieldsOf(input.before);
  return record && record.projectId === null ? input.targetId : undefined;
}

/** The last copy of a deleted task, from its newest delete event that stands. Undefined when no such event is in the state. */
export function lastTaskCopy(state: State, taskId: string): Task | undefined {
  let found: Event | undefined;
  for (const event of Object.values(state.events)) {
    if (event.verb === 'task.deleted' && event.targetId === taskId && !event.undoneBy && (!found || event.seq > found.seq)) found = event;
  }
  return found && found.before !== null && typeof found.before === 'object' ? (found.before as Task) : undefined;
}

/**
 * Writes one event. An event about an office record names its office task: the one the caller gives (an undo takes the office
 * task of the event it undoes), else the one its record shows. The same for a meeting with no project (officeMeetingId).
 */
export function writeEvent(
  ec: EventContext, input: EventMeta & { before: unknown; after: unknown; undoes?: string; officeTaskId?: string; officeMeetingId?: string },
): Event {
  const officeTaskId = input.officeTaskId ?? officeTaskOf(ec.state, input);
  const officeMeetingId = input.officeMeetingId ?? officeMeetingOf(ec.state, input);
  const id = nextId(ec.state, 'evt');
  const event: Event = {
    id, seq: ec.state.counters.evt, projectId: input.projectId, actorId: ec.actor.id, actorKind: ec.actor.kind,
    // Two names on every change (spec 17): who acted, and the person they acted for.
    actingForId: ec.authority?.id ?? ec.actor.ownerId ?? ec.actor.id,
    correlationId: ec.correlationId ?? `cor_${id}`,
    verb: input.verb, targetType: input.targetType, targetId: input.targetId, before: input.before, after: input.after,
    createdAt: ec.stamp, undoneBy: null,
    ...(input.causeEventId ? { causeEventId: input.causeEventId } : {}),
    ...(input.undoes ? { undoes: input.undoes } : {}),
    ...(officeTaskId ? { officeTaskId } : {}),
    ...(officeMeetingId ? { officeMeetingId } : {}),
  };
  ec.state.events[id] = event;
  return event;
}

export function recordCreate(ec: EventContext, meta: EventMeta & { entity: unknown }): Event {
  return writeEvent(ec, { ...meta, before: null, after: structuredClone(meta.entity) });
}

export function recordDelete(ec: EventContext, meta: EventMeta & { entity: unknown }): Event {
  return writeEvent(ec, { ...meta, before: structuredClone(meta.entity), after: null });
}

/** Applies the changed fields to the target and records one event. Returns null when nothing changes. */
export function applyPatch<T extends object>(ec: EventContext, target: T, changes: Partial<T>, meta: EventMeta): Event | null {
  const record = target as unknown as Record<string, unknown>;
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const [key, next] of Object.entries(changes)) {
    if (next === undefined) continue;
    if (JSON.stringify(record[key]) === JSON.stringify(next)) continue;
    before[key] = structuredClone(record[key]);
    after[key] = structuredClone(next);
    record[key] = structuredClone(next);
  }
  if (Object.keys(after).length === 0) return null;
  return writeEvent(ec, { ...meta, before, after });
}

function conflict(message = 'This item changed after that edit. Undo is not available.'): ApiError {
  return new ApiError('conflict', message);
}

/** Fields that point at another record. An undo may only bring back values whose record still exists. */
const REFERENCE_FIELDS: Record<string, keyof State> = {
  projectId: 'projects', stageId: 'stages', currentStageId: 'stages', taskId: 'tasks', clientId: 'clients', coverFileId: 'files',
  userId: 'users', ownerId: 'users', authorId: 'users', leaderId: 'users', createdBy: 'users', subCompanyId: 'subCompanies',
};

function assertReferencesExist(state: State, targetType: EventTarget, values: Record<string, unknown>): void {
  for (const [field, value] of Object.entries(values)) {
    const key = REFERENCE_FIELDS[field];
    if (!key || typeof value !== 'string') continue;
    // The sub-company list is optional in an office saved before it existed, so an absent list counts as empty.
    if (!((state[key] ?? {}) as Record<string, unknown>)[value]) throw conflict('Something this change needs is gone. Undo is not available.');
  }
  // Only a whole comment names its target. A change of some fields (an edit, a reaction) keeps the target it has (audit 2026-10-03, API-19).
  if (targetType === 'comment' && 'targetId' in values) {
    const target = values.targetType === 'task' ? state.tasks[String(values.targetId)] : state.updates[String(values.targetId)];
    if (!target) throw conflict('Something this change needs is gone. Undo is not available.');
  }
}

/** "derived" lets the history calls take back a stage move together with the story that caused it. */
export function undoEvent(ec: EventContext, eventId: string, options: { derived?: boolean } = {}): Event {
  const event = ec.state.events[eventId];
  if (!event) throw notFound('Event', eventId);
  if (event.undoneBy) throw new ApiError('conflict', 'This change is already undone.');
  const key = COLLECTION[event.targetType];
  const allowed = options.derived === true && DERIVED.has(event.verb);
  if (!key || (NOT_UNDOABLE.has(event.verb) && !allowed)) throw new ApiError('conflict', 'This change cannot be undone.');
  const collection = ec.state[key] as unknown as Record<string, Record<string, unknown>>;
  const current = collection[event.targetId];
  const later = Object.values(ec.state.events).filter(
    (e) => e.seq > event.seq && e.targetType === event.targetType && e.targetId === event.targetId && e.undoneBy === null && e.verb !== 'undo',
  );
  // The undo event names the event it undoes. The server stores only that link and fills undoneBy from it (plan 4.3, AM 7.8).
  // The undo of a change of an office record is private as the change was (review 2026-10-06).
  const meta = {
    projectId: event.projectId, verb: 'undo', targetType: event.targetType, targetId: event.targetId, undoes: event.id,
    ...(event.officeTaskId ? { officeTaskId: event.officeTaskId } : {}),
    ...(event.officeMeetingId ? { officeMeetingId: event.officeMeetingId } : {}),
  };
  let undo: Event;
  if (event.before === null) {
    if (!current || later.length > 0) throw conflict();
    if (isReferenced(ec.state, event.targetType, event.targetId)) throw conflict('Other items now use this. Undo is not available.');
    delete collection[event.targetId];
    undo = writeEvent(ec, { ...meta, before: structuredClone(current), after: null });
  } else if (event.after === null) {
    if (current) throw conflict();
    assertReferencesExist(ec.state, event.targetType, event.before as Record<string, unknown>);
    collection[event.targetId] = structuredClone(event.before) as Record<string, unknown>;
    undo = writeEvent(ec, { ...meta, before: null, after: structuredClone(event.before) });
  } else {
    const restore = event.before as Record<string, unknown>;
    const keys = Object.keys(event.after as Record<string, unknown>);
    const clash = later.some((e) => e.after === null || Object.keys((e.after ?? {}) as object).some((k) => keys.includes(k)));
    if (!current || clash) throw conflict();
    assertReferencesExist(ec.state, event.targetType, restore);
    const before: Record<string, unknown> = {};
    for (const field of Object.keys(restore)) {
      before[field] = structuredClone(current[field]);
      current[field] = structuredClone(restore[field]);
    }
    undo = writeEvent(ec, { ...meta, before, after: structuredClone(restore) });
  }
  event.undoneBy = undo.id;
  return undo;
}
