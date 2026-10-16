// Steady load for wave 0: one call each second to the office object (n=4, about 40 ms of CPU) and one to the control Worker
// (n=10, about 40 ms), for MINUTES minutes. Each answer goes to load.jsonl.
import { readFileSync, appendFileSync } from "node:fs";
const secret = readFileSync(new URL("./secret.txt", import.meta.url), "utf8").trim();
const H = { "x-probe-secret": secret };
const minutes = Number(process.argv[2] ?? 30);
const out = new URL("./load.jsonl", import.meta.url);
const end = Date.now() + minutes * 60_000;
async function loop(name, url) {
  while (Date.now() < end) {
    const t = Date.now();
    let status = 0, text = "";
    try { const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(20_000) }); status = r.status; text = (await r.text()).slice(0, 60); }
    catch (e) { text = String(e?.message ?? e).slice(0, 60); }
    appendFileSync(out, JSON.stringify({ name, at: t, ms: Date.now() - t, status, text }) + "\n");
    const wait = 1000 - (Date.now() - t);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
}
await Promise.all([
  loop("do", "https://madar-do-probe.vado-sa.workers.dev/do?n=4"),
  loop("worker", "https://madar-cpu-probe.vado-sa.workers.dev/?n=10"),
]);
console.log("load done");
