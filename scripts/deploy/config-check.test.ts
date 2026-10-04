import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkRemoteConfig } from './config-check.ts';

/**
 * config.sh runs this check before `supabase config push` (plan 5.9). config.toml holds local values (site_url on 127.0.0.1), so
 * a push needs a [remotes.<env>] block for the project, or the local values would reach the hosted Auth.
 */
const TEST = 'qdgwpnesxppnqsaabqzd';
const today = readFileSync(new URL('../../supabase/config.toml', import.meta.url), 'utf8');
/** config.toml without its [remotes.*] blocks, which start at the Madar comment above [remotes.test]. */
const base = today.slice(0, today.indexOf('\n# Madar: the hosted projects') === -1 ? undefined : today.indexOf('\n# Madar: the hosted projects'));
const HOOK = 'create or replace function public.madar_access_token_hook(event jsonb) returns jsonb language plpgsql as $$ begin return event; end $$;';

const remote = (env: string, ref: string, site = 'https://preview.madar.pages.dev', redirects = '["https://preview.madar.pages.dev"]') =>
  `\n[remotes.${env}]\nproject_id = "${ref}"\n\n[remotes.${env}.auth]\nsite_url = "${site}"\nadditional_redirect_urls = ${redirects}\n`;

describe('checkRemoteConfig', () => {
  it('passes a config with a block for the project, https sign-in addresses and the hook function in a migration', () => {
    expect(checkRemoteConfig(base + remote('test', TEST), 'test', TEST, [HOOK])).toEqual([]);
  });

  it('passes the config of today for both projects (the free Pages address, 2026-10-04)', () => {
    expect(checkRemoteConfig(today, 'test', TEST, [HOOK])).toEqual([]);
    expect(checkRemoteConfig(today, 'production', 'oprkvdjudjxxhvodkzgs', [HOOK])).toEqual([]);
  });

  it('refuses a config with no block for the project, so the local site_url would reach the hosted Auth', () => {
    expect(checkRemoteConfig(base, 'test', TEST, [HOOK]).join('\n')).toMatch(/\[remotes\.test\]/);
  });

  it('refuses a block for another project', () => {
    expect(checkRemoteConfig(base + remote('test', 'oprkvdjudjxxhvodkzgs'), 'test', TEST, [HOOK]).join('\n')).toMatch(/project_id/);
  });

  it('refuses a local or plain http sign-in address, and a block without redirect addresses', () => {
    expect(checkRemoteConfig(base + remote('test', TEST, 'http://127.0.0.1:5173'), 'test', TEST, [HOOK]).join('\n')).toMatch(/site_url/);
    expect(checkRemoteConfig(base + remote('test', TEST, undefined, '["http://localhost:5173"]'), 'test', TEST, [HOOK]).join('\n')).toMatch(/additional_redirect_urls/);
    const noRedirects = `${base}\n[remotes.test]\nproject_id = "${TEST}"\n\n[remotes.test.auth]\nsite_url = "https://preview.madar.pages.dev"\n`;
    expect(checkRemoteConfig(noRedirects, 'test', TEST, [HOOK]).join('\n')).toMatch(/additional_redirect_urls/);
  });

  it('refuses to turn on the token hook while no migration makes its function (seed.sql never runs on a hosted project)', () => {
    expect(checkRemoteConfig(base + remote('test', TEST), 'test', TEST, []).join('\n')).toMatch(/madar_access_token_hook/);
  });

  it('refuses a config that turns the Data API on (plan, change 14)', () => {
    const on = base.replace(/\[api\]\n((?:#.*\n)*)enabled = false/, '[api]\n$1enabled = true');
    expect(on).not.toBe(base);
    expect(checkRemoteConfig(on + remote('test', TEST), 'test', TEST, [HOOK]).join('\n')).toMatch(/Data API/);
    expect(checkRemoteConfig(`${base + remote('test', TEST)}\n[remotes.test.api]\nenabled = true\n`, 'test', TEST, [HOOK]).join('\n')).toMatch(/Data API/);
  });
});
