import { existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { fileStoreKind, type FileStoreKind } from '../../server/core/ports';
import type { R2Env } from '../../server/files/r2';
import { parseSecretsFile, r2Values, REFS, type Target } from '../deploy/secrets';

/**
 * The values of one copy for the storage scripts (owner, 2026-10-16): scripts/storage/move-to-r2.ts and verify-r2-keys.ts with
 * --env test|production. The project comes from the fixed refs, the R2 values and the store from secrets/<env>.env (checked as
 * secrets.ts checks them), and the Management API token from the environment or .env.local. Nothing here prints a value.
 */

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The copy of --env, or undefined when the flag is not there. */
export function envArg(argv: string[]): Target | undefined {
  const at = argv.indexOf('--env');
  if (at === -1) return undefined;
  const value = argv[at + 1];
  if (value !== 'test' && value !== 'production') throw new Error('--env must be test or production.');
  return value;
}

export type CopyEnv = {
  target: Target;
  ref: string;
  supabaseUrl: string;
  /** The store of the screens now: supabase before the switch, r2 after it. */
  fileStore: FileStoreKind;
  /** The Supabase Storage bucket of the copy. */
  filesBucket: string;
  /** Always the EU endpoint of the account: the file never names another endpoint. */
  r2: R2Env;
};

/** The values of one copy from the text of secrets/<env>.env. It refuses a file with no R2 values, or the bucket of the other copy. */
export function copyEnv(target: Target, secretsText: string): CopyEnv {
  const values = parseSecretsFile(secretsText);
  const r2 = r2Values(values, target);
  if (!r2) throw new Error(`secrets/${target}.env has no R2 values. Add R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET first.`);
  const ref = REFS[target];
  return {
    target, ref, supabaseUrl: `https://${ref}.supabase.co`, fileStore: fileStoreKind(values.MADAR_FILE_STORE),
    filesBucket: values.FILES_BUCKET || 'madar-files', r2,
  };
}

/** The text of secrets/<env>.env (git ignores the folder). */
export function readSecretsText(target: Target): string {
  const file = `${ROOT}secrets/${target}.env`;
  if (!existsSync(file)) throw new Error(`secrets/${target}.env is missing. It holds the values of ${target} (git ignores secrets/).`);
  return readFileSync(file, 'utf8');
}

/** The text of .env.local, or null when the checkout has none. */
export function readLocalEnv(): string | null {
  const file = `${ROOT}.env.local`;
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

/** The Management API token of the Madar account: SUPABASE_ACCESS_TOKEN of the environment, else of .env.local. */
export function accessToken(env: Record<string, string | undefined>, readLocal: () => string | null): string {
  if (env.SUPABASE_ACCESS_TOKEN) return env.SUPABASE_ACCESS_TOKEN;
  for (const line of (readLocal() ?? '').split('\n')) {
    const match = /^\s*(?:export\s+)?SUPABASE_ACCESS_TOKEN\s*=\s*(.*?)\s*$/.exec(line);
    const value = match?.[1].replace(/^(['"])(.*)\1$/, '$2');
    if (value) return value;
  }
  throw new Error('SUPABASE_ACCESS_TOKEN is not set: load the Madar token from ~/dev/madar/.env.local (never the Halulu sign-in).');
}

/**
 * Production runs from the Mac only, after the typed word production, as all.sh asks (plan, section 10, decision 9). A
 * MADAR_DEPLOY_CONFIRMED from the shell never counts. Without a terminal: echo production | npx tsx <script> --env production.
 */
export async function confirmProduction(target: Target, env: Record<string, string | undefined>, ask: (question: string) => Promise<string>): Promise<void> {
  if (target !== 'production') return;
  if (env.CI || env.GITHUB_ACTIONS) throw new Error('Production runs from the Mac only (plan, section 10, decision 9). Nothing changed.');
  const word = await ask(`This changes the files of the production project ${REFS.production}. Type production to go on: `);
  if (word.trim() !== 'production') throw new Error('Stopped: the typed word was not production. Nothing changed.');
}

/** One line from stdin, with the question on stderr (stdout carries only the JSON report). */
export async function askLine(question: string): Promise<string> {
  const reader = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await reader.question(question);
  } catch {
    return '';
  } finally {
    reader.close();
  }
}
