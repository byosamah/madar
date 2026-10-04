import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * The deploy scripts of plan 5.9 (task O3), run for real in a copy of the repository with stub CLIs: supabase, wrangler and tsx in
 * node_modules/.bin, npm, curl and sleep on the PATH. Each stub writes its arguments to a log, so a test sees every command a
 * script would run, in order, and that nothing ran after a refusal. No test reaches the network or a cloud project.
 */
const repo = fileURLToPath(new URL('../../', import.meta.url));
const TEST = 'qdgwpnesxppnqsaabqzd';
const PRODUCTION = 'oprkvdjudjxxhvodkzgs';
const SCRIPTS = ['lib.sh', 'db.sh', 'config.sh', 'functions.sh', 'pages.sh', 'all.sh'];
const HOOK_MIGRATION = 'create function public.madar_access_token_hook(event jsonb) returns jsonb language sql as $$ select event $$;\n';
const REMOTES = (env: string, ref: string) =>
  `\n[remotes.${env}]\nproject_id = "${ref}"\n\n[remotes.${env}.auth]\nsite_url = "https://${env}.madar.example"\nadditional_redirect_urls = ["https://${env}.madar.example"]\n`;

let root = '';
let log = '';
let stubs = '';

const STUB = (name: string, body = '') => `#!/bin/sh
echo "${name} $*" >> "$STUB_LOG"
if [ -n "\${STUB_FAIL:-}" ]; then case "${name} $*" in *"$STUB_FAIL"*) exit 1 ;; esac; fi
${body}
exit 0
`;

function stub(dir: string, name: string, body = ''): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), STUB(name, body), { mode: 0o755 });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'madar-deploy-'));
  for (const file of [...SCRIPTS, 'headers.ts', 'config-check.ts']) {
    const from = join(repo, 'scripts/deploy', file);
    mkdirSync(join(root, 'scripts/deploy'), { recursive: true });
    cpSync(from, join(root, 'scripts/deploy', file));
    chmodSync(join(root, 'scripts/deploy', file), statSync(from).mode);
  }
  cpSync(join(repo, 'scripts/build-remote.ts'), join(root, 'scripts/build-remote.ts'));
  cpSync(join(repo, 'config'), join(root, 'config'), { recursive: true });
  cpSync(join(repo, 'supabase/config.toml'), join(root, 'supabase/config.toml'));
  cpSync(join(repo, 'supabase/migrations'), join(root, 'supabase/migrations'), { recursive: true });
  log = join(root, 'stub.log');
  writeFileSync(log, '');
  const bin = join(root, 'node_modules/.bin');
  stub(bin, 'supabase', 'if [ -n "${SUPABASE_DB_PASSWORD:-}" ]; then echo "supabase has SUPABASE_DB_PASSWORD" >> "$STUB_LOG"; fi');
  stub(bin, 'wrangler', 'echo "wrangler account $CLOUDFLARE_ACCOUNT_ID" >> "$STUB_LOG"');
  stub(bin, 'tsx');
  stubs = join(root, 'stubs');
  stub(stubs, 'npm', 'case "$*" in *build:remote*) mkdir -p dist && echo "<html></html>" > dist/index.html ;; esac');
  stub(stubs, 'curl', 'printf "%s" "${STUB_CURL:-{\\"ok\\":true,\\"region\\":\\"eu-central-1\\",\\"calls\\":108}}"');
  stub(stubs, 'sleep');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Runs one script with a clean environment: no CI, no token, unless the test gives them. */
