import { DatabaseSync } from 'node:sqlite';
import type { State } from '../../../src/api/store';
import type { WireEntry, WireResponse } from '../../../src/api/remote/wire';
import { buildSeed } from '../../../src/data/seed';
import { resolveActor } from '../../core/actor';
import { nodeHost } from '../../data/lite/host';
import { applyLiteSchema } from '../../data/lite/schema';
import { liteWriteState } from '../../data/lite/whole';
import { daftraDeps, type FakeDaftra } from '../../daftra/fakeDaftra';
import { fakeGoogle, type FakeGoogle } from '../../google/fakeGoogle';
import { GOOGLE_CONFIG } from '../../google/testOffice';
import { fixedClock, type FixedClock } from '../../test/fakes/clock';
import { daftraRequest, googleRequest, type NetHttpRequest } from '../net';
import { officeParts, type OfficeCronReport, type OfficeEffectsReport, type OfficeParts } from '../parts';
import { principalOfWho } from '../who';
import { fakeSockets, recordingNet } from './fakes';
import { NODE_OFFICE_ENV } from './nodeOffice';

/**
 * For tests only: the office object parts on node:sqlite with Google and Daftra behind the network port. The object makes no network call
 * itself. So here the port answers like the Worker does (`googleRequest` and `daftraRequest` of server/office/net.ts), and the fakes of
 * Google and Daftra answer behind it. `openAtCall` keeps, for each outside request, whether a transaction was open at that time (it must
 * never be). `net.calls` keeps `google <METHOD> <url>` and `daftra GET <url>` for each request.
 */

export type OutsideOptions = {
  /** False: the Worker holds no Google values. */
  google?: boolean;
  /** The Daftra accounts of the Worker, one fake for each account. */
  daftra?: FakeDaftra[];
  /** Changes the sample office before it is saved. */
  edit?: (seed: State) => void;
  /** The start time. The sample office is made for this day. */
  at?: string;
};

export async function outsideOffice(o: OutsideOptions = {}) {
  const at = o.at ?? '2026-10-21T06:00:00Z';
  const fakes = o.daftra ?? [];
  const google: FakeGoogle = fakeGoogle({ clientId: GOOGLE_CONFIG.clientId, clientSecret: GOOGLE_CONFIG.clientSecret });
  const env: Record<string, string> = { ...NODE_OFFICE_ENV };
  if (o.google !== false) {
    env.GOOGLE_CLIENT_ID = GOOGLE_CONFIG.clientId;
    env.GOOGLE_CLIENT_SECRET = GOOGLE_CONFIG.clientSecret;
    env.MADAR_GOOGLE_KEY = GOOGLE_CONFIG.key;
  }
  for (const fake of fakes) {
    env[`DAFTRA_${fake.account}_KEY`] = fake.apiKey;
    env[`DAFTRA_${fake.account}_SITE`] = fake.site;
  }
  // serverEnvFrom reads the Daftra accounts by name, so the reader lists its names.
  const read = Object.assign((name: string) => env[name], { names: () => Object.keys(env) });

  const raw = new DatabaseSync(':memory:');
  const host = Object.assign(nodeHost(raw), { totals: { rowsRead: 0, rowsWritten: 0 } });
  await applyLiteSchema(host);
  const clock: FixedClock = fixedClock(at);
  const lines: string[] = [];
  const keep = (level: string) => (message: string, fields?: Record<string, unknown>) => void lines.push(`${level} ${message}${fields ? ` ${JSON.stringify(fields)}` : ''}`);
  const parts: OfficeParts = officeParts({
    host, read, sockets: fakeSockets(), clock, log: { info: keep('info'), warn: keep('warn'), error: keep('error') },
    // The token of a browser batch is the user id itself; an agent goes through the real rule.
    principal: (who, snapshot) => {
      if (who.kind !== 'browser') return principalOfWho(who, snapshot);
      const principal = { userId: who.authUserId };
      resolveActor(snapshot, principal);
      return principal;
    },
  });
  const seed = await buildSeed(at.slice(0, 10), async () => undefined);
  o.edit?.(seed);
  await parts.db.tx('write', (q) => liteWriteState(q, seed));

  const openAtCall: boolean[] = [];
  const daftraSites = daftraDeps(...fakes);
  /** The fetch behind the Worker: it notes the state of the database, then sends the request to the fake of its host. */
  const routed: typeof globalThis.fetch = async (input, init) => {
    openAtCall.push(parts.db.isOpen());
    const url = new URL(String(input));
    if (url.hostname.endsWith('googleapis.com')) return google.fetch(input, init);
    return daftraSites.daftraFetch!(input, init);
  };
  const toGoogle = googleRequest(routed);
  const toDaftra = daftraRequest(Object.fromEntries(fakes.map((fake) => [fake.account, fake.config])), routed);
  const base = recordingNet();
  const net = Object.assign(base, {
    googleFetch: (req: NetHttpRequest) => (base.calls.push(`google ${req.method} ${req.url}`), toGoogle(req)),
    daftraGet: (req: { url: string }) => (base.calls.push(`daftra GET ${req.url}`), toDaftra(req)),
  });

  return {
    raw, parts, net, clock, lines, google, daftra: fakes, openAtCall,
    /** One batch of a person (the token is the user id). `later` holds the rows that run after the answer. */
    async batch(userId: string, calls: { name: string; input: unknown }[]): Promise<{ results: WireEntry[]; later: string[] }> {
      const out = await parts.batch({ who: { kind: 'browser', authUserId: userId }, calls: calls.map((call, i) => ({ i, ...call })), overviewCalls: 0, worker: 1 }, net);
      if (!out.ok) throw new Error(`The batch was refused: ${JSON.stringify(out.error)}`);
      return { results: (JSON.parse(out.body) as WireResponse).results, later: out.later };
    },
    /** One person starts the connect and finishes it with the code of the fake Google. */
    async connect(userId: string, code?: string): Promise<{ results: WireEntry[]; later: string[] }> {
      const start = await this.batch(userId, [{ name: 'google.connectStart', input: {} }]);
      const first = start.results[0];
      if (!first.ok) return start;
      const url = new URL((first.output as { url: string }).url);
      google.state.challenge = url.searchParams.get('code_challenge') ?? undefined;
      return this.batch(userId, [{ name: 'google.connect', input: { code: code ?? google.state.code, state: url.searchParams.get('state') } }]);
    },
    effects: (ids: string[]): Promise<OfficeEffectsReport> => parts.runEffects({ ids, worker: 1 }, net),
    cron: (when: Date): Promise<OfficeCronReport> => parts.cron({ at: when.toISOString(), worker: 0 }, net),
    rows: (text: string, values: unknown[] = []) => parts.db.statement('read', text, values) as Promise<Record<string, unknown>[]>,
  };
}

export type OutsideOffice = Awaited<ReturnType<typeof outsideOffice>>;
