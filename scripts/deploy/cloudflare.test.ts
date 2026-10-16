import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ACCOUNT_ID, cloudflareApi, cloudflareToken, codesOf, hyperdriveOrigin, redact, runWithStdin } from './cloudflare.ts';

/** The Cloudflare parts of the deploy scripts (owner, 2026-10-16). No test reaches the network. */
const places: string[] = [];
afterEach(() => {
  for (const place of places.splice(0)) rmSync(place, { recursive: true, force: true });
});

describe('runWithStdin', () => {
  it('gives the input on stdin only, never in the arguments, and gives back the exit code and the output', async () => {
    const script = 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{process.stdout.write(JSON.stringify({argv:process.argv.slice(1),stdin:s}));process.exit(3)})';
    const input = JSON.stringify({ JOBS_SECRET: 'jobs-secret-value-1' });
    const { code, output } = await runWithStdin(process.execPath, ['-e', script, 'secret', 'bulk'], input);
    expect(code).toBe(3);
    const seen = JSON.parse(output) as { argv: string[]; stdin: string };
    expect(seen.stdin).toBe(input);
    expect(seen.argv).toEqual(['secret', 'bulk']);
  });

  it('is the way secrets.ts hands the Worker secrets to wrangler: the JSON on stdin, the names of the step in the arguments', () => {
    const source = readFileSync(new URL('./secrets.ts', import.meta.url), 'utf8');
    expect(source).toContain("runWithStdin(wrangler, ['secret', 'bulk', '-c', 'wrangler.server.toml', '--env', env], json,");
    expect(source).not.toMatch(/writeFileSync|secret put/);
  });
});

describe('cloudflareToken', () => {
  function home(text?: string): string {
    const place = mkdtempSync(join(tmpdir(), 'madar-cf-'));
    places.push(place);
    if (text !== undefined) {
      mkdirSync(join(place, 'Library/Preferences/.wrangler/config'), { recursive: true });
      writeFileSync(join(place, 'Library/Preferences/.wrangler/config/default.toml'), text);
    }
    return place;
  }

  it('takes CLOUDFLARE_API_TOKEN first, else the OAuth token of the wrangler sign-in', () => {
    expect(cloudflareToken({ CLOUDFLARE_API_TOKEN: 'api-token-1' }, home('oauth_token = "oauth-1"\n'))).toBe('api-token-1');
    expect(cloudflareToken({}, home('oauth_token = "oauth-1"\nrefresh_token = "r"\n'))).toBe('oauth-1');
  });

  it('names the way to sign in when there is no token, and never prints a value', () => {
    expect(() => cloudflareToken({}, home())).toThrow(/wrangler login/);
    expect(() => cloudflareToken({}, home('refresh_token = "refresh-secret-1"\n'))).toThrow(/wrangler login/);
    try {
      cloudflareToken({}, home('refresh_token = "refresh-secret-1"\n'));
    } catch (error) {
      expect(String(error)).not.toContain('refresh-secret-1');
    }
  });
});

describe('cloudflareApi', () => {
  it('calls the account path with the bearer and a JSON body, and gives the result', async () => {
    const seen: Request[] = [];
    const api = cloudflareApi('token-1', (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(new Request(input, init));
      return Response.json({ success: true, errors: [], result: { id: 'x' } });
    }) as typeof fetch);
    const answer = await api<{ id: string }>('/hyperdrive/configs/abc', { method: 'PATCH', body: { origin: { password: 'pw' } } });
    expect(answer).toEqual({ status: 200, success: true, errors: [], result: { id: 'x' } });
    expect(seen[0].url).toBe(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/hyperdrive/configs/abc`);
    expect(seen[0].method).toBe('PATCH');
    expect(seen[0].headers.get('authorization')).toBe('Bearer token-1');
    expect(await seen[0].json()).toEqual({ origin: { password: 'pw' } });
    await api('/r2/buckets/madar-files-test', { headers: { 'cf-r2-jurisdiction': 'eu' } });
    expect(seen[1].headers.get('cf-r2-jurisdiction')).toBe('eu');
    expect(seen[1].headers.get('authorization')).toBe('Bearer token-1');
  });

  it('counts an answer that is not JSON, or an HTTP error, as no success, and names its codes', async () => {
    const text = cloudflareApi('t', (async () => new Response('<html>', { status: 502 })) as typeof fetch);
    const refused = cloudflareApi('t', (async () => Response.json({ success: false, errors: [{ code: 10042, message: 'Please enable R2.' }] }, { status: 403 })) as typeof fetch);
    const a = await text('/x');
    const b = await refused('/x');
    expect([a.success, b.success]).toEqual([false, false]);
    expect(codesOf(a)).toBe('HTTP 502');
    expect(codesOf(b)).toBe('10042 Please enable R2.');
  });
});

describe('hyperdriveOrigin and redact', () => {
  it('makes the origin of madar_server of one project on the session pooler', () => {
    expect(hyperdriveOrigin('qdgwpnesxppnqsaabqzd', 'pw-1')).toEqual({
      scheme: 'postgres', host: 'aws-1-eu-central-1.pooler.supabase.com', port: 5432, database: 'postgres', user: 'madar_server.qdgwpnesxppnqsaabqzd', password: 'pw-1',
    });
    expect(() => hyperdriveOrigin('ref', '')).toThrow(/password/);
  });

  it('replaces each secret and its URL form in an output line', () => {
    expect(redact('a Pa$$/word-1 b Pa%24%24%2Fword-1 c', ['Pa$$/word-1'])).toBe('a [redacted] b [redacted] c');
    expect(redact('no secret here', ['ab'])).toBe('no secret here');
  });
});
