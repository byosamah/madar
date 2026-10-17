import { describe, expect, it } from 'vitest';
import { localPasswords } from '../../tests/e2e-deploy/local';
import { LOCAL_OFFICE, LOCAL_OUT, LOCAL_SCREENS, playwrightLines, screensEnv, workerEnvLines } from './office-local';

describe('the local office stack (scripts/dev/office-local.ts)', () => {
  const secrets = { opsSecret: 'local-ops', exportSecret: 'local-export', jobsSecret: 'local-jobs', authKey: '{"kty":"EC","kid":"k1"}' };

  it('gives wrangler dev the made-up secrets of one run, the sign-in key among them, and no real key', () => {
    const lines = workerEnvLines(secrets);
    expect(lines).toContain('MADAR_OPS_SECRET=local-ops');
    expect(lines).toContain('MADAR_EXPORT_SECRET=local-export');
    expect(lines).toContain('JOBS_SECRET=local-jobs');
    expect(lines).toContain('MADAR_AUTH_PRIVATE_JWK={"kty":"EC","kid":"k1"}');
    expect(lines.join('\n')).not.toMatch(/madar\.vado\.sa|oprkvdjudjxxhvodkzgs|qdgwpnesxppnqsaabqzd/);
  });

  it('builds the Madar screens with the live socket against the local office', () => {
    expect(screensEnv('2026.10.17')).toMatchObject({ VITE_MADAR_API: 'remote', VITE_MADAR_AUTH: 'madar', VITE_MADAR_LIVE: 'socket', VITE_API_URL: `${LOCAL_OFFICE}/api`, VITE_MADAR_BUILD: '2026.10.17' });
  });

  it('writes the run lines of the helper: the screens, the office, the agents flag and the 4 local passwords', () => {
    const lines = playwrightLines({ opsSecret: 'local-ops' });
    for (const line of [`MADAR_DEPLOY_URL=${LOCAL_SCREENS}`, `MADAR_E2E_APP_URL=${LOCAL_SCREENS}`, `MADAR_E2E_OFFICE_URL=${LOCAL_OFFICE}`, `MADAR_E2E_MCP_URL=${LOCAL_OFFICE}/mcp`, 'MADAR_E2E_OPS_SECRET=local-ops', 'MADAR_E2E_AFTER_G=1']) {
      expect(lines).toContain(line);
    }
    for (const [name, value] of Object.entries(localPasswords())) expect(lines).toContain(`${name}=${value}`);
  });

  it('keeps the run output in the git-ignored test-results folder', () => {
    expect(LOCAL_OUT.startsWith('test-results/')).toBe(true);
  });
});
