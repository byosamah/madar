/// <reference types="vitest/config" />
import { rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type HtmlTagDescriptor, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { FONT_WEIGHTS, originsOf } from './scripts/check-bundles.ts';

// The build flag is fixed at build time, so the prototype bundle drops the remote chunk (plan, section 3, rule 6).
// The prototype build keeps hash links and a relative base; the remote modes (remote-test, remote-production) use path links.
// No loadEnv with an empty prefix here: secrets live in .env.local and secrets/, and only VITE_ names reach the page.
const MADAR_API = process.env.VITE_MADAR_API ?? 'fake';
/** Script tests that need the local stack. They run in the it project, never in npm test. */
const DOCKER_SCRIPT_TESTS = ['scripts/first-admin.test.ts', 'scripts/restore-check.test.ts', 'scripts/seed-test-office.test.ts'];

/**
 * The remote build starts with the page what the first screen needs (performance audit BND-2, BND-3, BND-4): the bootstrap
 * chunk and the chunks it imports, the three Thmanyah files, and a connection to each Supabase origin. Before, each one
 * started only after the entry script ran. The tags are plain links with no inline script, so the CSP script-src 'self'
 * holds. crossorigin is needed: the scripts and fonts load in CORS mode, and fetch to Supabase uses the anonymous connection
 * pool. Cloudflare Pages makes no Early Hint from a link with crossorigin. The prototype gets none of the links: it holds no
 * Supabase code, and its one script file needs no preload. scripts/check-bundles.ts checks the links of each build.
 */
export function earlyLinks(env: Record<string, string | undefined> = process.env): Plugin {
  let base = '/';
  return {
    name: 'madar-early-links',
    apply: 'build',
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const bundle = ctx.bundle ?? {};
        const items = Object.values(bundle);
        const tags: HtmlTagDescriptor[] = originsOf(env).map((origin) => ({ tag: 'link', attrs: { rel: 'preconnect', href: origin, crossorigin: true }, injectTo: 'head' }));
        // The bootstrap chunk and every chunk that it imports statically, except the ones that index.html starts already.
        const boot = items.find((item) => item.type === 'chunk' && item.facadeModuleId?.endsWith('/src/app/remote/bootstrap.ts'));
        const seen = new Set<string>();
        const stack = boot ? [boot.fileName] : [];
        while (stack.length > 0) {
          const name = stack.pop()!;
          if (seen.has(name)) continue;
          seen.add(name);
          const item = bundle[name];
          if (item?.type === 'chunk') stack.push(...item.imports);
          if (!html.includes(`"${base}${name}"`)) tags.push({ tag: 'link', attrs: { rel: 'modulepreload', crossorigin: true, href: `${base}${name}` }, injectTo: 'head' });
        }
        // The three Thmanyah files, as tokens.css names them. font-display swap stays, and Inter has no preload.
        for (const weight of FONT_WEIGHTS) {
          const font = items.find((item) => item.type === 'asset' && new RegExp(`^assets/thmanyahsans-${weight}-[\\w-]+\\.otf$`).test(item.fileName));
          if (font) tags.push({ tag: 'link', attrs: { rel: 'preload', as: 'font', type: 'font/otf', crossorigin: true, href: `${base}${font.fileName}` }, injectTo: 'head' });
        }
        return tags;
      },
    },
  };
}

/**
 * The service worker of browser push (public/sw.js, owner 2026-10-08) belongs to the remote build. The prototype is one script file
 * and registers no worker, so its dist drops the copy that Vite makes from the public folder. check-bundles.ts checks both builds.
 */
export function workerOnlyInRemote(remote: boolean): Plugin {
  let target = '';
  return {
    name: 'madar-worker-only-remote',
    apply: 'build',
    configResolved(config) {
      target = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      if (!remote) rmSync(join(target, 'sw.js'), { force: true });
    },
  };
}

/**
 * The chunk groups of the remote build (performance audit BND-5). The packages of the first screen go into one vendor chunk,
 * the sheet packages into one overlay chunk (FL-3), and the Supabase packages into one supabase chunk. Neither imports app code, so a release that changes only app code keeps
 * their names, and the browser keeps them in its cache. zod is not in the list: it stays with the screens that parse, so the
 * first load holds no zod schemas (BND-6). A package that is in no group goes into an automatic chunk (a change of size only).
 */
const REMOTE_CHUNKS = {
  groups: [
    {
      name: 'vendor',
      test: /node_modules[\\/](react|react-dom|scheduler|react-router|@tanstack|i18next|react-i18next|html-parse-stringify|void-elements|motion|motion-dom|motion-utils|framer-motion|tslib|use-sync-external-store)[\\/]/,
    },
    // The sheet packages (vaul, Radix and the scroll lock) load with the first sheet, not with the first screen (FL-3). Like
    // vendor and supabase, the chunk imports no app chunk, so its name stays over a release that changes only app code.
    {
      name: 'overlay',
      test: /node_modules[\\/](vaul|@radix-ui|react-remove-scroll|react-remove-scroll-bar|react-style-singleton|use-callback-ref|use-sidecar|aria-hidden|detect-node-es|get-nonce)[\\/]/,
    },
    { name: 'supabase', test: /node_modules[\\/](@supabase|iceberg-js)[\\/]/ },
  ],
};

