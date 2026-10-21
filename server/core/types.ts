import type { z } from 'zod';
import type { ServerCallName, ServerContracts } from '../../src/api/contract/server';
import type { State } from '../../src/api/store';
import type { ChangeSignal, RunError, StoryRef } from '../../src/api/remote/wire';
import type { Deps, Query } from './ports';
import type { CallData } from './runCall';

export type { ChangeSignal, Kind, RunError, StoryRef } from '../../src/api/remote/wire';

/** A Madar user id. For an agent, the agent's own user id; clientId names the OAuth client it signed in with. */
export type Principal = { userId: string; agent?: { clientId: string } };

/** The office lists that the office cache keeps in memory (plan 4.7). */
export const OFFICE_COLLECTIONS = [
  'users', 'teams', 'settings', 'clients', 'stageTemplates', 'taskTemplates', 'projectTemplates', 'projects', 'members', 'stages', 'deadlines',
  'conversations', 'subCompanies',
] as const;
export type OfficeCollection = (typeof OFFICE_COLLECTIONS)[number];
/** One committed read of the office lists, at office_meta.version. Its objects are frozen: a call gets its own deep copy. */
export type OfficeSnapshot = { version: number; lists: Readonly<Required<Pick<State, OfficeCollection>>> };

/**
 * What one batch shares between its entries (plan 4.10): the story placeholders it mapped, the office it read once,
 * and how many overview calls it holds. runCall drops "office" after an entry that raised the office version.
 * mail: the mail effects of the batch that run after the answer, as one chain, so they run in the order of the entries.
 */
export type BatchScope = { storyRefs: Map<string, string>; office?: OfficeSnapshot; overviewCalls: number; mail?: Promise<void> };

/**
 * The read transaction of the sign-in, still open (performance audit SV-5). The first read call of a batch runs in it, so the batch
 * saves one begin, one office_meta read and one commit. Only handleBatch sets it, only for a call that joinsFirstRead accepts, and
 * only for that one call.
 */
export type OpenRead = { q: Query };

export type RunRequest = { principal: Principal; name: string; input: unknown; story?: StoryRef; key?: string; batch: BatchScope; open?: OpenRead };

/** signals: only the signals that the actor's own screen receives (the office signal, and the actor's person signal). */
export type RunResult =
  | { ok: true; output: unknown; storyId?: string; changed: boolean; signals?: ChangeSignal[] }
  | { ok: false; error: RunError };

/** runCall checks story { id } for a server write (plan 4.9). story { ref } and key are not checked: a server write runs resolveStory and the KeyStore replay and put inside its own transaction. */
/**
 * What a server call (one of the 9) gets. It does its own permission checks with can() on the office snapshot.
 * data: the CallData of the runCall that runs the call (sqlData or liteData), for a server write that saves (agents.remove).
 */
export type ServerCallCtx = { deps: Deps; principal: Principal; office: OfficeSnapshot; batch: BatchScope; story?: StoryRef; key?: string; now: Date; data?: CallData };

export type ServerCallInput<N extends ServerCallName> = z.output<ServerContracts[N]['input']>;
export type ServerCallOutput<N extends ServerCallName> = z.input<ServerContracts[N]['output']>;
export type ServerCallResult<O> = { output: O; storyId?: string; changed?: boolean; signals?: ChangeSignal[] };
export type ServerCall<N extends ServerCallName> = (input: ServerCallInput<N>, ctx: ServerCallCtx) => Promise<ServerCallResult<ServerCallOutput<N>>>;
