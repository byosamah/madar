// madar-probe-edge: the front Worker of the Hyperdrive probe (proof.md, "Hyperdrive probe on madar-test (2026-10-16)").
// It has no placement, so it runs in the data center nearest to the caller. It forwards each request, with its
// x-probe-secret header, to madar-probe through the service binding PROBE, and adds its own colo and time to the answer.
// It holds no secret: madar-probe checks the header.
type Fetcher = { fetch(request: Request): Promise<Response> };
type Env = { PROBE: Fetcher };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const t0 = Date.now();
    const edgeColo = (request as Request & { cf?: { colo?: string } }).cf?.colo;
    const inner = await env.PROBE.fetch(request);
    const text = await inner.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = text.slice(0, 500);
    }
    return new Response(
      JSON.stringify({ edgeColo, edgeMs: Date.now() - t0, status: inner.status, innerPlacementHeader: inner.headers.get('cf-placement'), inner: body }),
      { status: inner.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
    );
  },
};