/**
 * Supabase client packages that the screens never call (FL-5): the screens use only the sign-in and Realtime parts of supabase-js.
 * The remote build gives their names an empty stand-in (src/stubs/unusedClients.ts); src/app/remote/unusedClients.test.ts fails
 * when a screen starts to use one of them.
 */
const UNUSED_SUPABASE_CLIENTS = ['@supabase/storage-js', '@supabase/postgrest-js', '@supabase/functions-js'];

export default defineConfig(({ mode }) => ({
  // The prototype build is one script file, so the prototype artifact holds every script. The remote modes keep code splitting.
  build: mode.startsWith('remote') ? { rolldownOptions: { output: { codeSplitting: REMOTE_CHUNKS } } } : { rolldownOptions: { output: { codeSplitting: false } } },
  base: mode.startsWith('remote') ? '/' : './',
  // The prototype takes the screen list with plain imports: in its one script file, an on-demand import costs extra start-up
  // code for each screen (performance audit BND-1). The remote modes split the screens, and the tests keep the on-demand list.
  // The remote modes point three Supabase client packages that the screens never call at an empty stand-in (FL-5).
  resolve: {
    alias: mode.startsWith('remote')
      ? UNUSED_SUPABASE_CLIENTS.map((find) => ({ find, replacement: fileURLToPath(new URL('./src/stubs/unusedClients.ts', import.meta.url)) }))
      : mode === 'test'
        ? []
        : [{ find: /^\.\/screenLoaders$/, replacement: fileURLToPath(new URL('./src/app/screenLoaders.static.ts', import.meta.url)) }],
  },
  define: { 'import.meta.env.VITE_MADAR_API': JSON.stringify(MADAR_API) },
  plugins: [react(), tailwindcss(), workerOnlyInRemote(mode.startsWith('remote')), ...(mode.startsWith('remote') ? [earlyLinks()] : [])],
  test: {
    restoreMocks: true,
    // At most 5 test workers for each run (owner, 2026-10-20): the Mac has 10 cores and 16 GB, and several sessions test at once.
    maxWorkers: 5,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'jsdom',
          include: ['src/**/*.test.{ts,tsx}'],
          setupFiles: ['./src/test/setup.ts'],
        },
      },
      {
        // Node tests of the server and of the build scripts. The integration tests in server/it and the Docker script tests need the local stack.
        // The office object tests (*.wd.test.ts) need local workerd, so they run only in the office project (test:office).
        extends: true,
        test: {
          name: 'server',
          environment: 'node',
          include: ['server/**/*.test.ts', 'scripts/**/*.test.ts'],
          exclude: ['server/it/**', 'server/**/*.wd.test.ts', ...DOCKER_SCRIPT_TESTS],
        },
      },
      // The Docker projects join only when their script asks (test:db, test:it), so a bare run or a run by path stays unit + server.
      ...(process.env.MADAR_DB === '1'
        ? [
            {
              // The API tests again, on the local database. Track D replaces the two setup files (plan 7.2).
              extends: true,
              test: {
                name: 'db',
                environment: 'node',
                include: ['src/api/**/*.test.ts'],
                // The browser store (IndexedDB) has no db mode.
                exclude: ['src/api/persist.test.ts'],
                env: { MADAR_DB: '1' },
                globalSetup: ['./server/test/global-setup.ts'],
                setupFiles: ['./server/test/db.ts'],
              },
            },
          ]
        : []),
      ...(process.env.MADAR_LITE === '1'
        ? [
            {
              // The API tests again, on node:sqlite (Supabase exit, wave 1): the SQLite path of the office object, with no Docker.
              extends: true,
              test: {
                name: 'lite',
                environment: 'node',
                include: ['src/api/**/*.test.ts'],
                exclude: ['src/api/persist.test.ts'],
                env: { MADAR_DB: '1', MADAR_LITE: '1' },
                globalSetup: ['./server/test/lite-setup.ts'],
                setupFiles: ['./server/test/lite.ts'],
              },
            },
          ]
        : []),
      ...(process.env.MADAR_OFFICE === '1'
        ? [
            {
              // The office object on local workerd (Supabase exit, wave 1): host parity, everyCall parity, the rows pins.
              extends: true,
              test: {
                name: 'office',
                environment: 'node',
                include: ['server/office/**/*.wd.test.ts'],
                fileParallelism: false,
                testTimeout: 300_000,
                hookTimeout: 900_000,
              },
            },
          ]
        : []),
      ...(process.env.MADAR_IT === '1'
        ? [
            {
              // The suites with real commits (lock, Realtime, backup) share one local stack, so one file runs at a time (plan 7.3).
              extends: true,
              test: {
                name: 'it',
                environment: 'node',
                include: ['server/it/**/*.it.test.ts', 'server/data/schema.test.ts', ...DOCKER_SCRIPT_TESTS],
                fileParallelism: false,
                testTimeout: 60000,
              },
            },
          ]
        : []),
    ],
  },
}));
