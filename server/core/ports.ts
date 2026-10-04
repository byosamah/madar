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
}

export interface Clock {
  now(): Date;
}

/**
 * Where the files live (plan 2b, point 1): Supabase Storage first (MADAR_FILE_STORE=supabase, the default), R2 when the owner
 * turns it on (MADAR_FILE_STORE=r2). The limits come from the active store; MAX_FILE_BYTES in the contract stays the ceiling.
 */
export type FileStoreKind = 'supabase' | 'r2';
export const FILE_STORE_LIMITS: Record<FileStoreKind, { maxFileBytes: number; totalBytes: number }> = {
  supabase: { maxFileBytes: 50 * 1024 * 1024, totalBytes: 1024 * 1024 * 1024 },
  r2: { maxFileBytes: 250 * 1024 * 1024, totalBytes: 10 * 1024 * 1024 * 1024 },
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
};

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
};
