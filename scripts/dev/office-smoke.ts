/**
 * npm run smoke:office (Supabase exit, wave 3): the real Workers bundle on local wrangler dev with the office path on. It needs no
 * Docker and no sign-in, so it checks what comes before a person: the health route with and without the jobs secret, the token
 * refusal of the batch route, the socket refusal, and one Cron run through /__scheduled (wrangler 4.147.0, --test-scheduled).
 * Run it after npm run build:server, with the sandbox off (wrangler dev binds a port). It changes nothing outside $TMPDIR: the
 * local state of wrangler dev (the office object storage) goes into the folder of the run (--persist-to), so each run starts with a
 * new office object. In the default folder (.wrangler/ beside the config) the heartbeat of one run stays, and the next run fails.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 8791;
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = 'smoke-jobs-secret';

const dir = mkdtempSync(join(tmpdir(), 'madar-office-smoke-'));
const envFile = join(dir, 'smoke.env');
writeFileSync(envFile, [
  'MADAR_SECRET_KEY=sb_secret_test_not_a_key', `JOBS_SECRET=${SECRET}`, `R2_ACCOUNT_ID=${'0'.repeat(32)}`,
  'R2_ACCESS_KEY_ID=test-not-a-key', 'R2_SECRET_ACCESS_KEY=test-not-a-key',
].join('\n'), { mode: 0o600 });

const dev = spawn('npx', [
  'wrangler', 'dev', '-c', 'server/office/test/live/wrangler.bundle.toml', '--env-file', envFile, '--port', String(PORT),
  '--ip', '127.0.0.1', '--persist-to', join(dir, 'state'), '--test-scheduled', '--show-interactive-dev-session=false',
], { stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
dev.stdout.on('data', (chunk) => (output += String(chunk)));
dev.stderr.on('data', (chunk) => (output += String(chunk)));

async function until<T>(work: () => Promise<T | undefined>, ms: number): Promise<T | undefined> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const value = await work();
      if (value !== undefined) return value;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return undefined;
}

type Health = { host?: string; office?: { schema?: number; lastJob?: string | null } };
const health = async (secret?: string) => (await fetch(`${BASE}/api/health`, { headers: secret ? { 'x-madar-jobs-secret': secret } : {} })).json() as Promise<Health>;

const checks: [string, boolean][] = [];
try {
  const open = await until(() => health(), 60_000);
  checks.push(['the health route names the office host', open?.host === 'office']);
  const before = await health(SECRET);
  checks.push(['the office object answers with schema 3 and no job run yet', before.office?.schema === 3 && before.office?.lastJob === null]);
  const batch = await fetch(`${BASE}/api/batch`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ v: 1, calls: [] }) });
  checks.push(['a batch with no token gets 401 from the office route', batch.status === 401 && (batch.headers.get('x-madar-server') ?? '').startsWith('office;')]);
  const live = await fetch(`${BASE}/api/live?ticket=${'a'.repeat(64)}`);
  checks.push(['a socket address with no upgrade gets 426', live.status === 426]);
  const ran = await fetch(`${BASE}/__scheduled?cron=${encodeURIComponent('*/15 * * * *')}`);
  checks.push(['the Cron route of wrangler dev answers', ran.ok]);
  const after = await until(async () => {
    const answer = await health(SECRET);
    return answer.office?.lastJob ? answer : undefined;
  }, 15_000);
  checks.push(['the Cron run wrote the heartbeat in the office object', typeof after?.office?.lastJob === 'string']);
} finally {
  dev.kill('SIGINT');
  rmSync(dir, { recursive: true, force: true });
}
for (const [name, ok] of checks) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
const passed = checks.length === 6 && checks.every(([, ok]) => ok);
if (!passed) console.log(output.split('\n').slice(-40).join('\n'));
process.exit(passed ? 0 : 1);
