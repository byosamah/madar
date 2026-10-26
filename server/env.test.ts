import { afterEach, describe, expect, it } from 'vitest';
import { env, envNames, requireEnv, setEnvSource } from './env';

afterEach(() => {
  setEnvSource(undefined);
  delete (globalThis as { Deno?: unknown }).Deno;
  delete process.env.MADAR_TEST_VALUE;
});

describe('env', () => {
  it('reads process.env on Node', () => {
    process.env.MADAR_TEST_VALUE = 'node';
    expect(env('MADAR_TEST_VALUE')).toBe('node');
  });

  it('reads Deno.env on Supabase Edge Functions before process.env', () => {
    process.env.MADAR_TEST_VALUE = 'node';
    (globalThis as { Deno?: unknown }).Deno = { env: { get: (name: string) => (name === 'MADAR_TEST_VALUE' ? 'deno' : undefined) } };
    expect(env('MADAR_TEST_VALUE')).toBe('deno');
  });

  it('reads the bindings that the Workers entry sets, before everything else', () => {
    process.env.MADAR_TEST_VALUE = 'node';
    setEnvSource({ MADAR_TEST_VALUE: 'worker' });
    expect(env('MADAR_TEST_VALUE')).toBe('worker');
  });

  it('treats an empty value as missing', () => {
    process.env.MADAR_TEST_VALUE = '';
    expect(env('MADAR_TEST_VALUE')).toBeUndefined();
  });

  it('names the missing value and never prints a value', () => {
    expect(() => requireEnv('MADAR_TEST_VALUE')).toThrow('MADAR_TEST_VALUE is not set.');
    process.env.MADAR_TEST_VALUE = 'secret-value';
    expect(requireEnv('MADAR_TEST_VALUE')).toBe('secret-value');
  });
});

describe('envNames', () => {
  it('lists the names of the Workers bindings, the Deno values and the Node values, once each, and no value', () => {
    process.env.MADAR_TEST_VALUE = 'node-secret';
    setEnvSource({ DAFTRA_MAZJ_KEY: 'worker-secret', EMPTY_ONE: '', OBJECT_ONE: {} });
    (globalThis as { Deno?: unknown }).Deno = { env: { get: () => undefined, toObject: () => ({ DAFTRA_VADO_SITE: 'deno-secret', MADAR_TEST_VALUE: 'x' }) } };
    const names = envNames();
    expect(names).toEqual(expect.arrayContaining(['DAFTRA_MAZJ_KEY', 'DAFTRA_VADO_SITE', 'MADAR_TEST_VALUE']));
    expect(names).not.toContain('EMPTY_ONE');
    expect(names.filter((name) => name === 'MADAR_TEST_VALUE')).toHaveLength(1);
    expect(JSON.stringify(names)).not.toMatch(/secret/);
  });

  it('is the names method of env, so serverEnvFrom can find the Daftra accounts', () => {
    expect(env.names).toBe(envNames);
  });

  it('still lists the names when Deno refuses to list its values', () => {
    setEnvSource({ DAFTRA_MAZJ_KEY: 'x' });
    (globalThis as { Deno?: unknown }).Deno = { env: { get: () => undefined, toObject: () => { throw new Error('permission'); } } };
    expect(envNames()).toContain('DAFTRA_MAZJ_KEY');
  });
});
