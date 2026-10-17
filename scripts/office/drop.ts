// Drops a spare object of the production rehearsal (wave 5): npx tsx scripts/office/drop.ts --to <test page address> --office rehearsal-YYYYMMDD
// The Worker drops only a rehearsal name, and the object deletes all of its storage. The ops secret comes from secrets/test.env
// (the test copy) or from the environment (the local office); the script never prints it.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { OPS_SECRET_HEADER } from '../../server/entries/officeWorker';
import { REHEARSAL_NAME } from '../../server/office/ops';
import { copyValuesOf, flagOf, targetOf } from './import';
import { opsOf } from './ops';

async function main(argv: string[]): Promise<void> {
  const target = targetOf(flagOf(argv, '--to'));
  const office = flagOf(argv, '--office');
  if (!REHEARSAL_NAME.test(office)) throw new Error('--office must be a rehearsal name (rehearsal-YYYYMMDD).');
  const secret = copyValuesOf(target.copy).MADAR_OPS_SECRET;
  if (!secret) throw new Error('MADAR_OPS_SECRET is not set for this copy (scripts/office/new-secret.ts).');
  console.log(JSON.stringify(await opsOf({ base: target.base, secret, header: OPS_SECRET_HEADER, office }).post('drop', {})));
}

const isMain = process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
