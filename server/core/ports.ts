import type { DaftraConfig } from '../daftra/config';
import type { EnterpriseFacts } from '../enterprise/facts';
import type { EnterpriseId } from '../enterprise/ids';
import type { RunCall } from './runCall';
import type { ServerHost } from './serverHost';
import type { TypingSignal } from '../../src/api/remote/wire';
import type { ChangeSignal } from './types';

/**
 * Every side effect of the server goes through one of these ports, so tests use the fakes in server/test/fakes (plan 4.5).
 * server/core/deps.ts (track E) builds the real ports from env().
 */

export type Query = <R = Record<string, unknown>>(text: string, values?: unknown[]) => Promise<R[]>;

export interface Db {
  /** One transaction. A nested call refuses (AsyncLocalStorage). */
  tx<T>(mode: 'read' | 'write', work: (q: Query) => Promise<T>): Promise<T>;
  /** Only where code asks for it explicitly. */
  savepoint<T>(q: Query, work: (q: Query) => Promise<T>): Promise<T>;
  /** One statement, with no open transaction. */
  statement<R = Record<string, unknown>>(mode: 'read' | 'write', text: string, values?: unknown[]): Promise<R[]>;
  /** Ends the connections of this Db. The Workers entry calls it after each request (server/entries/requestDb.ts). */
  close?(): Promise<void>;
  /**
   * Opens the connection of one pool and sends no statement, so a later transaction finds it open (performance audit SRV-M2).
   * It reads nothing. A Db without pools leaves it out.
   */
  warm?(mode: 'read' | 'write'): Promise<void>;
  /**
   * `statement` for work that was started inside a transaction and runs on after it (the office copy writer, officeCache.ts). pgDb
   * keeps its open transaction in AsyncLocalStorage, and a promise that starts inside a transaction inherits it: on Supabase Edge
   * Functions AsyncLocalStorage.exit clears it only for the first synchronous part (probe, 2026-11-02), so `statement` would refuse.
   * This one never reads that context and uses a connection of its own. A Db with no such context leaves it out.
   */
  statementApart?<R = Record<string, unknown>>(mode: 'read' | 'write', text: string, values?: unknown[]): Promise<R[]>;
  /**
   * 'sqlite' for the SQLite Db of the office object and of test:lite (server/data/lite/db.ts). Absent means Postgres. Code that
   * sends its own SQL picks its text with sqlFor (server/data/dialect.ts).
   */
  readonly dialect?: 'sqlite';
}

export interface Clock {
  now(): Date;
}

/**
 * Where the files live (plan 2b, point 1): Supabase Storage first (MADAR_FILE_STORE=supabase, the default), R2 after the switch
 * (MADAR_FILE_STORE=r2; owner, 2026-10-16: the test copy first, then production). The limits come from the active store;
 * MAX_FILE_BYTES in the contract stays the ceiling, and fileLimitOf (limits.ts) lowers it for a file of a chat.
 */
export type FileStoreKind = 'supabase' | 'r2';
export const FILE_STORE_LIMITS: Record<FileStoreKind, { maxFileBytes: number; totalBytes: number }> = {
  supabase: { maxFileBytes: 50 * 1024 * 1024, totalBytes: 1024 * 1024 * 1024 },
  // 500 MB is the file ceiling of the contract (MAX_FILE_BYTES). A file of a chat is held to 250 MB by place (fileLimitOf), not by the store.
  r2: { maxFileBytes: 500 * 1024 * 1024, totalBytes: 10 * 1024 * 1024 * 1024 },
};

export function fileStoreKind(value: string | undefined): FileStoreKind {
  if (value === undefined || value === '' || value === 'supabase') return 'supabase';
  if (value === 'r2') return 'r2';
  throw new Error(`MADAR_FILE_STORE must be supabase or r2, not ${value}.`);
}

/** A signed upload. The headers always hold Content-Type; a store can add its own. */
export type PresignedPut = { url: string; headers: Record<string, string>; expiresAt: string };

