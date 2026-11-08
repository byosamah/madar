import { describe, expect, it, vi } from 'vitest';
import type { FilesPort, MailPort } from '../core/ports';

// workerd provides RpcTarget. Node has none, so the test stands in a plain class: only the methods of WorkerNet are under test.
vi.mock('cloudflare:workers', () => ({ RpcTarget: class {} }));

const { WorkerNet } = await import('./workerNet');

const files = { kind: 'r2', maxFileBytes: 1 } as unknown as FilesPort;
const mail = {} as MailPort;

describe('WorkerNet (Madar enterprises, plan D)', () => {
  it('cannot be made with no enterprise', () => {
    // @ts-expect-error ent is a required option
    expect(() => new WorkerNet({ files, mail })).toThrow('A file port needs the id of its enterprise.');
    expect(() => new WorkerNet({ files, mail, ent: 'vado' })).toThrow('A file port needs the id of its enterprise.');
  });

  it('mailReserve sends the ent of the Worker and never an ent from the call', async () => {
    const seen: unknown[] = [];
    const platform = { mailReserve: async (input: unknown) => (seen.push(input), 'ok' as const) };
    const net = new WorkerNet({ files, mail, ent: 'ent_002', platform });
    // A hostile object cannot name another enterprise: the method has no ent argument, and extra arguments are ignored.
    const call = net.mailReserve as unknown as (kind: string, day: string, ref: string, ent: string) => Promise<unknown>;
    expect(await call.call(net, 'notice', '2026-11-08', 'ent_002:n1', 'ent_001')).toEqual({ ok: true, value: 'ok' });
    expect(seen).toEqual([{ ent: 'ent_002', kind: 'notice', day: '2026-11-08', ref: 'ent_002:n1' }]);
  });

  it('mailReserve fails closed with no platform, and carries a failure of the platform', async () => {
    const none = new WorkerNet({ files, mail, ent: 'ent_002' });
    expect(await none.mailReserve('notice', '2026-11-08', 'ent_002:n1')).toMatchObject({ ok: false });
    const down = new WorkerNet({ files, mail, ent: 'ent_002', platform: { mailReserve: async () => { throw new Error('The platform did not answer.'); } } });
    expect(await down.mailReserve('notice', '2026-11-08', 'ent_002:n1')).toMatchObject({ ok: false, failure: { message: 'The platform did not answer.' } });
  });
});
