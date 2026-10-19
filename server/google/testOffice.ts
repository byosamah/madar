import type { Deps } from '../core/ports';
import { createRunCall } from '../core/runCall';
import type { RunResult } from '../core/types';
import { liteData } from '../data/lite/callData';
import { signinOffice, type TestOffice } from '../auth/own/testOffice';
import { fakeGoogle, type FakeGoogle } from './fakeGoogle';
import { googleKeysOf } from './keys';
import { readState } from './state';

/**
 * A test office for the Google Calendar tests (fbk_022), for tests only: the sample office on node:sqlite (as signinOffice), Google
 * switched on with made-up values, and fakeGoogle behind deps.googleFetch, so no test reaches Google. `call` runs a call as a
 * person; `callAs` runs one with any principal (an agent) and an idempotency key.
 */

export const GOOGLE_KEY = Buffer.alloc(32, 11).toString('base64');
export const GOOGLE_CONFIG = { clientId: 'id-made-up.apps.googleusercontent.com', clientSecret: 'cs-SECRET', key: GOOGLE_KEY };
export const APP_URL = 'https://madar.example';
export const AT = '2026-10-21T06:00:00Z';

export type GoogleOffice = TestOffice & {
  google: FakeGoogle;
  callAs(principal: { userId: string; agent?: { clientId: string } }, name: string, input: unknown, key?: string): Promise<RunResult>;
  /** One person starts the connect and finishes it with the code of fakeGoogle. */
  connect(userId: string, code?: string): Promise<RunResult>;
};

export async function googleOffice(o: { google?: boolean; at?: string; fake?: Parameters<typeof fakeGoogle>[0] } = {}): Promise<GoogleOffice> {
  const config = o.google === false ? { appUrl: APP_URL } : { appUrl: APP_URL, google: GOOGLE_CONFIG };
  const t = await signinOffice({ at: o.at ?? AT, config });
  const google = fakeGoogle({ clientId: GOOGLE_CONFIG.clientId, clientSecret: GOOGLE_CONFIG.clientSecret, ...(o.fake ?? {}) });
  t.deps.googleFetch = google.fetch;
  const run = createRunCall({ data: liteData });
  const callAs: GoogleOffice['callAs'] = (principal, name, input, key) =>
    run(t.deps as unknown as Deps, { principal, name, input, ...(key ? { key } : {}), batch: { storyRefs: new Map(), overviewCalls: 0 } });
  return {
    ...t,
    google,
    callAs,
    async connect(userId, code) {
      const start = await t.call(userId, 'google.connectStart', {});
      if (!start.ok) return start;
      const url = new URL((start.output as { url: string }).url);
      google.state.challenge = url.searchParams.get('code_challenge') ?? undefined;
      return t.call(userId, 'google.connect', { code: code ?? google.state.code, state: url.searchParams.get('state') });
    },
  };
}

/** The person that a state names, read with the key of the test office. */
export async function stateOwner(state: string, now: Date): Promise<string | undefined> {
  const read = await readState(await googleKeysOf(GOOGLE_KEY), state, now);
  return read.ok ? read.userId : undefined;
}

/** The outbox rows of a kind, with their payloads. */
export async function outboxRows(t: TestOffice, kind: string): Promise<{ id: number; payload: Record<string, unknown>; done: boolean; error: string | null }[]> {
  const rows = (await t.db.statement('read', 'select id, payload, done_at, error from outbox where kind = ?1 order by id', [kind])) as { id: number; payload: Record<string, unknown>; done_at: string | null; error: string | null }[];
  return rows.map((row) => ({ id: row.id, payload: row.payload, done: row.done_at !== null, error: row.error }));
}

export const PLAN = { kind: 'meeting', title: 'Kickoff', where: 'Meeting room' } as const;
export const planMeeting = async (t: TestOffice, userId: string, input: Record<string, unknown>) => {
  const result = await t.call(userId, 'meetings.create', { ...PLAN, ...input });
  if (!result.ok) throw new Error(`meetings.create failed: ${JSON.stringify(result.error)}`);
  return (result.output as { id: string }).id;
};