function run(script: string, args: string[], o: { input?: string; env?: Record<string, string> } = {}) {
  const result = spawnSync(join(root, 'scripts/deploy', script), args, {
    cwd: root,
    input: o.input ?? '',
    encoding: 'utf8',
    env: { PATH: `${stubs}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: root, STUB_LOG: log, ...o.env },
  });
  return { code: result.status, out: `${result.stdout}${result.stderr}`, calls: readFileSync(log, 'utf8').split('\n').filter(Boolean) };
}

const TOKENS = { SUPABASE_ACCESS_TOKEN: 'sbp_token', MADAR_TEST_DB_PASSWORD: 'pg-test-secret', MADAR_DB_PASSWORD: 'pg-prod-secret' };

function readyForConfigPush(): void {
  writeFileSync(join(root, 'supabase/config.toml'), readFileSync(join(root, 'supabase/config.toml'), 'utf8') + REMOTES('test', TEST) + REMOTES('production', PRODUCTION));
  writeFileSync(join(root, 'supabase/migrations/20261004000400_platform_auth_hook.sql'), HOOK_MIGRATION);
}

describe('every deploy script', () => {
  it('is executable, except the shared library', () => {
    for (const file of SCRIPTS) {
      const executable = (statSync(join(repo, 'scripts/deploy', file)).mode & 0o111) !== 0;
      expect(executable, file).toBe(file !== 'lib.sh');
    }
  });

  it('stops with the usage for a missing or unknown environment, and runs nothing', () => {
    for (const script of SCRIPTS.filter((file) => file !== 'lib.sh')) {
      for (const args of [[], ['staging'], ['prod']]) {
        const result = run(script, args, { env: TOKENS });
        expect(result.code, `${script} ${args.join(' ')}`).toBe(2);
        expect(result.out).toMatch(/Usage: .* <test\|production>/);
        expect(result.calls).toEqual([]);
      }
    }
  });

  it('needs the Madar access token for every Supabase step, so the Halulu sign-in of the CLI is never used', () => {
    for (const script of ['db.sh', 'config.sh', 'functions.sh']) {
      const result = run(script, ['test'], { env: { MADAR_TEST_DB_PASSWORD: 'x' } });
      expect(result.code, script).toBe(1);
      expect(result.out).toContain('SUPABASE_ACCESS_TOKEN');
      expect(result.calls).toEqual([]);
    }
  });

  it('has no em dash', () => {
    for (const file of [...SCRIPTS, 'headers.ts', 'config-check.ts', 'secrets.ts']) {
      expect(readFileSync(join(repo, 'scripts/deploy', file), 'utf8'), file).not.toContain('\u2014');
    }
  });
});

describe('all.sh production', () => {
  it('stops without the typed word, before any step', () => {
    for (const input of ['', '\n', 'yes\n', 'Production\n', 'test\n']) {
      const result = run('all.sh', ['production'], { input, env: TOKENS });
      expect(result.code, JSON.stringify(input)).toBe(1);
      expect(result.out).toContain('Type production to go on');
      expect(result.out).toContain('Nothing changed');
      expect(result.calls).toEqual([]);
    }
  });

  it('asks even when MADAR_DEPLOY_CONFIRMED=production comes from the environment, so only a typed word deploys production', () => {
    const result = run('all.sh', ['production'], { input: '', env: { ...TOKENS, MADAR_DEPLOY_CONFIRMED: 'production' } });
    expect(result.code).toBe(1);
    expect(result.out).toContain('Type production to go on');
    expect(result.out).toContain('Nothing changed');
    expect(result.calls).toEqual([]);
  });

  it('stops in GitHub Actions or any CI even with the typed word (plan, section 10, decision 9)', () => {
    for (const ci of [{ CI: 'true' }, { GITHUB_ACTIONS: 'true' }] as Record<string, string>[]) {
      const result = run('all.sh', ['production'], { input: 'production\n', env: { ...TOKENS, ...ci } });
      expect(result.code).toBe(1);
      expect(result.out).toContain('from the Mac only');
      expect(result.out).not.toContain('Type production');
      expect(result.calls).toEqual([]);
    }
  });

  it('with the typed word, asks once and runs every step on the production project only', () => {
    readyForConfigPush();
    const result = run('all.sh', ['production'], { input: 'production\n', env: TOKENS });
    expect(result.out.match(/Type production to go on/g)).toHaveLength(1);
    expect(result.code, result.out).toBe(0);
    expect(result.calls).toEqual([
      `supabase link --project-ref ${PRODUCTION}`,
      'supabase has SUPABASE_DB_PASSWORD',
      'supabase db push --linked --dry-run',
      'supabase has SUPABASE_DB_PASSWORD',
      'supabase db push --linked --yes',
      'supabase has SUPABASE_DB_PASSWORD',
      'supabase unlink',
      'supabase has SUPABASE_DB_PASSWORD',
      `supabase config diff --project-ref ${PRODUCTION}`,
      `supabase config push --project-ref ${PRODUCTION} --yes`,
      `tsx ${root}/scripts/deploy/secrets.ts production`,
      'npm run build:server',
      `supabase functions deploy api mcp jobs --project-ref ${PRODUCTION} --use-api`,
      `curl -fsS --max-time 20 https://${PRODUCTION}.supabase.co/functions/v1/api/health?forceFunctionRegion=eu-central-1`,
      'npm run build:remote -- production',
      'wrangler pages deploy dist --project-name madar --branch main',
      'wrangler account d76d34779c63849f5acdf3d6af3751cd',
    ]);
    expect(result.calls.join('\n')).not.toContain(TEST);
    expect(result.calls.join('\n')).not.toContain('pg-prod-secret');
  });
});

