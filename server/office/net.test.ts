import { describe, expect, it } from 'vitest';
import type { Mail } from '../core/ports';
import { MailSendError } from '../mail/resend';
import { PushSendError, sendPush } from '../push/send';
import { makeVapidKeys } from '../push/vapid';
import { NET_BUDGET, NET_HTTP_MAX_CHARS, NET_IN_TRANSACTION, NetBudgetSpent, answerOf, daftraRequest, failureOf, googleRequest, isGoogleApiUrl, netPorts, postPush, type NetAnswer } from './net';
import { recordingNet } from './test/fakes';

const NOW = new Date('2026-10-04T06:00:00Z');
const PUSH = 'https://fcm.googleapis.com/fcm/send/abc';
const MAIL: Mail = { to: 'a@madar.test', subject: 'S', html: '<p>H</p>', text: 'H', tag: 'notice', idempotencyKey: 'notice-ntf_001' };
const ok = <T,>(value: T): Promise<NetAnswer<T>> => Promise.resolve({ ok: true, value });

const closed = { open: () => false, now: () => NOW };

describe('the network port of the office object (server/office/net.ts)', () => {
  it('answers a file call through the port, and counts only a call that is a real network call', async () => {
    const net = recordingNet();
    const ports = netPorts(net, { guard: closed, kind: 'r2', maxFileBytes: 100 });
    expect(await ports.files.presignGet('files/a', { disposition: 'inline', filename: 'a.png', mimeType: 'image/png' })).toEqual({ url: 'https://files.test/get/files/a', expiresAt: '2099-01-01T00:00:00.000Z' });
    expect(await ports.files.head('files/a')).toEqual({ size: 10, mimeType: 'image/png' });
    expect([ports.files.kind, ports.files.maxFileBytes, ports.used()]).toEqual(['r2', 100, 1]);
    expect(net.calls).toEqual(['presignGet files/a', 'head files/a']);
  });

  it('refuses a network call while a transaction is open, before it reaches the Worker', async () => {
    const net = recordingNet();
    const ports = netPorts(net, { guard: { open: () => true, now: () => NOW }, kind: 'r2', maxFileBytes: 100 });
    await expect(ports.mail.send(MAIL)).rejects.toThrow(NET_IN_TRANSACTION);
    expect(net.calls).toEqual([]);
  });

  it('stops at the budget with an error that names a time to try again', async () => {
    const ports = netPorts(recordingNet(), { guard: closed, kind: 'r2', maxFileBytes: 100 });
    for (let i = 0; i < NET_BUDGET; i += 1) await ports.mail.send(MAIL);
    const error = await ports.mail.send(MAIL).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NetBudgetSpent);
    expect((error as NetBudgetSpent).retryAt.toISOString()).toBe('2026-10-04T06:01:00.000Z');
  });

  it('gives back the error class that the caller reads, with its fields', async () => {
    const refused = new MailSendError('Resend refused the mail.', { status: 403, code: 'validation_error', retryable: false });
    const net = recordingNet({ sendMail: () => Promise.resolve({ ok: false, failure: failureOf(refused) }) });
    const error = await netPorts(net, { guard: closed, kind: 'r2', maxFileBytes: 100 }).mail.send(MAIL).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MailSendError);
    expect({ ...(error as MailSendError).toJSON() }).toEqual(refused.toJSON());
  });

  it('turns a thrown error into a failure, and never throws', async () => {
    expect(await answerOf(async () => { throw new PushSendError('The push service answered 503.', 503); })).toEqual({
      ok: false, failure: { name: 'PushSendError', message: 'The push service answered 503.', status: 503 },
    });
  });

  it('lets sendPush run in the object and post in the Worker, with the same outcomes', async () => {
    const keys = await makeVapidKeys();
    const config = { ...keys, subject: 'mailto:madar@vado.sa' };
    const net = recordingNet();
    const { pushFetch } = netPorts(net, { guard: closed, kind: 'r2', maxFileBytes: 100 });
    expect(await sendPush(config, PUSH, { fetch: pushFetch, now: () => NOW })).toBe('sent');
    const gone = netPorts(recordingNet({ pushPost: () => ok({ status: 410 }) }), { guard: closed, kind: 'r2', maxFileBytes: 100 });
    expect(await sendPush(config, PUSH, { fetch: gone.pushFetch, now: () => NOW })).toBe('gone');
    const late = netPorts(recordingNet({ pushPost: () => Promise.resolve({ ok: false, failure: { name: 'TimeoutError', message: 'timed out' } }) }), { guard: closed, kind: 'r2', maxFileBytes: 100 });
    await expect(sendPush(config, PUSH, { fetch: late.pushFetch, now: () => NOW })).rejects.toThrow('The push to fcm.googleapis.com timed out.');
    expect(net.calls).toEqual([`push ${PUSH}`]);
  });
});

