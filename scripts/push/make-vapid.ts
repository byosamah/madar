import { appendFileSync, existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { VAPID_NAMES, makeVapidKeys, type VapidConfig } from '../../server/push/vapid.ts';

/**
 * A new VAPID key pair for browser push (owner, 2026-10-08):
 *   npx tsx scripts/push/make-vapid.ts <test|production>
 *
 * It makes a P-256 pair with WebCrypto and
 *   1. APPENDS VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY and VAPID_SUBJECT to secrets/<env>.env (git ignores the folder), and
 *   2. sets VITE_VAPID_PUBLIC_KEY in config/remote.<env>.env (public values only: the screens need the public key to subscribe).
 * It refuses to run when the secrets file already holds one of the three names, so it never replaces a key that browsers already
 * use (a new key makes every old subscription useless). It prints the PUBLIC key only. Test and production each get a pair of
 * their own: run it once for each.
 *
 * After a run: scripts/deploy/secrets.ts sends the three secrets to the functions, and the next remote build holds the public key.
 */

export type Target = 'test' | 'production';
const PUBLIC_NAME = 'VITE_VAPID_PUBLIC_KEY';

/** The sender of push: the address of the mail of Madar. Push services may write to it when a sender misbehaves. */
export const subjectOf = (): string => 'mailto:madar@vado.sa';

const lineOf = (name: string) => new RegExp(`^\\s*${name}\\s*=`, 'm');
/** The text without its comment lines, so a commented name is not taken for a key. */
const withoutComments = (text: string): string => text.split('\n').filter((line) => !line.trimStart().startsWith('#')).join('\n');

/** The secrets text with the three lines added. It refuses when one of the names is already set. */
export function addSecretLines(text: string, keys: VapidConfig): string {
  const present = VAPID_NAMES.filter((name) => lineOf(name).test(withoutComments(text)));
  if (present.length > 0) {
    throw new Error(`${present.join(', ')} already in the secrets file. A new key makes every old subscription useless, so nothing changed. Remove the line on purpose to make a new pair.`);
  }
  const start = text === '' || text.endsWith('\n') ? text : `${text}\n`;
  return `${start}VAPID_PRIVATE_KEY=${keys.privateKey}\nVAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_SUBJECT=${keys.subject}\n`;
}

/** The public env text with VITE_VAPID_PUBLIC_KEY set: the old line is replaced, else a line is added at the end. */
export function addPublicValue(text: string, publicKey: string): string {
  const line = `${PUBLIC_NAME}=${publicKey}`;
  if (lineOf(PUBLIC_NAME).test(withoutComments(text))) return text.replace(new RegExp(`^\\s*${PUBLIC_NAME}\\s*=.*$`, 'm'), line);
  const start = text === '' || text.endsWith('\n') ? text : `${text}\n`;
  return `${start}${line}\n`;
}

export type Files = { secrets: string; publicEnv: string };
export type Made = { secrets: string; publicEnv: string; publicKey: string; report: string[] };

/** The new texts of both files. Nothing here reads or writes a file, and the report holds the public key only. */
export async function makeVapid(target: Target, files: Files): Promise<Made> {
  if (target !== 'test' && target !== 'production') throw new Error('The target must be test or production.');
  const keys: VapidConfig = { ...(await makeVapidKeys()), subject: subjectOf() };
  const secrets = addSecretLines(files.secrets, keys);
  const publicEnv = addPublicValue(files.publicEnv, keys.publicKey);
  return {
    secrets, publicEnv, publicKey: keys.publicKey,
    report: [
      `VAPID keys made for ${target}.`,
      `Public key: ${keys.publicKey}`,
      `Added VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY and VAPID_SUBJECT to secrets/${target}.env. The private key is not shown.`,
      `Set ${PUBLIC_NAME} in config/remote.${target}.env.`,
      'Next: run scripts/deploy/secrets.ts for this target, then deploy the screens, so both sides use the new pair.',
    ],
  };
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const target = process.argv[2];
  if (target !== 'test' && target !== 'production') {
    console.error('Usage: npx tsx scripts/push/make-vapid.ts <test|production>');
    process.exit(2);
  }
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const secretsFile = `${root}secrets/${target}.env`;
  const publicFile = `${root}config/remote.${target}.env`;
  for (const file of [secretsFile, publicFile]) {
    if (!existsSync(file)) {
      console.error(`${file.slice(root.length)} is missing.`);
      process.exit(1);
    }
  }
  const files: Files = { secrets: readFileSync(secretsFile, 'utf8'), publicEnv: readFileSync(publicFile, 'utf8') };
  makeVapid(target, files).then(
    (made) => {
      // Append only the new lines to the secrets file, so a failure never rewrites the old ones.
      appendFileSync(secretsFile, made.secrets.slice(files.secrets.length));
      writeFileSync(publicFile, made.publicEnv);
      for (const line of made.report) console.log(line);
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : 'Failed.');
      process.exit(1);
    },
  );
}
