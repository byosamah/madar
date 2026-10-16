import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildId } from '../build-remote.ts';
import { redact, runWithStdin } from '../deploy/cloudflare.ts';

/**
 * The time of one server call on the test copy, on both server hosts (owner, 2026-10-16: the Worker stays only if it measures
 * faster). scripts/proof/server-time.sh <rounds> runs this from the Mac with the sandbox off.
 *
 * Two paths, each in one curl process for each round, so every measured request goes on one warm connection:
 *   supabase  the api function of madar-test, straight (as the screens call it today): a warm-up OPTIONS, the CORS preflight,
 *             then the requests, each with forceFunctionRegion=eu-central-1 and the Origin of the test page;
 *   page      https://preview.madar-46r.pages.dev/api (the page's own api, the Pages Function, then the host of the setting): a
 *             warm-up GET of /favicon.ico, then the requests. No preflight: the screens call their own address.
 * The requests of each path: POST /api/batch with session.get and no token (401), the same with the token of the member account
 * (200: the token check, the person, the office cache, the database), and GET /api/health with the jobs secret (the database
 * check). The rounds alternate which path goes first, one second apart.
 *
 * The member signs in with the password grant inside this process. The token and the jobs secret go to curl in its config on
 * stdin (-K -), never as an argument, and no output holds them. It prints the median, p25 and p75 of the time to the first byte
 * and of the whole request, in ms, the HTTP codes, and the x-madar-server of each path.
 */

export const TEST_REF = 'qdgwpnesxppnqsaabqzd';
export const SUPABASE_URL = `https://${TEST_REF}.supabase.co`;
export const PAGE = 'https://preview.madar-46r.pages.dev';
export const MEMBER = 'member@madar.test';
export type PathName = 'supabase' | 'page';
export type Step = { label: string; url: string; method: 'GET' | 'POST' | 'OPTIONS'; headers: string[]; data?: string; measured: boolean };

const BATCH = JSON.stringify({ v: 1, calls: [{ i: 0, name: 'session.get', input: {} }] });

/** The api address of each path. Only the Supabase function takes the region parameter. */
export function apiOf(path: PathName): { batch: string; health: string } {
  return path === 'supabase'
    ? { batch: `${SUPABASE_URL}/functions/v1/api/batch?forceFunctionRegion=eu-central-1`, health: `${SUPABASE_URL}/functions/v1/api/health?forceFunctionRegion=eu-central-1` }
    : { batch: `${PAGE}/api/batch`, health: `${PAGE}/api/health` };
}

/** The requests of one path in one round. */
export function stepsOf(path: PathName, o: { publishableKey: string; token: string; jobsSecret: string; build: string }): Step[] {
  const api = apiOf(path);
  const origin = `Origin: ${PAGE}`;
  const post = ['Content-Type: application/json', `X-Madar-Build: ${o.build}`, `apikey: ${o.publishableKey}`, origin];
  const warm: Step = path === 'supabase'
    ? { label: 'warm', url: api.batch, method: 'OPTIONS', headers: [origin, 'Access-Control-Request-Method: POST'], measured: false }
    : { label: 'warm', url: `${PAGE}/favicon.ico`, method: 'GET', headers: [], measured: false };
  return [
    warm,
    ...(path === 'supabase'
      ? [{ label: 'preflight', url: api.batch, method: 'OPTIONS' as const, headers: [origin, 'Access-Control-Request-Method: POST', 'Access-Control-Request-Headers: authorization,apikey,content-type,x-madar-build'], measured: true }]
      : []),
    { label: 'anon', url: api.batch, method: 'POST', headers: post, data: BATCH, measured: true },
    { label: 'member', url: api.batch, method: 'POST', headers: [...post, `Authorization: Bearer ${o.token}`], data: BATCH, measured: true },
    { label: 'health', url: api.health, method: 'GET', headers: [`x-madar-jobs-secret: ${o.jobsSecret}`], measured: true },
  ];
}

/** A value inside double quotes of a curl config file: a backslash and a quote get a backslash. */
const quoted = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** The curl config of one round of one path: one transfer for each step, joined with next, all on one connection. */
export function curlConfig(steps: Step[]): string {
  const blocks = steps.map((step) => [
    `url = ${quoted(step.url)}`,
    `request = ${quoted(step.method)}`,
    ...step.headers.map((header) => `header = ${quoted(header)}`),
    ...(step.data === undefined ? [] : [`data = ${quoted(step.data)}`]),
    'output = "/dev/null"',
    'max-time = 20',
    // The label is a fixed word; \n inside the quotes is the newline escape of a curl config file.
    `write-out = "${step.label} %{http_code} %{time_starttransfer} %{time_total} %header{x-madar-server}\\n"`,
  ].join('\n'));
  return `silent\nshow-error\n${blocks.join('\nnext\n')}\n`;
}

export type Sample = { label: string; code: string; ttfbMs: number; totalMs: number; server: string };

/** The write-out lines of curl. A line that does not parse is left out. */
export function parseLines(output: string): Sample[] {
  return output.split('\n').flatMap((line) => {
    const match = /^(\w+) (\d{3}) ([\d.]+) ([\d.]+) ?(.*)$/.exec(line.trim());
    return match ? [{ label: match[1], code: match[2], ttfbMs: Number(match[3]) * 1000, totalMs: Number(match[4]) * 1000, server: match[5].trim() }] : [];
  });
}

