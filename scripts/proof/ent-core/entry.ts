import { DurableObject } from 'cloudflare:workers';
import { runSigninOp } from '../../../server/auth/own/office';
import { liteDb } from '../../../server/data/lite/db';
import { applyLiteSchema } from '../../../server/data/lite/schema';
import { doHost } from '../../../server/office/doHost';
import { PinOffice } from '../../../server/office/test/pinOffice';
import { fakeDeps } from '../../../server/test/fakes/deps';

export { PinOffice };

type Namespace = { idFromName(name: string): unknown; newUniqueId(): unknown; get(id: unknown): { fetch(request: Request): Promise<Response> } };
type Env = { PIN: Namespace; DIR: Namespace; NAME: Namespace };

/**
 * Spike S2: the platform directory. One table, one primary-key read. The numbers are the rows that one request reads and writes,
 * the schema check of a new instance included (as the rows pins count a cold wake).
 */
export class ProbeDirectory extends DurableObject {
  #host?: ReturnType<typeof doHost>;
  #full = false;

  #ready() {
    if (!this.#host) {
      this.#host = doHost(this.ctx.storage);
      this.#host.exec('create table if not exists directory (email text primary key, ent text not null)', []);
    }
    return this.#host;
  }

  /** The rows of one request: the work, with the schema check of a new instance. */
  #measured<T>(work: (host: ReturnType<typeof doHost>) => T): { value: T; rowsRead: number; rowsWritten: number } {
    const before = this.#host ? { ...this.#host.totals } : { rowsRead: 0, rowsWritten: 0 };
    const host = this.#ready();
    const value = work(host);
    return { value, rowsRead: host.totals.rowsRead - before.rowsRead, rowsWritten: host.totals.rowsWritten - before.rowsWritten };
  }

  put(email: string, ent: string) {
    return this.#measured((host) => host.exec('insert into directory (email, ent) values (?1, ?2) on conflict (email) do update set ent = excluded.ent', [email, ent]));
  }

  resolve(email: string) {
    const out = this.#measured((host) => host.exec('select ent from directory where email = ?1', [email]).rows);
    return { ent: out.value[0]?.ent ?? null, rowsRead: out.rowsRead, rowsWritten: out.rowsWritten };
  }

  /** An unknown email on empty sign-in tables: the real step runs, with keys that throw when read. */
  async refuse(email: string, password: string) {
    const host = this.#ready();
    if (!this.#full) {
      await applyLiteSchema(host);
      this.#full = true;
    }
    const deps = fakeDeps({ db: liteDb(host) });
    const keys = new Proxy({}, { get: () => { throw new Error('The keys were read.'); } }) as never;
    const t = Date.now();
    const answer = await runSigninOp({ db: deps.db, clock: deps.clock, log: deps.log, config: deps.config, keys }, 'auth.password', { email, password, address: '203.0.113.9' });
    return { answer, ms: Date.now() - t };
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const email = url.searchParams.get('email') ?? '';
    if (url.pathname === '/put') return Response.json(this.put(email, url.searchParams.get('ent') ?? 'ent_001'));
    if (url.pathname === '/resolve') return Response.json(this.resolve(email));
    if (url.pathname === '/refuse') return Response.json(await this.refuse(email, url.searchParams.get('password') ?? 'x'));
    return new Response('not found', { status: 404 });
  }
}

/** Spike S3: does an object know its own name? The constructor and a method both report ctx.id.name. */
export class ProbeName extends DurableObject {
  #ctor: string | undefined;

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    this.#ctor = ctx.id.name;
  }

  async fetch(): Promise<Response> {
    return Response.json({ ctor: this.#ctor ?? null, method: this.ctx.id.name ?? null });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const name = url.searchParams.get('name') ?? 'one';
    const klass = url.searchParams.get('o') ?? 'PinOffice';
    const space = klass === 'ProbeDirectory' ? env.DIR : klass === 'ProbeName' ? env.NAME : env.PIN;
    const id = url.searchParams.get('unique') === '1' ? space.newUniqueId() : space.idFromName(name);
    return space.get(id).fetch(request);
  },
};
