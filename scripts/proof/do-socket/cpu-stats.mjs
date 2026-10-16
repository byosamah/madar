// Groups the tail events by path and execution model, and prints min, median, p90 and max CPU time and the outcomes.
import { events } from "./parse.mjs";
const evs = events(process.argv[2]);
const groups = {};
for (const e of evs) {
  let p = "?"; try { p = new URL(e.event?.request?.url).pathname; } catch { p = e.event?.getWebSocketEvent ? "ws:" + e.event.getWebSocketEvent.webSocketEventType : JSON.stringify(Object.keys(e.event ?? {})); }
  const k = `${p} ${e.executionModel}`;
  (groups[k] ??= []).push(e);
}
const q = (a, f) => a[Math.min(a.length - 1, Math.ceil(f * a.length) - 1)];
for (const [k, list] of Object.entries(groups)) {
  const cpu = list.map((e) => e.cpuTime).sort((a, b) => a - b);
  const wall = list.map((e) => e.wallTime).sort((a, b) => a - b);
  const out = {}; for (const e of list) out[e.outcome] = (out[e.outcome] ?? 0) + 1;
  console.log(k.padEnd(32), "n", String(list.length).padStart(3), "cpu min", cpu[0], "med", q(cpu, 0.5), "p90", q(cpu, 0.9), "max", cpu.at(-1), "| wall med", q(wall, 0.5), "max", wall.at(-1), "|", JSON.stringify(out));
}
