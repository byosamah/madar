// Reads a wrangler tail --format json file (pretty JSON objects one after another) and prints one line for each event.
import { readFileSync } from "node:fs";
export function events(file) {
  const t = readFileSync(file, "utf8"); const out = []; let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < t.length; i++) { const c = t[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === "{") { if (depth === 0) start = i; depth++; } else if (c === "}") { depth--; if (depth === 0) { try { out.push(JSON.parse(t.slice(start, i + 1))); } catch {} } } }
  return out.sort((a, b) => a.eventTimestamp - b.eventTimestamp);
}
if (process.argv[2]) for (const e of events(process.argv[2])) {
  let u = "?"; try { const x = new URL(e.event?.request?.url); u = x.pathname + x.search; } catch {}
  console.log(e.executionModel, e.outcome, "cpu", e.cpuTime, "wall", e.wallTime, u, e.event?.response?.status ?? "");
}
