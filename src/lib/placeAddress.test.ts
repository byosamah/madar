import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addressOf, ADDRESS_WAIT_MS } from './placeAddress';
import { resetGate } from './nominatimGate';

const POINT = { lat: 26.2834, lng: 50.2105 };
const REVERSE = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=26.2834&lon=50.2105&zoom=17&accept-language=en';
const fetchMock = vi.fn();
const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  resetGate();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('VITE_MADAR_API', 'remote');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('addressOf in the real build (the Location is the address of the pin, 2026-10-19)', () => {
  it('asks OpenStreetMap once and gives the short address', async () => {
    fetchMock.mockResolvedValue(answer({ address: { road: 'King Fahd Road', city: 'Dammam', country: 'Saudi Arabia' } }));
    await expect(addressOf(POINT, 'en')).resolves.toBe('King Fahd Road, Dammam');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(REVERSE);
  });

  it('sends no header and no referrer of its own: the page policy is no-referrer', async () => {
    fetchMock.mockResolvedValue(answer({ address: { road: 'A', city: 'B' } }));
    await addressOf(POINT, 'en');
    const options = fetchMock.mock.calls[0][1] as RequestInit | undefined;
    expect(options?.headers).toBeUndefined();
    expect(options?.referrer).toBeUndefined();
  });

  it('asks in Arabic for an Arabic screen', async () => {
    fetchMock.mockResolvedValue(answer({ address: { road: 'طريق الملك فهد', city: 'الدمام' } }));
    await expect(addressOf(POINT, 'ar')).resolves.toBe('طريق الملك فهد, الدمام');
    expect(String(fetchMock.mock.calls[0][0])).toContain('&accept-language=ar');
  });

  it('gives an empty text when the request fails, so the pin still saves', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(addressOf(POINT, 'en')).resolves.toBe('');
  });

  it('gives an empty text when OpenStreetMap answers with an error status', async () => {
    fetchMock.mockResolvedValue(answer({ error: 'rate limit' }, 429));
    await expect(addressOf(POINT, 'en')).resolves.toBe('');
  });

  it('gives an empty text when the answer is not JSON', async () => {
    fetchMock.mockResolvedValue(new Response('<html>busy</html>', { status: 200 }));
    await expect(addressOf(POINT, 'en')).resolves.toBe('');
  });

  it('gives an empty text when the answer holds no address', async () => {
    fetchMock.mockResolvedValue(answer({ error: 'Unable to geocode' }));
    await expect(addressOf(POINT, 'en')).resolves.toBe('');
  });

  it('gives up after a short wait, and ends the request', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    fetchMock.mockImplementation((_url: string, options?: RequestInit) => new Promise((_resolve, reject) => {
      signal = options?.signal ?? undefined;
      signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const result = addressOf(POINT, 'en');
    await vi.advanceTimersByTimeAsync(ADDRESS_WAIT_MS);
    await expect(result).resolves.toBe('');
    expect(signal?.aborted).toBe(true);
  });

  it('keeps the policy of the search: a second lookup waits one second after the first start', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => answer({ address: { road: 'A', city: 'B' } }));
    const first = addressOf(POINT, 'en');
    const second = addressOf({ lat: 26.3, lng: 50.1 }, 'en');
    await vi.advanceTimersByTimeAsync(0);
    await expect(first).resolves.toBe('A, B');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(second).resolves.toBe('A, B');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('addressOf in the prototype (no network lookup)', () => {
  it('gives an empty text, never raw numbers, and sends no request', async () => {
    vi.stubEnv('VITE_MADAR_API', 'fake');
    await expect(addressOf(POINT, 'en')).resolves.toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
