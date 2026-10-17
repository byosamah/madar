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
const SCRIPTS = ['lib.sh', 'db.sh', 'config.sh', 'functions.sh', 'worker.sh', 'pages.sh', 'checks.sh', 'all.sh'];
/** The node helpers that the shell steps run (owner, 2026-10-16). */
const HELPERS = ['token-scope.sh', 'headers.ts', 'config-check.ts', 'wranglerServer.ts', 'serverHost.ts'];
const HOOK_MIGRATION = 'create function public.madar_access_token_hook(event jsonb) returns jsonb language sql as $$ select event $$;\n';
const REMOTES = (env: string, ref: string) =>
  `\n[remotes.${env}]\nproject_id = "${ref}"\n\n[remotes.${env}.auth]\nsite_url = "https://${env}.madar.example"\nadditional_redirect_urls = ["https://${env}.madar.example"]\n`;

let root = '';
let log = '';
let stubs = '';

/**
 * The curl stub: it logs its arguments. A -K - call (the jobs secret on stdin) keeps its stdin in curl-input and answers the
 * database checks. An -i call answers with headers: STUB_SERVER names the host (supabase by default), STUB_STATUS the status of
 * the health. Every other call answers STUB_CURL, the body of the Supabase health of functions.sh.
 */
const CURL_STUB = `#!/bin/sh
echo "curl $*" >> "$STUB_LOG"
case "$*" in
  *"-K -"*) cat > "$STUB_ROOT/curl-input"; printf '%s' "\${STUB_CHECKS:-{\\"ok\\":true,\\"checks\\":{\\"database\\":\\"ok\\",\\"lock\\":\\"ok\\",\\"asyncContext\\":\\"ok\\"}}}" ;;
  *"/mcp"*) printf 'HTTP/2 %s\\r\\nx-madar-server: %s\\r\\n\\r\\n{}' "\${STUB_MCP_STATUS:-401}" "\${STUB_SERVER:-supabase}" ;;
  *" -i "*) printf 'HTTP/2 %s\\r\\nx-madar-server: %s\\r\\n%s\\r\\n{"ok":true,"host":"x","calls":108}' "\${STUB_STATUS:-200}" "\${STUB_SERVER:-supabase}" "\${STUB_PLACEMENT-cf-placement: remote-FRA\\r\\n}" ;;
  *) printf '%s' "\${STUB_CURL:-{\\"ok\\":true,\\"region\\":\\"eu-central-1\\",\\"calls\\":108}}" ;;
esac
exit 0
`;

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
  for (const file of [...SCRIPTS, ...HELPERS]) {
    const from = join(repo, 'scripts/deploy', file);
    mkdirSync(join(root, 'scripts/deploy'), { recursive: true });
    cpSync(from, join(root, 'scripts/deploy', file));
    chmodSync(join(root, 'scripts/deploy', file), statSync(from).mode);
  }
  cpSync(join(repo, 'scripts/build-remote.ts'), join(root, 'scripts/build-remote.ts'));
  mkdirSync(join(root, 'server/core'), { recursive: true });
  cpSync(join(repo, 'server/core/serverHost.ts'), join(root, 'server/core/serverHost.ts'));
  cpSync(join(repo, 'wrangler.server.toml'), join(root, 'wrangler.server.toml'));
  // Each test starts with the placeholder id of production, as before the first setup; productionHyperdrive() sets one.
  setProductionHyperdrive(PLACEHOLDER_ID);
  cpSync(join(repo, 'config'), join(root, 'config'), { recursive: true });
  // Each test starts from the same server host setting, never from the live one (the test copy may already say workers).
  writeFileSync(join(root, 'config/server-host.json'), '{"test":"supabase","production":"supabase"}\n');
  cpSync(join(repo, 'supabase/config.toml'), join(root, 'supabase/config.toml'));
  cpSync(join(repo, 'supabase/migrations'), join(root, 'supabase/migrations'), { recursive: true });
  log = join(root, 'stub.log');
  writeFileSync(log, '');
  const bin = join(root, 'node_modules/.bin');
  stub(bin, 'supabase', 'if [ -n "${SUPABASE_DB_PASSWORD:-}" ]; then echo "supabase has SUPABASE_DB_PASSWORD" >> "$STUB_LOG"; fi');
  stub(bin, 'wrangler', 'echo "wrangler account $CLOUDFLARE_ACCOUNT_ID" >> "$STUB_LOG"');
  stub(bin, 'tsx');
  stubs = join(root, 'stubs');
  // npm run build:server writes the Worker bundle too (dist-server/worker.js), which worker.sh --prebuilt wants.
  stub(stubs, 'npm', 'case "$*" in *build:remote*) mkdir -p dist && echo "<html></html>" > dist/index.html ;; *build:server*) mkdir -p dist-server && echo "export default {};" > dist-server/worker.js ;; esac');
  // The checks after a deploy (checks.sh) ask with -i for the headers; functions.sh asks for the body of the Supabase health.
  writeFileSync(join(stubs, 'curl'), CURL_STUB, { mode: 0o755 });
  stub(stubs, 'sleep');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Runs one script with a clean environment: no CI, no token, unless the test gives them. `at` is another checkout (a worktree). */
