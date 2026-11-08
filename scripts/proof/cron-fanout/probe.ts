// Spike S1 of Madar enterprises: how many legs of the Cron fan-out stay ok on the deployed test Worker.
// Usage: npx tsx scripts/proof/cron-fanout/probe.ts --to <page address> --kind self|api --count 15 --outside 40
// It reads the jobs secret from secrets/test.env, prints the JSON of the legs, and never prints the secret.
// Run it only against the test copy, with the lead. The route needs MADAR_TEST_TOOLS = "on" (the test Worker only).
import { readFileSync } from 'node:fs';
import { parseSecretsFile } from '../../deploy/secrets';

function arg(name: string, fallback?: string): string {
  const at = process.argv.indexOf(`--${name}`);
  const value = at >= 0 ? process.argv[at + 1] : fallback;
  if (value === undefined) throw new Error(`Give --${name}.`);
  return value;
}

const to = arg('to').replace(/\/$/, '');
const kind = arg('kind', 'self');
const count = Number(arg('count', '3'));
const outside = Number(arg('outside', '0'));
if (kind !== 'self' && kind !== 'api') throw new Error('--kind is self or api.');
const secret = parseSecretsFile(readFileSync(new URL('../../../secrets/test.env', import.meta.url), 'utf8'), { file: 'secrets/test.env' }).JOBS_SECRET;
if (!secret) throw new Error('secrets/test.env has no JOBS_SECRET.');

const started = Date.now();
const response = await fetch(`${to}/api/internal/probe/fanout`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-madar-jobs-secret': secret },
  body: JSON.stringify({ kind, count, outside }),
});
const text = await response.text();
console.log(JSON.stringify({ status: response.status, kind, count, outside, ms: Date.now() - started, answer: text.slice(0, 4000) }));
