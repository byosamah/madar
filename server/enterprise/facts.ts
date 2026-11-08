import type { LiteDb } from '../data/lite/db';
import type { EnterpriseId } from './ids';
import type { EnterpriseLimits, EnterpriseState } from './types';

/**
 * The facts of the enterprise of one office object, in memory (Madar enterprises, plan C): its id, state and limits (from the table
 * enterprise) and its platform owners (from enterprise_use). A hook or a call reads them with no query. The object keeps them in step: the
 * methods setState, setLimits and setPlatformOwners call set, and a change of the identity row calls load again. With no row, id() is
 * undefined, the state is active and the limits are null (no limit), so a test office with no enterprise is not limited.
 */

export type EnterpriseFactsRows = { id: EnterpriseId; state: EnterpriseState; limits: EnterpriseLimits };
type RawIdentity = { id: string; state: string; limits: string };
type RawUse = { owners: string };

const NO_LIMITS: EnterpriseLimits = { people: null, storageBytes: null };

function limitsOf(text: string): EnterpriseLimits {
  try {
    const value = JSON.parse(text) as Partial<EnterpriseLimits>;
    const one = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null);
    return { people: one(value.people), storageBytes: one(value.storageBytes) };
  } catch {
    return { ...NO_LIMITS };
  }
}

function ownersOf(text: string): string[] {
  try {
    const value = JSON.parse(text) as unknown;
    return Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : [];
  } catch {
    return [];
  }
}

export class EnterpriseFacts {
  #id: EnterpriseId | undefined;
  #state: EnterpriseState = 'active';
  #limits: EnterpriseLimits = { ...NO_LIMITS };
  #owners: ReadonlySet<string> = new Set();
  #loaded = false;

  /**
   * Reads enterprise_use, and the identity row unless the caller has it already (the gate of the object keeps that row in memory, so the
   * cold start of the object reads it once).
   */
  async load(db: Pick<LiteDb, 'statement'>, identity?: EnterpriseFactsRows | null): Promise<void> {
    let row: EnterpriseFactsRows | null | undefined = identity;
    if (row === undefined) {
      const [raw] = await db.statement<RawIdentity>('read', 'select id, state, limits from enterprise limit 1');
      row = raw ? { id: raw.id, state: raw.state as EnterpriseState, limits: limitsOf(raw.limits) } : null;
    }
    const [use] = await db.statement<RawUse>('read', 'select owners from enterprise_use where id = 1');
    this.#id = row?.id;
    this.#state = row?.state ?? 'active';
    this.#limits = row?.limits ?? { ...NO_LIMITS };
    this.#owners = new Set(ownersOf(use?.owners ?? '[]'));
    this.#loaded = true;
  }

  /** True after a load. A change of the identity row calls forget, and the next call of the object loads again. */
  loaded(): boolean {
    return this.#loaded;
  }

  forget(): void {
    this.#loaded = false;
  }

  id(): EnterpriseId | undefined {
    return this.#id;
  }

  state(): EnterpriseState {
    return this.#state;
  }

  limits(): EnterpriseLimits {
    return this.#limits;
  }

  owners(): ReadonlySet<string> {
    return this.#owners;
  }

  set(change: { state?: EnterpriseState; limits?: EnterpriseLimits; owners?: string[] }): void {
    if (change.state !== undefined) this.#state = change.state;
    if (change.limits !== undefined) this.#limits = { ...change.limits };
    if (change.owners !== undefined) this.#owners = new Set(change.owners);
  }
}
