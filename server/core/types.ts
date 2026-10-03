import type { z } from 'zod';
import type { ServerCallName, ServerContracts } from '../../src/api/contract/server';
import type { State } from '../../src/api/store';
import type { ChangeSignal, RunError, StoryRef } from '../../src/api/remote/wire';
import type { Deps } from './ports';

export type { ChangeSignal, Kind, RunError, StoryRef } from '../../src/api/remote/wire';

/** A Madar user id. For an agent, the agent's own user id; clientId names the OAuth client it signed in with. */
export type Principal = { userId: string; agent?: { clientId: string } };

/** The office lists that the office cache keeps in memory (plan 4.7). */
export const OFFICE_COLLECTIONS = [
  'users', 'teams', 'settings', 'clients', 'stageTemplates', 'taskTemplates', 'projects', 'members', 'stages', 'deadlines', 'conversations',
] as const;
export type OfficeCollection = (typeof OFFICE_COLLECTIONS)[number];
/** One committed read of the office lists, at office_meta.version. Its objects are frozen: a call gets its own deep copy. */
export type OfficeSnapshot = { version: number; lists: Readonly<Required<Pick<State, OfficeCollection>>> };

/**
 * What one batch shares between its entries (plan 4.10): the story placeholders it mapped, the office it read once,
 * and how many overview calls it holds. runCall drops "office" after an entry that raised the office version.
 */
export type BatchScope = { storyRefs: Map<string, string>; office?: OfficeSnapshot; overviewCalls: number };

export type RunRequest = { principal: Principal; name: string; input: unknown; story?: StoryRef; key?: string; batch: BatchScope };

/** signals: only the signals that the actor's own screen receives (the office signal, and the actor's person signal). */
export type RunResult =
  | { ok: true; output: unknown; storyId?: string; changed: boolean; signals?: ChangeSignal[] }
  | { ok: false; error: RunError };

/** What a server call (one of the 9) gets. It does its own permission checks with can() on the office snapshot. */
export type ServerCallCtx = { deps: Deps; principal: Principal; office: OfficeSnapshot; batch: BatchScope; story?: StoryRef; key?: string; now: Date };

export type ServerCallInput<N extends ServerCallName> = z.output<ServerContracts[N]['input']>;
export type ServerCallOutput<N extends ServerCallName> = z.input<ServerContracts[N]['output']>;
export type ServerCallResult<O> = { output: O; storyId?: string; changed?: boolean; signals?: ChangeSignal[] };
export type ServerCall<N extends ServerCallName> = (input: ServerCallInput<N>, ctx: ServerCallCtx) => Promise<ServerCallResult<ServerCallOutput<N>>>;
