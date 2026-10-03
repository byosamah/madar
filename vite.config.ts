/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The build flag is fixed at build time, so the prototype bundle drops the remote chunk (plan, section 3, rule 6).
// The prototype build keeps hash links and a relative base; the remote modes (remote-test, remote-production) use path links.
// No loadEnv with an empty prefix here: secrets live in .env.local and secrets/, and only VITE_ names reach the page.
const MADAR_API = process.env.VITE_MADAR_API ?? 'fake';

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
        // Node tests of the server and of the build scripts. The integration tests in server/it need the local stack.
        extends: true,
        test: {
          name: 'server',
          environment: 'node',
          include: ['server/**/*.test.ts', 'scripts/**/*.test.ts'],
          exclude: ['server/it/**'],
        },
      },
      {
        // The API tests again, on the local database (track D adds the setup).
        extends: true,
        test: {
          name: 'db',
          environment: 'node',
          include: ['src/api/**/*.test.ts'],
          env: { MADAR_DB: '1' },
        },
      },
      {
        extends: true,
        test: {
          name: 'it',
          environment: 'node',
          include: ['server/it/**/*.it.test.ts'],
          passWithNoTests: true,
        },
      },
    ],
  },
}));
