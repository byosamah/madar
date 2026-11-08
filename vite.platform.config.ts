import { copyFileSync, renameSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';

/**
 * The build of the site Madar enterprises (design 12, D7): `npm run build:platform` (scripts/build-platform.ts). One entry, platform.html, which
 * loads src/platform/main.tsx. The output is dist-platform/ with the page as index.html and the headers file of config/headers.platform. The site
 * has no public folder (no manifest, no service worker, no app icons), no Supabase package and no company screen. check-bundles.ts checks it.
 */
export function platformPage(): Plugin {
  let target = '';
  let root = '';
  return {
    name: 'madar-platform-page',
    apply: 'build',
    configResolved(config) {
      root = config.root;
      target = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      // Pages serves index.html at the root address.
      rmSync(join(target, 'index.html'), { force: true });
      renameSync(join(target, 'platform.html'), join(target, 'index.html'));
      copyFileSync(join(root, 'config', 'headers.platform'), join(target, '_headers'));
    },
  };
}

export default defineConfig({
  base: '/',
  publicDir: false,
  build: { outDir: 'dist-platform', emptyOutDir: true, rolldownOptions: { input: 'platform.html' } },
  plugins: [react(), tailwindcss(), platformPage()],
});
