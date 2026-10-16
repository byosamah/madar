// Shared parts of the probe clients: the address, the secret, and a count of every request to the Worker.
import { readFileSync, appendFileSync } from "node:fs";
export const BASE = "https://madar-socket-probe.vado-sa.workers.dev";
const DIR = new URL(".", import.meta.url).pathname;
export const SECRET = readFileSync(DIR + "keys/secret.txt", "utf8").trim();
export const TOKEN = readFileSync(DIR + "keys/token.txt", "utf8").trim();
export function count(what) { appendFileSync(DIR + "requests.log", `${new Date().toISOString()} ${what}\n`); }
export async function call(path, init = {}) {
  count(path.split("?")[0]);
  const t0 = Date.now();
  const r = await fetch(BASE + path, { ...init, headers: { "x-probe-secret": SECRET, ...(init.headers ?? {}) } });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text.slice(0, 200); }
  return { status: r.status, ms: Date.now() - t0, body };
}
export const wsUrl = (client) => `${BASE.replace("https", "wss")}/ws?c=${client}&s=${SECRET}`;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
