import { createTestHarness } from 'wrangler';
import type { PinAnswer, PinCall, PinOfficeApi } from './pinOffice';

/** Starts the test Worker of test:office on local workerd (wrangler createTestHarness, about 240 ms in the probe). */
export async function startOffice() {
  const server = createTestHarness({ workers: [{ configPath: new URL('./wrangler.toml', import.meta.url) }] });
  await server.listen();
  const worker = server.getWorker();
  const env = (await worker.getEnv()) as { OFFICE: { idFromName(name: string): unknown; get(id: unknown): unknown } };
  const rpc = async (name: string, method: keyof PinOfficeApi, args: unknown[]): Promise<unknown> => {
    const res = await worker.fetch(`http://office.test/rpc?o=${name}`, { method: 'POST', body: JSON.stringify({ method, args }) });
    const body = (await res.json()) as { value?: unknown; error?: string };
    if (!res.ok) throw new Error(body.error ?? `${method} failed with status ${res.status}.`);
    return body.value;
  };
  /** The office object through fetch only, so Node holds no RPC stub that keeps it awake (the cold wake of the rows pins). */
  const officeByFetch = (name: string): PinOfficeApi => {
    const send = <K extends keyof PinOfficeApi>(method: K) => ((...args: unknown[]) => rpc(name, method, args)) as PinOfficeApi[K];
    return {
      hostChecks: send('hostChecks'),
      writeState: send('writeState'),
      load: send('load'),
      finish: send('finish'),
      call: send('call'),
      readBack: send('readBack'),
      statTables: send('statTables'),
      dropIndex: send('dropIndex'),
      cron: send('cron'),
    };
  };
  return {
    server,
    office: (name: string) => env.OFFICE.get(env.OFFICE.idFromName(name)) as PinOfficeApi,
    officeByFetch,
    callByFetch: async (name: string, c: PinCall): Promise<PinAnswer> =>
      (await (await worker.fetch(`http://office.test/call?o=${name}`, { method: 'POST', body: JSON.stringify(c) })).json()) as PinAnswer,
    evict: (name: string) => worker.evictDurableObject('OFFICE', { name }),
  };
}
