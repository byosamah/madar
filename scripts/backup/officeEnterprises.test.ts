import { describe, expect, it } from 'vitest';
import { enterprisesArgProblems, listEnterprises } from './officeEnterprises';
import { opsOf } from '../office/ops';

const opsAnswering = (answer: unknown, status = 200) => {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const fake = (async (url: string, init: RequestInit) => {
    seen.push({ url, headers: init.headers as Record<string, string> });
    return new Response(JSON.stringify(answer), { status });
  }) as unknown as typeof fetch;
  return { seen, ops: opsOf({ base: 'https://w.test', secret: 'secret-of-the-test', header: 'x-madar-export-secret', fetch: fake }) };
};

describe('the list of the enterprises for the nightly backup (scripts/backup/officeEnterprises.ts)', () => {
  it('asks the op enterprises with the export secret in the header only, and gives the ids sorted', async () => {
    const { seen, ops } = opsAnswering({ enterprises: ['ent_010', 'ent_002', 'ent_001', 'ent_002'] });
    expect(await listEnterprises(ops)).toEqual(['ent_001', 'ent_002', 'ent_010']);
    expect(seen).toEqual([{ url: 'https://w.test/api/office/enterprises', headers: { 'content-type': 'application/json', 'x-madar-export-secret': 'secret-of-the-test' } }]);
  });

  it('fails for an empty list, a list that is no array, and an id of a wrong form', async () => {
    await expect(listEnterprises(opsAnswering({ enterprises: [] }).ops)).rejects.toThrow('nothing to back up');
    for (const bad of [{}, { enterprises: 'ent_001' }, { enterprises: ['ent_001', 'ent_2'] }, { enterprises: ['ent_001', 7] }, { enterprises: ['ent_001/../x'] }]) {
      await expect(listEnterprises(opsAnswering(bad).ops), JSON.stringify(bad)).rejects.toThrow('did not answer a list of enterprise ids');
    }
  });

  it('names the status of a refusal, and never the secret', async () => {
    const error = await listEnterprises(opsAnswering({ error: { code: 'unauthenticated' } }, 401).ops).catch((e: Error) => e);
    expect(String(error)).toContain('answered 401');
    expect(String(error)).not.toContain('secret-of-the-test');
  });

  it('names each missing argument by name', () => {
    expect(enterprisesArgProblems([], {})).toEqual(['--url <page address of the copy> is missing.', 'OFFICE_EXPORT_SECRET is missing.']);
    expect(enterprisesArgProblems(['--url', 'https://w.test'], { OFFICE_EXPORT_SECRET: 'x' })).toEqual([]);
  });
});
