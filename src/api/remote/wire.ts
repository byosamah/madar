import type { CallMeta } from '../client';
import type { ApiErrorCode } from '../errors';
import type { State } from '../store';

/**
 * The batch wire form (plan 4.10), shared by RemoteApi in the browser and the server.
 * Only types and constants live here, so the browser bundle carries no server code and no handler.
 */

/** A story: a server story ID, or a browser placeholder (cor_ui_...) that the server maps to a new story (plan 4.9). */
export type StoryRef = { id: string } | { ref: string };

export type RunError = { code: ApiErrorCode; message: string; details?: Record<string, unknown> };

/** What a change touched. projectTouched: only a project's updatedAt changed. preferences: only a person's own preferences changed. */
export type Kind = Exclude<keyof State, 'version' | 'seededOn' | 'session' | 'counters' | 'counts'> | 'projectTouched' | 'preferences';

/**
 * One change signal (plan, change 13). The office channel carries office changes; each person:<userId> channel carries the
 * personal ones. The signals of one save share one id, so a screen that receives a change twice applies it once. A save that
 * changes an office task sends that part with a second id and no names, only to the people of the task (review 2026-10-06).
 */
export type ChangeSignal = {
  v: 1;
  id: string;
  channel: 'office' | `person:${string}`;
  seq: number;
  projects: string[];
  office: boolean;
  kinds: Kind[];
  people: string[];
  /** Absent on a signal of an office task change, which names nobody (review 2026-10-06). */
  storyId?: string;
  actorId?: string;
};

export type WireCall = { i: number; name: string; input: unknown; story?: StoryRef; key?: string };
export type WireRequest = { v: 1; calls: WireCall[] };
export type WireEntry =
  | { i: number; ok: true; output: unknown; storyId?: string; changed?: boolean; signals?: ChangeSignal[] }
  | { i: number; ok: false; error: RunError };
export type WireResponse = { v: 1; serverTime: string; results: WireEntry[] };

export const MAX_BATCH = 12;
/** At most one of these in one request, because the CPU limit covers the whole request. tasks.list counts only without projectId. */
export const OVERVIEW_CALLS = ['projects.list', 'dashboard.get', 'tasks.list', 'search.query', 'events.list'] as const;
/** The largest request body the server reads. */
export const MAX_BODY_BYTES = 256 * 1024;
/** Every request URL carries this, so the functions run in Frankfurt (plan, change 5). */
export const FUNCTION_REGION = 'eu-central-1';

/** True when this entry counts as an overview call. */
export function isOverviewCall(name: string, input: unknown): boolean {
  if (!(OVERVIEW_CALLS as readonly string[]).includes(name)) return false;
  if (name !== 'tasks.list') return true;
  return !(typeof input === 'object' && input !== null && typeof (input as { projectId?: unknown }).projectId === 'string');
}

/**
 * An adapter turns one screen call whose input JSON cannot carry (a file) into several wire calls (plan 5.2).
 * RemoteApi (track R1) runs it in place of the call; track F writes the adapters. "call" sends one wire call through the batcher.
 */
export type AdapterCtx = { call(name: string, input: unknown, meta?: CallMeta): Promise<unknown>; meta: CallMeta };
export type Adapter = (input: unknown, ctx: AdapterCtx) => Promise<unknown>;
