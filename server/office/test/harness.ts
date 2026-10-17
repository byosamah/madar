import { createTestHarness } from 'wrangler';
import type { PinAnswer, PinCall, PinOfficeApi } from './pinOffice';

/** Starts the test Worker of test:office on local workerd (wrangler createTestHarness, about 240 ms in the probe). */
export async function startOffice() {
  const server = createTestHarness({ workers: [{ configPath: new URL('./wrangler.toml', import.meta.url) }] });
  await server.listen();
  const worker = server.getWorker();
  const env = (await worker.getEnv()) as { OFFICE: { idFromName(name: string): unknown; get(id: unknown): unknown } };
  return {
    server,
    office: (name: string) => env.OFFICE.get(env.OFFICE.idFromName(name)) as PinOfficeApi,
    callByFetch: async (name: string, c: PinCall): Promise<PinAnswer> =>
      (await (await worker.fetch(`http://office.test/call?o=${name}`, { method: 'POST', body: JSON.stringify(c) })).json()) as PinAnswer,
    evict: (name: string) => worker.evictDurableObject('OFFICE', { name }),
  };
}
