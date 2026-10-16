// Round 2 of wave 0: heavier calls into the office object only. Each second, one call with n from the list in turn
// (10, 20, 30: about 40 to 300 ms of CPU), for MINUTES minutes. Each answer goes to load.jsonl.
import { readFileSync, appendFileSync } from "node:fs";
const secret = readFileSync(new URL("./secret.txt", import.meta.url), "utf8").trim();
const minutes = Number(process.argv[2] ?? 15);
const out = new URL("./load.jsonl", import.meta.url);
const end = Date.now() + minutes * 60_000;
const ns = [10, 20, 30];
let i = 0;
while (Date.now() < end) {
  const t = Date.now(); const n = ns[i++ % ns.length];
  let status = 0, text = "";
  try { const r = await fetch(`https://madar-do-probe.vado-sa.workers.dev/do?n=${n}`, { headers: { "x-probe-secret": secret }, signal: AbortSignal.timeout(20_000) }); status = r.status; text = (await r.text()).slice(0, 60); }
  catch (e) { text = String(e?.message ?? e).slice(0, 60); }
  appendFileSync(out, JSON.stringify({ name: "do", n, at: t, ms: Date.now() - t, status, text }) + "\n");
  const wait = 1000 - (Date.now() - t);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}
console.log("load done");
