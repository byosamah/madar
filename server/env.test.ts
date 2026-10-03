import { afterEach, describe, expect, it } from 'vitest';
import { env, requireEnv, setEnvSource } from './env';

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