describe('the push POST of the Worker (postPush)', () => {
  it('refuses an address that is not a push service, with no fetch', async () => {
    const seen: string[] = [];
    const post = postPush(async (input) => (seen.push(String(input)), new Response(null, { status: 201 })));
    expect(await post('https://evil.example/collect', {}, 3000)).toMatchObject({ ok: false });
    expect(seen).toEqual([]);
  });

  it('posts the headers to a push service and gives back the status', async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const post = postPush(async (input, init) => (seen.push({ url: String(input), headers: Object.fromEntries(new Headers(init?.headers).entries()) }), new Response(null, { status: 201 })));
    expect(await post(PUSH, { authorization: 'vapid t=x, k=y', ttl: '3600' }, 3000)).toEqual({ ok: true, value: { status: 201 } });
    expect(seen).toEqual([{ url: PUSH, headers: { authorization: 'vapid t=x, k=y', ttl: '3600' } }]);
  });
});

type Seen = { url: string; init: RequestInit | undefined };
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_EVENT = 'https://www.googleapis.com/calendar/v3/calendars/c/events/e';
const recorder = (reply: () => Response | Promise<Response> = () => new Response('{"id":"cal-1"}', { status: 200 })) => {
  const seen: Seen[] = [];
  const run = (async (input: RequestInfo | URL, init?: RequestInit) => (seen.push({ url: String(input), init }), reply())) as typeof fetch;
  return { seen, run };
};
const headerNames = (init: RequestInit | undefined): string[] => Object.keys(Object.fromEntries(new Headers(init?.headers).entries())).sort();

describe('the Google request of the Worker (googleRequest)', () => {
  it('refuses an address that is not a Google address, with no fetch', async () => {
    const { seen, run } = recorder();
    const request = googleRequest(run);
    const refused = [
      'https://evil.example/token',
      'http://oauth2.googleapis.com/token',
      'https://oauth2.googleapis.com/token?x=1',
      'https://oauth2.googleapis.com/other',
      'https://www.googleapis.com/drive/v3/files',
      'https://u:p@www.googleapis.com/calendar/v3/calendars',
    ];
    for (const url of refused) expect(await request({ url, method: 'POST', headers: {}, body: null })).toMatchObject({ ok: false });
    expect(await request({ url: GOOGLE_TOKEN, method: 'TRACE', headers: {}, body: null })).toMatchObject({ ok: false });
    expect(seen).toEqual([]);
    expect([GOOGLE_TOKEN, 'https://oauth2.googleapis.com/revoke', 'https://www.googleapis.com/calendar/v3/calendars/x/events?timeMin=1'].map(isGoogleApiUrl)).toEqual([true, true, true]);
    expect(refused.map(isGoogleApiUrl)).toEqual(refused.map(() => false));
  });

  it('refuses a body over the limit', async () => {
    const { seen, run } = recorder();
    expect(await googleRequest(run)({ url: GOOGLE_TOKEN, method: 'POST', headers: {}, body: 'x'.repeat(64_001) })).toMatchObject({ ok: false });
    expect(seen).toEqual([]);
  });

  it('sends only authorization, content-type and accept, never follows a redirect, and gives back the status and the text', async () => {
    const { seen, run } = recorder();
    const answer = await googleRequest(run)({
      url: GOOGLE_EVENT, method: 'PATCH',
      headers: { authorization: 'Bearer at-1', 'content-type': 'application/json', accept: 'application/json', cookie: 'a=b', 'x-evil': '1' },
      body: '{"summary":"S"}',
    });
    expect(answer).toEqual({ ok: true, value: { status: 200, body: '{"id":"cal-1"}' } });
    expect(seen).toHaveLength(1);
    expect(seen[0].init?.redirect).toBe('manual');
    expect(seen[0].init?.method).toBe('PATCH');
    expect(headerNames(seen[0].init)).toEqual(['accept', 'authorization', 'content-type']);
    const missing = recorder(() => new Response('{"error":{}}', { status: 404 }));
    expect(await googleRequest(missing.run)({ url: GOOGLE_EVENT, method: 'GET', headers: {}, body: null })).toEqual({ ok: true, value: { status: 404, body: '{"error":{}}' } });
  });
});

describe('the Daftra request of the Worker (daftraRequest)', () => {
  const accounts = { MAZJ: { key: 'K'.repeat(30), site: 'mazj.daftra.com' } };

  it('adds the key of the account itself and sends a GET', async () => {
    const { seen, run } = recorder(() => new Response('{"ok":1}', { status: 200 }));
    const answer = await daftraRequest(accounts, run)({ url: 'https://MAZJ.daftra.com/api2/invoices/1.json' });
    expect(answer).toEqual({ ok: true, value: { status: 200, body: '{"ok":1}' } });
    expect(seen).toHaveLength(1);
    expect(seen[0].init?.method).toBe('GET');
    expect(seen[0].init?.redirect).toBe('manual');
    expect(new Headers(seen[0].init?.headers).get('apikey')).toBe('K'.repeat(30));
    expect(seen[0].init?.body ?? null).toBeNull();
  });

  it('refuses a site it does not hold, a plain address, a path outside api2 and an address with a user, with no fetch', async () => {
    const { seen, run } = recorder();
    const request = daftraRequest(accounts, run);
    for (const url of [
      'https://other.daftra.com/api2/x.json',
      'http://mazj.daftra.com/api2/x.json',
      'https://mazj.daftra.com/admin/x',
      'https://u:p@mazj.daftra.com/api2/x.json',
      'not a url',
    ]) expect(await request({ url })).toMatchObject({ ok: false });
    expect(seen).toEqual([]);
  });
});

