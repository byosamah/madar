// Runs the probe of scripts/proof/do-tx on local workerd and prints every answer (exit plan, wave 1 Task 1).
import { createTestHarness } from 'wrangler';

const server = createTestHarness({ workers: [{ configPath: new URL('./wrangler.toml', import.meta.url).pathname }] });
await server.listen();
try {
  const get = async (path) => (await server.fetch(path)).json();
  console.log(JSON.stringify({
    rollback: await get('/rollback?o=r1'),
    microtask: await get('/race?o=m1&kind=micro'),
    timer: await get('/race?o=t1&kind=timer'),
    timerFail: await get('/race?o=t2&kind=timer&fail=1'),
    features: await get('/features?o=f1'),
  }, null, 1));
} finally {
  await server.close();
}
