// A new secret of an office copy (exit wave 4), typed by nobody and printed nowhere:
//
//   npx tsx scripts/office/new-secret.ts test MADAR_OPS_SECRET
//   npx tsx scripts/office/new-secret.ts test MADAR_EXPORT_SECRET --github OFFICE_EXPORT_SECRET
//
// It makes 32 random bytes (base64url), adds the line NAME=<value> to secrets/<env>.env, and with --github sends the same value
// to that GitHub secret of byosamah/madar on the stdin of gh. Then scripts/deploy/secrets.ts <env> gives it to the Worker.
// The owner runs it in his Terminal (a GitHub write needs his OK). Production comes with the switch (wave 6).
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const NEW_SECRET_NAMES = ['MADAR_OPS_SECRET', 'MADAR_EXPORT_SECRET'] as const;
/** The one GitHub secret that may get a value: the nightly export of office-backup.yml reads OFFICE_EXPORT_SECRET. */
const GITHUB_NAMES: Readonly<Record<string, string>> = { MADAR_EXPORT_SECRET: 'OFFICE_EXPORT_SECRET' };

/** The file text with the new line at the end. A name that the file holds already stays, and nothing changes. */
export function withSecretLine(text: string, name: string, value: string): string {
  if (new RegExp(`^${name}=`, 'm').test(text)) throw new Error(`${name} is in the file already: remove its line first to make a new one.`);
  return `${text.replace(/\n*$/, text === '' ? '' : '\n')}${name}=${value}\n`;
}

export type NewSecretArgs = { target: 'test'; name: (typeof NEW_SECRET_NAMES)[number]; github?: string };

/** The checked arguments: the test copy only, one of the two names, and --github only with the name of the export secret. */
export function newSecretArgs(argv: readonly string[]): NewSecretArgs {
  const [target, name] = argv;
  if (target !== 'test') throw new Error('Only the test copy takes a new office secret now; production comes with the switch (wave 6).');
  if (!(NEW_SECRET_NAMES as readonly string[]).includes(name ?? '')) throw new Error(`The name must be one of ${NEW_SECRET_NAMES.join(', ')}.`);
  const at = argv.indexOf('--github');
  const github = at === -1 ? undefined : argv[at + 1];
  if (github !== undefined && GITHUB_NAMES[name!] !== github) throw new Error(`${name} goes only to the GitHub secret ${GITHUB_NAMES[name!] ?? '(none)'}.`);
  return { target, name: name as NewSecretArgs['name'], ...(github === undefined ? {} : { github }) };
}

function main(argv: string[]): void {
  const { target, name, github } = newSecretArgs(argv);
  const file = fileURLToPath(new URL(`../../secrets/${target}.env`, import.meta.url));
  if (!existsSync(file)) throw new Error(`secrets/${target}.env is missing.`);
  const value = randomBytes(32).toString('base64url');
  writeFileSync(file, withSecretLine(readFileSync(file, 'utf8'), name, value), { mode: 0o600 });
  console.log(`Wrote ${name} to secrets/${target}.env.`);
  if (github) {
    // gh reads the value from its stdin: never from an argument, so no process list and no shell history holds it.
    const set = spawnSync('gh', ['secret', 'set', github, '-R', 'byosamah/madar'], { input: value, stdio: ['pipe', 'inherit', 'inherit'] });
    if (set.status !== 0) throw new Error(`gh secret set ${github} failed. ${name} is in secrets/${target}.env already: remove that line, then run this script again.`);
    console.log(`Set the GitHub secret ${github}.`);
  }
  console.log(`Next: npx tsx scripts/deploy/secrets.ts ${target} (it gives ${name} to the Worker).`);
}

const isMain = process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
