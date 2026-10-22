/**
 * The page's own /api for the calls of a WebKit browser (performance audit DF-12 and LV-6, measured on the test copy, 2026-10-22).
 *
 * A call to the Supabase function is a cross-site POST with an Authorization header, so the browser first sends a CORS preflight
 * (OPTIONS) and waits for it: one more round trip, about 275 ms. The server allows 7,200 s (`server/http/cors.ts`). Chromium keeps
 * that answer for 2 hours. WebKit keeps it for 10 minutes at most (a call 9 minutes later sent no preflight, a call 11 minutes later
 * sent one), and its network process can stop earlier, so a person who works in bursts pays the round trip again and again.
 * The page's own /api is same-site: no preflight. Measured with the same call, 15 rounds, on WebKit: direct with a preflight 656 ms
 * (median), direct with a cached preflight 370 ms, the page's own /api 383 ms. The /api forwarder is the Pages Function
 * `functions/api/[[path]].ts`; with the setting `supabase` it hands the call to the Supabase function of the copy.
 *
 * Every iPhone and iPad browser is WebKit (Chrome, Firefox and Edge there too), and so is Safari on a Mac. Every other browser keeps the
 * direct address: Chromium caches the preflight for 2 hours, and the forwarder would only add a hop.
 * This file takes plain values and reads no global, so a test can set each one.
 */

/** True for Safari on a Mac and for every browser on an iPhone or iPad. The test runner (jsdom) and Chromium browsers are false. */
export function isWebKit(userAgent: string): boolean {
  // Every browser on iOS and iPadOS is WebKit, whatever its name (CriOS, FxiOS, EdgiOS). The iPad in desktop mode sends the Mac text below.
  if (/\b(iPhone|iPad|iPod)\b/.test(userAgent)) return true;
  // Safari on a Mac names Version/ and Safari/. Chrome, Edge, Opera and Firefox name themselves too; Android is never WebKit.
  return /\bMacintosh\b/.test(userAgent)
    && /\bAppleWebKit\//.test(userAgent)
    && /\bVersion\/[\d.]+ Safari\//.test(userAgent)
    && !/\b(Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS)\b/.test(userAgent);
}

export type BatchApiPlace = {
  /** The api address of the build (`RemoteConfig.apiUrl`). */
  apiUrl: string;
  /** `VITE_API_PAGE_HOSTS`: the page hosts that serve /api, comma separated. Unset when the build must use the direct address. */
  pageHosts: string | undefined;
  /** The host of the page that runs (`location.hostname`). */
  hostname: string;
  userAgent: string;
};

/**
 * The address for the batch calls. It is the page's own `/api` only when all four hold: the build address is a Supabase function (the
 * one that needs a preflight), the build names the page hosts that serve /api, the page runs on one of them (a deployment hash host has
 * no /api function: the forwarder answers 404 there), and the browser is WebKit. Else it is the address of the build.
 */
export function batchApiUrl(o: BatchApiPlace): string {
  let host: string;
  try {
    host = new URL(o.apiUrl).hostname;
  } catch {
    return o.apiUrl;
  }
  if (!host.endsWith('.supabase.co')) return o.apiUrl;
  const hosts = (o.pageHosts ?? '').split(',').map((h) => h.trim().toLowerCase()).filter((h) => h !== '');
  if (!hosts.includes(o.hostname.toLowerCase())) return o.apiUrl;
  return isWebKit(o.userAgent) ? '/api' : o.apiUrl;
}
