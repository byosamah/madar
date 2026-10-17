import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TABLES } from '../../server/data/tables';
import type { ExportManifest } from '../backup/officeExport';
import { canonical, compareDigests, digestOf, recordDigest, type TableDigest } from './digest';
import type { OfficeSource } from './source';

/**
 * The count and hash check of each table after an import (spec section 4, step 6): the source against an export of the office
 * object. Records compare by id and doc; the server rows compare by their values, in the forms that both sides give. A
 * difference stops the switch.
 */

type Line = Record<string, unknown>;
const sorted = (lines: Line[]): TableDigest => digestOf(lines.map(canonical).sort());
const bool = (value: unknown): number => (value === true || value === 1 || value === '1' ? 1 : 0);

function readTable(folder: string, table: string): Record<string, unknown>[] {
  return readFileSync(join(folder, 'tables', `${table}.ndjson`), 'utf8').split('\n').filter((line) => line !== '').map((line) => JSON.parse(line) as Record<string, unknown>);
}

export function sourceDigests(source: OfficeSource): Record<string, TableDigest> {
  const out: Record<string, TableDigest> = {};
  for (const table of source.tables) out[table.table] = recordDigest(table.rows);
  out.counters = sorted(source.server.counters.map((c) => ({ prefix: c.prefix, n: c.n })));
  out.person_seq = sorted(source.server.personSeq.map((p) => ({ user_id: p.user_id, seq: p.seq })));
  out.office_seq = digestOf([String(source.server.officeSeq)]);
  out.job_runs = sorted(source.server.jobRuns.map((j) => ({ key: j.key, done_at: j.done_at })));
  out.usage_month = sorted(source.server.usageMonth.map((u) => ({ month: u.month, calls: u.calls, bytes_read: u.bytes_read })));
  out.mail_log = sorted(source.server.mailLog.map((m) => ({ utc_day: m.utc_day, ref: m.ref })));
  // The rule of importSigninRows: a link to a person who is not in the office stays out.
  out.auth_users = sorted(source.signin.map((s) => ({
    id: s.id, email: s.email.trim().toLowerCase(), password_hash: s.password_hash, user_id: s.user_id !== null && source.users.has(s.user_id) ? s.user_id : null,
    banned: bool(s.banned), password_set: bool(s.password_set), email_confirmed: bool(s.email_confirmed),
  })));
  return out;
}

/** The same digests from an export folder of an office object. The mail log counts only the days of the source. */
export function exportDigests(folder: string, o: { days: readonly string[] }): Record<string, TableDigest> {
  const manifest = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8')) as ExportManifest;
  const out: Record<string, TableDigest> = {};
  for (const spec of TABLES) out[spec.table] = recordDigest(readTable(folder, spec.table).map((r) => ({ id: String(r.id), doc: r.doc })));
  out.counters = sorted(readTable(folder, 'counters').map((r) => ({ prefix: r.prefix, n: Number(r.n) })));
  out.person_seq = sorted(readTable(folder, 'person_seq').map((r) => ({ user_id: r.user_id, seq: Number(r.seq) })));
  out.office_seq = digestOf([String(manifest.officeSeq)]);
  out.job_runs = sorted(readTable(folder, 'job_runs').map((r) => ({ key: r.key, done_at: r.done_at })));
  out.usage_month = sorted(readTable(folder, 'usage_month').map((r) => ({ month: r.month, calls: Number(r.calls), bytes_read: Number(r.bytes_read) })));
  out.mail_log = sorted(readTable(folder, 'mail_log').filter((r) => o.days.includes(String(r.utc_day))).map((r) => ({ utc_day: r.utc_day, ref: r.ref })));
  out.auth_users = sorted(readTable(folder, 'auth_users').map((r) => ({
    id: r.id, email: r.email, password_hash: r.password_hash ?? null, user_id: r.user_id ?? null, banned: bool(r.banned), password_set: bool(r.password_set),
    email_confirmed: bool(r.email_confirmed),
  })));
  return out;
}

export function compareImport(source: OfficeSource, folder: string): { problems: string[]; notes: string[] } {
  const days = [...new Set(source.server.mailLog.map((m) => m.utc_day))];
  // usage_month holds the meter of the import itself too (the finish adds its requests): a difference there is a note.
  return compareDigests(sourceDigests(source), exportDigests(folder, { days }), { notes: ['usage_month'] });
}
