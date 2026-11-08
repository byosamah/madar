import { fakeDaftra } from '../../../daftra/fakeDaftra';
import { fakeGoogle } from '../../../google/fakeGoogle';

/**
 * The outside services of the live test Worker (plan A of Madar enterprises): a fake Google and a fake Daftra account in the memory of
 * the Worker. The network port of the Worker (WorkerNet) sends a Google or Daftra request here, so no test reaches a real service.
 * Every value is made up. `OUTSIDE_SECRETS` are the values that the harness gives the office object when a suite asks for them
 * (`startLive({ outside: true })`), the same three Google values and the same Daftra pair that a real Worker holds as secrets.
 */

const GOOGLE_CLIENT_ID = 'id-made-up.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = 'cs-SECRET';
/** 32 bytes of value 11 in base64: the made-up seal key of the test. */
const GOOGLE_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(11)));

const google = fakeGoogle({ clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET });
const daftra = fakeDaftra({
  account: 'MAZJ',
  clients: [{ id: '842', name: 'Gulf Crest Holding' }],
  invoices: [{
    id: '1830', no: 'N1830', clientId: '842', total: 5, date: '2026-10-20', created: '2026-10-20 09:00:00', paymentStatus: 2,
    payments: [{ date: '2026-10-22 00:00:00', amount: 5 }],
  }],
});

export const OUTSIDE_SECRETS: Record<string, string> = {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  MADAR_GOOGLE_KEY: GOOGLE_KEY,
  DAFTRA_MAZJ_KEY: daftra.apiKey,
  DAFTRA_MAZJ_SITE: daftra.site,
};
/** The Daftra account of the Worker, as the real Worker holds it in its config. The key stays in the Worker. */
export const OUTSIDE_DAFTRA = { MAZJ: daftra.config };

/** The fetch behind the Worker: a Google address goes to the fake Google, the Daftra site to the fake Daftra, anything else is a mistake. */
export const outsideFetch: typeof fetch = async (input, init) => {
  const host = new URL(String(input instanceof Request ? input.url : input)).hostname;
  if (host.endsWith('googleapis.com')) return google.fetch(input, init);
  if (host === daftra.site) return daftra.fetch(input, init);
  throw new Error(`The test Worker has no fake for ${host}.`);
};

/** True for an address that the fakes answer. */
export const isOutsideHost = (input: RequestInfo | URL): boolean => {
  const host = new URL(String(input instanceof Request ? input.url : input)).hostname;
  return host.endsWith('googleapis.com') || host === daftra.site;
};

/** What the fakes saw: the method and the address, never a header or a body. */
export function outsideSeen(): { google: { method: string; path: string }[]; daftra: { method: string; url: string }[] } {
  return {
    google: google.requests.map((request) => ({ method: request.method, path: request.path })),
    daftra: daftra.requests.map((request) => ({ method: request.method, url: request.url })),
  };
}
