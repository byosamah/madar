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
    acceptWebSocket(socket: WebSocket, tags?: string[]): void;
    getWebSockets(tag?: string): WebSocket[];
    setWebSocketAutoResponse(pair?: WebSocketRequestResponsePair): void;
    getWebSocketAutoResponseTimestamp(socket: WebSocket): Date | null;
    getTags(socket: WebSocket): string[];
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

/** The WebSocket globals of workerd that the office object uses (developers.cloudflare.com, Durable Object State, 2026-10-17). */
declare class WebSocketPair {
  0: WebSocket;
  1: WebSocket;
}
declare class WebSocketRequestResponsePair {
  constructor(request: string, response: string);
}