export interface FilesPort {
  readonly kind: FileStoreKind;
  /** The largest file this store takes. */
  readonly maxFileBytes: number;
  presignPut(key: string, o: { mimeType: string; size?: number }): Promise<PresignedPut>;
  /** filename: the name the download keeps (RFC 6266 on R2, the download parameter on Supabase Storage). */
  presignGet(key: string, o: { disposition: 'inline' | 'attachment'; filename: string; mimeType: string }): Promise<{ url: string; expiresAt: string }>;
  head(key: string, o?: { timeoutMs?: number }): Promise<{ size: number; mimeType: string } | null>;
  copy(from: string, to: string): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

export type Mail = { to: string; subject: string; html: string; text: string; tag: string; idempotencyKey: string };
export interface MailPort {
  send(mail: Mail): Promise<{ id: string }>;
}

/** Sends the change signals inside the save transaction, so a rollback sends nothing. */
export interface SignalPort {
  send(q: Query, signals: ChangeSignal[]): Promise<void>;
}

/** confirmed: Auth confirmed the email. passwordSet: the person saved a password (PASSWORD_SET_MARK). */
export type AuthUserInfo = { authUserId: string; email: string | null; confirmed: boolean; passwordSet: boolean };
export interface AuthAdminPort {
  generateLink(type: 'invite' | 'recovery', email: string): Promise<{ authUserId: string; tokenHash: string }>;
  createUser(email: string, password: string): Promise<{ authUserId: string }>;
  setBanned(authUserId: string, banned: boolean): Promise<void>;
  /** confirm: true only for a person who already accepted (server/auth/admin.ts). */
  updateEmail(authUserId: string, email: string, o?: { confirm?: boolean }): Promise<void>;
  /** Every Auth user, and whether the email is confirmed (users.invites). */
  listUsers(): Promise<AuthUserInfo[]>;
  /** One Auth user, or null (the auth.email effect). */
  getUser(authUserId: string): Promise<AuthUserInfo | null>;
}

export type LogFields = Record<string, unknown>;
export interface Logger {
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

export type Limits = {
  /** The file limit of the active store (FILE_STORE_LIMITS). session.get returns it as limits.maxFileBytes. */
  maxFileBytes: number;
  /** The storage meter limit of the active store. */
  filesTotalBytes: number;
};

export type Config = {
  /**
   * The enterprise of this object (Madar enterprises). The office object sets it from its identity row; the Postgres path leaves it out,
   * and entOfConfig (plan D) reads a missing value as ENT_VADO.
   */
  ent?: EnterpriseId;
  /** The key of pg_advisory_xact_lock for the office. In tests, one key for each worker schema. */
  lockKey: number;
  appUrl: string;
  apiUrl: string;
  mcpUrl: string;
  supabaseUrl: string;
  mailFrom: string;
  /** The oldest screen build the server accepts (X-Madar-Build). Older builds get 409 client_outdated. */
  minClientBuild: string;
  allowedOrigins: string[];
  /** SB_REGION of the running function. */
  region: string;
  /** MCP_FORWARD_REGION: the region every MCP request runs in (default eu-central-1). */
  forwardRegion: string;
  fileStore: FileStoreKind;
  limits: Limits;
  /** The VAPID keys of browser push (server/push/vapid.ts). Left out when push is off: the push effect then skips and logs it. */
  push?: { publicKey: string; privateKey: string; subject: string };
  /**
   * The Google Calendar values (fbk_022, server/google/keys.ts): the OAuth client and the 32 byte key that seals the refresh tokens and
   * signs the state. Left out when the copy has none: Google is off, google.status answers ready false, and the sync does nothing.
   */
  google?: { clientId: string; clientSecret: string; key: string };
  /**
   * The Daftra link values (server/daftra/config.ts): the key and the site of each Daftra account, by account name (one account for each
   * sub-company). Left out when the copy has none: the link is off, the daftra calls answer daftra_not_ready, and the job step does nothing.
   * The names are not secret. The keys and the sites never go in an answer, a log line or an error text.
   */
  daftra?: DaftraConfig;
  /**
   * The public PostHog project key (POSTHOG_KEY, `phc_...`). Left out when the owner has no PostHog account yet: the logger then stays
   * as it is. With it, each `error` line also posts one record to PostHog Cloud EU (server/core/insight.ts).
   */
  posthogKey?: string;
  /**
   * The compressed office copy (tsk_496, server/data/officeCopy.ts): true makes the office cache start a cold read from the copy row and
   * write a new copy after an answer. Left out means off, which is what the unit tests and the db-mode harness need (the harness never
   * commits). buildDeps turns it on, and OFFICE_COPY=off turns it off again.
   */
  officeCopy?: boolean;
};

/** The live socket tickets of the office object (exit wave 3): live.ticket mints one, the socket open takes it (server/office/live.ts). */
export interface LivePort {
  mint(userId: string, now: Date): { ticket: string; expiresAt: string };
}

/**
 * The typing signals (chat presence design B, base B5): the same signal to each of the people, on person:<id>, with its own event name.
 * It is no change signal and is never saved. send never throws: a lost signal ends by itself 6 seconds after the last one.
 */
export interface TypingPort {
  send(people: string[], signal: TypingSignal): Promise<void>;
}

/**
 * The email directory of the platform object, bound to the enterprise of the call (Madar enterprises, design 5.4). reserve answers taken
 * when another enterprise holds the email. Only the office object sets it, through its network port (a call outside a transaction).
 */
export interface DirectoryPort {
  reserve(email: string): Promise<'ok' | 'taken'>;
  release(email: string): Promise<void>;
}

export type Deps = {
  db: Db;
  /**
   * The facts of the enterprise of this object (Madar enterprises, plan C): its id, state, limits and platform owners, in memory. Only the
   * office object sets it. The Postgres path leaves it out: its hooks and limits then do nothing, and the enterprise is ENT_VADO.
   */
  enterprise?: EnterpriseFacts;
  /** The email directory (plan C, Task 12). Left out on the Postgres path and in tests without one: the email hooks then do nothing. */
  directory?: DirectoryPort;
  clock: Clock;
  files: FilesPort;
  mail: MailPort;
  signal: SignalPort;
  authAdmin: AuthAdminPort;
  config: Config;
  log: Logger;
  /**
   * The fetch of a push POST. The office object passes the one of its network port (server/office/net.ts), so the POST runs in the
   * Worker. Left out on every other host: sendPush then uses the global fetch.
   */
  pushFetch?: typeof globalThis.fetch;
  /**
   * The fetch of a Google call (server/google/api.ts). Tests pass a stub, so no test reaches Google. Left out on the Postgres hosts: the
   * calls then use the global fetch. The office object sets it from its network port (`NetApi.googleFetch`, server/office/net.ts), so
   * the request leaves from the Worker.
   */
  googleFetch?: typeof globalThis.fetch;
  /**
   * The fetch of a Daftra call (server/daftra/client.ts). Tests pass a stub, so no test reaches Daftra. Left out on the Postgres hosts:
   * the client then uses the global fetch. The office object sets it from its network port (`NetApi.daftraGet`): it sends the address
   * only, and the Worker adds the key.
   */
  daftraFetch?: typeof globalThis.fetch;
  /**
   * The office object only: effect rows that a server call wrote with writeOutbox. They run after the answer, as the rows of a shared
   * call (server/calls/google.ts). Left out on the other hosts: the server call then runs its rows with `processOutbox` itself.
   */
  later?: (ids: string[], kinds: string[]) => void;
  /** The office object only: the run of the internal call payments.daftraPaid (server/daftra/paidCall.ts) on the SQLite data. */
  daftraRun?: RunCall;
  /** The typing signals. Left out where the host has no sender (the office object gets its own): chats.typing then tells nobody. */
  typing?: TypingPort;
  /** The live socket tickets. Only the office object has them; live.ticket answers not_found without them. */
  live?: LivePort;
  /**
   * The run of a normal call, for a job step that runs one (fbk_022: the meetings step runs meetings.settle). The office object puts its
   * own run here, which reads and writes the SQLite data. Left out on every other host: the step then uses the Postgres runCall.
   */
  runCall?: RunCall;
};
