import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/api/errors';
import { MAX_BODY_BYTES } from '../../src/api/remote/wire';
import { buildOlder, readBody } from './limits';

/** A body with no Content-Length, sent in chunks, as a browser stream or a chunked upload sends it. */
function streamed(total: number, chunk = 64 * 1024): Request {
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= total) return controller.close();
      const size = Math.min(chunk, total - sent);
      sent += size;
      controller.enqueue(new Uint8Array(size).fill(120));
    },
  });
  return new Request('http://127.0.0.1/batch', { method: 'POST', body, duplex: 'half' } as RequestInit);
}

describe('the build check', () => {
  it('compares the builds number by number', () => {
    expect(buildOlder('2026.9.30', '2026.10.4')).toBe(true);
    expect(buildOlder('2026.10.12', '2026.10.4')).toBe(false);
    expect(buildOlder('2026.10.4', '2026.10.4')).toBe(false);
    expect(buildOlder('2026.10', '2026.10.1')).toBe(true);
  });

  it('accepts every build while the oldest accepted build is 0, and refuses a missing or empty build otherwise', () => {
    expect(buildOlder(undefined, '0')).toBe(false);
    expect(buildOlder(undefined, '2026.10.4')).toBe(true);
    expect(buildOlder('dev', '2026.10.4')).toBe(true);
  });
});

describe('the body read', () => {
  it('reads a chunked body up to the limit', async () => {
    expect((await readBody(streamed(MAX_BODY_BYTES))).length).toBe(MAX_BODY_BYTES);
  });

  it('stops a chunked body over the limit with too_large', async () => {
    const error = await readBody(streamed(MAX_BODY_BYTES + 1)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).details.reason).toBe('too_large');
  });
});