describe('db.sh', () => {
  it('links with the Madar token, pushes, and unlinks again, with the password in the environment, never in an argument', () => {
    const result = run('db.sh', ['test'], { env: TOKENS });
    expect(result.code, result.out).toBe(0);
    const commands = result.calls.filter((call) => !call.endsWith('SUPABASE_DB_PASSWORD'));
    expect(commands).toEqual([`supabase link --project-ref ${TEST}`, 'supabase db push --linked --dry-run', 'supabase db push --linked --yes', 'supabase unlink']);
    expect(result.calls).toContain('supabase has SUPABASE_DB_PASSWORD');
    expect(result.calls.join('\n')).not.toContain('pg-test-secret');
  });

  it('unlinks even when the push fails', () => {
    const result = run('db.sh', ['test'], { env: { ...TOKENS, STUB_FAIL: 'db push --linked --yes' } });
    expect(result.code).not.toBe(0);
    expect(result.calls.filter((call) => !call.endsWith('SUPABASE_DB_PASSWORD')).at(-1)).toBe('supabase unlink');
  });

  it('needs the postgres password of the chosen project', () => {
    const result = run('db.sh', ['test'], { env: { SUPABASE_ACCESS_TOKEN: 't', MADAR_DB_PASSWORD: 'p' } });
    expect(result.code).toBe(1);
    expect(result.out).toContain('MADAR_TEST_DB_PASSWORD');
    expect(result.calls).toEqual([]);
  });
});

describe('config.sh', () => {
  it('refuses the config of today, which has no [remotes.test] block, and pushes nothing', () => {
    const result = run('config.sh', ['test'], { env: TOKENS });
    expect(result.code).toBe(1);
    expect(result.out).toContain('[remotes.test]');
    expect(result.calls).toEqual([]);
  });

  it('shows the difference and pushes once the block and the hook migration are there', () => {
    readyForConfigPush();
    const result = run('config.sh', ['test'], { env: TOKENS });
    expect(result.code, result.out).toBe(0);
    expect(result.calls).toEqual([`supabase config diff --project-ref ${TEST}`, `supabase config push --project-ref ${TEST} --yes`]);
  });
});

