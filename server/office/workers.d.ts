// The few Workers types that the office object uses (Supabase exit, wave 1). The repo has no @cloudflare/workers-types; these
// follow the Durable Object storage API on developers.cloudflare.com (read 2026-10-17). test:office checks them on workerd.
declare module 'cloudflare:workers' {
  export interface SqlStorageCursor<T = Record<string, string | number | null | ArrayBuffer>> {
    toArray(): T[];
    readonly rowsRead: number;
    readonly rowsWritten: number;
  }
  export interface SqlStorage {
    exec<T = Record<string, string | number | null | ArrayBuffer>>(query: string, ...bindings: unknown[]): SqlStorageCursor<T>;
    readonly databaseSize: number;
  }
  export interface DurableObjectStorage {
    readonly sql: SqlStorage;
    transaction<T>(closure: () => Promise<T>): Promise<T>;
    transactionSync<T>(closure: () => T): T;
  }
  export interface DurableObjectState {
    readonly storage: DurableObjectStorage;
    blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
  }
  /** A class whose methods a stub can call over Workers RPC (developers.cloudflare.com, Workers RPC). */
  export abstract class RpcTarget {
    constructor();
  }
  export abstract class DurableObject<Env = unknown> {
    protected readonly ctx: DurableObjectState;
    protected readonly env: Env;
    constructor(ctx: DurableObjectState, env: Env);
  }
}
