// Probe 2: three sockets to one office object that sleeps between events (WebSocket Hibernation API).
// Steps: broadcasts after idle gaps of 15 s, 60 s, 3 min and 10 min; then 10 min of "ping" every 30 s from each client
// (the runtime answers "pong" and must not wake the object); then one normal message (it must wake the object);
// then one more idle gap of 6 min, a last broadcast, and a clean close. A socket that closes opens again after 1 s.
// Each event goes to sockets.jsonl. The last line is the summary.
import { appendFileSync, writeFileSync } from "node:fs";
import { call, wsUrl, count, sleep } from "./lib.mjs";

const DIR = new URL(".", import.meta.url).pathname;
const LOG = DIR + "sockets.jsonl";
writeFileSync(LOG, "");
const t0 = Date.now();
const log = (o) => appendFileSync(LOG, JSON.stringify({ t: Date.now(), s: Math.round((Date.now() - t0) / 100) / 10, ...o }) + "\n");

const clients = {};
let shutting = false;

function open(id) {
  count("/ws " + id);
  const c = (clients[id] ??= { id, got: [], rtts: [], opens: 0, closes: [], pings: 0, pongs: 0 });
  c.opens++;
  const ws = new WebSocket(wsUrl(id));
  c.ws = ws;
  c.openedAt = null;
  return new Promise((resolve) => {
    ws.onopen = () => { c.openedAt = Date.now(); c.lastTraffic = Date.now(); log({ ev: "open", id, n: c.opens }); resolve(); };
    ws.onmessage = (e) => {
      const now = Date.now();
      c.lastTraffic = now;
      const data = String(e.data);
      if (data === "pong") {
        c.pongs++;
        const rtt = c.pingAt ? now - c.pingAt : null;
        c.pingAt = null;
        c.rtts.push(rtt);
        log({ ev: "pong", id, rtt });
        return;
      }
      let m;
      try { m = JSON.parse(data); } catch { m = { raw: data.slice(0, 80) }; }
      c.got.push({ at: now, ...m });
      log({ ev: "msg", id, m });
    };
    ws.onclose = (e) => {
      const now = Date.now();
      const rec = { ev: "close", id, code: e.code, reason: e.reason, wasClean: e.wasClean, byUs: shutting,
        openForS: c.openedAt ? (now - c.openedAt) / 1000 : null, idleS: c.lastTraffic ? (now - c.lastTraffic) / 1000 : null };
      c.closes.push(rec);
      log(rec);
      resolve();
      if (!shutting) setTimeout(() => open(id), 1000);
    };
    ws.onerror = (e) => log({ ev: "error", id, msg: String(e?.message ?? e?.type ?? "error") });
  });
}

let seq = 0;
let lastBoot = null;
let lastObjectEventAt = Date.now();
const results = { broadcasts: [], states: [] };
const sleepUntil = (at) => sleep(Math.max(0, at - Date.now()));

async function state(label) {
  const r = await call("/state");
  lastObjectEventAt = Date.now();
  const s = { ev: "state", label, status: r.status, ms: r.ms, ...r.body };
  log(s);
  results.states.push(s);
  if (r.body?.bootId) lastBoot = r.body.bootId;
  return s;
}

async function broadcast(label) {
  seq++;
  const gapS = Math.round((Date.now() - lastObjectEventAt) / 1000);
  const r = await call(`/broadcast?n=${seq}`, { method: "POST" });
  lastObjectEventAt = Date.now();
  await sleep(3000);
  const per = Object.values(clients).map((c) => ({ id: c.id, got: c.got.some((m) => m.type === "broadcast" && m.n === seq), open: c.ws.readyState === 1 }));
  const b = r.body ?? {};
  const res = { ev: "broadcast", label, gapS, n: seq, status: r.status, ms: r.ms, reached: b.reached, sockets: b.sockets, bootId: b.bootId,
    wakes: b.wakes, firstEvent: b.firstEvent, bootAgeMs: b.bootAgeMs, newBoot: lastBoot !== null && b.bootId !== lastBoot, allGot: per.every((p) => p.got), per };
  lastBoot = b.bootId;
  log(res);
  results.broadcasts.push(res);
  return res;
}

// 1. Open three sockets.
for (const id of ["c1", "c2", "c3"]) await open(id);
const s0 = await state("after open");

