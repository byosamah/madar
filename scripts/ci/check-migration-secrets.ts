import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * No migration holds a secret (plan 6.1, rule 4). CI runs this on supabase/migrations:
 *   node scripts/ci/check-migration-secrets.ts [migrations folder]
 * It fails on vault.create_secret( or vault.update_secret( with a literal value: a quoted string, an E or U& string,
 * or a dollar-quoted string, also in brackets, by position or by name (new_secret => or the older new_secret :=). A value from a setting, a parameter or a variable passes, and so does a literal name or description.
 * It prints the file and the line of each finding, never the value, and it prints what it searched, so a search with no match is visible.
 */

export type Finding = { line: number; call: string };
export type CheckResult = { ok: boolean; lines: string[] };

/** The argument that holds the secret, by position (positional arguments come before named ones in Postgres). */
const SECRET_POSITION: Record<string, number> = { create_secret: 0, update_secret: 1 };
const CALL = /\b(create_secret|update_secret)\s*\(/gi;
const NAMED_SECRET = /^new_secret\s*(?:=>|:=)\s*/i;
const NAMED = /^[A-Za-z_][A-Za-z0-9_]*\s*(?:=>|:=)/;
/** A dollar-quote opener: $$ or $tag$. A tag never starts with a digit, so $1 is a parameter. */
const DOLLAR_TAG = /\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/y;

/** The dollar-quote tag that opens at `at`, or null. A $ after a name character is part of that name, not a tag. */
function dollarTagAt(sql: string, at: number): string | null {
  if (/[A-Za-z0-9_$]/.test(sql[at - 1] ?? '')) return null;
  DOLLAR_TAG.lastIndex = at;
  const match = DOLLAR_TAG.exec(sql);
  return match ? match[0] : null;
}

/**
 * The SQL with comments turned into spaces and the text inside single-quoted strings and quoted names turned into spaces.
 * The quotes stay, so a literal is still visible, and every newline stays, so line numbers hold.
 * Dollar-quoted text is mostly a function body, and the calls inside it count. So its body is masked as SQL of its own,
 * between the tags, and a quote in the body cannot reach past the closing tag.
 */
export function maskSql(sql: string): string {
  const out = sql.split('');
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    const tag = ch === '$' ? dollarTagAt(sql, i) : null;
    if (ch === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? sql.length : end;
      blank(i, stop);
      i = stop;
    } else if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (tag !== null) {
      const bodyStart = i + tag.length;
      const close = sql.indexOf(tag, bodyStart);
      const bodyEnd = close === -1 ? sql.length : close;
      const body = maskSql(sql.slice(bodyStart, bodyEnd));
      for (let k = 0; k < body.length; k++) out[bodyStart + k] = body[k];
      i = close === -1 ? sql.length : close + tag.length;
    } else if (ch === '"') {
      // A quoted name takes a doubled quote as one quote.
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === '"' && sql[j + 1] === '"') j += 2;
        else if (sql[j] === '"') break;
        else j++;
      }
      blank(i + 1, Math.min(j, sql.length));
      i = j + 1;
    } else if (ch === "'") {
      // An E string takes backslash escapes; every string takes a doubled quote as one quote.
      const escapes = /[eE]/.test(sql[i - 1] ?? '') && !/[A-Za-z0-9_]/.test(sql[i - 2] ?? '');
      let j = i + 1;
      while (j < sql.length) {
        if (escapes && sql[j] === '\\') j += 2;
        else if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
        else if (sql[j] === "'") break;
        else j++;
      }
      blank(i + 1, Math.min(j, sql.length));
      i = j + 1;
    } else {
      i++;
    }
  }
  return out.join('');
}

/** True when the argument text starts with a string literal, after any opening brackets. */
function isLiteral(text: string): boolean {
  const arg = text.replace(/^[\s(]+/, '');
  return /^(?:[eE]|[uU]&)?'/.test(arg) || /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.test(arg);
}

/** The top-level arguments of the call whose opening parenthesis is at `open`, from the masked SQL. */
function argumentsAt(masked: string, open: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = open + 1;
  for (let k = open; k < masked.length; k++) {
    const ch = masked[k];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) {
        args.push(masked.slice(start, k));
        break;
      }
    } else if (ch === ',' && depth === 1) {
      args.push(masked.slice(start, k));
      start = k + 1;
    }
  }
  return args.map((arg) => arg.trim()).filter((arg) => arg !== '');
}

/** Each create_secret or update_secret call with a literal secret value, by line (1-based). */
export function findLiteralSecrets(sql: string): Finding[] {
  const masked = maskSql(sql);
  const findings: Finding[] = [];
  for (const match of masked.matchAll(CALL)) {
    const call = match[1].toLowerCase();
    const args = argumentsAt(masked, match.index + match[0].length - 1);
    const named = args.find((arg) => NAMED_SECRET.test(arg));
    const positional = args.filter((arg) => !NAMED.test(arg));
    const value = named !== undefined ? named.replace(NAMED_SECRET, '') : positional[SECRET_POSITION[call]];
    if (value !== undefined && isLiteral(value)) {
      findings.push({ line: masked.slice(0, match.index).split('\n').length, call });
    }
  }
  return findings;
}

export function checkMigrationSecrets(dir: string): CheckResult {
  const files = existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.sql')).sort() : [];
  const lines = [
    `Searched ${files.length} ${files.length === 1 ? 'file' : 'files'} in ${dir} for create_secret( and update_secret( with a literal value.`,
  ];
  let ok = true;
  for (const name of files) {
    for (const finding of findLiteralSecrets(readFileSync(join(dir, name), 'utf8'))) {
      ok = false;
      lines.push(`${name}:${finding.line}: ${finding.call}( has a literal value. Set secrets at deploy time (scripts/deploy), never in a migration.`);
    }
  }
  return { ok, lines };
}

// Node does not resolve a symlink in process.argv[1], but import.meta.url is the real path. Compare real paths, so the
// check runs (and can fail) also when it is started through a symlink.
const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const dir = process.argv[2] ?? fileURLToPath(new URL('../../supabase/migrations', import.meta.url));
  const result = checkMigrationSecrets(dir);
  for (const line of result.lines) (result.ok ? console.log : console.error)(line);
  console.log(result.ok ? 'Migration secret check passed.' : 'Migration secret check failed.');
  process.exit(result.ok ? 0 : 1);
}
