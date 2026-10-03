import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import config from '../vite.config.ts';

type Project = { test: { name: string; include?: string[]; exclude?: string[]; globalSetup?: string[]; setupFiles?: string[]; fileParallelism?: boolean; testTimeout?: number } };

const saved = { db: process.env.MADAR_DB, it: process.env.MADAR_IT };

afterEach(() => {
  for (const [name, value] of [['MADAR_DB', saved.db], ['MADAR_IT', saved.it]] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

/** The test projects that vite.config.ts gives for the environment of this moment. */
function projects(env: { MADAR_DB?: string; MADAR_IT?: string } = {}): Project[] {
  delete process.env.MADAR_DB;
  delete process.env.MADAR_IT;
  Object.assign(process.env, env);
  const resolved = (config as unknown as (e: { mode: string; command: string }) => { test: { projects: Project[] } })({ mode: 'test', command: 'serve' });
  return resolved.test.projects;
}
const named = (list: Project[], name: string) => list.find((p) => p.test.name === name);

const scripts = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { scripts: Record<string, string> }).scripts;
const DOCKER_SCRIPT_TESTS = ['scripts/first-admin.test.ts', 'scripts/restore-check.test.ts'];

describe('the Vitest projects', () => {
  it('are only unit and server in a bare run, so a run by path never needs Docker or runs a file twice', () => {
    expect(projects().map((p) => p.test.name)).toEqual(['unit', 'server']);
  });

  it('add the db project with the database setup when MADAR_DB=1', () => {
    const db = named(projects({ MADAR_DB: '1' }), 'db');
    expect(db?.test.globalSetup).toEqual(['./server/test/global-setup.ts']);
    expect(db?.test.setupFiles).toEqual(['./server/test/db.ts']);
  });

  it('keep the browser store test out of the db project, because db mode has no IndexedDB', () => {
    expect(named(projects({ MADAR_DB: '1' }), 'db')?.test.exclude).toContain('src/api/persist.test.ts');
  });

  it('add the it project when MADAR_IT=1: one file at a time, a long timeout, and the Docker script tests', () => {
    const it_ = named(projects({ MADAR_IT: '1' }), 'it');
    expect(it_?.test.fileParallelism).toBe(false);
    expect(it_?.test.testTimeout).toBe(60000);
    for (const file of DOCKER_SCRIPT_TESTS) expect(it_?.test.include).toContain(file);
  });

  it('keep the Docker script tests out of the server project, so npm test never needs Docker', () => {
    const server = named(projects(), 'server');
    for (const file of DOCKER_SCRIPT_TESTS) expect(server?.test.exclude).toContain(file);
  });
});

describe('the test scripts', () => {
  it('turn on the project they run', () => {
    expect(scripts['test:db']).toBe('MADAR_DB=1 vitest run --project db');
    expect(scripts['test:it']).toBe('MADAR_IT=1 vitest run --project it --passWithNoTests');
  });

  it('run the MCP conformance runner against the served function', () => {
    expect(scripts['test:mcp']).toContain('conformance server --url ${MCP_URL:-http://127.0.0.1:54321/functions/v1/mcp}');
  });
});
