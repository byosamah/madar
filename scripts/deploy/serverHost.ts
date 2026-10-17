import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { COPIES, COPY_HOSTS, SERVER_HOST_SETTING, type Copy } from '../../server/core/serverHost.ts';

/**
 * The server host setting for the shell steps (owner, 2026-10-16):
 *   node scripts/deploy/serverHost.ts host <test|production>     supabase, workers or office (config/server-host.json)
 *   node scripts/deploy/serverHost.ts page <test|production>     the page address of the copy
 *   node scripts/deploy/serverHost.ts worker <test|production>   the Worker name of the copy
 * Plain node runs it (scripts/deploy/checks.sh). A setting with another key or word stops it (server/core/serverHost.ts).
 */

export const ASKS = {
  host: (copy: Copy) => SERVER_HOST_SETTING[copy],
  page: (copy: Copy) => COPY_HOSTS[copy].page,
  worker: (copy: Copy) => COPY_HOSTS[copy].workers.name,
} as const;

const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const [what, copy] = process.argv.slice(2);
  if (!(what in ASKS) || !(COPIES as readonly string[]).includes(copy)) {
    console.error('Usage: node scripts/deploy/serverHost.ts <host|page|worker> <test|production>');
    process.exit(2);
  }
  process.stdout.write(ASKS[what as keyof typeof ASKS](copy as Copy));
}
