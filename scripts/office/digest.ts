import { createHash } from 'node:crypto';

/**
 * The count and hash check of each table (Supabase exit, wave 4; spec section 4, step 6). A row digest hashes the full rows of an
 * export in rowid order: a restore must give the same bytes. A record digest hashes the id and the parsed doc of each record,
 * sorted by id: Postgres and the office object then give the same digest, although their key columns and JSON text differ.
 */

export type TableDigest = { rows: number; sha256: string };

/** JSON with the keys of each object sorted, at every depth. An undefined value leaves its key out, as JSON.stringify does. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => (item === undefined ? 'null' : canonical(item))).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
}

/** The count and the sha256 of the lines, each one with its newline. */
export function digestOf(lines: readonly string[]): TableDigest {
  const hash = createHash('sha256');
  for (const line of lines) hash.update(`${line}\n`);
  return { rows: lines.length, sha256: hash.digest('hex') };
}

/** The row digest one row at a time, so a client never holds a whole table (an export of the year office). */
export function rowDigester(): { add(row: Record<string, unknown>): void; done(): TableDigest } {
  const hash = createHash('sha256');
  let rows = 0;
  return {
    add(row) {
      hash.update(`${canonical(row)}\n`);
      rows += 1;
    },
    done: () => ({ rows, sha256: hash.digest('hex') }),
  };
}

/** The digest of the full rows, in the order given (the rowid order of an export). */
export function rowDigest(rows: readonly Record<string, unknown>[]): TableDigest {
  return digestOf(rows.map(canonical));
}

/** The digest of the id and the parsed doc of each record, sorted by id: a doc as JSON text and as an object give one digest. */
export function recordDigest(rows: readonly { id: string; doc: unknown }[]): TableDigest {
  const lines = rows.map((row) => `${row.id}\t${canonical(typeof row.doc === 'string' ? JSON.parse(row.doc) : row.doc)}`);
  lines.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return digestOf(lines);
}

/**
 * The tables whose digests differ, by name. A table in notes (a drift table of an export) gives a note, never a problem; a table
 * in skip is left out (a table that each side makes for itself).
 */
export function compareDigests(
  want: Readonly<Record<string, TableDigest>>,
  got: Readonly<Record<string, TableDigest>>,
  o: { notes?: readonly string[]; skip?: readonly string[] } = {},
): { problems: string[]; notes: string[] } {
  const problems: string[] = [];
  const notes: string[] = [];
  const names = [...new Set([...Object.keys(want), ...Object.keys(got)])].filter((name) => !o.skip?.includes(name)).sort();
  for (const name of names) {
    const a = want[name];
    const b = got[name];
    if (!b) {
      problems.push(`${name}: the source has it, the copy does not.`);
      continue;
    }
    if (!a) {
      problems.push(`${name}: the copy has it, the source does not.`);
      continue;
    }
    if (a.rows === b.rows && a.sha256 === b.sha256) continue;
    const text = a.rows !== b.rows ? `${name}: the source holds ${a.rows} rows, the copy holds ${b.rows}` : `${name}: the same ${a.rows} rows, another hash`;
    if (o.notes?.includes(name)) notes.push(`${text} (this table may change during an export).`);
    else problems.push(`${text}.`);
  }
  return { problems, notes };
}
