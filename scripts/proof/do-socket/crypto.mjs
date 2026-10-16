// Probe 3: sends the sign-in crypto calls one after another and writes one line for each answer.
import { call, sleep, TOKEN } from "./lib.mjs";
import { jwtVerify, importJWK } from "jose";
import { readFileSync, writeFileSync } from "node:fs";
const pub = await importJWK(JSON.parse(readFileSync(new URL("./public-inputs.json", import.meta.url), "utf8")).publicJwk, "ES256");
const rows = [];
async function run(kind, n, path, init) {
  for (let i = 0; i < n; i++) {
    const r = await call(path, init);
    const row = { kind, i, at: Date.now(), status: r.status, ms: r.ms, ok: r.body?.ok ?? false };
    if (kind === "sign" && r.body?.token) {
      try { await jwtVerify(r.body.token, pub, { issuer: "madar-probe", audience: "authenticated" }); row.tokenGood = true; } catch { row.tokenGood = false; }
    }
    if (typeof r.body === "string") row.text = r.body.slice(0, 120);
    rows.push(row);
    await sleep(Number(process.env.GAP_MS ?? "250"));
  }
}
await run("verify", 50, "/verify", { headers: { authorization: `Bearer ${TOKEN}` } });
await run("sign", 20, "/sign?room=crypto");
await run("bcrypt-object", 20, "/bcrypt?room=crypto");
await run("bcrypt-worker", 5, "/bcrypt-worker");
writeFileSync(new URL("./crypto-client.json", import.meta.url), JSON.stringify(rows, null, 0));
const by = {};
for (const r of rows) { const k = `${r.kind} status ${r.status} ok ${r.ok}${r.tokenGood === undefined ? "" : " tokenGood " + r.tokenGood}`; by[k] = (by[k] ?? 0) + 1; }
console.log(by);
for (const r of rows.filter((x) => x.status !== 200)) console.log("not 200:", JSON.stringify(r));