// 2. Broadcasts after idle gaps.
for (const [label, ms] of [["15 s", 15_000], ["60 s", 60_000], ["3 min", 180_000], ["10 min", 600_000]]) {
  await sleepUntil(lastObjectEventAt + ms);
  await broadcast(label);
}
const beforePing = results.broadcasts.at(-1);

// 3. Ten minutes of "ping" every 30 s from each client, all at the same moment.
const pingStart = Date.now();
for (let round = 1; round <= 20; round++) {
  await sleep(30_000);
  for (const c of Object.values(clients)) {
    if (c.ws.readyState !== 1) continue;
    c.pingAt = Date.now();
    c.lastTraffic = c.pingAt;
    c.pings++;
    c.ws.send("ping");
  }
}
const pingEnd = Date.now();
await sleep(5000);
const sPing = await state("after ping period");
const wakesInPing = (sPing.wakeLog ?? []).filter((w) => w.at >= pingStart && w.at <= pingEnd);

// 4. One normal message after 60 s of quiet: it must wake the object and get an answer.
await sleepUntil(lastObjectEventAt + 60_000);
const c1 = clients.c1;
const before = c1.got.length;
const helloAt = Date.now();
c1.ws.send(JSON.stringify({ type: "hello" }));
c1.lastTraffic = helloAt;
await sleep(3000);
const echo = c1.got.slice(before).find((m) => m.type === "echo") ?? null;
lastObjectEventAt = Date.now();
log({ ev: "hello", echo, echoMs: echo ? echo.at - helloAt : null, newBoot: echo ? echo.bootId !== lastBoot : null });
if (echo) lastBoot = echo.bootId;

// 5. A last idle gap of 6 minutes, a last broadcast, then a clean close.
await sleepUntil(lastObjectEventAt + 360_000);
await broadcast("6 min");
const sEnd = await state("before close");
shutting = true;
for (const c of Object.values(clients)) c.ws.close(1000, "probe done");
await sleep(4000);
const sClosed = await state("after close");

const q = (a, f) => a[Math.min(a.length - 1, Math.max(0, Math.ceil(f * a.length) - 1))];
const summary = {
  ev: "summary", minutes: Math.round((Date.now() - t0) / 600) / 100,
  broadcasts: results.broadcasts.map(({ label, gapS, reached, sockets, allGot, bootId, wakes, newBoot, firstEvent }) => ({ label, gapS, reached, sockets, allGot, bootId, wakes, newBoot, firstEvent })),
  ping: {
    beforeBoot: beforePing.bootId, beforeWakes: beforePing.wakes, afterBoot: sPing.bootId, afterWakes: sPing.wakes, afterFirstEvent: sPing.firstEvent,
    msgsAfter: sPing.msgs, wakesInPeriod: wakesInPing,
    perClient: Object.values(clients).map((c) => { const r = c.rtts.filter((x) => x !== null).sort((a, b) => a - b); return { id: c.id, pings: c.pings, pongs: c.pongs, rttMin: r[0], rttMed: q(r, 0.5), rttMax: r.at(-1) }; }),
    lastAutoPong: sPing.sockets?.map((x) => ({ client: x.client, lastAutoPong: x.lastAutoPong })),
  },
  hello: echo ? { bootId: echo.bootId, wakes: echo.wakes, firstEvent: echo.firstEvent, msgs: echo.msgs, echoMs: echo.at - helloAt } : null,
  closesByCloudflare: Object.values(clients).flatMap((c) => c.closes.filter((x) => !x.byUs)),
  closesByUs: Object.values(clients).flatMap((c) => c.closes.filter((x) => x.byUs)).map(({ id, code, wasClean }) => ({ id, code, wasClean })),
  opens: Object.values(clients).map((c) => ({ id: c.id, opens: c.opens })),
  end: { socketsBeforeClose: sEnd.sockets?.length, socketsAfterClose: sClosed.sockets?.length, closesSeenByObject: sClosed.closes, lastClose: sClosed.lastClose, msgs: sClosed.msgs, errors: sClosed.errors, wakes: sClosed.wakes },
  firstState: { bootId: s0.bootId, wakes: s0.wakes },
};
log(summary);
console.log(JSON.stringify(summary, null, 1));
process.exit(0);
