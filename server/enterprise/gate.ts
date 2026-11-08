import { ApiError } from '../../src/api/errors';
import type { RunError } from '../core/types';
import type { LiteDb } from '../data/lite/db';
import { runErrorOf } from '../http/errors';
import { isEnterpriseId, type EnterpriseId } from './ids';
import type { EnterpriseLimits, EnterpriseState } from './types';

/**
 * The identity of one enterprise object (Madar enterprises, design 5.1 and 5.2). The object keeps one row (the table enterprise) with its
 * id, its state and its limits, and refuses every call that names another id. The refusal of a wrong id has the same text as a bad
 * token, with no reason, so it tells a stranger nothing. A paused object refuses every call that does not allow a paused object.
 */

export type EnterpriseObjectRow = { id: EnterpriseId; state: EnterpriseState; limits: EnterpriseLimits; createdAt: string };
type RawRow = { id: string; state: string; limits: string; created_at: string };

const SELECT = 'select id, state, limits, created_at from enterprise limit 1';

function noObject(): RunError {
  return runErrorOf(new ApiError('not_found', 'This address does not exist.'));
}

function wrongEnterprise(): RunError {
  return runErrorOf(new ApiError('unauthenticated', 'Sign in to continue.'));
}

function paused(): RunError {
  return runErrorOf(new ApiError('forbidden', 'Madar is paused for this company.', { reason: 'enterprise_paused' }));
}

function rowOf(raw: RawRow): EnterpriseObjectRow {
  return { id: raw.id, state: raw.state as EnterpriseState, limits: JSON.parse(raw.limits) as EnterpriseLimits, createdAt: raw.created_at };
}

export class EnterpriseGate {
  #row: EnterpriseObjectRow | null | undefined;

  /** name: the name of the object (ctx.id.name, spike S3). When it is set and differs from the row, every call is refused. */
  constructor(private readonly db: Pick<LiteDb, 'statement' | 'tx'>, private readonly o: { name?: () => string | undefined } = {}) {}

  /** The row of this object, read once and kept in memory. undefined: the object was never made. */
  async load(): Promise<EnterpriseObjectRow | undefined> {
    if (this.#row === undefined) {
      const [raw] = await this.db.statement<RawRow>('read', SELECT);
      this.#row = raw ? rowOf(raw) : null;
    }
    return this.#row ?? undefined;
  }

  /** The id of this object. It throws before load found a row, so a code path that skipped the gate fails loud. */
  id(): EnterpriseId {
    if (!this.#row) throw new Error('The enterprise gate has not loaded a row.');
    return this.#row.id;
  }

  /** The row in memory, with no read. undefined before load, or when the object has no row. */
  current(): EnterpriseObjectRow | undefined {
    return this.#row ?? undefined;
  }

  /** Drops the row in memory, so the next load reads it again (after setState or setLimits). */
  forget(): void {
    this.#row = undefined;
  }

  /** The refusal for the id that a call names, or undefined when the call may run. */
  async refusal(ent: unknown, o: { allow?: 'paused' } = {}): Promise<RunError | undefined> {
    const row = await this.load();
    if (!row) return noObject();
    if (!isEnterpriseId(ent) || ent !== row.id) return wrongEnterprise();
    const name = this.o.name?.();
    if (name !== undefined && name !== row.id) return wrongEnterprise();
    if (row.state === 'paused' && o.allow !== 'paused') return paused();
    return undefined;
  }

  /** Makes the row once. The same id again changes nothing; another id throws conflict. */
  async create(row: { id: EnterpriseId; state: EnterpriseState; limits: EnterpriseLimits; now: Date }): Promise<void> {
    if (!isEnterpriseId(row.id)) throw new ApiError('invalid_input', 'This is not an enterprise id.');
    await this.db.tx('write', async (q) => {
      const [found] = await q<RawRow>(SELECT);
      if (found) {
        if (found.id !== row.id) throw new ApiError('conflict', 'This object belongs to another enterprise.');
        return;
      }
      await q('insert into enterprise (id, state, limits, created_at) values (?1, ?2, ?3, ?4)', [row.id, row.state, JSON.stringify(row.limits), row.now.toISOString()]);
    });
    this.#row = undefined;
    await this.load();
  }
}
