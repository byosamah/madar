import { afterEach, describe, expect, it, vi } from 'vitest';
import { peopleCalls } from '../api/handlers/people';
import { Store } from '../api/store';
import { memoryPersister } from '../api/persist';
import { makeWorld, testApi, useDbTestApi } from './factories';

afterEach(() => {
  useDbTestApi(undefined);
  vi.unstubAllEnvs();
});

describe('testApi and db mode (plan 7.2, D1)', () => {
  it('returns the in-memory API by default, also when a db factory is registered without MADAR_DB=1', async () => {
    const factory = vi.fn();
    useDbTestApi(factory);
    vi.stubEnv('MADAR_DB', '');
    const t = testApi(peopleCalls);
    expect(factory).not.toHaveBeenCalled();
    expect((await t.api.call('session.get', {})).user.id).toBe('usr_001');
  });

  it('returns the db version when MADAR_DB=1 and the db setup registered it', () => {
    const state = makeWorld();
    const made = { store: new Store(state, memoryPersister()), api: { call: vi.fn(), run: vi.fn() }, as: vi.fn() };
    const factory = vi.fn(() => made);
    useDbTestApi(factory);
    vi.stubEnv('MADAR_DB', '1');
    expect(testApi(peopleCalls, state)).toBe(made);
    expect(factory).toHaveBeenCalledWith(peopleCalls, state);
  });
});