describe('functions.sh', () => {
  it('bundles, deploys the three functions with --use-api, and asks the health check in Frankfurt with forceFunctionRegion', () => {
    const result = run('functions.sh', ['test'], { env: TOKENS });
    expect(result.code, result.out).toBe(0);
    expect(result.calls).toEqual([
      'npm run build:server',
      `supabase functions deploy api mcp jobs --project-ref ${TEST} --use-api`,
      `curl -fsS --max-time 20 https://${TEST}.supabase.co/functions/v1/api/health?forceFunctionRegion=eu-central-1`,
    ]);
  });

  it('with --prebuilt, deploys the bundles of an earlier build step and builds nothing, so the token never meets the build', () => {
    mkdirSync(join(root, 'supabase/functions/_build'), { recursive: true });
    for (const name of ['api', 'mcp', 'jobs']) writeFileSync(join(root, `supabase/functions/_build/${name}.js`), 'export default {};\n');
    const result = run('functions.sh', ['test', '--prebuilt'], { env: TOKENS });
    expect(result.code, result.out).toBe(0);
    expect(result.calls).toEqual([
      `supabase functions deploy api mcp jobs --project-ref ${TEST} --use-api`,
      `curl -fsS --max-time 20 https://${TEST}.supabase.co/functions/v1/api/health?forceFunctionRegion=eu-central-1`,
    ]);
  });

  it('with --prebuilt, stops before the deploy when a bundle is missing', () => {
    mkdirSync(join(root, 'supabase/functions/_build'), { recursive: true });
    writeFileSync(join(root, 'supabase/functions/_build/api.js'), 'export default {};\n');
    const result = run('functions.sh', ['test', '--prebuilt'], { env: TOKENS });
    expect(result.code).toBe(1);
    expect(result.out).toContain('supabase/functions/_build/mcp.js');
    expect(result.calls).toEqual([]);
  });

  it('stops with the usage for an unknown option, and runs nothing', () => {
    const result = run('functions.sh', ['test', '--fast'], { env: TOKENS });
    expect(result.code).toBe(2);
    expect(result.out).toMatch(/Usage: functions\.sh <test\|production> \[--prebuilt\]/);
    expect(result.calls).toEqual([]);
  });

  it('fails when api answers from another region, after its retries', () => {
    const result = run('functions.sh', ['test'], { env: { ...TOKENS, STUB_CURL: '{"ok":true,"region":"us-east-1","calls":108}' } });
    expect(result.code).toBe(1);
    expect(result.out).toContain('did not answer from eu-central-1');
    expect(result.calls.filter((call) => call.startsWith('curl '))).toHaveLength(6);
  });
});

describe('pages.sh', () => {
  const hosts = (text: string) => [...new Set([...text.matchAll(/(?:https|wss):\/\/[^\s;]+/g)].map((match) => match[0]))].sort();

  it('builds test, writes dist/_headers with the test hosts and no other, and uploads to the preview branch', () => {
    const result = run('pages.sh', ['test'], { env: {} });
    expect(result.code, result.out).toBe(0);
    expect(result.calls).toEqual([
      'npm run build:remote -- test',
      'wrangler pages deploy dist --project-name madar --branch preview',
      'wrangler account d76d34779c63849f5acdf3d6af3751cd',
    ]);
    const headers = readFileSync(join(root, 'dist/_headers'), 'utf8');
    expect(hosts(headers)).toEqual([`https://${TEST}.supabase.co`, `wss://${TEST}.supabase.co`]);
    expect(headers).toMatch(/img-src 'self' data: blob: https:\/\/qdgwpnesxppnqsaabqzd\.supabase\.co;/);
  });

  it('writes the production hosts and no other for production, after the typed word', () => {
    const result = run('pages.sh', ['production'], { input: 'production\n', env: {} });
    expect(result.code, result.out).toBe(0);
    expect(hosts(readFileSync(join(root, 'dist/_headers'), 'utf8'))).toEqual([`https://${PRODUCTION}.supabase.co`, `wss://${PRODUCTION}.supabase.co`]);
    expect(result.calls).toContain('wrangler pages deploy dist --project-name madar --branch main');
  });

  it('names the R2 host for the files once MADAR_FILE_STORE is r2', () => {
    const result = run('pages.sh', ['test'], { env: { MADAR_FILE_STORE: 'r2', R2_ACCOUNT_ID: 'd76d34779c63849f5acdf3d6af3751cd' } });
    expect(result.code, result.out).toBe(0);
    const headers = readFileSync(join(root, 'dist/_headers'), 'utf8');
    expect(hosts(headers)).toEqual(['https://d76d34779c63849f5acdf3d6af3751cd.eu.r2.cloudflarestorage.com', `https://${TEST}.supabase.co`, `wss://${TEST}.supabase.co`]);
  });

  it('refuses a public file without the publishable key, before the build', () => {
    writeFileSync(join(root, 'config/remote.test.env'), 'VITE_SUPABASE_URL=https://qdgwpnesxppnqsaabqzd.supabase.co\nVITE_SUPABASE_PUBLISHABLE_KEY=\n');
    const result = run('pages.sh', ['test'], { env: {} });
    expect(result.code).toBe(1);
    expect(result.out).toContain('VITE_SUPABASE_PUBLISHABLE_KEY');
    expect(result.calls).toEqual([]);
    expect(existsSync(join(root, 'dist/_headers'))).toBe(false);
  });
});
