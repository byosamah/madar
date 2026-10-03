/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The build flag is fixed at build time, so the prototype bundle drops the remote chunk (plan, section 3, rule 6).
// The prototype build keeps hash links and a relative base; the remote modes (remote-test, remote-production) use path links.
// No loadEnv with an empty prefix here: secrets live in .env.local and secrets/, and only VITE_ names reach the page.
const MADAR_API = process.env.VITE_MADAR_API ?? 'fake';
/** Script tests that need the local stack. They run in the it project, never in npm test. */
const DOCKER_SCRIPT_TESTS = ['scripts/first-admin.test.ts', 'scripts/restore-check.test.ts'];

export default defineConfig(({ mode }) => ({
  base: mode.startsWith('remote') ? '/' : './',
  define: { 'import.meta.env.VITE_MADAR_API': JSON.stringify(MADAR_API) },
  plugins: [react(), tailwindcss()],
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
                include: ['server/it/**/*.it.test.ts', ...DOCKER_SCRIPT_TESTS],
                fileParallelism: false,
                testTimeout: 60000,
              },
            },
          ]
        : []),
    ],
  },
}));
