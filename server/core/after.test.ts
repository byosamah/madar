import { afterEach, describe, expect, it } from 'vitest';
import { requestHost, runInHost } from './after';

/** The host of the running request and its "after" (task S1): Workers sets it in its entry; Supabase gives EdgeRuntime. */

const g = globalThis as { EdgeRuntime?: unknown };

afterEach(() => {
  delete g.EdgeRuntime;
});

describe('requestHost', () => {
  it('is "other" with no after outside every host (tests, local runs), so the work stays inline', () => {
    expect(requestHost()).toEqual({ host: 'other' });
  });

  it('gives the scope that the Workers entry set, also in the async work of the request', async () => {
    const kept: Promise<unknown>[] = [];
    const after = (work: Promise<unknown>) => void kept.push(work);
    const seen = await runInHost({ host: 'workers', after }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return requestHost();
    });
    expect(seen.host).toBe('workers');
    seen.after?.(Promise.resolve('x'));
    expect(kept).toHaveLength(1);
    expect(requestHost()).toEqual({ host: 'other' });
  });

  it('is "supabase" with EdgeRuntime.waitUntil when the Supabase Edge runtime is there', () => {
    const waited: Promise<unknown>[] = [];
    g.EdgeRuntime = { waitUntil: (work: Promise<unknown>) => void waited.push(work) };
    const found = requestHost();
    expect(found.host).toBe('supabase');
    found.after?.(Promise.resolve(1));
    expect(waited).toHaveLength(1);
  });

  it('a scope of the Workers entry wins over the global of the Supabase runtime', () => {
    g.EdgeRuntime = { waitUntil: () => undefined };
    expect(runInHost({ host: 'workers' }, () => requestHost())).toEqual({ host: 'workers' });
  });
});
