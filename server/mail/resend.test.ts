import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mail } from '../core/ports';
import { MailSendError, RESEND_URL, resendMailPort } from './resend';

/**
 * The Resend sender (plan 5.4; task N2.1). Every test hands the port a stub fetch; the global fetch fails the test, so no test
 * ever reaches api.resend.com.
 */

const KEY = 're_test_not_a_real_key';
const FROM = 'Madar <notices@notices.madar.example>';
const mail: Mail = {
  to: 'sara@madar.test',
  subject: 'A task is assigned to you',
  html: '<p>A task is assigned to you.</p>',
  text: 'A task is assigned to you.',
  tag: 'notice.task_assigned',
  idempotencyKey: 'notice-ntf_001',
};

type Seen = { url: string; init: RequestInit };

function stubFetch(answer: () => Response | Promise<Response>) {
  const seen: Seen[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), init: init ?? {} });
    return answer();
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, seen };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('A test reached the real fetch.');
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the Resend sender', () => {
  it('posts one email to the Resend API with the key, the idempotency key and the tag, and returns the Resend id', async () => {
    const stub = stubFetch(() => json(200, { id: 'resend-id-1' }));
    const result = await resendMailPort({ apiKey: KEY, from: FROM }, { fetch: stub.fetch }).send(mail);
    expect(result).toEqual({ id: 'resend-id-1' });
    expect(stub.seen).toHaveLength(1);
    const [{ url, init }] = stub.seen;
    expect(url).toBe(RESEND_URL);
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': 'notice-ntf_001' });
    expect(JSON.parse(String(init.body))).toEqual({
      from: FROM,
      to: ['sara@madar.test'],
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      tags: [{ name: 'kind', value: 'notice_task_assigned' }],
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('keeps only the letters, digits, _ and - that Resend allows in a tag value', async () => {
    const stub = stubFetch(() => json(200, { id: 'x' }));
    await resendMailPort({ apiKey: KEY, from: FROM }, { fetch: stub.fetch }).send({ ...mail, tag: 'quota warning/ü.1' });
    expect(JSON.parse(String(stub.seen[0].init.body)).tags).toEqual([{ name: 'kind', value: 'quota_warning___1' }]);
  });

  it('refuses an idempotency key that is empty or longer than the 256 characters Resend keeps, before any request', async () => {
    const stub = stubFetch(() => json(200, { id: 'x' }));
    const port = resendMailPort({ apiKey: KEY, from: FROM }, { fetch: stub.fetch });
    await expect(port.send({ ...mail, idempotencyKey: 'k'.repeat(257) })).rejects.toThrow(/256/);
    await expect(port.send({ ...mail, idempotencyKey: '' })).rejects.toThrow(/idempotency key/);
    expect(stub.seen).toHaveLength(0);
  });

  it('turns a refusal into a MailSendError with the status and the Resend error name, and never the API key', async () => {
    const stub = stubFetch(() => json(422, { statusCode: 422, name: 'validation_error', message: `The to field is wrong. Bearer ${KEY}` }));
    const error = await resendMailPort({ apiKey: KEY, from: FROM }, { fetch: stub.fetch }).send(mail).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MailSendError);
    expect(error).toMatchObject({ status: 422, code: 'validation_error', retryable: false });
    expect(String((error as Error).message)).not.toContain(KEY);
    expect(JSON.stringify(error)).not.toContain(KEY);
  });

  it('marks a rate limit, a busy key and a server error as retryable, and a key reused with another email as final', async () => {
    const cases: [number, string, boolean][] = [
      [429, 'rate_limit_exceeded', true],
      [409, 'concurrent_idempotent_requests', true],
      [500, 'internal_server_error', true],
      [409, 'invalid_idempotent_request', false],
      [403, 'validation_error', false],
    ];
    for (const [status, name, retryable] of cases) {
      const stub = stubFetch(() => json(status, { statusCode: status, name, message: 'no' }));
      const error = await resendMailPort({ apiKey: KEY, from: FROM }, { fetch: stub.fetch }).send(mail).catch((e: unknown) => e);
      expect({ status, name, error }).toMatchObject({ status, name, error: { status, code: name, retryable } });
    }
  });

  it('gives a retryable MailSendError when the answer is not JSON or has no id', async () => {
    for (const answer of [() => new Response('<html>bad gateway</html>', { status: 502 }), () => json(200, {})]) {
      const stub = stubFetch(answer);
      const error = await resendMailPort({ apiKey: KEY, from: FROM }, { fetch: stub.fetch }).send(mail).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(MailSendError);
      expect((error as MailSendError).retryable).toBe(true);
    }
  });

  it('gives a retryable MailSendError when the network fails or the request runs out of time', async () => {
    const port = resendMailPort({ apiKey: KEY, from: FROM }, { fetch: (async () => { throw new TypeError('fetch failed'); }) as typeof fetch });
    await expect(port.send(mail)).rejects.toMatchObject({ code: 'network', retryable: true });
    const slow = resendMailPort({ apiKey: KEY, from: FROM }, {
      timeoutMs: 5,
      fetch: ((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation timed out.', 'TimeoutError')));
      })) as typeof fetch,
    });
    await expect(slow.send(mail)).rejects.toMatchObject({ code: 'timeout', retryable: true });
  });

  it('refuses to build without a key or a sender', () => {
    expect(() => resendMailPort({ apiKey: '', from: FROM })).toThrow(/RESEND_API_KEY/);
    expect(() => resendMailPort({ apiKey: KEY, from: '' })).toThrow(/MAIL_FROM/);
  });
});
