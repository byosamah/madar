import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { authOf, localStack, PASSWORD } from '../it/authStack';
import { connectAgent, LOCAL_API, LOCAL_MCP_URL, publicOffice, registerClient, RELINK_SQL } from '../it/oauthAgent';

/**
 * The official MCP conformance runner against the mcp function (plan 7.4; task G3), the second half of `npm run test:mcp`.
 * It needs the local stack and the Docker lock, after "supabase db reset" from this worktree. It talks only to 127.0.0.1.
 *
 *   1. The office in the public schema, and a person with an Auth user of this run.
 *   2. An agent token through the real OAuth 2.1 flow (DCR, PKCE, the approval, the code exchange).
 *   3. The bundles (npm run build:server), and `supabase functions serve mcp` with local values.
 *   4. A proxy on 127.0.0.1 that adds the agent token to each request: the runner (0.1.16) cannot send a token, and Madar answers
 *      every request without one with 401.
 *   5. `conformance server --scenario <name>` against the proxy, for each server scenario of `conformance list`, each with a
 *      45-second limit (the runner has none, and a scenario that waits for a fixture never ends). The scenarios that need the
 *      runner's own test tools, prompts or resources (Madar has none of them) are in server/mcp/conformance-baseline.yml.
 *      The run fails when a scenario outside the baseline fails, and when a scenario of the baseline passes (a stale baseline).
 *
 * The runner covers the 2025-era protocol only (0.1.16). The 2026-07-28 points of platform facts 7.2 are in server/mcp/app.test.ts.
 */

const ROOT = join(import.meta.dirname, '..', '..');
const BASELINE = join(import.meta.dirname, 'conformance-baseline.yml');
const SCENARIO_LIMIT_MS = 45_000;

function secretKey(): string {
  const status = JSON.parse(execFileSync('npx', ['supabase', 'status', '-o', 'json'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) as Record<string, string>;
  return status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;
}

async function waitForMcp(ms: number): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const response = await fetch(LOCAL_MCP_URL, { method: 'POST', body: '{}' });
      // 401 is the answer of the MCP app itself; 502 and 503 mean the function does not run yet.
      if (response.status === 401) return;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`The mcp function did not answer in ${ms} ms.`);
}

/** A proxy that adds the agent token, so the runner reaches the MCP app behind the sign-in. */
function tokenProxy(token: string): Promise<Server> {
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (value === undefined || ['host', 'connection', 'content-length', 'authorization'].includes(name)) continue;
      headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    }
    headers.set('Authorization', `Bearer ${token}`);
    const body = chunks.length > 0 && req.method !== 'GET' && req.method !== 'HEAD' ? Buffer.concat(chunks) : undefined;
    try {
      const upstream = await fetch(LOCAL_MCP_URL, { method: req.method, headers, body });
      const out: Record<string, string> = {};
      upstream.headers.forEach((value, name) => {
        if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(name)) out[name] = value;
      });
      res.writeHead(upstream.status, out);
      res.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) {
      res.writeHead(502).end(String(error));
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/** The server scenarios of the runner (`conformance list`): the lines "  - <name> [...]" under "Server scenarios". */
function serverScenarios(listing = execFileSync('npx', ['conformance', 'list'], { cwd: ROOT, encoding: 'utf8' })): string[] {
  const section = listing.split(/\n\s*\n/).find((part) => part.startsWith('Server scenarios')) ?? '';
  return [...section.matchAll(/^\s+- (\S+)/gm)].map((match) => match[1]);
}

/** The names under "server:" of the baseline YAML. */
function baselineOf(text: string): Set<string> {
  const names = new Set<string>();
  let inServer = false;
  for (const line of text.split('\n')) {
    if (/^\S/.test(line)) inServer = /^server:/.test(line);
    const item = /^\s+-\s+(\S+)/.exec(line);
    if (inServer && item) names.add(item[1]);
  }
  return names;
}

function runScenario(url: string, scenario: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('npx', ['conformance', 'server', '--url', url, '--scenario', scenario], { cwd: ROOT, stdio: 'ignore', detached: true });
    const timer = setTimeout(() => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGTERM');
      } catch {
        // Already gone.
      }
    }, SCENARIO_LIMIT_MS);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

async function main(): Promise<number> {
  const stack = localStack();
  const auth = authOf(stack, 'g3conf');
  const office = await publicOffice();
  const dir = mkdtempSync(join(tmpdir(), 'madar-g3-conformance-'));
  let serve: ChildProcess | undefined;
  let proxy: Server | undefined;
  try {
    const email = auth.email('admin');
    const { authUserId } = await auth.admin.createUser(email, PASSWORD);
    await office.admin.query(RELINK_SQL, ['usr_001', email, authUserId]);
    const person = createClient(stack.apiUrl, stack.publishableKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const signedIn = await person.auth.signInWithPassword({ email, password: PASSWORD });
    if (signedIn.error) throw signedIn.error;
    const token = (await connectAgent(person, await registerClient('MCP conformance runner'))).access_token;

    execFileSync('npm', ['run', 'build:server'], { cwd: ROOT, stdio: 'ignore' });
    const env = join(dir, 'mcp.env');
    writeFileSync(env, Object.entries({
      MADAR_SECRET_KEY: secretKey(),
      APP_URL: 'http://127.0.0.1:5173',
      MAIL_FROM: 'Madar <notices@madar.test>',
      MAIL_DRIVER: 'outbox',
      // Inside the Docker network the pooler is "pooler" (proof.md, E1).
      DATABASE_URL: 'postgres://postgres.pooler-dev:postgres@pooler:6543/postgres',
      SB_REGION: 'local-deno',
      // The function sees SUPABASE_URL http://kong:8000; its tokens name the address of the Mac.
      AUTH_ISSUER: `${LOCAL_API}/auth/v1`,
      MCP_URL: LOCAL_MCP_URL,
    }).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
    serve = spawn('npx', ['supabase', 'functions', 'serve', 'mcp', '--env-file', env], { cwd: ROOT, detached: true, stdio: 'ignore' });
    await waitForMcp(240_000);

    proxy = await tokenProxy(token);
    const url = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}/`;
    const expected = baselineOf(readFileSync(BASELINE, 'utf8'));
    const results: { scenario: string; passed: boolean; expected: boolean }[] = [];
    for (const scenario of serverScenarios()) {
      // The proxy runs in this process, so the runner must not block it: spawn with a promise, not spawnSync.
      const passed = await runScenario(url, scenario);
      results.push({ scenario, passed, expected: expected.has(scenario) });
      console.log(`${passed ? 'pass' : 'fail'}${expected.has(scenario) ? ' (expected failure)' : ''}: ${scenario}`);
    }
    const unexpected = results.filter((r) => !r.passed && !r.expected).map((r) => r.scenario);
    const stale = results.filter((r) => r.passed && r.expected).map((r) => r.scenario);
    if (unexpected.length > 0) console.error(`Failed outside the baseline: ${unexpected.join(', ')}`);
    if (stale.length > 0) console.error(`Passed but listed in the baseline (remove them): ${stale.join(', ')}`);
    console.log(`conformance: ${results.filter((r) => r.passed).length} of ${results.length} scenarios pass; ${results.filter((r) => !r.passed && r.expected).length} expected failures.`);
    return unexpected.length === 0 && stale.length === 0 ? 0 : 1;
  } finally {
    proxy?.close();
    if (serve?.pid) {
      try {
        process.kill(-serve.pid, 'SIGTERM');
      } catch {
        // Already gone.
      }
    }
    await auth.cleanup();
    await office.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

main().then((code) => process.exit(code), (error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
