import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { HtmlTagDescriptor, Plugin } from 'vite';
import config, { earlyLinks } from '../vite.config.ts';

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
/** The build options that vite.config.ts gives for a mode. */
function buildOf(mode: string): { rolldownOptions?: { output?: { codeSplitting?: boolean } } } {
  return (config as unknown as (e: { mode: string; command: string }) => { build: object })({ mode, command: 'build' }).build;
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

  it('run the MCP unit tests, then the conformance runner against the served function through server/mcp/conformance.ts (G3)', () => {
    expect(scripts['test:mcp']).toBe('vitest run --project server server/mcp && tsx server/mcp/conformance.ts');
  });
});

describe('the build output', () => {
  it('is one script file in the prototype build, so the prototype artifact holds every script', () => {
    expect(buildOf('production').rolldownOptions?.output?.codeSplitting).toBe(false);
  });

  it('keeps code splitting in the remote modes', () => {
    expect(buildOf('remote-test').rolldownOptions).toBeUndefined();
    expect(buildOf('remote-production').rolldownOptions).toBeUndefined();
  });
});

/** The names of the plugins that vite.config.ts gives for a mode, the nested lists included. */
function pluginsOf(mode: string): string[] {
  const resolved = (config as unknown as (e: { mode: string; command: string }) => { plugins: unknown[] })({ mode, command: 'build' });
  return (resolved.plugins.flat(Infinity) as (Plugin | null | false)[]).flatMap((plugin) => (plugin ? [plugin.name] : []));
}

/** The tags that the early-link plugin adds to an index.html with a given bundle. */
function earlyTags(env: Record<string, string | undefined>, html: string, bundle: Record<string, object>): HtmlTagDescriptor[] {
  const plugin = earlyLinks(env);
  (plugin.configResolved as (c: { base: string }) => void)({ base: '/' });
  const hook = plugin.transformIndexHtml as { order: string; handler: (html: string, ctx: { bundle: Record<string, object> }) => HtmlTagDescriptor[] };
  expect(hook.order).toBe('post');
  return hook.handler(html, { bundle });
}

const chunk = (fileName: string, imports: string[], facadeModuleId: string | null = null) => ({ type: 'chunk', fileName, imports, facadeModuleId });
const asset = (fileName: string) => ({ type: 'asset', fileName });

describe('the early links of the remote build (performance audit BND-2, BND-3, BND-4)', () => {
  it('join only the remote modes, and only the build', () => {
    expect(pluginsOf('remote-test')).toContain('madar-early-links');
    expect(pluginsOf('remote-production')).toContain('madar-early-links');
    expect(pluginsOf('production')).not.toContain('madar-early-links');
    expect(earlyLinks({}).apply).toBe('build');
  });

  it('start the bootstrap chunk and the chunks it imports that index.html does not start, the three fonts, and each Supabase origin once', () => {
    const html = '<script type="module" crossorigin src="/assets/index-a1.js"></script>\n<link rel="modulepreload" crossorigin href="/assets/vendor-v1.js">';
    const bundle = {
      'assets/index-a1.js': chunk('assets/index-a1.js', ['assets/vendor-v1.js'], '/repo/src/main.tsx'),
      'assets/vendor-v1.js': chunk('assets/vendor-v1.js', []),
      'assets/bootstrap-b1.js': chunk('assets/bootstrap-b1.js', ['assets/supabase-s1.js', 'assets/index-a1.js'], '/repo/src/app/remote/bootstrap.ts'),
      'assets/supabase-s1.js': chunk('assets/supabase-s1.js', ['assets/vendor-v1.js']),
      'assets/DashboardScreen-d1.js': chunk('assets/DashboardScreen-d1.js', ['assets/vendor-v1.js'], '/repo/src/features/dashboard/DashboardScreen.tsx'),
      'assets/thmanyahsans-Regular-r1.otf': asset('assets/thmanyahsans-Regular-r1.otf'),
      'assets/thmanyahsans-Medium-m1.otf': asset('assets/thmanyahsans-Medium-m1.otf'),
      'assets/thmanyahsans-Bold-b1.otf': asset('assets/thmanyahsans-Bold-b1.otf'),
      'assets/inter-latin-opsz-normal-i1.woff2': asset('assets/inter-latin-opsz-normal-i1.woff2'),
    };
    const env = { VITE_SUPABASE_URL: 'https://ref.supabase.co', VITE_API_URL: 'https://ref.supabase.co/functions/v1/api' };
    expect(earlyTags(env, html, bundle)).toEqual([
      { tag: 'link', attrs: { rel: 'preconnect', href: 'https://ref.supabase.co', crossorigin: true }, injectTo: 'head' },
      { tag: 'link', attrs: { rel: 'modulepreload', crossorigin: true, href: '/assets/bootstrap-b1.js' }, injectTo: 'head' },
      { tag: 'link', attrs: { rel: 'modulepreload', crossorigin: true, href: '/assets/supabase-s1.js' }, injectTo: 'head' },
      { tag: 'link', attrs: { rel: 'preload', as: 'font', type: 'font/otf', crossorigin: true, href: '/assets/thmanyahsans-Regular-r1.otf' }, injectTo: 'head' },
      { tag: 'link', attrs: { rel: 'preload', as: 'font', type: 'font/otf', crossorigin: true, href: '/assets/thmanyahsans-Medium-m1.otf' }, injectTo: 'head' },
      { tag: 'link', attrs: { rel: 'preload', as: 'font', type: 'font/otf', crossorigin: true, href: '/assets/thmanyahsans-Bold-b1.otf' }, injectTo: 'head' },
    ]);
  });

  it('add a second preconnect only for a second origin, and none when the values are missing', () => {
    const preconnects = (env: Record<string, string | undefined>) => earlyTags(env, '', {}).filter((tag) => tag.attrs?.rel === 'preconnect').map((tag) => tag.attrs?.href);
    expect(preconnects({ VITE_SUPABASE_URL: 'https://ref.supabase.co', VITE_API_URL: 'https://api.example.test/api' })).toEqual(['https://ref.supabase.co', 'https://api.example.test']);
    expect(preconnects({})).toEqual([]);
  });
});
