# Madar real build: proof record

Each section records one proof of the plan (`docs/superpowers/plans/2026-10-03-madar-real-build-plan.md`): what ran, on what, and the result. Each task writes only its own section.

## E1. Bundle spike: the shared code on Supabase Edge Functions (2026-10-03)

**Result: PASS.** Risk 1 of section 9 does not apply. The planned default holds: Vite bundles each entry into one ESM file, `pg` and the `node:` modules stay outside the bundle, and each function's `deno.json` maps `pg` to `npm:pg@8.23.1`. No fallback (`jsr:@db/postgres`, sloppy imports, another host) is necessary.

**What ran.**

- Bundle: `npm run build:server` (`vite.server.config.ts`, Vite 8.3.1 with Rolldown, one build environment for each entry, `codeSplitting: false`). Output: `supabase/functions/_build/api.js` (548 KB, the 108 shared calls with zod and every handler), `mcp.js`, `jobs.js`, and `dist-server/worker.js`. The only imports left in `api.js` are `node:async_hooks` and `pg`.
- Host: the local stack of Supabase CLI 2.119.0 (edge runtime image `v1.77.1`, Deno 2, Supavisor `2.9.13`, Postgres 17.11), `supabase functions serve` with `--env-file`. `supabase/functions/api/index.ts` imports `../_build/api.js` and calls `Deno.serve`.
- Route: `GET /functions/v1/api/health` (`server/http/health.ts`). In one call it opens a `pg` client through the **transaction pooler** (`postgres.pooler-dev@pooler:6543`), runs `begin isolation level repeatable read, read only`, `set local statement_timeout`, `select pg_advisory_xact_lock(7310999)`, reads `pg_locks` to see that its own backend holds the lock, commits, and checks that an `AsyncLocalStorage` context from `node:async_hooks` is the same after the awaits.

**Answers.**

| Check | Result |
|---|---|
| `supabase functions serve api` answers | 200, `{"ok":true,"region":"local-docker","calls":108,"checks":{"database":"ok","lock":"ok","asyncContext":"ok"}}`, 28 to 50 ms warm |
| The bundle loads the shared code | `calls: 108` (the count of `sharedCalls`) |
| `pg` (`npm:pg@8.23.1`) works in the edge runtime | yes, through the transaction pooler |
| `pg_advisory_xact_lock` holds a transaction through the pooler | yes. A direct connection held the same key for 3 s. During the hold, `pg_locks` showed the health backend from `172.18.0.7` (the Supavisor container) with `granted = false` and `wait_event_type = Lock`. The health call answered 200 after 3,078 ms, right after the holder committed. |
| `AsyncLocalStorage` from `node:async_hooks` in the bundle | yes (`asyncContext: ok`, also with three calls in parallel in the unit test) |
| `mcp` and `jobs` bundles load | yes, each answers its stub 501 |

**Facts found on the way (for C1, D1 and the it suites).**

1. Inside the Docker network, a function must reach the pooler by its alias `pooler` (and the database by `db`). The container names (`supabase_pooler_madar`) contain `_`, and the Deno resolver refuses them: `getaddrinfo ENOTFOUND supabase_pooler_madar`. From the Mac, the transaction pooler is `127.0.0.1:54329` (`config.toml`, `[db.pooler] port`).
2. The local pooler user is `postgres.pooler-dev` (tenant `pooler-dev`). The pooler connects to Postgres as `postgres`, so a local check of the `madar_server` role needs that role's own login through the pooler (B, Z0a).
3. The first serve on this Mac logged `CPU time soft limit reached` once for one isolate during the cold start, while the Mac's load average was about 170 (many agents at work). It did not repeat. Z0b measures the CPU of a cold start on the hosted platform (risk 3).
4. The health route opens one connection of its own for each call and closes it, with a lock key (`7310999`) that is never the office key. So it shows the database path on every host without a pool of the app.

**Re-run.** Take the Docker lock, `supabase start`, `npm run build:server`, then `supabase functions serve --env-file <file>` with `DATABASE_URL=postgres://postgres.pooler-dev:postgres@pooler:6543/postgres`, and call `curl http://127.0.0.1:54321/functions/v1/api/health`. `server/it/worker.it.test.ts` (E4) runs the same health check and the batch smoke on this host and on Wrangler.

## E4. Workers entry: the same smoke on Supabase and on Wrangler (2026-10-03)

**Result: PASS, with one design fact for the Workers path.** `server/it/worker.it.test.ts` builds the bundles, starts `supabase functions serve` (Deno) and `wrangler dev -c wrangler.server.toml` (workerd, `nodejs_compat`, Wrangler 4.147.0) against the local stack, and runs the same smoke on both: 10 of 10 tests pass.

| Check, on both hosts | Result |
|---|---|
| `GET /api/health`: `pg` through the transaction pooler, the transaction lock, `AsyncLocalStorage`, 108 shared calls | 200 on both, with the region of each host (`local-deno`, `local-workers`) |
| 13 entries, two overview calls, a body over 256 KB, an old `X-Madar-Build` | 413 `too_many_calls`, 413 `too_many_overviews`, 413, 409 `client_outdated` on both |
| A batch without a valid sign-in | a refusal on both (500 `not_built` while the token check is the T0 stub; 401 after track P) |
| `/api/batch` without a token, `/mcp`, `/jobs/run` | the same status and body on both hosts, never 404 |
| CORS preflight of the screens on Workers | 204, the allowed origin, `Access-Control-Max-Age: 7200` |

**Design fact for the Workers path (C1, risk 18).** On Workers, a `pg.Pool` made at module level serves the first request and then hangs every later request: the runtime ties a socket to the request that opened it ("The Workers runtime canceled this request because it detected that your Worker's code had hung"). A probe with one module-level pool (`max: 1`) through the local pooler answered 200, then 500, 500. So the two module-level pools of plan 4.5 work on Supabase Edge Functions (Deno keeps the isolate's sockets across requests), but on Workers the `Db` must open its clients for each request and close them at the end (or use Hyperdrive). The health route already does this, which is why it passes on both hosts. When the Workers host is needed, `pgDb` gets a "per request" mode for that entry; nothing changes on Supabase.

**Local fact.** The local Supabase gateway (Kong) adds `Access-Control-Allow-Origin: *` to function answers. So the local stack cannot show the CORS answer of the function itself. The CORS check runs on Workers here, and Z0a checks the answer of the hosted gateway on the test project.
