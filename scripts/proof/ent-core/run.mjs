// Runs the probe of scripts/proof/ent-core on local workerd and prints one JSON line (Madar enterprises, plan B Task 1).
// S3: does an object know its own name? S2: the rows of a directory read, and the answer of a sign-in for an unknown email.
// Exit 1 unless every check holds. It never deploys.
import { calculateJwkThumbprint, exportJWK, generateKeyPair } from 'jose';
import { createTestHarness } from 'wrangler';

const server = createTestHarness({ workers: [{ configPath: new URL('./wrangler.toml', import.meta.url).pathname }] });
await server.listen();
const worker = server.getWorker();
const failures = [];
const check = (ok, text) => { if (!ok) failures.push(text); };
const get = async (query) => {
  const res = await worker.fetch(`http://probe.test/x?${query}`);
  const body = await res.json();
  if (!res.ok) throw new Error(`${query} answered ${res.status}: ${JSON.stringify(body)}`);
  return body;
};
const ms = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] };
};
const result = {};
try {
  // S3: the name of the object.
  const named = await server.getWorker().fetch('http://probe.test/x?o=ProbeName&name=ent_001').then((r) => r.json());
  await worker.evictDurableObject('NAME', { name: 'ent_001' });
  const afterEvict = await worker.fetch('http://probe.test/x?o=ProbeName&name=ent_001').then((r) => r.json());
  const unique = await worker.fetch('http://probe.test/x?o=ProbeName&unique=1').then((r) => r.json());
  result.s3 = { named, afterEvict, unique };
  check(named.ctor === 'ent_001' && named.method === 'ent_001', 'S3: a named object must report its name in the constructor and in a method.');
  check(afterEvict.ctor === 'ent_001' && afterEvict.method === 'ent_001', 'S3: a named object must report its name after an evict.');
  check(unique.ctor === null && unique.method === null, 'S3: an object of newUniqueId must report no name.');

  // S2: the rows of the directory read.
  const d = 'o=ProbeDirectory&name=platform';
  await get(`${d}&email=known%40x.test&ent=ent_001`).catch(() => undefined);
  const put = await worker.fetch(`http://probe.test/put?${d}&email=known%40x.test&ent=ent_001`).then((r) => r.json());
  const at = (path, email) => worker.fetch(`http://probe.test${path}?${d}&email=${encodeURIComponent(email)}`).then((r) => r.json());
  const warmHit = await at('/resolve', 'known@x.test');
  const warmMiss = await at('/resolve', 'nobody@x.test');
  await worker.evictDurableObject('DIR', { name: 'platform' });
  const coldHit = await at('/resolve', 'known@x.test');
  await worker.evictDurableObject('DIR', { name: 'platform' });
  const coldMiss = await at('/resolve', 'nobody@x.test');
  result.s2 = { put: { rowsRead: put.rowsRead, rowsWritten: put.rowsWritten }, warmHit, warmMiss, coldHit, coldMiss };
  check(warmHit.ent === 'ent_001' && coldHit.ent === 'ent_001', 'S2: a known email must resolve.');
  check(warmMiss.ent === null && coldMiss.ent === null, 'S2: an unknown email must resolve to null.');
  for (const [name, one] of Object.entries({ warmHit, warmMiss, coldHit, coldMiss })) {
    check(one.rowsRead <= 2 && one.rowsWritten === 0, `S2: ${name} must read at most 2 rows and write 0 (got ${one.rowsRead} and ${one.rowsWritten}).`);
  }

  // S2: the refusal of an unknown email, on empty sign-in tables inside the directory object, and the real object.
  const jwk = await (async () => {
    const { privateKey } = await generateKeyPair('ES256', { extractable: true });
    const key = await exportJWK(privateKey);
    return JSON.stringify({ ...key, kid: await calculateJwkThumbprint(key) });
  })();
  const refusal = await at('/refuse', 'ghost@x.test');
  const pin = await worker.fetch('http://probe.test/rpc?o=PinOffice&name=pin', {
    method: 'POST',
    body: JSON.stringify({ method: 'signin', args: ['auth.password', { email: 'ghost@x.test', password: 'x-wrong-password', address: '203.0.113.9' }, jwk, '2026-11-08T08:00:00.000Z'] }),
  }).then((r) => r.json());
  result.s2.refusal = refusal.answer;
  result.s2.pinAnswer = pin.value;
  check(refusal.answer?.ok === false && refusal.answer.error?.details?.reason === 'invalid_credentials', 'S2: the directory object must answer invalid_credentials for an unknown email.');
  check(pin.value?.ok === false && pin.value.error?.details?.reason === 'invalid_credentials', 'S2: the office object must answer invalid_credentials for a wrong password.');

  // S2: time of the two paths, 20 runs each.
  const objectMs = [];
  const refuseMs = [];
  for (let i = 0; i < 20; i += 1) {
    let t = performance.now();
    await worker.fetch('http://probe.test/rpc?o=PinOffice&name=pin', {
      method: 'POST',
      body: JSON.stringify({ method: 'signin', args: ['auth.password', { email: `ghost${i}@x.test`, password: 'x-wrong-password', address: `203.0.113.${i + 1}` }, jwk, '2026-11-08T08:00:00.000Z'] }),
    }).then((r) => r.json());
    objectMs.push(performance.now() - t);
    t = performance.now();
    await at('/refuse', `ghost${i}@x.test`);
    refuseMs.push(performance.now() - t);
  }
  result.s2.objectPath = ms(objectMs);
  result.s2.refusePath = ms(refuseMs);
} finally {
  await server.close();
}
console.log(JSON.stringify(result));
if (failures.length > 0) {
  for (const line of failures) console.error(line);
  process.exit(1);
}
