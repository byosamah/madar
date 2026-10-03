import { describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { ApiError } from '../errors';
import { AttemptKeys, READ_CALLS, isRead, newKey } from './keys';

describe('the read list of the browser', () => {
  it('names exactly the calls that the call map marks as reads', () => {
    const reads = Object.entries(calls).filter(([, def]) => Boolean((def as { readOnly?: boolean }).readOnly)).map(([name]) => name).sort();
    expect([...READ_CALLS].sort()).toEqual(reads);
  });

  it('treats a call it does not know as a write', () => {
    expect(isRead('projects.get')).toBe(true);
    expect(isRead('tasks.complete')).toBe(false);
    expect(isRead('no.such')).toBe(false);
  });
});

describe('idempotency keys', () => {
  it('makes a new key each time', () => {
    const a = newKey();
    const b = newKey();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(20);
    expect(a.length).toBeLessThanOrEqual(100);
  });

  it('gives a new attempt a new key, also for the same input object', async () => {
    const keys = new AttemptKeys();
    const input = { id: 'tsk_001' };
    const seen: string[] = [];
    keys.fresh(input);
    await keys.run(input, async (key) => seen.push(key));
    keys.fresh(input);
    await keys.run(input, async (key) => seen.push(key));
    expect(seen[0]).not.toBe(seen[1]);
  });

  it('gives a Retry the key of the failed attempt', async () => {
    const keys = new AttemptKeys();
    const input = { id: 'tsk_001' };
    const seen: string[] = [];
    keys.fresh(input);
    await keys.run(input, async (key) => {
      seen.push(key);
      throw new ApiError('failed', 'No answer.');
    }).catch(() => undefined);
    keys.again(input);
    await keys.run(input, async (key) => seen.push(key));
    expect(seen[1]).toBe(seen[0]);
    // A new attempt after the Retry gets a new key again.
    keys.fresh(input);
    await keys.run(input, async (key) => seen.push(key));
    expect(seen[2]).not.toBe(seen[0]);
  });

  it('gives a Retry a new key when no attempt failed', async () => {
    const keys = new AttemptKeys();
    const input = { id: 'tsk_001' };
    const seen: string[] = [];
    keys.fresh(input);
    await keys.run(input, async (key) => seen.push(key));
    keys.again(input);
    await keys.run(input, async (key) => seen.push(key));
    expect(seen[1]).not.toBe(seen[0]);
  });

  it('keeps the order of two attempts with the same input object that start in one tick', async () => {
    const keys = new AttemptKeys();
    const input = { id: 'tsk_001' };
    keys.fresh(input);
    keys.fresh(input);
    const seen = await Promise.all([keys.run(input, async (key) => key), keys.run(input, async (key) => key)]);
    expect(seen[0]).not.toBe(seen[1]);
  });

  it('gives a key to an attempt with no fresh() and to an input that is not an object', async () => {
    const keys = new AttemptKeys();
    expect(await keys.run({ id: 'x' }, async (key) => key)).toMatch(/\S/);
    keys.fresh('text');
    keys.again('text');
    expect(await keys.run('text', async (key) => key)).toMatch(/\S/);
  });
});
