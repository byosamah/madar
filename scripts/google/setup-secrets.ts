import { appendFileSync, existsSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The Google Calendar secrets of one copy (fbk_022, owner 2026-10-19):
 *   npx tsx scripts/google/setup-secrets.ts <test|production>
 *
 * It reads GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET from .env.local (the owner puts them there), makes a new key of 32 random bytes with
 * WebCrypto, and APPENDS GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and MADAR_GOOGLE_KEY to secrets/<env>.env (git ignores the folder). Test and
 * production each get a key of their own: run it once for each. It refuses to run when the secrets file already holds one of the three
 * names, so it never replaces a key that seals tokens already (a new key makes every sealed token useless, and each person connects
 * again). It prints the names only, never a value. Errors name the variable, never a value.
 *
 * After a run: scripts/deploy/secrets.ts <env> sends the three secrets to the functions and to the Worker (the merge lead does that).
 */

export type Target = 'test' | 'production';
const NAMES = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'MADAR_GOOGLE_KEY'] as const;

const lineOf = (name: string) => new RegExp(`^\\s*${name}\\s*=`, 'm');
/** The text without its comment lines, so a commented name is not taken for a line. */
const withoutComments = (text: string): string => text.split('\n').filter((line) => !line.trimStart().startsWith('#')).join('\n');

function valueOf(text: string, name: string): string | undefined {
  const match = new RegExp(`^\\s*${name}\\s*=(.*)$`, 'm').exec(withoutComments(text));
  return match ? match[1].trim().replace(/^(["'])(.*)\1$/, '$2') : undefined;
}

export type ClientValues = { clientId: string; clientSecret: string };

/** The two client values of .env.local. A missing or wrong one throws an error that names the variable. */
export function googleLinesOf(local: string): ClientValues {
  const clientId = valueOf(local, 'GOOGLE_CLIENT_ID');
  const clientSecret = valueOf(local, 'GOOGLE_CLIENT_SECRET');
  if (!clientId) throw new Error('.env.local needs GOOGLE_CLIENT_ID.');
  if (!clientSecret) throw new Error('.env.local needs GOOGLE_CLIENT_SECRET.');
  if (!clientId.endsWith('.apps.googleusercontent.com')) throw new Error('GOOGLE_CLIENT_ID must end with .apps.googleusercontent.com.');
  if (/\s/.test(clientSecret)) throw new Error('GOOGLE_CLIENT_SECRET must be one word with no space.');
  return { clientId, clientSecret };
}

/** The secrets text with the three lines added. It refuses when one of the names is already set. */
export function addGoogleLines(text: string, client: ClientValues, key: Uint8Array): string {
  const present = NAMES.filter((name) => lineOf(name).test(withoutComments(text)));
  if (present.length > 0) {
    throw new Error(`${present.join(', ')} already in the secrets file. A new key makes every sealed token useless, so nothing changed. Remove the line on purpose to make a new key.`);
  }
  const start = text === '' || text.endsWith('\n') ? text : `${text}\n`;
  return `${start}GOOGLE_CLIENT_ID=${client.clientId}\nGOOGLE_CLIENT_SECRET=${client.clientSecret}\nMADAR_GOOGLE_KEY=${Buffer.from(key).toString('base64')}\n`;
}

export type Made = { secrets: string; report: string[] };

/** The new secrets text. Nothing here reads or writes a file, and the report holds names only. */
export async function makeGoogleSecrets(target: Target, files: { secrets: string; local: string }): Promise<Made> {
  if (target !== 'test' && target !== 'production') throw new Error('The target must be test or production.');
  const client = googleLinesOf(files.local);
  const secrets = addGoogleLines(files.secrets, client, crypto.getRandomValues(new Uint8Array(32)));
  return {
    secrets,
    report: [
      `Google Calendar secrets made for ${target}.`,
      `Added ${NAMES.join(', ')} to secrets/${target}.env. No value is shown.`,
      'Next: run scripts/deploy/secrets.ts for this target, then deploy the copy.',
    ],
  };
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const target = process.argv[2];
  if (target !== 'test' && target !== 'production') {
    console.error('Usage: npx tsx scripts/google/setup-secrets.ts <test|production>');
    process.exit(2);
  }
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const secretsFile = `${root}secrets/${target}.env`;
  const localFile = `${root}.env.local`;
  for (const file of [secretsFile, localFile]) {
    if (!existsSync(file)) {
      console.error(`${file.slice(root.length)} is missing.`);
      process.exit(1);
    }
  }
  const files = { secrets: readFileSync(secretsFile, 'utf8'), local: readFileSync(localFile, 'utf8') };
  makeGoogleSecrets(target, files).then(
    (made) => {
      // Append only the new lines, so a failure never rewrites the old ones.
      appendFileSync(secretsFile, made.secrets.slice(files.secrets.length));
      for (const line of made.report) console.log(line);
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : 'Failed.');
      process.exit(1);
    },
  );
}