function run(script: string, args: string[], o: { input?: string; env?: Record<string, string>; at?: string } = {}) {
  const at = o.at ?? root;
  const result = spawnSync(join(at, 'scripts/deploy', script), args, {
    cwd: at,
    input: o.input ?? '',
    encoding: 'utf8',
    env: { PATH: `${stubs}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: root, STUB_LOG: log, STUB_ROOT: root, ...o.env },
  });
  return { code: result.status, out: `${result.stdout}${result.stderr}`, calls: readFileSync(log, 'utf8').split('\n').filter(Boolean) };
}

const TOKENS = { SUPABASE_ACCESS_TOKEN: 'sbp_token', MADAR_TEST_DB_PASSWORD: 'pg-test-secret', MADAR_DB_PASSWORD: 'pg-prod-secret' };

/** The copied config.toml without its [remotes.*] blocks (they start at the Madar comment above [remotes.test]). */
function withoutRemotes(): string {
  const text = readFileSync(join(root, 'supabase/config.toml'), 'utf8');
  const at = text.indexOf('\n# Madar: the hosted projects');
  return at === -1 ? text : `${text.slice(0, at)}\n`;
}

function readyForConfigPush(): void {
  writeFileSync(join(root, 'supabase/config.toml'), withoutRemotes() + REMOTES('test', TEST) + REMOTES('production', PRODUCTION));
  writeFileSync(join(root, 'supabase/migrations/20261004000400_platform_auth_hook.sql'), HOOK_MIGRATION);
}

/** git in the copy, without the global hooks and the commit signature of this Mac. */
function git(args: string[], cwd = root): string {
  const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

/** Commits every file of the copy and gives the commit. The first call makes the copy a git checkout; the stubs and their log stay out. */
function commitAll(message = 'deploy test'): string {
  if (!existsSync(join(root, '.git'))) {
    writeFileSync(join(root, '.gitignore'), `${readFileSync(join(repo, '.gitignore'), 'utf8')}\nstub.log\nstubs/\ncurl-input\n`);
    git(['init', '-q']);
  }
  git(['add', '-A']);
  git(['-c', 'user.name=Madar Test', '-c', 'user.email=test@madar.test', 'commit', '-q', '--allow-empty', '-m', message]);
  return git(['rev-parse', 'HEAD']);
}

/** A full all.sh test, then an empty log, so a test sees only the commands of its own later run. */
function deployTest(): void {
  const result = run('all.sh', ['test'], { env: TOKENS });
  expect(result.code, result.out).toBe(0);
  writeFileSync(log, '');
}

const NEW_MIGRATION = 'supabase/migrations/20261005000000_new_table.sql';

describe('every deploy script', () => {
  it('is executable, except the shared library', () => {
    for (const file of [...SCRIPTS, 'token-scope.sh']) {
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
    for (const file of [...SCRIPTS, ...HELPERS, 'secrets.ts', 'cloudflare.ts']) {
      expect(readFileSync(join(repo, 'scripts/deploy', file), 'utf8'), file).not.toContain('\u2014');
    }
  });
});

describe('all.sh production', () => {
  it('stops without the typed word, before any step', () => {
    readyForConfigPush();
    commitAll();
    deployTest();
    for (const input of ['', '\n', 'yes\n', 'Production\n', 'test\n']) {
      const result = run('all.sh', ['production'], { input, env: TOKENS });
      expect(result.code, JSON.stringify(input)).toBe(1);
      expect(result.out).toContain('Type production to go on');
      expect(result.out).toContain('Nothing changed');
      expect(result.calls).toEqual([]);
    }
  });

  it('asks even when MADAR_DEPLOY_CONFIRMED=production comes from the environment, so only a typed word deploys production', () => {
    readyForConfigPush();
    commitAll();
    deployTest();
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
    commitAll();
    deployTest();
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
      // worker.sh skips production while its Hyperdrive id is the placeholder (see the worker.sh tests).
      'npm run build:remote -- production',
      'wrangler pages deploy dist --project-name madar --branch main',
      'wrangler account d76d34779c63849f5acdf3d6af3751cd',
      'curl -sS --max-time 20 -i https://madar.vado.sa/api/health',
      "curl -sS --max-time 20 -i -X POST -H Content-Type: application/json --data {} https://madar.vado.sa/mcp",
    ]);
    expect(result.out).toContain('Skip: [env.production] of wrangler.server.toml has no Hyperdrive id yet');
    expect(result.calls.join('\n')).not.toContain(TEST);
    expect(result.calls.join('\n')).not.toContain('pg-prod-secret');
  });
});

describe('production takes only the commit of the test copy (owner release flow, 2026-10-05)', () => {
  const refused = (result: ReturnType<typeof run>, reason: string) => {
    expect(result.code, result.out).toBe(1);
    expect(result.out).toContain(reason);
    expect(result.out).toContain('Nothing changed');
    expect(result.out).not.toContain('Type production');
    expect(result.calls).toEqual([]);
  };
  const NOT_TESTED = 'did not go to the test copy first';

  it('refuses a commit that never went to the test copy, before the typed word, and runs nothing', () => {
    readyForConfigPush();
    commitAll();
    refused(run('all.sh', ['production'], { input: 'production\n', env: TOKENS }), NOT_TESTED);
  });

  it('refuses a newer commit than the one on the test copy', () => {
    readyForConfigPush();
    commitAll();
    deployTest();
    writeFileSync(join(root, NEW_MIGRATION), 'select 1;\n');
    commitAll('a new migration');
    refused(run('all.sh', ['production'], { input: 'production\n', env: TOKENS }), NOT_TESTED);
  });

  it('refuses changes that are not committed, also a new file, on the commit of the test copy', () => {
    readyForConfigPush();
    commitAll();
    deployTest();
    const tracked = join(root, 'supabase/migrations/20261004000400_platform_auth_hook.sql');
    writeFileSync(tracked, `${HOOK_MIGRATION}select 2;\n`);
    refused(run('all.sh', ['production'], { input: 'production\n', env: TOKENS }), 'not committed');
    git(['checkout', '--', 'supabase/migrations/20261004000400_platform_auth_hook.sql']);
    writeFileSync(join(root, NEW_MIGRATION), 'select 1;\n');
    refused(run('all.sh', ['production'], { input: 'production\n', env: TOKENS }), 'not committed');
  });

  it('refuses a copy that is not a git checkout', () => {
    readyForConfigPush();
    refused(run('all.sh', ['production'], { input: 'production\n', env: TOKENS }), 'git checkout');
  });

  it('records nothing when the test deploy had changes that are not committed', () => {
    readyForConfigPush();
    commitAll();
    writeFileSync(join(root, NEW_MIGRATION), 'select 1;\n');
    const test = run('all.sh', ['test'], { env: TOKENS });
    expect(test.code, test.out).toBe(0);
    expect(test.out).toContain('Not recorded for production');
    rmSync(join(root, NEW_MIGRATION));
    writeFileSync(log, '');
    refused(run('all.sh', ['production'], { input: 'production\n', env: TOKENS }), NOT_TESTED);
  });

  it('forgets the old record when a test deploy stops part way, because the test copy then runs a mix', () => {
    readyForConfigPush();
    commitAll();
    deployTest();
    const test = run('all.sh', ['test'], { env: { ...TOKENS, STUB_FAIL: 'pages deploy' } });
    expect(test.code).not.toBe(0);
    writeFileSync(log, '');
    refused(run('all.sh', ['production'], { input: 'production\n', env: TOKENS }), NOT_TESTED);
  });

  it('records only a full all.sh test, never one step alone', () => {
    readyForConfigPush();
    commitAll();
    const step = run('functions.sh', ['test'], { env: TOKENS });
    expect(step.code, step.out).toBe(0);
    writeFileSync(log, '');
    refused(run('all.sh', ['production'], { input: 'production\n', env: TOKENS }), NOT_TESTED);
  });

  it('checks a step that runs alone for production too, and lets it go on after the test deploy', () => {
    readyForConfigPush();
    commitAll();
    refused(run('db.sh', ['production'], { input: 'production\n', env: TOKENS }), NOT_TESTED);
    deployTest();
    const step = run('db.sh', ['production'], { input: 'production\n', env: TOKENS });
    expect(step.code, step.out).toBe(0);
    expect(step.calls[0]).toBe(`supabase link --project-ref ${PRODUCTION}`);
  });

  it('reads one record for every worktree, so a test deploy from a worktree counts for main at the same commit', () => {
    readyForConfigPush();
    commitAll();
    deployTest();
    const place = mkdtempSync(join(tmpdir(), 'madar-deploy-wt-'));
    try {
      const worktree = join(place, 'wt');
      git(['worktree', 'add', '-q', '--detach', worktree]);
      const result = run('all.sh', ['production'], { input: '', env: TOKENS, at: worktree });
      expect(result.code).toBe(1);
      expect(result.out).not.toContain(NOT_TESTED);
      expect(result.out).toContain('Type production to go on');
      expect(result.calls).toEqual([]);
    } finally {
      rmSync(place, { recursive: true, force: true });
    }
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
  it('refuses a config with no [remotes.test] block, and pushes nothing', () => {
    writeFileSync(join(root, 'supabase/config.toml'), withoutRemotes());
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

describe('token-scope.sh', () => {
  /** A curl stub that logs its arguments and its standard input, and answers with the HTTP code of STUB_CODE. */
  function scopeCurl(): string {
    const input = join(root, 'curl-input');
    writeFileSync(join(stubs, 'curl'), `#!/bin/sh\necho "curl $*" >> "$STUB_LOG"\ncat > "${input}"\nprintf "%s" "$STUB_CODE"\n`, { mode: 0o755 });
    return input;
  }

  it('goes on only when the production project refuses the token', () => {
    for (const code of ['401', '403', '404']) {
      scopeCurl();
      const result = run('token-scope.sh', [], { env: { SUPABASE_ACCESS_TOKEN: 'sbp_scoped_token', STUB_CODE: code } });
      expect(result.code, `${code} ${result.out}`).toBe(0);
    }
  });

  it('stops when the token reaches production, or when the answer is unknown', () => {
    for (const code of ['200', '000', '500', '']) {
      scopeCurl();
      const result = run('token-scope.sh', [], { env: { SUPABASE_ACCESS_TOKEN: 'sbp_wide_token', STUB_CODE: code } });
      expect(result.code, code).toBe(1);
      expect(result.out).toContain('production');
      expect(result.out).not.toContain('sbp_wide_token');
    }
  });

  it('asks the production project, with the token in the standard input of curl, never in its arguments', () => {
    const input = scopeCurl();
    const result = run('token-scope.sh', [], { env: { SUPABASE_ACCESS_TOKEN: 'sbp_scoped_token', STUB_CODE: '403' } });
    expect(result.code, result.out).toBe(0);
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0]).toContain(`https://api.supabase.com/v1/projects/${PRODUCTION}`);
    expect(result.calls[0]).not.toContain('sbp_scoped_token');
    expect(readFileSync(input, 'utf8')).toContain('Authorization: Bearer sbp_scoped_token');
  });

  it('needs the token', () => {
    const result = run('token-scope.sh', [], { env: {} });
    expect(result.code).toBe(1);
    expect(result.out).toContain('SUPABASE_ACCESS_TOKEN');
    expect(result.calls).toEqual([]);
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
    readyForConfigPush();
    commitAll();
    deployTest();
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

const PLACEHOLDER_ID = '00000000000000000000000000000000';

/** Sets the Hyperdrive id of production in the copied wrangler.server.toml. */
function setProductionHyperdrive(id: string): void {
  const file = join(root, 'wrangler.server.toml');
  const text = readFileSync(file, 'utf8');
  const at = text.indexOf('[[env.production.hyperdrive]]');
  const next = `${text.slice(0, at)}${text.slice(at).replace(/id = "[0-9a-f]{32}"/, `id = "${id}"`)}`;
  if (!next.slice(at).includes(`id = "${id}"`)) throw new Error('The copied wrangler.server.toml has no [[env.production.hyperdrive]] id.');
  writeFileSync(file, next);
}

/** Gives the copied wrangler.server.toml a made-up Hyperdrive id for production, as cloudflare-setup.ts would. */
function productionHyperdrive(): void {
  setProductionHyperdrive('0123456789abcdef0123456789abcdef');
}

/** Sets the word of one copy in the copied config/server-host.json. */
function setHost(copy: 'test' | 'production', word: 'supabase' | 'workers' | 'office'): void {
  const file = join(root, 'config/server-host.json');
  const setting = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
  writeFileSync(file, `${JSON.stringify({ ...setting, [copy]: word })}\n`);
}

describe('worker.sh (owner, 2026-10-16)', () => {
  it('builds the server bundles, deploys the test Worker from [env.test], and lists its deployments', () => {
    const result = run('worker.sh', ['test'], { env: TOKENS });
    expect(result.code, result.out).toBe(0);
    expect(result.calls).toEqual([
      'npm run build:server',
      'wrangler deploy -c wrangler.server.toml --env test',
      'wrangler account d76d34779c63849f5acdf3d6af3751cd',
      'wrangler deployments list -c wrangler.server.toml --env test',
      'wrangler account d76d34779c63849f5acdf3d6af3751cd',
    ]);
    expect(result.out).toContain('madar-server-test is deployed');
  });

  it('with --prebuilt, deploys the bundle of an earlier step and builds nothing; without the bundle it stops', () => {
    const missing = run('worker.sh', ['test', '--prebuilt'], { env: TOKENS });
    expect(missing.code).toBe(1);
    expect(missing.out).toContain('dist-server/worker.js is missing');
    expect(missing.calls).toEqual([]);
    mkdirSync(join(root, 'dist-server'), { recursive: true });
    writeFileSync(join(root, 'dist-server/worker.js'), 'export default {};\n');
    const result = run('worker.sh', ['test', '--prebuilt'], { env: TOKENS });
    expect(result.code, result.out).toBe(0);
    expect(result.calls[0]).toBe('wrangler deploy -c wrangler.server.toml --env test');
    expect(result.calls).not.toContain('npm run build:server');
  });

  it('stops with the usage for an unknown option, and runs nothing', () => {
    const result = run('worker.sh', ['test', '--fast'], { env: TOKENS });
    expect(result.code).toBe(2);
    expect(result.out).toMatch(/Usage: worker\.sh <test\|production> \[--prebuilt\]/);
    expect(result.calls).toEqual([]);
  });

  it('skips a copy whose Hyperdrive id is still the placeholder, with a clear line, and deploys nothing', () => {
    readyForConfigPush();
    commitAll();
    deployTest();
    const result = run('worker.sh', ['production'], { input: 'production\n', env: TOKENS });
    expect(result.code, result.out).toBe(0);
    expect(result.out).toContain('Skip: [env.production] of wrangler.server.toml has no Hyperdrive id yet, so madar-server-production is not deployed');
    expect(result.calls).toEqual([]);
  });

  it('deploys production only after the typed word, from the recorded commit, to the production Worker only', () => {
    productionHyperdrive();
    readyForConfigPush();
    commitAll();
    deployTest();
    const refused = run('worker.sh', ['production'], { input: 'yes\n', env: TOKENS });
    expect(refused.code).toBe(1);
    expect(refused.calls).toEqual([]);
    const result = run('worker.sh', ['production'], { input: 'production\n', env: TOKENS });
    expect(result.code, result.out).toBe(0);
    expect(result.calls).toContain('wrangler deploy -c wrangler.server.toml --env production');
    expect(result.calls.join('\n')).not.toContain('--env test');
  });

  it('refuses production in CI, before any step', () => {
    productionHyperdrive();
    const result = run('worker.sh', ['production'], { input: 'production\n', env: { ...TOKENS, CI: 'true' } });
    expect(result.code).toBe(1);
    expect(result.out).toContain('from the Mac only');
    expect(result.calls).toEqual([]);
  });
});

describe('all.sh with the Worker (owner, 2026-10-16)', () => {
  it('runs the Worker after the functions with their bundle, then the screens, then the checks through the page host', () => {
    productionHyperdrive();
    readyForConfigPush();
    commitAll();
    deployTest();
    const result = run('all.sh', ['production'], { input: 'production\n', env: TOKENS });
    expect(result.code, result.out).toBe(0);
    const at = (call: string) => result.calls.indexOf(call);
    expect(at('wrangler deploy -c wrangler.server.toml --env production')).toBeGreaterThan(at(`supabase functions deploy api mcp jobs --project-ref ${PRODUCTION} --use-api`));
    expect(at('wrangler pages deploy dist --project-name madar --branch main')).toBeGreaterThan(at('wrangler deployments list -c wrangler.server.toml --env production'));
    expect(at('curl -sS --max-time 20 -i https://madar.vado.sa/api/health')).toBeGreaterThan(at('wrangler pages deploy dist --project-name madar --branch main'));
    expect(result.calls.filter((call) => call === 'npm run build:server')).toHaveLength(1);
    expect(result.calls.join('\n')).not.toContain(TEST);
  });

  it('stops after the screens when the checks fail, so a test deploy with a wrong host records no commit', () => {
    readyForConfigPush();
    commitAll();
    const result = run('all.sh', ['test'], { env: { ...TOKENS, STUB_SERVER: 'workers;colo=FRA' } });
    expect(result.code).toBe(1);
    expect(result.out).toContain('did not answer 200 from the host supabase');
    expect(result.out).not.toContain('Production may now take it');
  });
});

describe('checks.sh (owner, 2026-10-16)', () => {
  it('checks the health and the MCP answer through the page host of the copy, from the host of the setting', () => {
    const result = run('checks.sh', ['test'], { env: {} });
    expect(result.code, result.out).toBe(0);
    expect(result.calls).toEqual([
      'curl -sS --max-time 20 -i https://preview.madar-46r.pages.dev/api/health',
      "curl -sS --max-time 20 -i -X POST -H Content-Type: application/json --data {} https://preview.madar-46r.pages.dev/mcp",
    ]);
    expect(result.out).toContain('answers from supabase');
    expect(result.out).toContain('cf-placement: remote-FRA');
    expect(result.out).toContain('Skip: secrets/test.env has no JOBS_SECRET');
  });

  it('goes on when the answer has no cf-placement header (the Supabase host never sends one)', () => {
    const result = run('checks.sh', ['test'], { env: { STUB_PLACEMENT: '' } });
    expect(result.code, result.out).toBe(0);
    expect(result.out).toContain('answers from supabase');
    expect(result.out).not.toContain('cf-placement');
    expect(result.out).toContain('The quick checks of test passed on the host supabase.');
  });

  it('wants workers;colo=<data center> when the setting says workers, and refuses an answer from Supabase', () => {
    setHost('test', 'workers');
    const good = run('checks.sh', ['test'], { env: { STUB_SERVER: 'workers;colo=FRA' } });
    expect(good.code, good.out).toBe(0);
    expect(good.out).toContain('answers from workers;colo=FRA');
    const unknown = run('checks.sh', ['test'], { env: { STUB_SERVER: 'workers;colo=unknown' } });
    expect(unknown.code, unknown.out).toBe(0);
    expect(unknown.out).toContain('colo=unknown');
    writeFileSync(log, '');
    const wrong = run('checks.sh', ['test'], { env: { STUB_SERVER: 'supabase' } });
    expect(wrong.code).toBe(1);
    expect(wrong.out).toContain('did not answer 200 from the host workers');
    expect(wrong.calls.filter((call) => call.includes('/api/health'))).toHaveLength(6);
  });

  it('refuses an MCP answer that is not 401, or that comes from the other host', () => {
    const status = run('checks.sh', ['test'], { env: { STUB_MCP_STATUS: '200' } });
    expect(status.code).toBe(1);
    expect(status.out).toContain('must give 401 from the host supabase');
    setHost('test', 'workers');
    const host = run('checks.sh', ['test'], { env: { STUB_SERVER: 'workers;colo=FRA', STUB_MCP_STATUS: '401' } });
    expect(host.code, host.out).toBe(0);
  });

  it('sends the jobs secret to curl on stdin only, never as an argument, and wants the three database checks', () => {
    mkdirSync(join(root, 'secrets'), { recursive: true });
    writeFileSync(join(root, 'secrets/test.env'), 'APP_URL=https://x\nJOBS_SECRET="jobs-secret-value-9"\n', { mode: 0o600 });
    const result = run('checks.sh', ['test'], { env: {} });
    expect(result.code, result.out).toBe(0);
    expect(result.out).toContain('Database check: database, lock and asyncContext ok.');
    expect(readFileSync(join(root, 'curl-input'), 'utf8')).toBe('header = "x-madar-jobs-secret: jobs-secret-value-9"\n');
    expect(result.calls).toContain('curl -sS --max-time 20 -K - https://preview.madar-46r.pages.dev/api/health');
    expect(result.calls.join('\n')).not.toContain('jobs-secret-value-9');
    expect(result.out).not.toContain('jobs-secret-value-9');
    const failed = run('checks.sh', ['test'], { env: { STUB_CHECKS: '{"ok":false,"checks":{"database":"ok","lock":"failed","asyncContext":"ok"}}' } });
    expect(failed.code).toBe(1);
    expect(failed.out).toContain('did not give database, lock and asyncContext ok');
  });

  it('checks the production page host for production, and needs no typed word: it only reads', () => {
    const result = run('checks.sh', ['production'], { input: '', env: {} });
    expect(result.code, result.out).toBe(0);
    expect(result.calls[0]).toBe('curl -sS --max-time 20 -i https://madar.vado.sa/api/health');
    expect(result.out).not.toContain('Type production');
  });

  it('stops on a setting with another word, before any call', () => {
    writeFileSync(join(root, 'config/server-host.json'), '{"test":"worker","production":"supabase"}\n');
    const result = run('checks.sh', ['test'], { env: {} });
    expect(result.code).not.toBe(0);
    expect(result.calls).toEqual([]);
  });
});

describe('all.sh, worker.sh and checks.sh on an office copy (exit wave 4)', () => {
  const OFFICE_HEALTH = '{"ok":true,"host":"office","office":{"schema":3,"lastJob":null}}';

  it('runs only the Worker secrets, the Worker with MADAR_DATA = office, the screens and the checks: no Supabase step', () => {
    setHost('test', 'office');
    mkdirSync(join(root, 'secrets'), { recursive: true });
    writeFileSync(join(root, 'secrets/test.env'), 'APP_URL=https://x\nJOBS_SECRET=jobs-secret-value-9\n', { mode: 0o600 });
    const result = run('all.sh', ['test'], { env: { STUB_SERVER: 'office;colo=FRA', STUB_CHECKS: OFFICE_HEALTH } });
    expect(result.code, result.out).toBe(0);
    expect(result.out).toContain('The test copy runs on its office object: db.sh, config.sh and functions.sh stay out.');
    expect(result.calls.filter((call) => call.startsWith('supabase '))).toEqual([]);
    expect(result.calls).toContain('tsx ' + join(root, 'scripts/deploy/secrets.ts') + ' test --office');
    expect(result.calls).toContain('npm run build:server');
    expect(result.calls).toContain('wrangler deploy -c wrangler.server.toml --env test --var MADAR_DATA:office');
    expect(result.out).toContain('Office check: the office object answers with its schema and its last job.');
    expect(result.out).toContain('The quick checks of test passed on the host office.');
  });

  it('deploys a copy of another word with no MADAR_DATA var, as before', () => {
    const result = run('worker.sh', ['test'], { env: TOKENS });
    expect(result.code, result.out).toBe(0);
    expect(result.calls).toContain('wrangler deploy -c wrangler.server.toml --env test');
    expect(result.calls.join('\n')).not.toContain('MADAR_DATA');
  });

  it('refuses an office health answer that has no office object, and an answer from another host', () => {
    setHost('test', 'office');
    mkdirSync(join(root, 'secrets'), { recursive: true });
    writeFileSync(join(root, 'secrets/test.env'), 'APP_URL=https://x\nJOBS_SECRET=jobs-secret-value-9\n', { mode: 0o600 });
    const plain = run('checks.sh', ['test'], { env: { STUB_SERVER: 'office;colo=FRA' } });
    expect(plain.code).toBe(1);
    expect(plain.out).toContain('did not give the office object');
    writeFileSync(log, '');
    const other = run('checks.sh', ['test'], { env: { STUB_SERVER: 'workers;colo=FRA', STUB_CHECKS: OFFICE_HEALTH } });
    expect(other.code).toBe(1);
    expect(other.out).toContain('did not answer 200 from the host office');
  });
});
