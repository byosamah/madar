// A throwaway probe for wave 0 of the Supabase exit plan (2026-10-16), probes 2 and 3.
// Probe 2: the "Room" object holds browser sockets with the WebSocket Hibernation API. It must sleep between events
// and still reach every socket. The constructor makes a new boot id (memory) and raises a wake counter (storage),
// so each answer shows if the object woke from sleep. The runtime answers "ping" with "pong" and does not wake the object.
// Probe 3: the CPU time of sign-in crypto. bcrypt cost 10 (the Supabase hash), ES256 verify (each API call, in the
// front Worker) and ES256 sign (a sign-in or a token renewal, in the object).
// No data and no secrets in the answers. The front Worker refuses each request without the probe secret.
import { DurableObject } from "cloudflare:workers";
import bcrypt from "bcryptjs";
import inputs from "./public-inputs.json";

const PASSWORD = "a probe password";
const enc = new TextEncoder();

const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

// The front Worker imports the public key once for each isolate, as the real Worker will.
let publicKey = null;
async function verifyEs256(token) {
  if (!publicKey) {
    publicKey = await crypto.subtle.importKey("jwk", inputs.publicJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  }
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, why: "shape" };
  const header = JSON.parse(new TextDecoder().decode(unb64u(parts[0])));
  if (header.alg !== "ES256" || header.kid !== inputs.publicJwk.kid) return { ok: false, why: "header" };
  const good = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, unb64u(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`));
  if (!good) return { ok: false, why: "signature" };
  const claims = JSON.parse(new TextDecoder().decode(unb64u(parts[1])));
  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== "madar-probe" || claims.aud !== "authenticated" || !(claims.exp > now)) return { ok: false, why: "claims" };
  return { ok: true, sub: claims.sub };
}

// The object imports the private key once for each wake (it lives in memory only).
let privateKey = null;
async function signEs256(env, sub) {
  if (!privateKey) {
    privateKey = await crypto.subtle.importKey("jwk", JSON.parse(env.SIGN_JWK), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  }
  const now = Math.floor(Date.now() / 1000);
  const header = b64u(enc.encode(JSON.stringify({ alg: "ES256", typ: "JWT", kid: "probe-1" })));
  const payload = b64u(enc.encode(JSON.stringify({
    iss: "madar-probe", aud: "authenticated", sub, role: "authenticated", session_id: crypto.randomUUID(), iat: now, exp: now + 900,
  })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, enc.encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64u(sig)}`;
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.bootId = crypto.randomUUID().slice(0, 8);
    this.bootAt = Date.now();
    this.firstEvent = null;
    const sql = ctx.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v INTEGER NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS wakes (n INTEGER PRIMARY KEY, boot TEXT NOT NULL, at INTEGER NOT NULL, first TEXT)");
    this.wakes = sql.exec("INSERT INTO meta (k, v) VALUES ('wakes', 1) ON CONFLICT (k) DO UPDATE SET v = v + 1 RETURNING v").one().v;
    sql.exec("INSERT INTO wakes (n, boot, at) VALUES (?, ?, ?)", this.wakes, this.bootId, this.bootAt);
    // The runtime answers this pair itself, with no wake of the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  // Records what woke the object, once for each boot.
  mark(what) {
    if (this.firstEvent) return;
    this.firstEvent = what;
    this.ctx.storage.sql.exec("UPDATE wakes SET first = ? WHERE n = ?", what, this.wakes);
  }

  bump(k) {
    return this.ctx.storage.sql.exec("INSERT INTO meta (k, v) VALUES (?, 1) ON CONFLICT (k) DO UPDATE SET v = v + 1 RETURNING v", k).one().v;
  }

  counter(k) {
    return this.ctx.storage.sql.exec("SELECT v FROM meta WHERE k = ?", k).toArray()[0]?.v ?? 0;
  }

  who() {
    return { bootId: this.bootId, wakes: this.wakes, bootAgeMs: Date.now() - this.bootAt, firstEvent: this.firstEvent };
  }

  async fetch(request) {
    const url = new URL(request.url);
    this.mark(`fetch ${url.pathname}`);
    if (url.pathname === "/ws") {
      if (request.headers.get("upgrade") !== "websocket") return new Response("upgrade needed", { status: 426 });
      const pair = new WebSocketPair();
      const client = url.searchParams.get("c") ?? "?";
      this.ctx.acceptWebSocket(pair[1], [client]);
      pair[1].serializeAttachment({ client, openedAt: Date.now(), openedBoot: this.bootId });
      this.bump("opens");
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (url.pathname === "/broadcast") {
      const n = Number(url.searchParams.get("n") ?? "0");
      const text = JSON.stringify({ type: "broadcast", n, ...this.who(), at: Date.now() });
      let reached = 0;
      let failed = 0;
      const sockets = this.ctx.getWebSockets();
      for (const ws of sockets) {
        try { ws.send(text); reached++; } catch { failed++; }
      }
      return json({ n, reached, failed, sockets: sockets.length, ...this.who() });
    }
    if (url.pathname === "/state") {
      const sockets = this.ctx.getWebSockets().map((ws) => {
        const a = ws.deserializeAttachment() ?? {};
        const pong = this.ctx.getWebSocketAutoResponseTimestamp(ws);
        return { client: a.client, openedAt: a.openedAt, openedBoot: a.openedBoot, lastAutoPong: pong ? pong.getTime() : null };
      });
      const wakeLog = this.ctx.storage.sql.exec("SELECT n, boot, at, first FROM wakes ORDER BY n DESC LIMIT 60").toArray();
      return json({
        ...this.who(), sockets, msgs: this.counter("msgs"), closes: this.counter("closes"), errors: this.counter("errors"),
        opens: this.counter("opens"), lastClose: this.ctx.storage.kv.get("lastClose") ?? null, wakeLog,
      });
    }
    if (url.pathname === "/bcrypt") {
      const ok = bcrypt.compareSync(PASSWORD, inputs.bcryptHash);
      return json({ ok, where: "object" });
    }
    if (url.pathname === "/sign") {
      const token = await signEs256(this.env, "00000000-0000-4000-8000-000000000001");
      return json({ ok: true, token });
    }
    return new Response("not found", { status: 404 });
  }

  async webSocketMessage(ws, message) {
    this.mark("webSocketMessage");
    const msgs = this.bump("msgs");
    const a = ws.deserializeAttachment() ?? {};
    ws.send(JSON.stringify({ type: "echo", client: a.client, got: String(message).slice(0, 40), msgs, ...this.who(), at: Date.now() }));
  }

  async webSocketClose(ws, code, reason, wasClean) {
    this.mark("webSocketClose");
    this.bump("closes");
    const a = ws.deserializeAttachment() ?? {};
    this.ctx.storage.kv.put("lastClose", { client: a.client, code, reason, wasClean, at: Date.now() });
    try { ws.close(code === 1005 ? 1000 : code, "bye"); } catch {}
  }

  async webSocketError(ws, error) {
    this.mark("webSocketError");
    this.bump("errors");
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // A browser socket cannot send a header, so the socket upgrade carries the secret in the query.
    const given = url.pathname === "/ws" ? url.searchParams.get("s") : request.headers.get("x-probe-secret");
    if (!env.PROBE_SECRET || given !== env.PROBE_SECRET) return new Response("not found", { status: 404 });
    if (url.pathname === "/verify") {
      const auth = request.headers.get("authorization") ?? "";
      const r = await verifyEs256(auth.replace(/^Bearer /, ""));
      return json(r, r.ok ? 200 : 401);
    }
    if (url.pathname === "/bcrypt-worker") {
      const ok = bcrypt.compareSync(PASSWORD, inputs.bcryptHash);
      return json({ ok, where: "worker" });
    }
    const room = url.searchParams.get("room") === "crypto" ? "crypto" : "office";
    if (["/ws", "/broadcast", "/state", "/bcrypt", "/sign"].includes(url.pathname)) {
      return env.ROOM.get(env.ROOM.idFromName(room)).fetch(request);
    }
    return new Response("not found", { status: 404 });
  },
};
