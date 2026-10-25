import { describe, expect, it, vi } from 'vitest';
import { insightLogger, POSTHOG_CAPTURE_URL, SERVER_SENDS_PER_MINUTE } from './insight';
import type { LogFields, Logger } from './ports';

const KEY = 'phc_abcdefghijklmnopqrstuvwx';

function setup(o: { fetch?: typeof fetch; now?: () => number } = {}) {
  const lines: { level: string; message: string; fields?: LogFields }[] = [];
  const inner: Logger = {
    info: (message, fields) => lines.push({ level: 'info', message, fields }),
    warn: (message, fields) => lines.push({ level: 'warn', message, fields }),
    error: (message, fields) => lines.push({ level: 'error', message, fields }),
  };
  const kept: Promise<unknown>[] = [];
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchMock = o.fetch ?? (vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response('{"status":"Ok"}', { status: 200 });
  }) as unknown as typeof fetch);
  const log = insightLogger(inner, { key: KEY, env: 'test', fetch: fetchMock, keep: (work) => { kept.push(work); }, now: o.now });
  const bodies = () => calls.map((call) => JSON.parse(String(call.init.body)) as Record<string, any>);
  return { log, lines, kept, calls, bodies, fetchMock };
}

describe('insightLogger', () => {
  it('logs first, then sends one $exception record', async () => {
    const t = setup();
    t.log.error('A call failed.', { name: 'tasks.update', error: 'a bug', personId: 'usr_7', agentId: 'client_9' });
    expect(t.lines).toEqual([{ level: 'error', message: 'A call failed.', fields: { name: 'tasks.update', error: 'a bug', personId: 'usr_7', agentId: 'client_9' } }]);
    await Promise.all(t.kept);
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]!.url).toBe(POSTHOG_CAPTURE_URL);
    expect(POSTHOG_CAPTURE_URL).toBe('https://eu.i.posthog.com/i/v0/e/');
    expect(t.calls[0]!.init.method).toBe('POST');
    const body = t.bodies()[0]!;
    expect(body).toMatchObject({ api_key: KEY, event: '$exception', distinct_id: 'usr_7' });
    expect(body.properties).toMatchObject({
      $exception_source: 'server',
      call: 'tasks.update',
      personId: 'usr_7',
      agentId: 'client_9',
      env: 'test',
      $process_person_profile: false,
    });
    expect(body.properties.$exception_list).toHaveLength(1);
    expect(body.properties.$exception_list[0].value).toContain('A call failed.');
    expect(body.properties.$exception_list[0].value).toContain('a bug');
  });

  it('uses the distinct id madar-server when the line has no person', async () => {
    const t = setup();
    t.log.error('The health check failed.', { error: 'boom' });
    await Promise.all(t.kept);
    expect(t.bodies()[0]!.distinct_id).toBe('madar-server');
    expect(t.bodies()[0]!.properties).not.toHaveProperty('personId');
  });

  it('sends no field that it does not know, and never an input', async () => {
    const t = setup();
    t.log.error('A call failed.', { name: 'projects.create', error: 'x', input: { name: 'Secret villa' }, body: 'private words', title: 'Private title' });
    await Promise.all(t.kept);
    const text = JSON.stringify(t.bodies()[0]);
    expect(text).not.toMatch(/Secret villa|private words|Private title/);
    expect(t.bodies()[0]!.properties).not.toHaveProperty('input');
    expect(Object.keys(t.bodies()[0]!)).not.toContain('input');
  });

  it('scrubs an address in the error text and the values a database error repeats', async () => {
    const t = setup();
    t.log.error('A route failed.', { error: 'Failed https://f.test/k?X-Amz-Signature=1 and Key (name)=(Secret villa) already exists' });
    await Promise.all(t.kept);
    const value = t.bodies()[0]!.properties.$exception_list[0].value as string;
    expect(value).toContain('https://f.test/k');
    expect(value).not.toContain('X-Amz-Signature');
    expect(value).not.toContain('Secret villa');
  });

  it('redacts quoted parts, emails and long tokens in the error text, and keeps the words (third security fix)', async () => {
    const t = setup();
    t.log.error('A call failed.', { name: 'users.invite', personId: 'usr_7', error: 'duplicate key value violates unique constraint "users_email_key" for a.b@vado.sa with eyJhbGciOiJIUzI1NiIsInR5cCI6' });
    await Promise.all(t.kept);
    const body = t.bodies()[0]!;
    const value = body.properties.$exception_list[0].value as string;
    expect(value).toBe('A call failed. duplicate key value violates unique constraint "..." for <email> with <token>');
    // The call name and the person stay as separate fields, so the issue is easy to find.
    expect(body.properties).toMatchObject({ call: 'users.invite', personId: 'usr_7' });
  });

  it('leaves a plain message as it is', async () => {
    const t = setup();
    t.log.error('A call failed.');
    await Promise.all(t.kept);
    expect(t.bodies()[0]!.properties.$exception_list[0].value).toBe('A call failed.');
  });

  it('cuts a huge error text before any pattern reads it', async () => {
    const t = setup();
    const started = performance.now();
    t.log.error('A call failed.', { error: 'a'.repeat(200_000) });
    expect(performance.now() - started).toBeLessThan(50);
    await Promise.all(t.kept);
    expect((t.bodies()[0]!.properties.$exception_list[0].value as string).length).toBeLessThanOrEqual(600);
  });

  it('keeps the error text short', async () => {
    const t = setup();
    t.log.error('A call failed.', { error: 'x'.repeat(5000) });
    await Promise.all(t.kept);
    expect((t.bodies()[0]!.properties.$exception_list[0].value as string).length).toBeLessThanOrEqual(600);
  });

  it('keeps the send off the answer: error() returns before the fetch settles', async () => {
    let finish: () => void = () => undefined;
    const slow = vi.fn(() => new Promise<Response>((resolve) => { finish = () => resolve(new Response('{}')); })) as unknown as typeof fetch;
    const t = setup({ fetch: slow });
    const before = Date.now();
    t.log.error('A call failed.', { error: 'x' });
    expect(Date.now() - before).toBeLessThan(50);
    expect(t.kept).toHaveLength(1);
    let settled = false;
    void t.kept[0]!.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    finish();
    await t.kept[0];
    expect(settled).toBe(true);
  });

  it('drops a failed send: a rejected fetch and a 500 answer throw nothing and send nothing again', async () => {
    const rejecting = vi.fn(async () => { throw new TypeError('network down'); }) as unknown as typeof fetch;
    const a = setup({ fetch: rejecting });
    expect(() => a.log.error('A call failed.', { error: 'x' })).not.toThrow();
    await expect(Promise.all(a.kept)).resolves.toBeDefined();
    expect(rejecting).toHaveBeenCalledTimes(1);

    const failing = vi.fn(async () => new Response('no', { status: 500 })) as unknown as typeof fetch;
    const b = setup({ fetch: failing });
    b.log.error('A call failed.', { error: 'x' });
    await expect(Promise.all(b.kept)).resolves.toBeDefined();
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it('throws nothing when the fetch throws at once, or when keep throws', () => {
    const throwing = vi.fn(() => { throw new Error('no fetch'); }) as unknown as typeof fetch;
    const lines: string[] = [];
    const inner: Logger = { info: () => undefined, warn: () => undefined, error: (message) => { lines.push(message); } };
    const log = insightLogger(inner, { key: KEY, env: 'test', fetch: throwing, keep: () => { throw new Error('no keep'); } });
    expect(() => log.error('A call failed.', { error: 'x' })).not.toThrow();
    expect(lines).toEqual(['A call failed.']);
  });

  it('caps the sends: the 61st error inside one minute sends nothing, and the next minute sends again', async () => {
    let now = 1_000_000;
    const t = setup({ now: () => now });
    for (let i = 0; i < SERVER_SENDS_PER_MINUTE + 1; i += 1) t.log.error('A call failed.', { error: `e${i}` });
    await Promise.all(t.kept);
    expect(SERVER_SENDS_PER_MINUTE).toBe(60);
    expect(t.calls).toHaveLength(60);
    // Every line still reaches the inner logger.
    expect(t.lines).toHaveLength(61);
    now += 60_001;
    t.log.error('A call failed.', { error: 'next minute' });
    await Promise.all(t.kept);
    expect(t.calls).toHaveLength(61);
  });

  it('sends nothing for info and warn, and passes them to the inner logger', async () => {
    const t = setup();
    t.log.info('hello', { a: 1 });
    t.log.warn('careful');
    await Promise.all(t.kept);
    expect(t.calls).toHaveLength(0);
    expect(t.lines.map((line) => line.level)).toEqual(['info', 'warn']);
  });
});
