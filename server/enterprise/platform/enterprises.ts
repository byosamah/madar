import { ApiError } from '../../../src/api/errors';
import type { LiteDb } from '../../data/lite/db';
import { isAddressName, isEnterpriseId, normalizeEmail, type EnterpriseId } from '../ids';
import type { EnterpriseLimits, EnterpriseRow, EnterpriseState, EnterpriseStatus } from '../types';
import type { CreateRowAnswer, CreateRowInput, EnterpriseListRow } from './stub';

/**
 * The rows of the enterprises in the platform object (Madar enterprises, plan C): the list for the platform page, the create step, and the
 * changes of the name, the logo, the limits and the state. The platform object holds no record of an enterprise, and these rows hold no
 * person data except the name and the email of the first Admin that the owner typed.
 */

type Raw = {
  id: string; address: string; state: string; name: string; name_ar: string; limits: string; created_at: string; first_admin: string; logo: string | null;
  status_doc: string | null;
};

const SELECT =
  'select e.id, e.address, e.state, e.name, e.name_ar, e.limits, e.created_at, e.first_admin, e.logo, s.doc as status_doc '
  + 'from enterprises e left join status s on s.ent = e.id';

function parseOr<T>(text: string | null, fallback: T): T {
  if (text === null) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function listRowOf(raw: Raw): EnterpriseListRow {
  const status = parseOr<EnterpriseStatus | null>(raw.status_doc, null);
  // The names that the Cron reported come from the Settings of the enterprise, so they win when they are not empty.
  const name = status?.name ? status.name : raw.name;
  const nameAr = status?.nameAr ? status.nameAr : raw.name_ar;
  return {
    id: raw.id, address: raw.address, name, nameAr, state: raw.state as EnterpriseState,
    limits: parseOr<EnterpriseLimits>(raw.limits, { people: null, storageBytes: null }), createdAt: raw.created_at,
    firstAdmin: parseOr<{ name: string; email: string }>(raw.first_admin, { name: '', email: '' }), logo: raw.logo, status,
  };
}

export async function listEnterprises(db: LiteDb): Promise<EnterpriseListRow[]> {
  return (await db.statement<Raw>('read', `${SELECT} order by e.id`)).map(listRowOf);
}

export async function getEnterprise(db: LiteDb, ent: EnterpriseId): Promise<EnterpriseListRow | null> {
  const [raw] = await db.statement<Raw>('read', `${SELECT} where e.id = ?1`, [ent]);
  return raw ? listRowOf(raw) : null;
}

const numberOf = (id: string): number => Number(id.slice(4));

/** The id after the highest one, and at least ent_002 (ent_001 is VADOs' Companies). */
function nextId(ids: readonly string[]): EnterpriseId {
  const top = ids.reduce((max, id) => Math.max(max, numberOf(id)), 1);
  return `ent_${String(top + 1).padStart(3, '0')}`;
}

function rowOf(raw: Raw): EnterpriseRow {
  const { status: _status, logo: _logo, ...row } = listRowOf(raw);
  return row;
}

/**
 * One transaction. The same address with the same first Admin email in state creating is a repeat: it returns that row with fresh false.
 * Any other use of the address gives address_taken. A taken email gives email_taken and names nothing.
 */
export async function createEnterprise(db: LiteDb, input: CreateRowInput, now: Date): Promise<CreateRowAnswer> {
  if (!isAddressName(input.address)) throw new ApiError('invalid_input', 'Use 3 to 32 lower case letters, digits and hyphens, and not a reserved word.', { fields: ['address'] });
  const email = normalizeEmail(input.admin.email);
  return db.tx('write', async (q) => {
    const [same] = await q<Raw>(`${SELECT} where e.address = ?1`, [input.address]);
    if (same) {
      const admin = parseOr<{ email: string }>(same.first_admin, { email: '' });
      if (same.state !== 'creating' || normalizeEmail(admin.email) !== email) return { ok: false, refused: 'address_taken' } as const;
      // A repeat after a failed init: the email stays reserved for this row, the row stays as it is.
      return { ok: true, row: rowOf(same), fresh: false } as const;
    }
    const [taken] = await q<{ ent: string }>('select ent from emails where email = ?1', [email]);
    if (taken) return { ok: false, refused: 'email_taken' } as const;
    const ids = (await q<{ id: string }>('select id from enterprises')).map((one) => one.id);
    const id = nextId(ids);
    const firstAdmin = { name: input.admin.name, email };
    await q(
      'insert into enterprises (id, address, state, name, name_ar, limits, created_at, first_admin, logo) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)',
      [id, input.address, 'creating', input.name, input.nameAr, JSON.stringify(input.limits), now.toISOString(), JSON.stringify(firstAdmin), input.logo],
    );
    await q('insert into emails (email, ent) values (?1, ?2)', [email, id]);
    const row: EnterpriseRow = { id, address: input.address, name: input.name, nameAr: input.nameAr, state: 'creating', limits: input.limits, createdAt: now.toISOString(), firstAdmin };
    return { ok: true, row, fresh: true } as const;
  });
}

export async function activateEnterprise(db: LiteDb, ent: EnterpriseId): Promise<void> {
  await db.statement('write', "update enterprises set state = 'active' where id = ?1 and state = 'creating'", [entOf(ent)]);
}

export async function updateEnterprise(
  db: LiteDb, ent: EnterpriseId, patch: { name?: string; nameAr?: string; logo?: string | null; limits?: EnterpriseLimits },
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [entOf(ent)];
  const add = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = ?${values.length}`);
  };
  if (patch.name !== undefined) add('name', patch.name);
  if (patch.nameAr !== undefined) add('name_ar', patch.nameAr);
  if (patch.logo !== undefined) add('logo', patch.logo);
  if (patch.limits !== undefined) add('limits', JSON.stringify(patch.limits));
  if (sets.length === 0) return;
  await db.statement('write', `update enterprises set ${sets.join(', ')} where id = ?1`, values);
}

export async function setEnterpriseState(db: LiteDb, ent: EnterpriseId, state: 'active' | 'paused'): Promise<void> {
  await db.tx('write', async (q) => {
    const [row] = await q<{ state: string }>('select state from enterprises where id = ?1', [entOf(ent)]);
    if (!row) throw new ApiError('not_found', 'This address does not exist.');
    if (row.state === 'creating') throw new ApiError('conflict', 'Finish creating this enterprise first.', { reason: 'not_finished' });
    await q('update enterprises set state = ?2 where id = ?1', [ent, state]);
  });
}

export async function activeEnterpriseIds(db: LiteDb): Promise<EnterpriseId[]> {
  return (await db.statement<{ id: string }>('read', "select id from enterprises where state = 'active' order by id")).map((row) => row.id);
}

export async function ownersOfEnterprises(db: LiteDb): Promise<{ ent: EnterpriseId; userId: string }[]> {
  return (await db.statement<{ ent: string; user_id: string }>('read', 'select ent, user_id from owners order by ent, user_id')).map((row) => ({ ent: row.ent, userId: row.user_id }));
}

function entOf(value: unknown): EnterpriseId {
  if (!isEnterpriseId(value)) throw new ApiError('invalid_input', 'This is not an enterprise id.');
  return value;
}
