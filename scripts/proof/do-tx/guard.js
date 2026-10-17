// The guard of the do-tx probe (exit wave 5, R8 (e)): a deployed probe answers only with the header x-probe-secret = PROBE_SECRET.
// The local harness (run.mjs) calls http://localhost and sets no secret, so it passes as before.
export function allowed(request, env) {
  const url = new URL(request.url);
  if (!env.PROBE_SECRET) return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  return request.headers.get('x-probe-secret') === env.PROBE_SECRET;
}
