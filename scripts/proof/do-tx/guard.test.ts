import { describe, expect, it } from 'vitest';
import { allowed } from './guard.js';

describe('the secret guard of the deployed do-tx probe', () => {
  it('lets a request through only with the probe secret, and never with no secret on the Worker', () => {
    const request = (secret?: string) => new Request('https://p.test/race?o=m1', secret ? { headers: { 'x-probe-secret': secret } } : {});
    expect(allowed(request('s3cret'), { PROBE_SECRET: 's3cret' })).toBe(true);
    expect(allowed(request('no'), { PROBE_SECRET: 's3cret' })).toBe(false);
    expect(allowed(request(), { PROBE_SECRET: 's3cret' })).toBe(false);
    expect(allowed(request(''), {})).toBe(false);
    expect(allowed(request('s3cret'), {})).toBe(false);
  });

  it('lets the local harness through, which sets no secret and calls no deployed address', () => {
    expect(allowed(new Request('http://localhost/race?o=m1'), {})).toBe(true);
    expect(allowed(new Request('http://127.0.0.1:8787/race?o=m1'), {})).toBe(true);
  });

  it('wants the secret also on a local address when the Worker has one', () => {
    expect(allowed(new Request('http://localhost/race?o=m1'), { PROBE_SECRET: 's3cret' })).toBe(false);
  });
});
