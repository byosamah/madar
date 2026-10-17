import type { ServerHost } from './serverHost';
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
 * MAX_FILE_BYTES in the contract stays the ceiling.
 */
export type FileStoreKind = 'supabase' | 'r2';
export const FILE_STORE_LIMITS: Record<FileStoreKind, { maxFileBytes: number; totalBytes: number }> = {
  supabase: { maxFileBytes: 50 * 1024 * 1024, totalBytes: 1024 * 1024 * 1024 },
  r2: { maxFileBytes: 250 * 1024 * 1024, totalBytes: 10 * 1024 * 1024 * 1024 },
};

/**
 * The calls of a month that the plan of each server host includes (owner, 2026-10-16): Supabase Free has 500,000 Edge
 * Function invocations; Workers Paid has 10 million requests (the Pages Functions of /api and /mcp count there too).
 * office (exit wave 4): Workers Free allows 100,000 requests a day for the account, about 3 million a month. The four day meters
 * of the office object (exit wave 3) watch the real limits, so no month warning goes out for it (warningMeters).
 */
export const CALL_LIMITS: Record<ServerHost, number> = { supabase: 500_000, workers: 10_000_000, office: 3_000_000 };

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

/** The usage meter. The default does nothing (server/usage/meter.ts) until track M fills it. */
export interface MeterPort {
  addBytes(n: number): void;
  /** One statement of its own after a batch, never inside the transaction of a call. */
  countRequest(db: Db): Promise<void>;
  /** The change signals that realtime.send did not send (server/signal/realtime.ts). */
  signalsFailed(count: number): void;
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
  /**
   * The host that serves the screens and agents of this copy (config/server-host.json, server/core/serverHost.ts), not always
   * the running host: the 15-minute job stays on the Supabase jobs function. The calls limit of the Usage page follows it
   * (CALL_LIMITS), so the job on Supabase and usage.get on the Worker give the same answer.
   */
  servingHost: ServerHost;
  /** The VAPID keys of browser push (server/push/vapid.ts). Left out when push is off: the push effect then skips and logs it. */
  push?: { publicKey: string; privateKey: string; subject: string };
};

/** The live socket tickets of the office object (exit wave 3): live.ticket mints one, the socket open takes it (server/office/live.ts). */
export interface LivePort {
  mint(userId: string, now: Date): { ticket: string; expiresAt: string };
}

export type Deps = {
  db: Db;
  clock: Clock;
  files: FilesPort;
  mail: MailPort;
  signal: SignalPort;
  authAdmin: AuthAdminPort;
  meter: MeterPort;
  config: Config;
  log: Logger;
  /**
   * The fetch of a push POST. The office object passes the one of its network port (server/office/net.ts), so the POST runs in the
   * Worker. Left out on every other host: sendPush then uses the global fetch.
   */
  pushFetch?: typeof globalThis.fetch;
  /** The live socket tickets. Only the office object has them; live.ticket answers not_found without them. */
  live?: LivePort;
};