/** The q quantile with linear interpolation (q 0.5 is the median). */
export function quantile(values: number[], q: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (sorted.length - 1) * q;
  const low = Math.floor(at);
  const high = Math.ceil(at);
  return sorted[low] + (sorted[high] - sorted[low]) * (at - low);
}

/** The order of the paths in a round: the paths alternate, so neither one always gets the first, cold request. */
export function orderOf(round: number): PathName[] {
  return round % 2 === 0 ? ['supabase', 'page'] : ['page', 'supabase'];
}

/** One summary line for each path and step: n, the HTTP codes, and the median, p25 and p75 in ms. */
export function summary(samples: Record<PathName, Sample[]>): string[] {
  const lines = ['path      step       n   codes          ttfb median p25 p75      total median p25 p75   x-madar-server'];
  for (const path of ['supabase', 'page'] as const) {
    for (const label of ['preflight', 'anon', 'member', 'health']) {
      const rows = samples[path].filter((s) => s.label === label);
      if (rows.length === 0) continue;
      const codes = Object.entries(rows.reduce<Record<string, number>>((all, s) => ({ ...all, [s.code]: (all[s.code] ?? 0) + 1 }), {})).map(([code, n]) => `${code}x${n}`).join(',');
      const ms = (values: number[]) => [0.5, 0.25, 0.75].map((q) => quantile(values, q).toFixed(0)).join(' ');
      const servers = [...new Set(rows.map((s) => s.server || 'none'))].join(',');
      lines.push(`${path.padEnd(9)} ${label.padEnd(10)} ${String(rows.length).padEnd(3)} ${codes.padEnd(14)} ${ms(rows.map((s) => s.ttfbMs)).padEnd(19)} ${ms(rows.map((s) => s.totalMs)).padEnd(19)} ${servers}`);
    }
  }
  return lines;
}

function valueIn(text: string, name: string): string | undefined {
  const line = text.split('\n').find((l) => l.startsWith(`${name}=`));
  return line?.slice(name.length + 1).trim().replace(/^(["'])(.*)\1$/, '$2');
}

/** The password grant of Supabase Auth. The error names the step and the status, never the password or the token. */
async function signIn(publishableKey: string, password: string): Promise<string> {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: publishableKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: MEMBER, password }),
  });
  const body = (await response.json().catch(() => ({}))) as { access_token?: string };
  if (!response.ok || !body.access_token) throw new Error(`The sign-in of ${MEMBER} failed with HTTP ${response.status}.`);
  return body.access_token;
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const rounds = Number(process.argv[2] ?? '20');
  if (!Number.isInteger(rounds) || rounds < 1) {
    console.error('Usage: scripts/proof/server-time.sh <rounds>');
    process.exit(2);
  }
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const read = (file: string) => readFileSync(`${root}${file}`, 'utf8');
  const publishableKey = valueIn(read('config/remote.test.env'), 'VITE_SUPABASE_PUBLISHABLE_KEY');
  const password = valueIn(read('secrets/test-accounts.env'), 'MADAR_TEST_PASSWORD_MEMBER');
  const jobsSecret = valueIn(read('secrets/test.env'), 'JOBS_SECRET');
  if (!publishableKey || !password || !jobsSecret) {
    console.error('Needed: VITE_SUPABASE_PUBLISHABLE_KEY (config/remote.test.env), MADAR_TEST_PASSWORD_MEMBER (secrets/test-accounts.env), JOBS_SECRET (secrets/test.env).');
    process.exit(1);
  }
  const build = buildId(new Date());
  let token = await signIn(publishableKey, password);
  let signedAt = Date.now();
  const samples: Record<PathName, Sample[]> = { supabase: [], page: [] };
  for (let round = 0; round < rounds; round += 1) {
    // The token lives 15 minutes (jwt_expiry 900): a new one after 10.
    if (Date.now() - signedAt > 10 * 60 * 1000) {
      token = await signIn(publishableKey, password);
      signedAt = Date.now();
    }
    for (const path of orderOf(round)) {
      const steps = stepsOf(path, { publishableKey, token, jobsSecret, build });
      const { output } = await runWithStdin('curl', ['-K', '-'], curlConfig(steps));
      const got = parseLines(output);
      const measured = new Set(steps.filter((s) => s.measured).map((s) => s.label));
      samples[path].push(...got.filter((s) => measured.has(s.label)));
      if (got.length < steps.length) console.error(redact(`Round ${round + 1}, ${path}: ${got.length} of ${steps.length} answers. ${output.trim().split('\n').at(-1) ?? ''}`, [token, password, jobsSecret]));
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  console.log(`server-time: ${rounds} rounds on the test copy, ${new Date().toISOString()}, build ${build}. Times in ms.`);
  for (const line of summary(samples)) console.log(line);
  if (samples.page.some((s) => s.server === 'supabase')) console.log('Note: the page path answered from supabase: config/server-host.json says supabase for test, or the binding is missing.');
}
