// The list of the enterprises for the nightly backup (Madar enterprises, design 5.15). .github/workflows/office-backup.yml runs it before
// the export, and the export loops over the ids.
//
//   OFFICE_EXPORT_SECRET=<value> npx tsx scripts/backup/officeEnterprises.ts --url <page address>
//
// It asks the op enterprises of the Worker (the export secret in the header only) and prints one JSON line: {"enterprises":["ent_001",...]}.
// It fails when the list is empty or holds a text that is no enterprise id, so a night never ends with no backup and no error.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EXPORT_SECRET_HEADER } from '../../server/entries/officeWorker';
import { ENTERPRISE_ID, type EnterpriseId } from '../../server/enterprise/ids';
import { opsOf, type OfficeOps } from '../office/ops';

/** The listed ids, sorted. It throws on a list that is empty, or on an id of a wrong form. */
export async function listEnterprises(ops: OfficeOps): Promise<EnterpriseId[]> {
  const answer = await ops.post<{ enterprises?: unknown }>('enterprises', {});
  const ids = answer.enterprises;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !ENTERPRISE_ID.test(id))) throw new Error('The op enterprises did not answer a list of enterprise ids.');
  if (ids.length === 0) throw new Error('The platform lists no enterprise, so there is nothing to back up.');
  return [...new Set(ids as string[])].sort();
}

/** The problems of the arguments and the env, by name only: never a value. */
export function enterprisesArgProblems(argv: readonly string[], env: Readonly<Record<string, string | undefined>>): string[] {
  const at = argv.indexOf('--url');
  return [
    ...(at === -1 || (argv[at + 1] ?? '') === '' ? ['--url <page address of the copy> is missing.'] : []),
    ...(!env.OFFICE_EXPORT_SECRET ? ['OFFICE_EXPORT_SECRET is missing.'] : []),
  ];
}

async function main(argv: string[]): Promise<void> {
  const problems = enterprisesArgProblems(argv, process.env);
  if (problems.length > 0) throw new Error(problems.join('\n'));
  const ops = opsOf({ base: argv[argv.indexOf('--url') + 1], secret: process.env.OFFICE_EXPORT_SECRET!, header: EXPORT_SECRET_HEADER });
  console.log(JSON.stringify({ enterprises: await listEnterprises(ops) }));
}

const isMain = process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
