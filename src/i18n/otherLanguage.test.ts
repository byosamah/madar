import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadOtherLanguageLater } from './otherLanguage';

/** A read that the test finishes by hand. */
function hold(client: QueryClient, key: string) {
  let finish: (value: string) => void = () => undefined;
  let fail: (error: Error) => void = () => undefined;
  const promise = client.fetchQuery({
    queryKey: ['api', key, {}],
    queryFn: () => new Promise<string>((resolve, reject) => { finish = resolve; fail = reject; }),
    retry: false,
  });
  promise.catch(() => undefined);
  return { finish: async (value = 'ok') => { finish(value); await promise; }, fail: async () => { fail(new Error('no')); await promise.catch(() => undefined); } };
}

describe('the load of the other language (performance audit 2026-10-21, FL-7, option A)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('loads nothing at the first render, and nothing while the first reads are on their way', async () => {
    const client = new QueryClient();
    const load = vi.fn(async () => undefined);
    loadOtherLanguageLater({ queryClient: client, language: 'en', load });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(load).not.toHaveBeenCalled();
    const first = hold(client, 'session.get');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(load).not.toHaveBeenCalled();
    await first.finish();
    expect(load).not.toHaveBeenCalled();
  });

  it('loads the other language 3 s after the first reads settle, and only once', async () => {
    const client = new QueryClient();
    const load = vi.fn(async () => undefined);
    loadOtherLanguageLater({ queryClient: client, language: 'en', load });
    const a = hold(client, 'session.get');
    const b = hold(client, 'tasks.list');
    await a.finish();
    await vi.advanceTimersByTimeAsync(5_000);
    // One read is still on its way: the first Home data has not settled.
    expect(load).not.toHaveBeenCalled();
    await b.finish();
    await vi.advanceTimersByTimeAsync(2_900);
    expect(load).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith('ar');
    hold(client, 'projects.list');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('takes the other of the two languages', async () => {
    const client = new QueryClient();
    const load = vi.fn(async () => undefined);
    loadOtherLanguageLater({ queryClient: client, language: 'ar', load });
    await hold(client, 'session.get').finish();
    await vi.advanceTimersByTimeAsync(3_100);
    expect(load).toHaveBeenCalledWith('en');
  });

  it('counts a failed first read as settled, so a person with a broken read still gets the words', async () => {
    const client = new QueryClient();
    const load = vi.fn(async () => undefined);
    loadOtherLanguageLater({ queryClient: client, language: 'en', load });
    await hold(client, 'session.get').fail();
    await vi.advanceTimersByTimeAsync(3_100);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('ignores a failed load, and stops when the person cancels it', async () => {
    const client = new QueryClient();
    const load = vi.fn(async () => { throw new Error('Failed to fetch dynamically imported module'); });
    const cancel = loadOtherLanguageLater({ queryClient: client, language: 'en', load });
    await hold(client, 'session.get').finish();
    await vi.advanceTimersByTimeAsync(3_100);
    expect(load).toHaveBeenCalledTimes(1);
    const other = new QueryClient();
    const second = vi.fn(async () => undefined);
    const stop = loadOtherLanguageLater({ queryClient: other, language: 'en', load: second });
    await hold(other, 'session.get').finish();
    stop();
    cancel();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(second).not.toHaveBeenCalled();
  });
});
