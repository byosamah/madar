import type { Event, EventTarget, User } from './contract/entities';
import { ApiError, notFound } from './errors';
import { nextId, type State } from './store';

export type EventContext = { state: State; actor: User; stamp: string; authority?: User; correlationId?: string };
export type EventMeta = { projectId: string | null; verb: string; targetType: EventTarget; targetId: string };

const COLLECTION: Record<EventTarget, keyof State | null> = {
  project: 'projects', member: 'members', stage: 'stages', deadline: 'deadlines', task: 'tasks', update: 'updates',
  comment: 'comments', file: 'files', time: 'time', client: 'clients', user: 'users', settings: null,
};

export const NOT_UNDOABLE = new Set(['project.created', 'project.deleted', 'project.stages_changed', 'undo']);

export function writeEvent(ec: EventContext, input: EventMeta & { before: unknown; after: unknown }): Event {
  const id = nextId(ec.state, 'evt');
  const event: Event = {
    id, seq: ec.state.counters.evt, projectId: input.projectId, actorId: ec.actor.id, actorKind: ec.actor.kind,
    // Two names on every change (spec 17): who acted, and the person they acted for.
    actingForId: ec.authority?.id ?? ec.actor.ownerId ?? ec.actor.id,
    correlationId: ec.correlationId ?? `cor_${id}`,
    verb: input.verb, targetType: input.targetType, targetId: input.targetId, before: input.before, after: input.after,
    createdAt: ec.stamp, undoneBy: null,
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

function conflict(): ApiError {
  return new ApiError('conflict', 'This item changed after that edit. Undo is not available.');
}

export function undoEvent(ec: EventContext, eventId: string): Event {
  const event = ec.state.events[eventId];
  if (!event) throw notFound('Event', eventId);
  if (event.undoneBy) throw new ApiError('conflict', 'This change is already undone.');
  const key = COLLECTION[event.targetType];
  if (!key || NOT_UNDOABLE.has(event.verb)) throw new ApiError('conflict', 'This change cannot be undone.');
  const collection = ec.state[key] as unknown as Record<string, Record<string, unknown>>;
  const current = collection[event.targetId];
  const later = Object.values(ec.state.events).filter(
    (e) => e.seq > event.seq && e.targetType === event.targetType && e.targetId === event.targetId && e.undoneBy === null && e.verb !== 'undo',
  );
  const meta: EventMeta = { projectId: event.projectId, verb: 'undo', targetType: event.targetType, targetId: event.targetId };
  let undo: Event;
  if (event.before === null) {
    if (!current || later.length > 0) throw conflict();
    delete collection[event.targetId];
    undo = writeEvent(ec, { ...meta, before: structuredClone(current), after: null });
  } else if (event.after === null) {
    if (current) throw conflict();
    collection[event.targetId] = structuredClone(event.before) as Record<string, unknown>;
    undo = writeEvent(ec, { ...meta, before: null, after: structuredClone(event.before) });
  } else {
    const restore = event.before as Record<string, unknown>;
    const keys = Object.keys(event.after as Record<string, unknown>);
    const clash = later.some((e) => e.after === null || Object.keys((e.after ?? {}) as object).some((k) => keys.includes(k)));
    if (!current || clash) throw conflict();
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
