// A new sign-in key of an office copy (exit wave 4; wave 2, Merge notes 14), straight to the Worker secret MADAR_AUTH_PRIVATE_JWK
// on the stdin of wrangler: no file, no log line. A new key signs every person and agent of that copy out once.
//
//   npx tsx scripts/office/auth-key.ts test        (sandbox off: wrangler talks to Cloudflare)
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { calculateJwkThumbprint, exportJWK, generateKeyPair } from 'jose';
import { OWN_AUTH_SECRET } from '../../server/auth/ownKeys';
import { ACCOUNT_ID, redact, runWithStdin } from '../deploy/cloudflare';

/** A new P-256 private JWK with its thumbprint as the kid, the form that server/auth/ownKeys.ts reads. */
export async function newAuthKey(): Promise<string> {
  const { privateKey } = await generateKeyPair('ES256', { extractable: true });
  const jwk = await exportJWK(privateKey);
  return JSON.stringify({ ...jwk, kid: await calculateJwkThumbprint(jwk) });
}

/** The copy of the command line: the test copy only until the switch of production (wave 6). */
export function authKeyTarget(argv: readonly string[]): 'test' {
  if (argv[0] !== 'test') throw new Error('Only the test copy takes a new sign-in key now; production comes with the switch (wave 6).');
  return 'test';
}

async function main(argv: string[]): Promise<void> {
  const target = authKeyTarget(argv);
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const jwk = await newAuthKey();
  const { code, output } = await runWithStdin(`${root}node_modules/.bin/wrangler`, ['secret', 'put', OWN_AUTH_SECRET, '-c', 'wrangler.server.toml', '--env', target], jwk, {
    cwd: root, env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID ?? ACCOUNT_ID },
  });
  if (code !== 0) throw new Error(`wrangler secret put ${OWN_AUTH_SECRET} failed (exit ${code}): ${redact(output, [jwk, (JSON.parse(jwk) as { d: string }).d]).trim().split('\n').slice(-4).join(' | ')}`);
  console.log(`The Worker madar-server-${target} has a new ${OWN_AUTH_SECRET} (kid ${(JSON.parse(jwk) as { kid: string }).kid}).`);
}

const isMain = process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
