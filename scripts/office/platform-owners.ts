// Writes the list of the platform owners (Madar enterprises): npx tsx scripts/office/platform-owners.ts --to <page address> ent_001:usr_001 [ent_002:usr_003 ...]
// The list is replaced as a whole. A pair is <enterprise id>:<person id>. The ops secret comes from secrets/<copy>.env (or from the environment
// for the local office); the script never prints it. For production the script needs --production, and the owner's OK comes first (plan E).
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { copyOfPageHost } from '../../server/core/serverHost';
import { OPS_SECRET_HEADER } from '../../server/entries/officeWorker';
import { OwnersBodyShape } from '../../server/enterprise/shapes';
import { copyValuesOf, flagOf, targetOf } from './import';
import { opsOf } from './ops';

/** The body of the ops route from the pairs "ent_001:usr_001". A bad pair stops the script before any request. */
export function ownersBodyOf(pairs: readonly string[]): { owners: { ent: string; userId: string }[] } {
  const owners = pairs.map((pair) => {
    const [ent, userId, ...more] = pair.split(':');
    return { ent: ent ?? '', userId: userId ?? '', more: more.length };
  });
  if (owners.some((one) => one.more > 0)) throw new Error('A pair is <enterprise id>:<person id>, for example ent_001:usr_001.');
  const body = OwnersBodyShape.safeParse({ owners: owners.map(({ ent, userId }) => ({ ent, userId })) });
  if (!body.success) throw new Error('A pair is <enterprise id>:<person id>, for example ent_001:usr_001.');
  return body.data;
}

function targetWith(to: string, production: boolean): { copy: ReturnType<typeof targetOf>['copy']; base: string } {
  const url = new URL(to);
  if (production && copyOfPageHost(url.hostname) === 'production') return { copy: 'production', base: url.origin };
  return targetOf(to);
}

/** The pairs of the command line: every argument but the flags and the value of --to. */
export function pairsOf(argv: readonly string[]): string[] {
  return argv.filter((arg, at) => arg !== '--to' && arg !== '--production' && argv[at - 1] !== '--to');
}

async function main(argv: string[]): Promise<void> {
  const body = ownersBodyOf(pairsOf(argv));
  const target = targetWith(flagOf(argv, '--to'), argv.includes('--production'));
  const secret = copyValuesOf(target.copy).MADAR_OPS_SECRET;
  if (!secret) throw new Error('MADAR_OPS_SECRET is not set for this copy (scripts/office/new-secret.ts).');
  console.log(JSON.stringify(await opsOf({ base: target.base, secret, header: OPS_SECRET_HEADER }).post('platform-owners', body)));
}

const isMain = process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
