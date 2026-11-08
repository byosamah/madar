import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { unstable_readConfig } from 'wrangler';
import { COPIES, COPY_HOSTS } from '../../server/core/serverHost';

/**
 * config/pages-platform/wrangler.toml: the file that sets the bindings of the Pages project madar-platform (the site Madar enterprises) at deploy time.
 * Cloudflare reads env.preview for the preview deployments and env.production for the production deployments of a Pages project. Cloudflare docs:
 * https://developers.cloudflare.com/pages/functions/wrangler-configuration/ . The file is for this site only: a wrangler.toml at the repo root would
 * set the project madar, which deploys from the root.
 */
const file = fileURLToPath(new URL('../../config/pages-platform/wrangler.toml', import.meta.url));
const read = (env?: string) => unstable_readConfig({ config: file, env }, {});

describe('config/pages-platform/wrangler.toml', () => {
  it('names the project madar-platform and the output folder dist-platform (relative to the file)', () => {
    const config = read();
    expect(config.name).toBe('madar-platform');
    expect(config.pages_build_output_dir).toMatch(/\/dist-platform$/);
    expect(config.pages_build_output_dir).toBe(fileURLToPath(new URL('../../dist-platform', import.meta.url)).replace(/\/$/, ''));
  });

  it('binds MADAR_SERVER_TEST to the Worker of the test copy on the preview environment, and no other binding', () => {
    expect(read('preview').services).toEqual([{ binding: COPY_HOSTS.test.workers.binding, service: COPY_HOSTS.test.workers.name }]);
    expect(COPY_HOSTS.test.workers).toMatchObject({ binding: 'MADAR_SERVER_TEST', name: 'madar-server-test' });
  });

  it('binds MADAR_SERVER_PRODUCTION to the Worker of production on the production environment, and no other binding', () => {
    expect(read('production').services).toEqual([{ binding: COPY_HOSTS.production.workers.binding, service: COPY_HOSTS.production.workers.name }]);
    expect(COPY_HOSTS.production.workers).toMatchObject({ binding: 'MADAR_SERVER_PRODUCTION', name: 'madar-server-production' });
  });

  it('keeps each binding on its own environment: the text names each service once, under its own env table', () => {
    const text = readFileSync(file, 'utf8');
    for (const copy of COPIES) {
      expect(text.split(`binding = "${COPY_HOSTS[copy].workers.binding}"`).length - 1, copy).toBe(1);
      expect(text.split(`service = "${COPY_HOSTS[copy].workers.name}"`).length - 1, copy).toBe(1);
    }
    expect(text).toMatch(/\[\[env\.preview\.services\]\]\s*\nbinding = "MADAR_SERVER_TEST"\s*\nservice = "madar-server-test"/);
    expect(text).toMatch(/\[\[env\.production\.services\]\]\s*\nbinding = "MADAR_SERVER_PRODUCTION"\s*\nservice = "madar-server-production"/);
  });

  it('holds no secret and no var', () => {
    const text = readFileSync(file, 'utf8');
    expect(text).not.toMatch(/^\[(env\.\w+\.)?vars\]/m);
    expect(text).not.toMatch(/secret|token|password|key\s*=/i);
  });

  it('sits next to no wrangler.toml at the repo root', () => {
    expect(() => readFileSync(fileURLToPath(new URL('../../wrangler.toml', import.meta.url)))).toThrow();
  });
});

describe('pages-platform.sh', () => {
  // The commands only: the comment lines say the same words.
  const script = readFileSync(fileURLToPath(new URL('./pages-platform.sh', import.meta.url)), 'utf8')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');

  it('deploys from the folder of the config file, so wrangler reads it, and names no directory', () => {
    expect(script).toMatch(/cd "\$ROOT\/config\/pages-platform"/);
    expect(script).toMatch(/pages deploy --project-name "\$PROJECT" --branch "\$branch"/);
    expect(script).not.toMatch(/pages deploy dist-platform/);
  });

  it('keeps the _worker.js and _routes.json steps before the deploy', () => {
    const at = (text: string) => script.indexOf(text);
    expect(at('pages functions build functions-platform --outdir dist-platform/_worker.js')).toBeGreaterThan(-1);
    expect(at('dist-platform/_routes.json')).toBeGreaterThan(at('pages functions build'));
    expect(at('pages deploy')).toBeGreaterThan(at('dist-platform/_routes.json'));
  });
});
