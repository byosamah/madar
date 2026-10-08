/// <reference types="vitest/config" />
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

export default defineConfig(({ mode }) => ({
  // The prototype build is one script file, so the prototype artifact holds every script. The remote modes keep code splitting.
  build: mode.startsWith('remote') ? {} : { rolldownOptions: { output: { codeSplitting: false } } },
  base: mode.startsWith('remote') ? '/' : './',
  define: { 'import.meta.env.VITE_MADAR_API': JSON.stringify(MADAR_API) },
  plugins: [react(), tailwindcss(), ...(mode.startsWith('remote') ? [earlyLinks()] : [])],
  test: {
    restoreMocks: true,
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
        extends: true,
        test: {
          name: 'server',
          environment: 'node',
          include: ['server/**/*.test.ts', 'scripts/**/*.test.ts'],
          exclude: ['server/it/**', ...DOCKER_SCRIPT_TESTS],
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
