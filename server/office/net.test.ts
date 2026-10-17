import { describe, expect, it } from 'vitest';
import type { Mail } from '../core/ports';
import { MailSendError } from '../mail/resend';
import { PushSendError, sendPush } from '../push/send';
import { makeVapidKeys } from '../push/vapid';
import { NET_BUDGET, NET_IN_TRANSACTION, NetBudgetSpent, answerOf, failureOf, netPorts, postPush, type NetAnswer } from './net';
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
