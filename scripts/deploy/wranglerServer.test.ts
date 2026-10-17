import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { unstable_readConfig } from 'wrangler';
import { COPIES, COPY_HOSTS } from '../../server/core/serverHost';
import { PLACEHOLDER_ID, hyperdriveIdOf, workerConfigOf } from './wranglerServer.ts';

/** wrangler.server.toml (owner, 2026-10-16): the local top level, and one Worker for each copy. */
const read = (name: string) => readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8');
const toml = read('wrangler.server.toml');
const accounts = read('docs/superpowers/real-build/accounts.md');
/** An AWS region name, as server/mcp/forward.ts reads SB_REGION. A label that matches would start an MCP region hop. */
const AWS_REGION = /^[a-z]{2}(?:-[a-z]+)+-\d+$/;

describe('wrangler.server.toml', () => {
  it('keeps the top level for local runs: the name, the bundle, no public address, the local Hyperdrive placeholder', () => {
    const top = workerConfigOf(toml, '');
    expect(top).toMatchObject({ name: 'madar-server', main: 'dist-server/worker.js', workersDev: false });
    expect(top.hyperdrive).toEqual([{ binding: 'DB', id: PLACEHOLDER_ID }]);
    expect(top.placementRegion).toBeUndefined();
  });

  for (const copy of COPIES) {
    describe(`[env.${copy}]`, () => {
      const env = workerConfigOf(toml, copy);

      it(`deploys as ${COPY_HOSTS[copy].workers.name}: Wrangler adds the env name to the top-level name`, () => {
        expect(env.name).toBeUndefined();
        expect(`${workerConfigOf(toml, '').name}-${copy}`).toBe(COPY_HOSTS[copy].workers.name);
      });

      it('has no public address, and no preview address for old versions', () => {
        expect(env.workersDev).toBe(false);
        expect(env.previewUrls).toBe(false);
      });

      it('runs next to the database (aws:eu-central-1), with its logs on', () => {
        expect(env.placementRegion).toBe('aws:eu-central-1');
        expect(env.observability).toBe(true);
      });

      it('gets the database through its own Hyperdrive binding DB', () => {
        expect(env.hyperdrive).toHaveLength(1);
        expect(env.hyperdrive[0].binding).toBe('DB');
        expect(env.hyperdrive[0].id).toMatch(/^[0-9a-f]{32}$/);
      });

      it('holds the public vars SUPABASE_URL of its own project and a region label that starts no MCP hop, and nothing else', () => {
        expect(Object.keys(env.vars).sort()).toEqual(['SUPABASE_URL', 'WORKER_REGION']);
        expect(env.vars.SUPABASE_URL).toBe(COPY_HOSTS[copy].supabaseUrl);
        expect(env.vars.WORKER_REGION).toBe('workers-eu-central-1');
        expect(env.vars.WORKER_REGION).not.toMatch(AWS_REGION);
      });
    });
  }

  it('binds the test Worker to madar-db-test (the session pooler of the probe), the id that accounts.md records', () => {
    const id = hyperdriveIdOf(toml, 'test');
    expect(id).toBe('1c4fc4b830234fad8956b6e80c52f4fc');
    expect(accounts).toMatch(new RegExp(`madar-db-test\` \\(madar-test, session pooler, port 5432\\) \\| \`${id}\``));
    expect(hyperdriveIdOf(toml, 'production')).not.toBe(id);
  });

  it('never binds a copy to the Hyperdrive config of the transaction pooler (its queries hang, proof.md)', () => {
    for (const copy of COPIES) expect(workerConfigOf(toml, copy).hyperdrive[0].id).not.toBe('5dee5c010db64061a45c5fd3ff592136');
  });

  it('holds no secret: no password in a URL, no key, no certificate, no secret name', () => {
    expect(toml).not.toMatch(/:\/\/[^/\s"]+:[^@\s"]+@/);
    expect(toml).not.toMatch(/sb_secret_|sb_publishable_|re_[A-Za-z0-9]{8,}|-----BEGIN|eyJ[A-Za-z0-9_-]{10,}/);
    for (const name of ['DATABASE_URL', 'MADAR_SECRET_KEY', 'JOBS_SECRET', 'RESEND_API_KEY', 'R2_SECRET_ACCESS_KEY', 'VAPID_PRIVATE_KEY']) {
      expect(toml).not.toMatch(new RegExp(`^\\s*${name}\\s*=`, 'm'));
    }
  });
});

describe('hyperdriveIdOf', () => {
  it('gives nothing for the placeholder, a missing binding or a broken id', () => {
    const at = (id: string) => `name = "madar-server"\n[env.production]\nworkers_dev = false\n[[env.production.hyperdrive]]\nbinding = "DB"\nid = "${id}"\n`;
    expect(hyperdriveIdOf(at(PLACEHOLDER_ID), 'production')).toBeUndefined();
    expect(hyperdriveIdOf(at('xyz'), 'production')).toBeUndefined();
    expect(hyperdriveIdOf('name = "madar-server"\n', 'production')).toBeUndefined();
    expect(hyperdriveIdOf(at('0123456789abcdef0123456789abcdef'), 'production')).toBe('0123456789abcdef0123456789abcdef');
    expect(hyperdriveIdOf(at('0123456789abcdef0123456789abcdef'), 'test')).toBeUndefined();
  });

  it('runs with plain node and prints the id of an env, or nothing for the placeholder', () => {
    const script = fileURLToPath(new URL('./wranglerServer.ts', import.meta.url));
    const run = (env: string) => spawnSync(process.execPath, [script, 'hyperdrive', env], { encoding: 'utf8' });
    expect(run('test').stdout).toBe(hyperdriveIdOf(toml, 'test'));
    expect(run('production').stdout).toBe(hyperdriveIdOf(toml, 'production') ?? '');
    expect(run('staging').status).toBe(2);
  });
});

describe('the office object in wrangler.server.toml (exit wave 3)', () => {
  const file = fileURLToPath(new URL('../../wrangler.server.toml', import.meta.url));
  const read = (env?: 'test' | 'production') => unstable_readConfig({ config: file, env }, { hideWarnings: true });

  it('gives the office object to local runs and to the test Worker, and none to production', () => {
    const office = [{ name: 'OFFICE', class_name: 'Office' }];
    expect(read().durable_objects.bindings).toEqual(office);
    expect(read('test').durable_objects.bindings).toEqual(office);
    expect(read('production').durable_objects.bindings).toEqual([]);
    expect(read('test').migrations).toEqual([{ tag: 'office-v1', new_sqlite_classes: ['Office'] }]);
    expect(read('production').migrations).toEqual([]);
  });

  it('sets MADAR_DATA in no env, so no deployed Worker takes the office path in wave 3', () => {
    for (const env of [undefined, 'test', 'production'] as const) expect(read(env).vars.MADAR_DATA).toBeUndefined();
  });
});
