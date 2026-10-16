// A throwaway probe: n burns about n million steps of CPU; sub makes that many outgoing fetches. No data, no secrets.
export default {
  async fetch(request, env) {
    if (request.headers.get("x-probe-secret") !== env.PROBE_SECRET) return new Response("not found", { status: 404 });
    const url = new URL(request.url);
    const n = Math.min(Number(url.searchParams.get("n") ?? "0"), 200) * 1_000_000;
    const sub = Math.min(Number(url.searchParams.get("sub") ?? "0"), 80);
    let x = 0;
    for (let i = 0; i < n; i++) x += Math.sqrt(i);
    let ok = 0;
    try {
      for (let i = 0; i < sub; i++) {
        const r = await fetch("https://www.cloudflare.com/cdn-cgi/trace");
        await r.arrayBuffer();
        ok += 1;
      }
    } catch (e) {
      return new Response(`subrequests ok ${ok}, then: ${String(e && e.message || e).slice(0, 120)}`, { status: 500 });
    }
    return new Response(`cpu ${x > 0 ? "done" : "none"}, subrequests ok ${ok}`);
  },
};