describe('a failure of the Worker request', () => {
  it('turns a thrown error into a failure with a fixed message, and keeps no secret', async () => {
    const throws = recorder(() => { throw new Error('connect failed Bearer at-SECRET'); });
    const google = await googleRequest(throws.run)({ url: GOOGLE_TOKEN, method: 'POST', headers: {}, body: null });
    const daftra = await daftraRequest({ MAZJ: { key: 'K'.repeat(30), site: 'mazj.daftra.com' } }, throws.run)({ url: 'https://mazj.daftra.com/api2/x.json' });
    for (const answer of [google, daftra]) {
      expect(answer).toEqual({ ok: false, failure: { name: 'NetworkError', message: 'The outside request did not finish.' } });
      expect(JSON.stringify(answer)).not.toContain('at-SECRET');
    }
    const late = recorder(() => { throw new DOMException('too slow', 'TimeoutError'); });
    expect(await googleRequest(late.run)({ url: GOOGLE_TOKEN, method: 'POST', headers: {}, body: null })).toEqual({
      ok: false, failure: { name: 'TimeoutError', message: 'The outside request did not finish.' },
    });
  });

  it('turns an answer body over the limit into a failure', async () => {
    const big = recorder(() => new Response('x'.repeat(NET_HTTP_MAX_CHARS + 1), { status: 200 }));
    expect(await googleRequest(big.run)({ url: GOOGLE_TOKEN, method: 'POST', headers: {}, body: null })).toEqual({
      ok: false, failure: { name: 'NetworkError', message: 'The outside request did not finish.' },
    });
  });
});

describe('the Google and Daftra fetch of the office object (netPorts)', () => {
  const portsOf = (net: ReturnType<typeof recordingNet>, guard = closed) => netPorts(net, { guard, kind: 'r2', maxFileBytes: 100 });

  it('gives a Response with a null body for an empty answer', async () => {
    const net = recordingNet({ googleFetch: () => ok({ status: 204, body: '' }) });
    const response = await portsOf(net).googleFetch(GOOGLE_EVENT, { method: 'DELETE' });
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
  });

  it('sends the method, the headers and the body of a Google call, and gives back the text', async () => {
    let sent: unknown;
    const net = recordingNet({ googleFetch: (req) => (sent = req, ok({ status: 200, body: '{"id":"x"}' })) });
    const response = await portsOf(net).googleFetch(GOOGLE_TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"a":1}' });
    expect(sent).toEqual({ url: GOOGLE_TOKEN, method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":1}' });
    expect(await response.json()).toEqual({ id: 'x' });
  });

  it('sends only the address of a Daftra call, refuses a method that is not GET, and shares the budget', async () => {
    let sent: unknown;
    const net = recordingNet({ daftraGet: (req) => (sent = req, ok({ status: 200, body: '{}' })) });
    const ports = portsOf(net);
    await ports.daftraFetch('https://mazj.daftra.com/api2/x.json', { method: 'GET', headers: { apikey: 'SECRET' } });
    expect(Object.keys(sent as object)).toEqual(['url']);
    await expect(ports.daftraFetch('https://mazj.daftra.com/api2/x.json', { method: 'POST' })).rejects.toThrow('Madar only reads Daftra.');
    const rest = NET_BUDGET - 1;
    for (let i = 0; i < rest; i += 1) await (i % 2 === 0 ? ports.googleFetch(GOOGLE_EVENT) : ports.daftraFetch('https://mazj.daftra.com/api2/x.json'));
    await expect(ports.googleFetch(GOOGLE_EVENT)).rejects.toBeInstanceOf(NetBudgetSpent);
    await expect(ports.daftraFetch('https://mazj.daftra.com/api2/x.json')).rejects.toBeInstanceOf(NetBudgetSpent);
  });

  it('refuses both calls inside a transaction, and no request leaves', async () => {
    const net = recordingNet();
    const ports = portsOf(net, { open: () => true, now: () => NOW });
    await expect(ports.googleFetch(GOOGLE_EVENT)).rejects.toThrow(NET_IN_TRANSACTION);
    await expect(ports.daftraFetch('https://mazj.daftra.com/api2/x.json')).rejects.toThrow(NET_IN_TRANSACTION);
    expect(net.calls).toEqual([]);
  });

  it('gives back a failure of the Worker as an error with its class', async () => {
    const net = recordingNet({ daftraGet: () => Promise.resolve({ ok: false, failure: { name: 'TimeoutError', message: 'The outside request did not finish.' } }) });
    const error = await portsOf(net).daftraFetch('https://mazj.daftra.com/api2/x.json').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe('TimeoutError');
  });
});
