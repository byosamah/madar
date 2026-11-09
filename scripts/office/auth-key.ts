// A new sign-in key of an office copy (exit wave 4; wave 2, Merge notes 14), straight to the Worker secret MADAR_AUTH_PRIVATE_JWK
// on the stdin of wrangler: no file, no log line. A new key signs every person and agent of that copy out once.
//
//   npx tsx scripts/office/auth-key.ts <test|production>        (sandbox off: wrangler talks to Cloudflare)
// production asks for the typed word production (plan E: the key is set before the switch, so the Worker can sign in people after it).
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { calculateJwkThumbprint, exportJWK, generateKeyPair } from 'jose';
import { OWN_AUTH_SECRET } from '../../server/auth/ownKeys';
import { ACCOUNT_ID, redact, runWithStdin } from '../deploy/cloudflare';
import { askTypedWord } from './import';

/** A new P-256 private JWK with its thumbprint as the kid, the form that server/auth/ownKeys.ts reads. */
export async function newAuthKey(): Promise<string> {
  const { privateKey } = await generateKeyPair('ES256', { extractable: true });
  const jwk = await exportJWK(privateKey);
  return JSON.stringify({ ...jwk, kid: await calculateJwkThumbprint(jwk) });
}

/** The copy of the command line: the test copy, or production with the typed word. */
export function authKeyTarget(argv: readonly string[]): { target: 'test' | 'production'; typed: boolean } {
  if (argv[0] !== 'test' && argv[0] !== 'production') throw new Error('The copy must be test or production.');
  return { target: argv[0], typed: argv[0] === 'production' };
}

async function main(argv: string[]): Promise<void> {
  const { target, typed } = authKeyTarget(argv);
  if (typed && process.env.MADAR_DEPLOY_CONFIRMED !== 'production' && (await askTypedWord('This sets a new sign-in key on the Worker of production and signs every person out once. Type production to go on: ')) !== 'production') {
    throw new Error('The typed word was not production. Nothing changed.');
  }
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
