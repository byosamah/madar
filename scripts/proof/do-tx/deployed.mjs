// The race of wave 1 Task 1 on the deployed probe (exit wave 5, R8 (e)): PROBE_URL=https://madar-do-tx-probe.<account>.workers.dev
// PROBE_SECRET=<the value of the run> node scripts/proof/do-tx/deployed.mjs. It prints every answer, as run.mjs does locally, and
// never the secret.
const base = process.env.PROBE_URL;
const secret = process.env.PROBE_SECRET;
if (!base || !secret) {
  console.error('PROBE_URL and PROBE_SECRET are missing.');
  process.exit(2);
}
const get = async (path) => {
  const response = await fetch(`${base}${path}`, { headers: { 'x-probe-secret': secret } });
  if (!response.ok) throw new Error(`${path} answered ${response.status}.`);
  return response.json();
};
console.log(JSON.stringify({
  rollback: await get('/rollback?o=r1'),
  microtask: await get('/race?o=m1&kind=micro'),
  timer: await get('/race?o=t1&kind=timer'),
  timerFail: await get('/race?o=t2&kind=timer&fail=1'),
  features: await get('/features?o=f1'),
}, null, 1));
