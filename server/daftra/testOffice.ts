import type { SubCompany } from '../../src/api/contract/entities';
import { nextId, subCompaniesOf, type State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { liteAuthAdmin } from '../auth/own/liteAdmin';
import type { Deps } from '../core/ports';
import { createRunCall, type RunCall } from '../core/runCall';
import type { RunResult } from '../core/types';
import { liteData } from '../data/lite/callData';
import { freshLite } from '../data/lite/testDb';
import { liteWriteState } from '../data/lite/whole';
import { daftra as daftraStep, type DaftraReport, type DaftraStepOptions } from '../jobs/steps/daftra';
import { fakeDeps } from '../test/fakes/deps';
import { daftraDeps, type FakeDaftra } from './fakeDaftra';
import { DAFTRA_INTERNAL_CALLS } from './paidCall';

/**
 * A test office for the Daftra tests (the Daftra link), for tests only: the sample office on node:sqlite with runCall on liteData, the Daftra
 * accounts of the fakes in the config, and the fakes behind `deps.daftraFetch`, so no test reaches Daftra. The step runs with `onOffice`.
 *
 * The seed gets three sub-companies and four projects with a sub-company:
 *   sub_001 MAZJ    prj_001 (client cli_001, payment pay_003: 320,000, due 2026-10-14)
 *   sub_002 Vado    prj_002 (client cli_002, payment pay_006: 120,000, due 2026-10-30)
 *   sub_003 Studio X (a sub-company that has no Daftra account in the test)    prj_006 (client cli_006, payment pay_011: 38,000, due 2026-10-29)
 *   prj_003 has no sub-company (payment pay_009: 110,000, due 2026-11-20)
 * People: usr_001 Admin, usr_011 Accounting (holds Link Daftra invoices), usr_010 Management and usr_003 Member (do not), usr_009 an agent of usr_001.
 */

export const AT = '2026-10-26T06:00:00Z';

export type DaftraOffice = Awaited<ReturnType<typeof daftraOffice>>;

export async function daftraOffice(o: { at?: string; fakes?: FakeDaftra[]; edit?: (seed: State) => void } = {}) {
  const at = o.at ?? AT;
  const { raw, db } = await freshLite();
  const seed = await buildSeed(at.slice(0, 10), async () => undefined);
  const make = (name: string): string => {
    const id = nextId(seed, 'sub');
    const row: SubCompany = { id, name, nameAr: name, logo: null, createdBy: 'usr_001', createdAt: '2026-09-01T09:00:00.000+03:00' };
    subCompaniesOf(seed)[id] = row;
    return id;
  };
  const [mazj, vado, studio] = [make('MAZJ'), make('Vado'), make('Studio X')];
  seed.projects.prj_001.subCompanyId = mazj;
  seed.projects.prj_002.subCompanyId = vado;
  seed.projects.prj_006.subCompanyId = studio;
  o.edit?.(seed);
  await db.tx('write', (q) => liteWriteState(q, seed));
  const fakes = o.fakes ?? [];
  const base = fakeDeps({ db });
  base.clock.set(new Date(at));
  const wired = fakes.length > 0 ? daftraDeps(...fakes) : { config: base.config, daftraFetch: undefined };
  const deps = { ...base, authAdmin: liteAuthAdmin({ db, clock: base.clock }), config: { ...base.config, ...(fakes.length > 0 ? { daftra: wired.config.daftra } : {}) } };
  if (wired.daftraFetch) (deps as { daftraFetch?: typeof globalThis.fetch }).daftraFetch = wired.daftraFetch;
  const run = createRunCall({ data: liteData });
  const batch = () => ({ storyRefs: new Map<string, string>(), overviewCalls: 0 });
  const internal: RunCall = createRunCall({ calls: DAFTRA_INTERNAL_CALLS, data: liteData });
  const asDeps = deps as unknown as Deps;
  return {
    raw, db, deps, seed, fakes,
    call: (actorId: string, name: string, input: unknown): Promise<RunResult> => run(asDeps, { principal: { userId: actorId }, name, input, batch: batch() }),
    callAs: (principal: { userId: string; agent?: { clientId: string } }, name: string, input: unknown): Promise<RunResult> =>
      run(asDeps, { principal, name, input, batch: batch() }),
    /** The same run on the private map of the job step. */
    internal,
    /** One run of the daftra step, on the SQLite data. */
    step: (extra: DaftraStepOptions = {}, when: Date = deps.clock.now()): Promise<DaftraReport> =>
      daftraStep(asDeps, when, { onOffice: true, run: internal, ...extra }),
    /** The stored document of a payment. */
    payment: async (id: string) => ((await db.statement('read', 'select doc from payments where id = ?1', [id])) as { doc: Record<string, unknown> }[])[0]?.doc,
    /** Every log line of the deps as one text, for the leak checks. */
    logText: () => JSON.stringify(deps.logs),
    ids: { mazj, vado, studio },
  };
}

/** The output of a call that must have worked. */
export function okOf(result: RunResult): Record<string, unknown> {
  if (!result.ok) throw new Error(`The call failed: ${JSON.stringify(result.error)}`);
  return result.output as Record<string, unknown>;
}
