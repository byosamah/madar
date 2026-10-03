import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/api/errors';
import { canonicalJson, digestOf, replay } from './idempotency';

describe('idempotency keys (plan 4.10)', () => {
  it('writes canonical JSON: sorted keys, no undefined fields, arrays in order', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 1], c: undefined, b: null } })).toBe('{"a":{"b":null,"d":[3,1]},"b":1}');
    expect(canonicalJson([{ y: 1, x: 2 }, 'z'])).toBe('[{"x":2,"y":1},"z"]');
  });

  it('gives one sha256 digest for the call name and the input, whatever the key order', async () => {
    const one = await digestOf('tasks.create', { projectId: 'prj_001', title: 'A' });
    expect(one).toMatch(/^[0-9a-f]{64}$/);
    expect(await digestOf('tasks.create', { title: 'A', projectId: 'prj_001' })).toBe(one);
    expect(await digestOf('tasks.update', { projectId: 'prj_001', title: 'A' })).not.toBe(one);
    expect(await digestOf('tasks.create', { projectId: 'prj_001', title: 'B' })).not.toBe(one);
  });

  it('returns the stored answer for the same digest, nothing for a new key, and key_reused for another input', async () => {
    const digest = await digestOf('tasks.create', { title: 'A' });
    const stored = { name: 'tasks.create', digest, result: { output: { id: 'tsk_001' }, storyId: 'sty_x', changed: true } };
    expect(replay(undefined, digest)).toBeUndefined();
    expect(replay(stored, digest)).toEqual(stored.result);
    let error: unknown;
    try {
      replay(stored, await digestOf('tasks.create', { title: 'B' }));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ApiError);
    expect([(error as ApiError).code, (error as ApiError).details.reason]).toEqual(['conflict', 'key_reused']);
  });
});
