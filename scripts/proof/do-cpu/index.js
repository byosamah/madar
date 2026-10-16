// A throwaway probe for wave 0 of the Supabase exit plan (2026-10-16): does a Durable Object on Workers Free get more than
// 10 ms of CPU for each call under a steady load? /do?n=N runs about N million steps inside the office object and writes one
// SQLite row. /pbkdf2 times 100,000 rounds of PBKDF2 inside the object. No data, no secrets in the answers.
import { DurableObject } from "cloudflare:workers";

const burn = (n) => {
  let x = 0;
  for (let i = 0; i < n * 1_000_000; i++) x += Math.sqrt(i);
  return x;
};

export class Office extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS calls (id INTEGER PRIMARY KEY, n INTEGER, at INTEGER)");
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/pbkdf2") {
      const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("a probe password"), "PBKDF2", false, ["deriveBits"]);
      const salt = crypto.getRandomValues(new Uint8Array(16));
      await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100_000 }, key, 256);
      return new Response("pbkdf2 done");
    }
    const n = Math.min(Number(url.searchParams.get("n") ?? "0"), 200);
    const x = burn(n);
    const id = this.ctx.storage.sql.exec("INSERT INTO calls (n, at) VALUES (?, ?) RETURNING id", n, Date.now()).one().id;
    return new Response(`do ${x > 0 ? "done" : "none"} row ${id}`);
  }
}

export default {
  async fetch(request, env) {
    if (request.headers.get("x-probe-secret") !== env.PROBE_SECRET) return new Response("not found", { status: 404 });
    const url = new URL(request.url);
    if (url.pathname === "/do" || url.pathname === "/pbkdf2") return env.OFFICE.get(env.OFFICE.idFromName("office")).fetch(request);
    return new Response("not found", { status: 404 });
  },
};
