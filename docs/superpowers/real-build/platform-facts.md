# Madar real build: platform facts (October 2026)

**Date:** 2026-10-03
**For:** the build of spec 2 (`docs/superpowers/specs/2026-10-03-madar-real-build-design.md`)
**Method:** I read the official documentation of each platform on 3 October 2026. I checked package versions with `npm view` and release notes with `gh api` on the same day. Each fact has its source URL. A fact from a secondary source has the label "(secondary source)".

**Labels in this file:**

- **OWNER:** a step that needs the owner: an account, a payment method, a DNS record, or a secret.
- **CHECK AT STEP n:** a fact that the documentation does not settle. The build checks it at that step of spec 2, section 17.
- **ADVICE:** my recommendation. It is not a platform fact.

---

## 0. Summary

### 0.1 Facts that change spec 2

| # | Fact | Effect on spec 2 | Section |
|---|---|---|---|
| 1 | The official MCP TypeScript SDK v2 (`@modelcontextprotocol/server` 2.3.0, 2 October 2026) implements MCP 2026-07-28. | No hand-written JSON-RPC server is necessary. The old `@modelcontextprotocol/sdk` 1.32.0 does not support 2026-07-28. | 7.6 |
| 2 | Supabase OAuth access tokens carry `aud: "authenticated"`, the same value as a normal browser sign-in token. Supabase documents no `resource` parameter (RFC 8707). | MCP requires an audience check. Without extra work, the `mcp` function accepts a Madar browser token. Use a Custom Access Token Hook (free plan) to set `aud` for agent tokens, and check `client_id`. | 6.8 |
| 3 | The Supabase OAuth server supports Dynamic Client Registration only. The request for Client ID Metadata Documents is an open issue, filed on 2 October 2026. | The risk in spec 2, section 18, row 1, is real. | 6.9 |
| 4 | An MCP client cannot add the `x-region` header. | The `mcp` function runs in the region nearest to the agent, not always in Frankfurt. Each database round trip then crosses an ocean. | 1.3, 6.10 |
| 5 | An MCP server must not send an `elicitation/create` question to a client that did not declare `elicitation`. | The reason question (spec 2, section 12) needs a second path for agents without elicitation. | 7.4 |
| 6 | Cloudflare R2 needs a "checkout flow" for the R2 subscription, also on the free tier. Railway's pricing page says that it requires a card. | Both stay at $0, but the owner must add a payment method. | 8.1, 12.1 |
| 7 | Supabase Auth emails (invitations, password resets) through Resend count toward the Resend limit of 100 emails a day. Supabase also limits custom SMTP to 30 emails an hour by default. | The Madar cap of 90 notice emails a day must leave room for sign-in emails. | 3.4, 10.1 |
| 8 | Supabase pauses a free project with too little "user database activity" in 7 days. The documentation does not say that pg_cron counts. | The claim in spec 2, section 11 ("the same timer keeps the project awake") is not proven. | 5.5 |
| 9 | Vault secrets stay encrypted in a dump and cannot be read in another project. | The restore test (step 7) must create the Vault secrets again. | 5.3, 11.4 |
| 10 | rclone's shared Google Drive client ID stops during 2026. A private Google OAuth app in "Testing" mode loses its grant after 7 days. | Google Drive is a poor second place. Use a GitHub release in a private repository and Backblaze B2. | 11.5 |
| 11 | GitHub Actions schedules accept an IANA time zone. | The backup runs at `0 2 * * *` with `timezone: 'Asia/Riyadh'`. No UTC conversion is needed. | 11.2 |
| 12 | Postgres.js sends queries in a pipeline. With the transaction pooler this can hang queries or return the wrong rows. | Use `pg` (node-postgres), which also runs on Node for Railway. | 2.3 |
| 13 | Supabase does not bill CORS preflight (`OPTIONS`) requests. | Preflights do not use the 500,000-call budget. | 1.1 |
| 14 | The Supabase free plan allows 2 active projects. | The main project and the restore-test project use both. There is no room for a third (for example, a staging project). | 11.4 |

### 0.2 Steps for the owner

| Step | What the owner does | When | Section |
|---|---|---|---|
| Supabase account | Make a free organization and a project in Frankfurt (`eu-central-1`). Keep the database password in a password manager. | Step 1 | 1, 2 |
| Supabase second project | Make a second free project for the restore test. | Step 7 | 11.4 |
| Cloudflare account | Make a free account. Complete the R2 checkout (a payment method is likely). | Step 1 | 8.1 |
| Cloudflare API tokens | Make one R2 API token (read and write, one bucket) and one token for Pages deploys. | Step 1 | 8, 9 |
| Domain | Buy the Madar domain. Either move its nameservers to Cloudflare, or keep the DNS elsewhere and use a subdomain for Madar. | Before step 7 | 9.4 |
| DNS for Pages | Add the custom domain in the Pages dashboard first, then the CNAME record. | Step 7 | 9.4 |
| Resend account | Make a free account. Add the sending domain (a subdomain, for example `notices.<domain>`). | Step 5 | 10 |
| DNS for Resend | Add the SPF (MX and TXT), DKIM (TXT) and DMARC (TXT) records that Resend shows. | Step 5 | 10.3 |
| GitHub | Make a private repository for backups. Make a fine-grained token that can write releases there. | Step 7 | 11 |
| Backblaze B2 | Make a free account (10 GB) for the weekly file copy. | Step 7 | 11.5 |
| age key | Keep the age private key offline (a password manager and a printed copy). Only the public key goes to GitHub. | Step 7 | 11.3 |
| Railway account | Make an account for the step-1 test deploy. A card is likely. | Step 1 | 12 |
| Secrets | Put each secret into the host's secret store (list in section 0.4). Never into the repository. | Steps 1 to 7 | 0.4 |

### 0.3 Versions on 3 October 2026

| Package | Version | Note |
|---|---|---|
| `@modelcontextprotocol/server` | 2.3.0 | Implements MCP 2026-07-28. Depends on `zod ^4.2.0`. |
| `@modelcontextprotocol/core` | 2.3.0 | |
| `@modelcontextprotocol/node` | 2.1.1 | Node adapter (`toNodeHandler`). |
| `@modelcontextprotocol/hono` | 2.0.2 | |
| `@modelcontextprotocol/sdk` (v1) | 1.32.0 | Latest protocol in code: `2025-11-25`. No 2026-07-28. |
| `@supabase/server` | 1.9.0 | Auth wrapper, OAuth resource metadata, Postgres middleware. |
| `@supabase/supabase-js` | 2.117.2 | |
| `supabase` (CLI) | 2.119.0 | |
| `hono` | 4.13.12 | |
| `@hono/node-server` | 2.1.3 | |
| `zod` | 4.6.5 | Same as the prototype. |
| `pg` | 8.23.1 | |
| `jose` | 6.2.12 | |
| `aws4fetch` | 1.0.20 | |
| `resend` | 6.32.0 | Optional. A plain `fetch` works. |
| `wrangler` | 4.147.0 | |

Source: `npm view <package> version`, run on 2026-10-03.

### 0.4 Secrets list

| Secret | Where it lives | Used by |
|---|---|---|
| `DATABASE_URL` (transaction pooler, port 6543) | Supabase function secrets, Railway variables | `api`, `mcp`, `jobs` |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | Supabase function secrets, Railway variables | `api` |
| `RESEND_API_KEY` | Supabase function secrets, Railway variables, Supabase Auth SMTP settings | `api`, `jobs`, Supabase Auth |
| `JOBS_SECRET` | Supabase function secrets and Supabase Vault | `jobs`, pg_cron |
| `MCP_STATE_KEY` (32 random bytes) | Supabase function secrets, Railway variables | `mcp` (MRTR `requestState`) |
| `SUPABASE_SESSION_POOLER_URL`, `BACKUP_REPO_TOKEN`, B2 keys, R2 read-only keys | GitHub Actions secrets | backup workflows |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | GitHub Actions secrets | Pages deploy |
| age private key | Offline only | restore |

Supabase injects `SUPABASE_URL`, `SUPABASE_DB_URL`, `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS` and `SUPABASE_JWKS` into each function. Your own secret names must not start with `SUPABASE_`. Source: https://supabase.com/docs/guides/functions/secrets and https://supabase.com/docs/guides/functions/limits

---

## 1. Supabase Edge Functions (Deno)

### 1.1 Limits

| Limit | Value | Source |
|---|---|---|
| Memory | 256 MB | https://supabase.com/docs/guides/functions/limits |
| Wall clock time | 150 s on Free, 400 s on paid plans | same |
| CPU time per request | 2 s. Async I/O (database, fetch) does not count. | same |
| Idle timeout | 150 s, then 504 | same |
| Function size after bundle | 20 MB with the CLI bundle, 5 MB with the server-side bundle | same |
| Functions per project | 100 on Free | same |
| Secrets | 100 per project, 48 KiB each, no `SUPABASE_` prefix | same |
| Outbound ports | Ports 25 and 587 are blocked | same |
| Not available | Web Workers, Node `vm`, multithread libraries | same |
| Invocations | 500,000 a month on Free | https://supabase.com/docs/guides/platform/billing-on-supabase |
| Billing rule | "You are charged for the number of times your functions get invoked, regardless of the response status code. Preflight (OPTIONS) requests are not billed." | https://supabase.com/docs/guides/platform/manage-your-usage/edge-function-invocations |
| Over the free quota | An email and a grace period, then the Fair Use Policy | same |

**Effect on Madar:** port 587 is blocked, so the server sends email through the Resend HTTP API, not SMTP (section 10). The 2 s CPU limit applies to the load, run and save steps (spec 2, section 5.3). Async database time does not count. **CHECK AT STEP 2:** measure the CPU time of the Dashboard call.

### 1.2 npm imports (zod 4, hono, pg)

- Import npm packages with the `npm:` specifier, or map them in a `deno.json` file for each function. Supabase recommends one `deno.json` per function. A global `deno.json` in `supabase/functions` works for local work but is "not recommended for deployment". Source: https://supabase.com/docs/guides/functions/dependencies
- `jsr:` and `node:` imports also work. Source: same.
- Hono runs on Edge Functions with `basePath('/<function-name>')` and `Deno.serve(app.fetch)`. Source: https://hono.dev/docs/getting-started/supabase-functions

```jsonc
// supabase/functions/api/deno.json
{
  "imports": {
    "hono": "npm:hono@4.13.12",
    "zod": "npm:zod@4.6.5",
    "pg": "npm:pg@8.23.1",
    "jose": "npm:jose@6.2.12",
    "aws4fetch": "npm:aws4fetch@1.0.20",
    "@supabase/server": "npm:@supabase/server@1.9.0"
  }
}
```

```ts
// supabase/functions/api/index.ts : the Deno home of the portable app
import { Hono } from 'hono'
import { madarApi } from '../_shared/server/app.ts' // the same app runs on Node (section 12)

const app = new Hono().basePath('/api') // must equal the function name
app.route('/', madarApi)
Deno.serve(app.fetch)
```

### 1.3 Regional invocation (`eu-central-1`)

- A function runs "in the region closest to the user" by default. Source: https://supabase.com/docs/guides/functions/regional-invocation
- `eu-central-1` (Frankfurt) is on the list of regions. Source: same.
- Set the region with the `x-region` header, or with the `forceFunctionRegion` query parameter "in case you cannot add the `x-region` header to the request (e.g.: CORS requests, Webhooks)". Source: same.
- The response header `x-sb-edge-region` shows the region that ran the function. The function can read `SB_REGION`. Source: same.
- With an explicit region, "requests will NOT be automatically re-routed to another region" during an outage. Source: same.

**Effect on Madar:**

- **Screens:** call `https://<ref>.supabase.co/functions/v1/api/batch?forceFunctionRegion=eu-central-1`. The query parameter adds no CORS header.
- **pg_cron:** add the header `x-region: eu-central-1` (section 5).
- **MCP agents:** an agent sends the request to the URL that the person gave it. It cannot add `x-region`. A query parameter in the MCP URL changes the resource URL that OAuth uses (section 6.10). **ADVICE:** let the `mcp` function run near the agent. Keep the number of database round trips per tool call low. **CHECK AT STEP 6:** measure the time per tool call from a US agent.

### 1.4 Secrets

```bash
# local: supabase/functions/.env is loaded by `supabase start`
supabase functions serve api --env-file supabase/functions/.env
# production
supabase secrets set RESEND_API_KEY=re_...
supabase secrets set --env-file .env.production
supabase secrets list
```

A function reads a new secret at once. No redeploy is necessary. Read secrets with `Deno.env.get('NAME')`. Source: https://supabase.com/docs/guides/functions/secrets

**ADVICE (portability):** read all settings through one helper, so the same code runs on Node.

```ts
export const env = (k: string): string | undefined =>
  (globalThis as any).Deno?.env.get(k) ?? (globalThis as any).process?.env?.[k]
```

### 1.5 Local development and deploy

```bash
supabase init
supabase functions new api
supabase start                      # needs Docker
supabase functions serve api        # http://localhost:54321/functions/v1/api, hot reload
supabase login
supabase link --project-ref <ref>
supabase functions deploy api       # bundles with Docker
supabase functions deploy api --use-api   # bundles on the server, no Docker
supabase config push                # pushes config.toml settings (Auth, OAuth server)
```

Source: https://supabase.com/docs/guides/functions/quickstart and https://supabase.com/docs/guides/ai-tools/byo-mcp

Local facts of this build (proof.md, sections E1 and C1):

- The local transaction pooler is `127.0.0.1:54329` from the Mac and `pooler:6543` inside the Docker network. It accepts `postgres.pooler-dev` (runs as `postgres`) and `madar_server.pooler-dev` (runs as `madar_server`, once that role has a login).
- `npm run start:server` (`wrangler dev -c wrangler.server.toml`) needs `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_DB` set to the local pooler URL, because the Worker takes its database from the Hyperdrive binding `DB`.

### 1.6 JWT verification for each function

- With `verify_jwt = true` (the default), the platform checks the `Authorization` header before your code runs. The check accepts legacy HS256 tokens and tokens signed with the new asymmetric keys. Source: https://supabase.com/docs/guides/functions/auth-headers
- The check also accepts publishable and secret keys "for migration compatibility". So the check alone does not prove that a person signed in. Source: same.
- Turn the check off per function in `supabase/config.toml`, or with `--no-verify-jwt` when you serve locally. Source: https://supabase.com/docs/guides/functions/function-configuration
- The `mcp` function must have `verify_jwt = false`, because the first MCP request has no token and must get a 401 with the resource metadata. Source: https://supabase.com/docs/guides/ai-tools/byo-mcp

**ADVICE:** set `verify_jwt = false` on all three functions and check the token in code (section 3.6). Railway has no gateway check, so the code must check the token anyway. One check path for both hosts keeps the behaviour the same.

```toml
# supabase/config.toml
[functions.api]
verify_jwt = false
[functions.mcp]
verify_jwt = false
[functions.jobs]
verify_jwt = false
```

### 1.7 CORS

- `withSupabase` from `@supabase/server` "handles CORS and preflight (`OPTIONS`) requests for you". Source: https://supabase.com/docs/guides/functions/cors
- Without it, answer `OPTIONS` yourself. `@supabase/supabase-js` 2.95.0 and later exports `corsHeaders` from `npm:@supabase/supabase-js@^2/cors`. Source: same.
- **ADVICE:** allow only the Madar origin (not `*`), and send `Access-Control-Max-Age: 7200`. Chromium caps the value at 2 hours, Firefox at 24 hours, and the default is 5 seconds. Source: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Access-Control-Max-Age

---

## 2. Postgres from an Edge Function

### 2.1 Which client

| Client | Real transactions with several statements | Advisory lock | Runs on Node | Note |
|---|---|---|---|---|
| `supabase-js` (`ctx.supabase`, `ctx.supabaseAdmin`) | No. Each call is one HTTP request to PostgREST. | Only inside one SQL function called by RPC | Yes | Good for simple reads. |
| `pg` (node-postgres) through the pooler | Yes | Yes (`pg_advisory_xact_lock`) | Yes | `@supabase/server` uses it. Sends no named prepared statements. |
| `postgres` (Postgres.js) | Yes | Yes | Yes | Pipelines queries by default. With transaction mode this "can hang queries or return mismatched rows". `max_pipeline: 0` breaks `sql.begin()`. |
| `jsr:@db/postgres` (deno-postgres) | Yes | Yes | No | Supabase example uses `SUPABASE_DB_URL`. Not portable to Node. |

Sources: https://supabase.com/docs/guides/functions/connect-to-postgres , https://supabase.com/docs/guides/database/postgres-js , https://github.com/supabase/server/blob/main/docs/postgres.md

**ADVICE:** use `pg` with one connection per isolate, through the shared pooler in transaction mode. The same code and the same `DATABASE_URL` work on Railway.

### 2.2 Connection strings and IP versions

| Mode | Host and port | Free plan IP | Use |
|---|---|---|---|
| Direct | `db.<ref>.supabase.co:5432` | IPv6 only | Migrations, `pg_dump` from an IPv6 network |
| Shared pooler, session mode | `aws-<index>-<region>.pooler.supabase.com:5432` | IPv4 | Backups from GitHub Actions (IPv4) |
| Shared pooler, transaction mode | `aws-<index>-<region>.pooler.supabase.com:6543` | IPv4 | Serverless and edge functions |

- The pooler user name is `postgres.<ref>`, not `postgres`. Copy the host from the **Connect** dialog. You cannot build it from the region name. Source: https://supabase.com/docs/guides/database/connecting-to-postgres
- `SUPABASE_DB_URL` inside a function is the direct connection. Each connection counts against `max_connections`. For many isolates, put the transaction-mode string into your own secret. Source: https://github.com/supabase/server/blob/main/docs/postgres.md

### 2.3 Transaction mode rules

From https://supabase.com/docs/guides/database/connecting-to-postgres :

- **Prepared statements:** not supported. Turn them off in the driver.
- **Session state:** lost between transactions. This covers `SET`, session-level advisory locks, `LISTEN`/`NOTIFY` and temporary tables. Run them inside the transaction that needs them.
- **Pipelining:** not supported.
- **Client pool:** "Create the client once at module scope, not per request. Set the pool to 1 connection."

**Effect on Madar:** `pg_advisory_xact_lock` is a transaction-level lock. Postgres releases it at `COMMIT` or `ROLLBACK`. So it works in transaction mode. A session-level `pg_advisory_lock` does not work there. `pg` with parameters uses the unnamed statement, which transaction mode accepts: "it sends no named prepared statements, so no driver setting is needed". Source: https://github.com/supabase/server/blob/main/docs/postgres.md

```ts
// _shared/server/db.ts : one write at a time for the whole office (spec 2, section 5.3)
import pg from 'pg'
import { env } from './env.ts'

const pool = new pg.Pool({ connectionString: env('DATABASE_URL'), max: 1 }) // SSL: see 2.5
const OFFICE_WRITE_LOCK = 7310001 // one fixed bigint for "office writes"

export async function writeTx<T>(work: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect()
  try {
    await c.query('begin')
    await c.query('select pg_advisory_xact_lock($1)', [OFFICE_WRITE_LOCK])
    const out = await work(c) // load, run, save: all inside this transaction
    await c.query('commit')   // the lock is released here
    return out
  } catch (e) {
    await c.query('rollback') // writes nothing, like Store.run
    throw e
  } finally {
    c.release()
  }
}
```

### 2.4 Connection limits on the free plan

| Compute | Database max connections | Pooler max clients | Source |
|---|---|---|---|
| Nano (Free) | 60 | 200 | https://supabase.com/docs/guides/platform/compute-and-disk |

Free also means 500 MB of database, shared CPU, and up to 0.5 GB memory. Source: same.

### 2.5 SSL

- Deployed functions use SSL to the Supabase database with no extra setting. Source: https://supabase.com/docs/guides/functions/connect-to-postgres
- Outside Supabase (Railway, GitHub Actions), use at least `sslmode=require`. `require` encrypts but does not verify the server. For verification, download the root certificate from Database settings and use `verify-full`. Source: https://supabase.com/docs/guides/database/connecting-to-postgres
- **CHECK AT STEP 1:** the exact `ssl` option for `pg` on Railway with the Supabase root certificate.

### 2.6 Postgres from a Cloudflare Worker through Hyperdrive

Measured on madar-test on 2026-10-16 (proof.md, "Hyperdrive probe on madar-test (2026-10-16)"):

- Put Hyperdrive in front of the **session pooler** (`aws-1-eu-central-1.pooler.supabase.com:5432`). In front of the transaction pooler (port 6543), a statement (mostly the first one) hung with no error in 55 of 57 requests, also with a 25 s wait and with a limit of 10 connections. One request failed at once with "Protocol Error: Tried to recycle a connection still in a transaction", and one answered.
- Through the session pooler, `pg_advisory_xact_lock` inside `begin ... commit`, `set local lock_timeout` (55P03), the joined start and `set local` work. Cloudflare lists advisory locks as unsupported, but the transaction form works because Hyperdrive keeps one origin connection for the whole transaction.
- A config takes `verify-full` with an uploaded CA (`mtls.ca_certificate_id`) and `caching.disabled: true`. The create call connects to the origin, so a wrong CA or host fails at create.
- With `origin_connection_limit` 5 (the lowest value), one Worker request often got only 1 or 2 origin connections. A second transaction then waited in its `begin` until the first one ended. `lock_timeout` does not cover that wait. With 10, the wait went away in the probe. The session pooler gives each origin connection its own backend, so keep the limit under the Supavisor pool size of the project.
- `RAISE WARNING` reaches the pg `notice` event through Hyperdrive, with severity `WARNING`.
- Inside a placed Worker, `request.cf.colo` names the data center where the request came in, not where the code runs. The answer header `cf-placement: remote-FRA` and the colo of a `/cdn-cgi/trace` subrequest name the run location. The Worker sees no `cf-placement` request header.
- `[placement] region = "aws:eu-central-1"` also places the Worker when another Worker calls it through a service binding.

### 2.7 The Worker host of Madar (owner 2026-10-16: the Free plan first, Workers Paid when the numbers ask for it)

The server of each copy can run on one Worker (`wrangler.server.toml`, `[env.test]` and `[env.production]`). Facts for that host:

| Item | Value | Source |
|---|---|---|
| Requests | Workers Paid: 10 million a month included, then $0.30 for each extra million. A call through a service binding adds no request: the Pages Function of `/api` or `/mcp` is the one request. An OPTIONS preflight counts (Supabase did not bill it); the page api has none. | https://developers.cloudflare.com/workers/platform/pricing/ |
| CPU | 30 million CPU ms a month included, then $0.02 for each extra million. 30 s for each HTTP request by default, 5 min at most (`[limits] cpu_ms`). Waiting on fetch or the database does not count. Over the limit: error 1102. | https://developers.cloudflare.com/workers/platform/limits/ |
| Memory | 128 MB for each isolate (not each request) | same |
| Connections | 6 open outgoing connections for each request (fetch, TCP, R2); a 7th waits. The server opens 2 database connections at most. | same |
| Subrequests | 10,000 for each request on Paid | same |
| Time | No wall-clock limit for HTTP while the client stays. waitUntil work runs up to 30 s after the answer (Supabase: 150 s), so a long mail or push chain can stop part way; the 15-minute job retries the outbox. | same |
| Sizes | Request body 100 MB (Free and Pro zones), answer no limit, Worker 64 MiB, start 1 s, 128 vars of 5 KB | same |
| Placement | `[placement] region = "aws:eu-central-1"` places fetch handlers only, next to the database. The `cf-placement` answer header names the run place. | https://developers.cloudflare.com/workers/configuration/placement/ |
| Hyperdrive | Unlimited queries on Paid. About 100 origin connections for each config, initial connection 15 s, idle 10 min, longest query 60 s. Caching is on by default: Madar turns it off (writes do not clear the cache). | https://developers.cloudflare.com/hyperdrive/platform/limits/ |
| Address | No Madar Worker has a public address (`workers_dev` and `preview_urls` false). Security vendors report heavy phishing abuse of workers.dev, and a Worker fetch of a workers.dev address of the same account fails with error 1042, so the Pages Functions reach the Worker through a service binding. | https://developers.cloudflare.com/workers/configuration/routing/workers-dev/ |
| Secrets | `wrangler secret bulk` takes JSON on stdin; null removes a name. A deploy resets the vars to the file and keeps the secrets. | https://developers.cloudflare.com/workers/wrangler/commands/workers/ |

**Effect on Madar:** the Usage page counts calls against 10 million when `config/server-host.json` says `workers` for the copy
(`CALL_LIMITS`, `server/core/ports.ts`), else against the 500,000 Edge Function invocations of Supabase Free (section 1.1). The
Worker uses `query_timeout` 12 s on each query (`server/data/sql.ts`), because a wait for a free Hyperdrive origin connection
has no other limit (section 2.6). The jobs stay on the Supabase jobs function (section 5).

**The Free plan (owner, 2026-10-16: "free is enough for now").** The table above gives the Paid values. Free differs here:

| Item | Free | Source |
|---|---|---|
| Requests | 100,000 a day for the whole account (the Workers and the Pages Functions of every project). Over the limit: error 1027 until 00:00 UTC. | https://developers.cloudflare.com/workers/platform/limits/ |
| CPU | 10 ms for each request in the documents. Waiting on fetch or the database does not count. Over the limit: error 1102 (`Worker exceeded resource limits`, outcome `exceededCpu`). Measured on this account (2026-10-16, proof.md): calls of 26 ms and 150 ms all passed, calls of 500 ms failed 1 time in 10. The documents do not promise this. | same, and proof.md "The test copy on the Worker" |
| Subrequests | 50 for each request | same |
| Hyperdrive | 100,000 database queries a day for the account, so the test copy and production share them. Over the limit, every further query fails until the next day. About 20 origin connections for each config, 10 configs. | https://developers.cloudflare.com/hyperdrive/platform/pricing/ |
| Same on both | 128 MB memory, 6 open connections, start 1 s, placement, Workers Logs | the Hyperdrive probe ran on Free: placement in FRA and every case passed (proof.md) |

**Effect on Madar on Free:** a day of heavy test runs takes from the query day of production. The calls meter of the Usage page
counts a month against 10 million, so it does not warn before a day limit. Before production runs on the Worker on Free, measure
the CPU time of each call (`wrangler tail`: `cpuTime` and `outcome` of each event) and the queries of each call, against the
production calls of a day.

---

## 3. Supabase Auth

### 3.1 Email and password

```ts
const { data, error } = await supabase.auth.signInWithPassword({ email, password })
```

Source: https://supabase.com/docs/guides/auth/passwords

### 3.2 Admin invitation and the set-password flow

- `supabase.auth.admin.inviteUserByEmail(email, { data, redirectTo })` sends an invitation link. It needs the secret (service role) key, so only the server calls it. "PKCE flow is not supported" for invitations. Source: https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail
- Some mail systems open the links in an email before the person does (for example, Microsoft Defender Safe Links). This can use up the one-time token. Source: https://supabase.com/docs/guides/auth/auth-email-templates
- The email template can send a token hash to your own page. The page then calls `verifyOtp` with `type: 'invite'` (or `'recovery'` for a reset). Source: same.

**ADVICE:** change the "Invite user" template so that the link opens a Madar page that shows a button. The click on the button calls `verifyOtp`. A mail scanner does not click the button.

```html
<!-- Supabase dashboard: Authentication, Emails, Invite user -->
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite">Set your Madar password</a>
```

```ts
// /auth/confirm page, after the person clicks "Continue"
const { error } = await supabase.auth.verifyOtp({ token_hash, type: 'invite' }) // or 'recovery'
// then the "set password" form:
await supabase.auth.updateUser({ password: newPassword })
```

### 3.3 Password reset

```ts
await supabase.auth.resetPasswordForEmail(email, { redirectTo: 'https://<madar>/auth/confirm' })
// after verifyOtp({ token_hash, type: 'recovery' }):
await supabase.auth.updateUser({ password: newPassword })
```

Source: https://supabase.com/docs/guides/auth/passwords

**OWNER:** add the Madar domain as the Site URL and to the Redirect URLs list (Authentication, URL Configuration).

### 3.4 Custom SMTP with Resend

- The built-in mail sends only to team members, and only 2 emails an hour. Source: https://supabase.com/docs/guides/auth/auth-smtp
- After you turn on custom SMTP, Supabase applies "a low rate-limit of 30 messages per hour". You can change it on the Rate Limits page. Source: same.
- Resend values: host `smtp.resend.com`, port `465`, user name `resend`, password = a Resend API key, sender from a verified domain. Source: https://resend.com/docs/send-with-supabase-smtp

**OWNER:** enter these values in Authentication, Emails, SMTP Settings.

### 3.5 No open sign-up

- "Allow new users to sign up": when it is off, "only existing users can sign in". Source: https://supabase.com/docs/guides/auth/general-configuration
- The admin invitation still creates users when sign-up is off (secondary source: https://www.rapidevelopers.com/md/supabase-tutorial/how-to-allow-login-only-for-invited-users-in-supabase). A CLI bug that turned off the email provider with `enable_signup = false` has a fix (https://github.com/supabase/cli/pull/4469).
- **CHECK AT STEP 3:** an invitation works with sign-up off.

### 3.6 Check a user token inside a function

- Asymmetric signing keys: ES256 (recommended) or RS256. Public keys are at `GET https://<ref>.supabase.co/auth/v1/.well-known/jwks.json`. Supabase's edge caches this for 10 minutes, and the client libraries cache it for 10 more minutes. Source: https://supabase.com/docs/guides/auth/signing-keys
- `getClaims` checks the token against the JWKS locally when the project uses asymmetric keys. With HS256 it calls the Auth server, like `getUser`. Source: https://supabase.com/docs/reference/javascript/auth-getclaims
- `@supabase/server` rejects legacy HS256 tokens and old `anon`/`service_role` keys. Source: https://github.com/supabase/server/blob/main/docs/auth-modes.md
- The docs disagree about the default for new projects. One page says asymmetric keys are "the default for new projects". The OAuth page says "By default, Supabase uses HS256". Sources: https://supabase.com/docs/guides/auth/oauth-server/getting-started (both sentences are on this page).
- **CHECK AT STEP 1:** open Settings, JWT Keys. If the legacy secret is active, make an ES256 standby key and rotate to it.

Two ways to check the token in code:

```ts
// A. @supabase/server (Deno and Node). It verifies against SUPABASE_JWKS.
import { withSupabase } from '@supabase/server'
export default {
  fetch: withSupabase({ auth: 'user', issuer: `${SUPABASE_URL}/auth/v1` }, async (req, ctx) => {
    if (ctx.jwtClaims?.client_id) return new Response('agent tokens go to /mcp', { status: 403 })
    // ctx.userClaims.id is the Supabase user id
    return handleBatch(req, ctx.userClaims!.id)
  }),
}
```

```ts
// B. jose, with no Supabase library
import { createRemoteJWKSet, jwtVerify } from 'jose'
const JWKS = createRemoteJWKSet(new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`))
const { payload } = await jwtVerify(token, JWKS, {
  issuer: `${SUPABASE_URL}/auth/v1`,
  audience: 'authenticated',
})
if (payload.client_id) throw new Error('agent token on the screens API')
```

### 3.7 Turn a person off (spec 2, section 7)

- `auth.admin.updateUserById(id, { ban_duration: '876000h' })` bans a user. Source: https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid
- The page does not say whether a ban ends the access tokens that the person already has. A Supabase access token lives for 1 hour by default. Source: https://supabase.com/docs/guides/auth/oauth-server/oauth-flows
- **ADVICE:** the server reads the Madar `users` row on every call and refuses a person who is off. Also call `revokeGrant` for each of their agents (section 6.6).

---

## 4. Supabase Realtime

### 4.1 Send a Broadcast message from the server

**From SQL, inside the save transaction:**

```sql
select realtime.send(
  jsonb_build_object('projectId', $1::text, 'kinds', $2::jsonb), -- payload
  'changed',  -- event
  'office',   -- topic
  true        -- private channel
);
```

- `realtime.send(payload, event, topic, private)`. Realtime reads the write-ahead log of `realtime.messages`. Source: https://supabase.com/docs/guides/realtime/broadcast
- **ADVICE:** send from SQL inside the save transaction. A rollback then sends nothing, because the insert never commits. **CHECK AT STEP 5:** a rolled-back save sends no signal.
- A WebSocket client creates the daily partition of `realtime.messages`. `realtime.send` does not. With no partition for today, the insert fails with a warning `WarnSendingBroadcastMessage`. Source: same. When no screen is open, no one needs the signal, so this is safe.

**From HTTP (REST):**

```bash
curl -X POST 'https://<ref>.supabase.co/realtime/v1/api/broadcast/office/events/changed?private=true' \
  -H 'apikey: <secret key>' -H 'Content-Type: application/json' \
  --data-raw '{"projectId":"p1","kinds":["tasks"]}'
```

A batch endpoint `POST /realtime/v1/api/broadcast` takes `{ "messages": [{ "topic", "event", "payload" }] }`. `channel.httpSend(event, payload)` in supabase-js 2.107.0 and later uses the REST API. Source: https://supabase.com/docs/guides/realtime/broadcast

### 4.2 Private channel and its policy

- Turn off "Allow public access" in Realtime Settings. Source: https://supabase.com/docs/guides/realtime/authorization
- Realtime checks RLS policies on `realtime.messages` when a client joins a topic. Use `realtime.topic()` and `realtime.messages.extension = 'broadcast'` in the policy. Source: same.
- The policy result stays cached for the connection. It is checked again only when the client joins or sends a new JWT. "If a new JWT is never received on the Channel, the client will be disconnected when the JWT expires." Source: same.

**OWNER (or the builder with dashboard access):** turn off "Allow public access" in Realtime Settings.

```sql
-- A helper with owner rights, so the browser role needs no grant on public.users.
-- Column names are examples.
create function public.is_active_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.users u
    where u.auth_user_id = (select auth.uid()) and u.active
  )
$$;
revoke execute on function public.is_active_member() from public, anon;
grant execute on function public.is_active_member() to authenticated;

create policy "office members receive office signals"
on realtime.messages for select to authenticated
using (
  (select realtime.topic()) = 'office'
  and realtime.messages.extension = 'broadcast'
  and (select public.is_active_member())
);
-- No insert policy: browsers cannot send on the channel.
```

```ts
// browser
await supabase.realtime.setAuth() // needed for Realtime Authorization
supabase
  .channel('office', { config: { private: true } })
  .on('broadcast', { event: 'changed' }, ({ payload }) => invalidateProject(payload))
  .subscribe()
```

Spec 2, section 6 says "no policy for the browser roles" on Madar tables. That stays true: this policy is on `realtime.messages`, not on a Madar table.

### 4.3 Free-plan limits

| Limit | Free | Source |
|---|---|---|
| Concurrent connections | 200 | https://supabase.com/docs/guides/realtime/limits |
| Messages per second | 100 | same |
| Channel joins per second | 100 | same |
| Channels per connection | 100 | same |
| Broadcast payload | 256 KB | same |
| Messages per month | 2 million | https://supabase.com/docs/guides/platform/billing-on-supabase |

---

## 5. pg_cron and pg_net: call `jobs` every 15 minutes

### 5.1 Facts

- Supabase documents pg_cron plus pg_net to call an Edge Function on a schedule, and recommends Vault for the token. Source: https://supabase.com/docs/guides/functions/schedule-functions
- pg_cron is on all plans, including Free (secondary sources: https://supabase.com/docs/guides/cron/install.md lists no plan limit; https://runhooks.app/blog/preventing-supabase-free-tier-pausing/). **CHECK AT STEP 5:** enable it under Integrations, Cron.
- Run no more than 8 jobs at once. Each job should run no more than 10 minutes. Run history goes to `cron.job_run_details`. Source: https://supabase.com/docs/guides/cron
- `net.http_post(url, body, params, headers, timeout_milliseconds)`. The default timeout is 2000 ms. Source: https://supabase.com/docs/guides/database/extensions/pg_net
- pg_net sends the request only after the transaction commits. A rollback discards it. Responses stay in `net._http_response` for 6 hours. pg_net handles up to 200 requests a second. Source: same.

### 5.2 Code

```sql
select vault.create_secret('https://<ref>.supabase.co', 'project_url');
select vault.create_secret('<64 random hex characters>', 'jobs_secret');

select cron.schedule(
  'madar-jobs',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/jobs',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-region', 'eu-central-1',
      'x-madar-jobs-secret',
        (select decrypted_secret from vault.decrypted_secrets where name = 'jobs_secret')
    ),
    body := jsonb_build_object('at', now()),
    timeout_milliseconds := 10000
  );
  $$
);
```

The `jobs` function compares `x-madar-jobs-secret` with its `JOBS_SECRET` secret in constant time. Another documented way: a named Supabase secret key on the `apikey` header with `withSupabase({ auth: 'secret:<name>' })`. Source: https://supabase.com/docs/guides/functions/auth

**ADVICE:** the `jobs` function decides by Riyadh time what to do (for example, the morning summary at 07:30). The cron schedule itself stays simple.

### 5.3 Vault and backups

- Vault keeps secrets encrypted on disk. Its key is "never stored in the database alongside the encrypted data". Backups keep the encryption "in a way that can't be decrypted or forged". Source: https://supabase.com/docs/guides/database/vault
- **Effect:** after a restore into another project, `vault.decrypted_secrets` cannot read the old secrets. The restore runbook creates them again.

### 5.4 Free-plan pause

- "A Free plan project is considered inactive if it does not receive sufficient user database activity over the past week." "Typically a few user requests to the database each day over the previous week is enough." Source: https://supabase.com/docs/guides/platform/free-project-pausing
- The page does not say whether pg_cron jobs count. Source: same.
- You can restore a paused project for up to 1 year. Supabase sends a warning email about one week before a pause. Source: same.

### 5.5 Effect on spec 2, section 11

The `jobs` function connects through the pooler and runs normal queries. These are likely "user database activity". During the build, before the office uses Madar every day, the project can still pause. **CHECK AT STEP 5:** watch the project for the warning email. The nightly backup (section 11) also reads the database every day.

---

## 6. Supabase Auth OAuth 2.1 server for MCP

### 6.1 Turn it on

- "OAuth 2.1 server is in beta and available on all Supabase plans. It has no separate charge." Sign-ins count as Monthly Active Users. Source: https://supabase.com/docs/guides/auth/oauth-server/getting-started
- Several agents for one person count as one MAU. Source: https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication
- Turn it on under Authentication, OAuth Server. Set the Authorization Path (for example `/oauth/consent`). The consent page URL is the Site URL plus this path. Source: https://supabase.com/docs/guides/auth/oauth-server/getting-started
- Turn on Dynamic Client Registration on the same page. Source: https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication

The same settings in `config.toml` (then `supabase config push`). Source: https://supabase.com/docs/guides/ai-tools/byo-mcp

```toml
[auth.oauth_server]
enabled = true
authorization_url_path = "/oauth/consent"
allow_dynamic_registration = true
```

**CHECK AT STEP 6:** the exact table name. The page shows the keys under an `[auth...]` heading that the scrape cut short.

### 6.2 Endpoints

| Endpoint | URL |
|---|---|
| Authorization | `https://<ref>.supabase.co/auth/v1/oauth/authorize` |
| Token | `https://<ref>.supabase.co/auth/v1/oauth/token` |
| JWKS | `https://<ref>.supabase.co/auth/v1/.well-known/jwks.json` |
| Discovery (RFC 8414) | `https://<ref>.supabase.co/.well-known/oauth-authorization-server/auth/v1` |
| OIDC discovery | `https://<ref>.supabase.co/auth/v1/.well-known/openid-configuration` |
| Issuer | `https://<ref>.supabase.co/auth/v1` |

Source: https://supabase.com/docs/guides/auth/oauth-server/getting-started

### 6.3 The consent page

1. Supabase sends the person to `<Site URL><Authorization Path>?authorization_id=<id>`.
2. If the person is not signed in, the page sends them to sign-in and keeps `authorization_id`.
3. The page calls `supabase.auth.oauth.getAuthorizationDetails(authorization_id)`. The result has `client.name`, `redirect_uri` and `scope`. If the result has no `authorization_id`, the person approved this client before: send them to `redirect_url` at once.
4. The page shows the agent name and asks Approve or Deny.
5. The page calls `approveAuthorization(authorization_id)` or `denyAuthorization(authorization_id)`. Each returns `redirect_url`. The page sends the browser there.

Source: https://supabase.com/docs/guides/auth/oauth-server/getting-started (the page has a React SPA tab and a Next.js tab).

```ts
// Madar SPA route /oauth/consent (sketch)
const id = new URLSearchParams(location.search).get('authorization_id')!
const { data: details, error } = await supabase.auth.oauth.getAuthorizationDetails(id)
if (details && !('authorization_id' in details)) location.assign(details.redirect_url)
// show details.client.name and details.scope, then on Approve:
const { data } = await supabase.auth.oauth.approveAuthorization(id)
location.assign(data!.redirect_url)
```

### 6.4 Tokens

- Claims: `sub`, `role`, `aud: "authenticated"`, `user_id`, `email`, `client_id`, `aal`, `amr`, `session_id`, `iss: "https://<ref>.supabase.co/auth/v1"`, `iat`, `exp`. Source: https://supabase.com/docs/guides/auth/oauth-server/token-security
- Access token lifetime: 3600 s by default. Refresh tokens can rotate. Source: https://supabase.com/docs/guides/auth/oauth-server/oauth-flows
- Scopes: `openid`, `email`, `profile`, `phone`. "Custom scopes are not currently supported." Source: same.
- PKCE: `S256` (recommended) or `plain`. Source: same.
- The authorization code lives 10 minutes. Source: https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication
- The OAuth flows page does not mention the `resource` parameter (RFC 8707). Source: https://supabase.com/docs/guides/auth/oauth-server/oauth-flows

### 6.5 Dynamic client registration

- MCP clients register themselves when DCR is on. Supabase asks you to review registered clients and to let people revoke grants. Source: https://supabase.com/docs/guides/ai-tools/byo-mcp
- Redirect URIs must match exactly. "No wildcards or patterns". Source: https://supabase.com/docs/guides/auth/oauth-server/getting-started
- Open issue: the server does not apply the loopback port exception of OAuth 2.1. A native client that registers `http://127.0.0.1/callback` without a port and then uses a random port fails. Source: https://github.com/supabase/auth/issues/2703 (open, filed 2026-08-17).
- Open issue: every reconnect through DCR makes a new client, so a person's list of agents fills with copies. Source: https://github.com/supabase/auth/issues/2850

### 6.6 The person's list of agents (Settings, Agents)

```ts
const { data } = await supabase.auth.oauth.listGrants()        // GET /auth/v1/user/oauth/grants
await supabase.auth.oauth.revokeGrant({ clientId })             // DELETE /auth/v1/user/oauth/grants
```

"Revocation marks consent as revoked, deletes active sessions for that OAuth client, and invalidates associated refresh tokens." Source: the type declarations of `@supabase/auth-js` 2.117.2 (`lib/types.d.ts`). The docs page names them `getUserGrants` and `revokeGrant(clientId)` (https://supabase.com/docs/guides/auth/oauth-server/oauth-flows), but the shipped code has `listGrants()` and `revokeGrant({ clientId })`.

### 6.7 Token check in the `mcp` function with `@supabase/server`

- `withOAuthProtectedResource()` serves the RFC 9728 document at `{resource}/oauth-protected-resource`, answers its CORS preflight, and adds `WWW-Authenticate: Bearer resource_metadata="..."` to each 401 from below. Source: https://github.com/supabase/server/blob/main/docs/mcp.md
- On Edge Functions it builds the resource as `{public origin}/functions/v1/{slug}` and the issuer as `{public origin}/auth/v1` with no configuration. Source: same.
- `withSupabase({ auth: 'user' })` is the gate. It needs an asymmetric signing key (ES256 or RS256). Set `verify_jwt = false` for the function. Source: same.
- `withSupabase` has an `audience` option. Without it, it does not check `aud`. It also has an `issuer` option. Source: `@supabase/server` 1.9.0 type declarations (`audience?: string | string[]`, `issuer?: string | string[]`).
- Off Edge Functions (Railway), pass `resourceServer` and `authorizationServer` explicitly, or every request gets a 500 `MISSING_RESOURCE_SERVER`. Source: https://github.com/supabase/server/blob/main/docs/mcp.md

The 401 and the metadata, as Supabase documents them:

```text
HTTP/1.1 401 Unauthorized
www-authenticate: Bearer resource_metadata="https://<ref>.supabase.co/functions/v1/mcp/oauth-protected-resource"

GET .../functions/v1/mcp/oauth-protected-resource
{ "resource": "https://<ref>.supabase.co/functions/v1/mcp",
  "authorization_servers": ["https://<ref>.supabase.co/auth/v1"],
  "bearer_methods_supported": ["header"] }
```

Source: https://supabase.com/docs/guides/ai-tools/byo-mcp

The MCP well-known fallback path (`/.well-known/oauth-protected-resource/functions/v1/mcp` at the root of `<ref>.supabase.co`) is not under Madar's control. This is acceptable: MCP requires one of the two mechanisms, and the 401 header is one. Source: https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery

### 6.8 The audience gap and its fix

**The problem.** MCP says: "MCP servers MUST validate that access tokens were issued specifically for them as the intended audience" and "MUST NOT accept or transit any other tokens". Source: https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/index . A Supabase OAuth token has `aud: "authenticated"`, the same as the token of a person signed in to the Madar screens (section 6.4). Without a fix, the `mcp` function accepts the browser token, and the `api` function accepts the agent token.

**The fix (two parts).**

1. Each function checks `client_id`: the `mcp` function requires it, and the `api` function refuses it.
2. A Custom Access Token Hook sets `aud` to the MCP URL for tokens that have a `client_id`. The hook is on the Free plan. `aud` is a required claim, so the hook may change it but not remove it. Supabase lists "Customize `audience` claim" as a use of this hook for OAuth clients. Sources: https://supabase.com/docs/guides/auth/auth-hooks , https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook , https://supabase.com/docs/guides/auth/oauth-server/getting-started

```sql
create or replace function public.madar_access_token_hook(event jsonb)
returns jsonb language plpgsql stable as $$
declare
  claims jsonb := event->'claims';
begin
  if coalesce(claims->>'client_id', event->>'client_id') is not null then -- a token for an agent
    claims := jsonb_set(claims, '{aud}', to_jsonb('https://<ref>.supabase.co/functions/v1/mcp'::text));
  end if;
  return jsonb_build_object('claims', claims);
end $$;

grant execute on function public.madar_access_token_hook to supabase_auth_admin;
revoke execute on function public.madar_access_token_hook from authenticated, anon, public;
-- Dashboard: Authentication, Hooks, Custom Access Token, choose this function.
```

```ts
// mcp function
withSupabase({
  auth: 'user',
  audience: 'https://<ref>.supabase.co/functions/v1/mcp',
  issuer: 'https://<ref>.supabase.co/auth/v1',
}, handler)
```

**CHECK AT STEP 1 (Proof):** (a) the hook sees `client_id` (in `claims` or at the top level of `event`); (b) Supabase Auth accepts a changed `aud`; (c) a refresh keeps the new `aud`. If (b) fails, part 1 alone still blocks the cross use of tokens.

### 6.9 Client ID Metadata Documents (CIMD)

- MCP 2026-07-28: authorization servers and clients "SHOULD" support CIMD. DCR is "deprecated and retained for backwards compatibility". Source: https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/index
- A client that supports all methods uses this order: pre-registration, then CIMD if the server metadata has `client_id_metadata_document_supported`, then DCR if the metadata has `registration_endpoint`. Source: https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration
- Supabase Auth does not support CIMD on 3 October 2026. The feature request is open: https://github.com/supabase/auth/issues/2850 (filed 2026-10-02, no reply yet). A code search of `supabase/auth` finds no `client_id_metadata_document`.
- **Effect:** a client that follows the order above falls back to DCR. Supabase documents Claude Code, Claude, Cursor, VS Code and ChatGPT as working clients. Source: https://supabase.com/docs/guides/ai-tools/byo-mcp . A client that supports only CIMD cannot connect.

### 6.10 Two more cautions

- **Custom domain.** With a custom domain on the Supabase project, `withOAuthProtectedResource()` advertises an issuer on that domain. "That doesn't match the issuer, and MCP clients that validate the Auth metadata stop at discovery." Fix: pass `authorizationServer` from an environment variable. Source: https://supabase.com/docs/guides/ai-tools/byo-mcp
- **Region parameter.** If the MCP URL had `?forceFunctionRegion=eu-central-1`, the URL that the agent uses would differ from the `resource` in the metadata. **ADVICE:** do not put the parameter in the MCP URL (section 1.3).

---

## 7. MCP specification 2026-07-28

### 7.1 What changed from 2025-11-25

- No sessions. The `Mcp-Session-Id` header is gone. "Servers that need cross-call state use explicit, server-minted handles passed as ordinary tool arguments." (This matches spec 2, section 5.5: story IDs.)
- No `initialize` handshake. Each request carries its protocol version and client capabilities in `_meta`.
- New `server/discover`. Servers MUST implement it.
- The HTTP GET stream is gone. Long-lived notifications use `subscriptions/listen`.
- `ping` and `logging/setLevel` are gone.
- Multi Round-Trip Requests (MRTR) replace server-to-client requests.
- Every result has `resultType`.
- New headers `Mcp-Method` and `Mcp-Name`.
- `ttlMs` and `cacheScope` on list results.
- Error codes renumbered: `-32020`, `-32021`, `-32022`.
- Deprecated: Roots, Sampling, Logging, and DCR.

Source: https://modelcontextprotocol.io/specification/2026-07-28/changelog

### 7.2 Checklist: what a minimal compliant server does over Streamable HTTP

This list is also the test list for step 6. "SDK" means that `@modelcontextprotocol/server` 2.3.0 does it (section 7.6).

**Transport** (https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)

1. One endpoint path that accepts POST. GET and DELETE get `405 Method Not Allowed`. (SDK)
2. Check `Origin`. If it is present and not allowed, answer `403`. (Not done by the SDK handler: "The handler itself validates neither Host nor Origin headers". Source: https://ts.sdk.modelcontextprotocol.io/v2/serving/http)
3. The body is one JSON-RPC request or notification. A notification gets `202 Accepted` with no body. (SDK)
4. A request gets `Content-Type: application/json` or `text/event-stream`. With SSE, send `X-Accel-Buffering: no`. (SDK)
5. Require `MCP-Protocol-Version`, and require it to equal `_meta["io.modelcontextprotocol/protocolVersion"]`. (SDK)
6. Require `Mcp-Method` on every request, and `Mcp-Name` on `tools/call`, `resources/read` and `prompts/get`. Decode `=?base64?...?=` values. If a header is missing or differs from the body, answer `400` with JSON-RPC error `-32020` (`HeaderMismatch`). (SDK)
7. Ignore `Mcp-Session-Id` and `Last-Event-ID`. Never make a session ID. (SDK)
8. An unknown method gets `404` with error `-32601`. (SDK)
9. Closing the SSE stream cancels the request. (SDK)

**Message format** (https://modelcontextprotocol.io/specification/2026-07-28/basic/index)

10. Each request `_meta` MUST have `io.modelcontextprotocol/protocolVersion` and `io.modelcontextprotocol/clientCapabilities`. If one is missing, answer `400` with error `-32602`. `io.modelcontextprotocol/clientInfo` is optional. (SDK)
11. An unsupported version gets `400` with error `-32022` and `data.supported`. (SDK)
12. A request that needs a client capability that the client did not declare gets `400` with error `-32021` and `data.requiredCapabilities`. (SDK)
13. Every result has `resultType`: `"complete"` or `"input_required"`. (SDK)
14. Put `io.modelcontextprotocol/serverInfo` in each result's `_meta` (SHOULD). (SDK)
15. Do not use codes from `-32000` to `-32019` for new errors. Do not invent codes from `-32020` to `-32099`. Application errors go outside `-32768` to `-32000`.

**Features**

16. `server/discover` returns `supportedVersions`, `capabilities`, `_meta.serverInfo`, optional `instructions`, plus `ttlMs` and `cacheScope`. (SDK) Source: https://modelcontextprotocol.io/specification/2026-07-28/server/discover
17. `tools/list` returns the tools in a fixed order (SHOULD), with `ttlMs` (an integer, 0 or more) and `cacheScope` (`"public"` or `"private"`). The list may depend on the token's rights, but not on the connection. (SDK, if you set `cacheHints`; the default is `ttlMs: 0`, `cacheScope: "private"`) Source: https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching
18. `tools/call`: an unknown tool or a bad request is a JSON-RPC error (`-32602`). A business error (bad date, no permission for this action) is a result with `isError: true`, so the model can correct itself. Source: https://modelcontextprotocol.io/specification/2026-07-28/server/tools
19. `inputSchema` is JSON Schema 2020-12 by default and MUST be an object. For no inputs use `{ "type": "object", "additionalProperties": false }`. Source: same.
20. Tool names: 1 to 128 characters of `A-Z a-z 0-9 _ - .`, so `stage.move` and `story.start` are valid. Source: same.
21. If a result has `structuredContent`, also put the same JSON in a text block (SHOULD). Source: same.
22. Validate all tool inputs, apply access control, rate-limit tool calls, and clean outputs (MUST). Source: same.

**Authorization** (https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/index)

23. Serve Protected Resource Metadata (RFC 9728) with at least one entry in `authorization_servers`. (`@supabase/server`)
24. A request with no token, or a bad or expired token, gets `401` with `WWW-Authenticate: Bearer resource_metadata="..."` and, if useful, `scope="..."`. (`@supabase/server`)
25. Too little scope gets `403` with `error="insufficient_scope"`. (Madar has no custom scopes. Supabase does not support them: section 6.4.)
26. Check that the token was issued for this server (audience). (Section 6.8.)
27. Never accept a token in the query string. Never pass the token on to another service.

### 7.3 Message shapes

Request (headers and body):

```http
POST /functions/v1/mcp HTTP/1.1
Content-Type: application/json
Accept: application/json, text/event-stream
Authorization: Bearer <token>
MCP-Protocol-Version: 2026-07-28
Mcp-Method: tools/call
Mcp-Name: stage.move

{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{
  "name":"stage.move","arguments":{"projectId":"p1","toStageId":"s2"},
  "_meta":{
    "io.modelcontextprotocol/protocolVersion":"2026-07-28",
    "io.modelcontextprotocol/clientInfo":{"name":"ExampleClient","version":"1.0.0"},
    "io.modelcontextprotocol/clientCapabilities":{"elicitation":{}}
  }}}
```

`server/discover` result:

```json
{"jsonrpc":"2.0","id":"d1","result":{
  "resultType":"complete",
  "supportedVersions":["2026-07-28"],
  "capabilities":{"tools":{}},
  "_meta":{"io.modelcontextprotocol/serverInfo":{"name":"madar","version":"1.0.0"}},
  "instructions":"Madar is the office project tool. Call madar.readFirst before a change.",
  "ttlMs":3600000,
  "cacheScope":"public"}}
```

`tools/list` result:

```json
{"jsonrpc":"2.0","id":2,"result":{
  "resultType":"complete",
  "tools":[{"name":"stage.move","description":"...","inputSchema":{"type":"object","properties":{}}}],
  "ttlMs":300000,
  "cacheScope":"private"}}
```

Errors:

```json
{"jsonrpc":"2.0","id":1,"error":{"code":-32022,"message":"Unsupported protocol version",
  "data":{"supported":["2026-07-28"],"requested":"1900-01-01"}}}
{"jsonrpc":"2.0","id":1,"error":{"code":-32020,"message":"Header mismatch: Mcp-Name header value 'foo' does not match body value 'bar'"}}
```

Sources: https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http , https://modelcontextprotocol.io/specification/2026-07-28/server/discover , https://modelcontextprotocol.io/specification/2026-07-28/server/tools , https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning

### 7.4 `input_required` (MRTR) and the retry

Result that asks for input:

```json
{"jsonrpc":"2.0","id":1,"result":{
  "resultType":"input_required",
  "inputRequests":{
    "reason":{"method":"elicitation/create","params":{
      "mode":"form",
      "message":"Why does the project move back to Design?",
      "requestedSchema":{"type":"object","properties":{"text":{"type":"string"}},"required":["text"]}}}},
  "requestState":"v1.eyJwIjp7...}.mac"}}
```

Retry (a new JSON-RPC `id`, the same arguments, plus the answers and the state):

```json
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{
  "name":"stage.move","arguments":{"projectId":"p1","toStageId":"s2"},
  "inputResponses":{"reason":{"action":"accept","content":{"text":"The client changed the brief"}}},
  "requestState":"v1.eyJwIjp7...}.mac",
  "_meta":{ "...": "..." }}}
```

Rules (https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr):

- Only `tools/call`, `prompts/get` and `resources/read` may return `input_required`.
- Each `input_required` result has `inputRequests`, `requestState`, or both.
- "Servers MUST NOT send an `inputRequests` that the client has not declared support for in its capabilities." No `elicitation` capability means no `elicitation/create`.
- `requestState` is attacker-controlled input. If it affects authorization or business logic, protect it with HMAC or AEAD and reject state that fails the check. Put the principal, a short expiry, and a digest of the original request inside it (SHOULD).
- The retry has a different JSON-RPC `id`.
- If the client leaves out a required answer, ask again with a new `input_required` result (SHOULD), not an error.
- `input_required` results are never cached.

**ADVICE for Madar (spec 2, section 12):**

- When the client declared `elicitation`: return `input_required` with a form question, as above.
- When the client did not declare it: return a tool result with `isError: true` and the text "This change needs a reason. Call stage.move again with the argument `reason`." Give each tool that can need a reason an optional `reason` input. The agent then asks its person and calls again.

### 7.5 The 401 to token flow

1. The client sends a request with no token.
2. The server answers `401` with `WWW-Authenticate: Bearer resource_metadata="<url>"`.
3. The client reads the Protected Resource Metadata and finds the authorization server.
4. The client reads the authorization server metadata (RFC 8414 first, then OIDC discovery). The `issuer` in the document must equal the issuer that the client used.
5. The client registers: pre-registered ID, or CIMD, or DCR (deprecated).
6. The client opens the browser with PKCE, the `resource` parameter (the canonical MCP URL), and the scopes from the challenge or from `scopes_supported`.
7. The person approves on the consent page. The client checks `iss` in the response (RFC 9207).
8. The client exchanges the code with `code_verifier` and `resource`, and calls the server with `Authorization: Bearer <token>` on every request.

Sources: https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/index , https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery

### 7.6 SDK status

| Package | Version (date) | 2026-07-28? | Evidence |
|---|---|---|---|
| `@modelcontextprotocol/sdk` (v1) | 1.32.0 (2026-10-02) | No | `LATEST_PROTOCOL_VERSION = '2025-11-25'` in `dist/esm/types.js` |
| `@modelcontextprotocol/server` (v2) | 2.3.0 (2026-10-02) | Yes | README: "v2 is the stable release line, implementing the 2026-07-28 MCP spec". Code: `FIRST_MODERN_PROTOCOL_VERSION = "2026-07-28"`, a `server/discover` handler, header checks with `-32020`, `input_required` support. |

Sources: `npm view`, `npm pack` of both packages on 2026-10-03; https://github.com/modelcontextprotocol/typescript-sdk/releases (tag `v2.3.0`, 2026-10-02).

What v2 gives (from the 2.3.0 type declarations and https://ts.sdk.modelcontextprotocol.io/v2/serving/http):

- `createMcpHandler(factory, options)` returns a web-standard `fetch(Request)` handler. "The factory runs once per HTTP request." It runs on Deno with `export default handler`, and on Node with `toNodeHandler` from `@modelcontextprotocol/node`.
- `options.legacy`: `'stateless'` (default) also serves 2025-era clients without sessions. `'reject'` answers them with the unsupported-version error.
- `options.responseMode`: `'auto'` (default), `'json'`, or `'sse'`.
- Upgrade note for 2.3.0: "a stateless Streamable HTTP transport handles one request". One `McpServer` object per request.
- `ServerOptions.cacheHints` sets `ttlMs` and `cacheScope` for `tools/list`, `server/discover` and others. Without it the SDK sends `ttlMs: 0` and `cacheScope: 'private'`.
- `inputRequired({ inputRequests, requestState })`, `inputRequired.elicit(...)`, and `acceptedContent(ctx.mcpReq.inputResponses, key, schema)`.
- `createRequestStateCodec({ key, ttlSeconds, bind })` with `mint(payload, ctx)` and `verify(state, ctx)`. It signs (HMAC-SHA256) but does not encrypt. Pass `verify` as `ServerOptions.requestState.verify`.
- `verifyBearerToken(header, { expectedResource, ... })` and `bearerAuthChallengeResponse(error)` for token checks without `@supabase/server`.
- The handler does not check the token: "Verify the bearer token in middleware", then call `handler.fetch(request, { authInfo })`.
- Dependency: `zod ^4.2.0`. Madar uses zod 4.6.5.

Supabase's own guide uses `npm:@modelcontextprotocol/server@^2.0.0` on Edge Functions with `createMcpHandler`. Source: https://supabase.com/docs/guides/ai-tools/byo-mcp

### 7.7 Code sketch for the `mcp` function

The names come from the 2.3.0 type declarations. **CHECK AT STEP 6:** compile it against the real package.

```ts
import { pipeline } from '@supabase/middleware'
import { withOAuthProtectedResource, withSupabase } from '@supabase/server'
import {
  createMcpHandler, McpServer, inputRequired, acceptedContent, createRequestStateCodec,
} from '@modelcontextprotocol/server'
import * as z from 'zod'

const MCP_URL = 'https://<ref>.supabase.co/functions/v1/mcp'
const ALLOWED_ORIGINS = new Set<string>([]) // agents send no Origin; browsers must be listed

const stateCodec = createRequestStateCodec<{ tool: string; argsDigest: string }>({
  key: env('MCP_STATE_KEY')!,
  ttlSeconds: 600,
  bind: (ctx) => principalOf(ctx), // the user id from the verified token
})
const Reason = z.object({ text: z.string().min(3).max(500) })

Deno.serve(pipeline(
  [
    withOAuthProtectedResource(),
    withSupabase({ auth: 'user', audience: MCP_URL, issuer: 'https://<ref>.supabase.co/auth/v1' }),
  ],
  async (req, ctx) => {
    const origin = req.headers.get('origin')
    if (origin && !ALLOWED_ORIGINS.has(origin)) return new Response(null, { status: 403 })
    if (!ctx.jwtClaims?.client_id) return new Response(null, { status: 401 }) // not an agent token

    const handler = createMcpHandler(() => {
      const server = new McpServer({ name: 'madar', version: '1.0.0' }, {
        instructions: 'Madar is the office project tool. Call madar.readFirst before a change.',
        cacheHints: {
          'server/discover': { ttlMs: 3_600_000, cacheScope: 'public' },
          'tools/list': { ttlMs: 300_000, cacheScope: 'private' },
        },
        requestState: { verify: (s, c) => stateCodec.verify(s, c) },
      })
      // register the 108 calls plus story.start and madar.readFirst, in a fixed order
      server.registerTool('stage.move', {
        description: 'Move a project to another stage. A move back needs a reason.',
        inputSchema: z.object({ projectId: z.string(), toStageId: z.string(), reason: z.string().optional() }),
      }, async (args, c) => {
        const answered = acceptedContent(c.mcpReq.inputResponses, 'reason', Reason)
        const reason = args.reason ?? answered?.text
        if (needsReason(args) && !reason) {
          if (!clientCanElicit(c)) {
            return { isError: true, content: [{ type: 'text',
              text: 'This change needs a reason. Call stage.move again with the argument "reason".' }] }
          }
          return inputRequired({
            inputRequests: { reason: inputRequired.elicit({ message: 'Why does the project move back?', requestedSchema: Reason }) },
            requestState: await stateCodec.mint({ tool: 'stage.move', argsDigest: digest(args) }, c),
          })
        }
        return runMadarCall('stage.move', { ...args, reason }, ctx.userClaims!.id, ctx.jwtClaims!.client_id)
      })
      return server
    }, { legacy: 'stateless', responseMode: 'json', onerror: (e) => console.error('mcp', e) })

    return handler.fetch(req)
  },
))
```

`clientCanElicit` reads `elicitation` from the request's `io.modelcontextprotocol/clientCapabilities`. **CHECK AT STEP 6:** the SDK accessor for it (the `Server` class has `getClientCapabilities()`).

### 7.8 zod to JSON Schema

`z.toJSONSchema(schema)` targets JSON Schema draft 2020-12 by default. Use `io: 'input'` for tool inputs, because defaults and coercions differ between input and output. Dates and transforms are "unrepresentable" and throw by default. Source: https://zod.dev/json-schema . The SDK's `registerTool` takes the zod schema and makes the JSON Schema itself. Source: https://ts.sdk.modelcontextprotocol.io/v2/servers/tools

---

## 8. Cloudflare R2

### 8.1 Free tier and the subscription

| Item | Free each month | Source |
|---|---|---|
| Storage (Standard) | 10 GB-month | https://developers.cloudflare.com/r2/pricing/ |
| Class A operations (writes, lists) | 1 million | same |
| Class B operations (reads) | 10 million | same |
| Egress | Free | same |

- "You need a Cloudflare account with an R2 subscription." "Complete the checkout flow to add an R2 subscription." "R2 is free to get started with included free monthly usage." Source: https://developers.cloudflare.com/r2/get-started/
- The checkout asks for a payment method, also for the free tier (secondary sources: https://costbench.com/software/cloud-infrastructure/cloudflare-r2/free-plan/ , https://freetier.co/directory/products/cloudflare-r2).
- **OWNER:** complete the R2 checkout with a card. Cloudflare charges only above the free tier.

### 8.2 Limits

| Limit | Value | Source |
|---|---|---|
| Object size | 5 TiB | https://developers.cloudflare.com/r2/platform/limits/ |
| One PUT (single part) | 5 GiB | same |
| Multipart | 4.995 TiB, 10,000 parts | same |

The Madar limit of 250 MB per file fits in one PUT.

### 8.3 Presigned PUT and GET

- A presigned URL allows one operation (GET, HEAD, PUT, DELETE) on one object. Expiry: 1 second to 7 days. `POST` form uploads are not supported. Source: https://developers.cloudflare.com/r2/api/s3/presigned-urls/
- Presigned URLs work only on the S3 domain `<ACCOUNT_ID>.r2.cloudflarestorage.com`, not on a custom domain. Source: same.
- Sign the `Content-Type`. A different `Content-Type` from the browser then fails with `403 SignatureDoesNotMatch`. Source: same.
- Treat a presigned URL as a bearer token. Source: same.

```ts
// _shared/server/r2.ts (Deno and Node)
import { AwsClient } from 'aws4fetch'
import { env } from './env.ts'

const r2 = new AwsClient({
  service: 's3', region: 'auto',
  accessKeyId: env('R2_ACCESS_KEY_ID')!, secretAccessKey: env('R2_SECRET_ACCESS_KEY')!,
})
// EU jurisdiction bucket (8.4): note the ".eu." part
const R2_URL = `https://${env('R2_ACCOUNT_ID')}.eu.r2.cloudflarestorage.com/${env('R2_BUCKET')}`

// key: made by the server, only [a-z0-9/-], for example "p/<projectId>/f/<fileId>/v/<n>"
export async function presignPut(key: string, contentType: string): Promise<string> {
  const req = new Request(`${R2_URL}/${key}?X-Amz-Expires=600`, {
    method: 'PUT', headers: { 'Content-Type': contentType },
  })
  return (await r2.sign(req, { aws: { signQuery: true } })).url
}
export async function presignGet(key: string): Promise<string> {
  const req = new Request(`${R2_URL}/${key}?X-Amz-Expires=600`)
  return (await r2.sign(req, { aws: { signQuery: true } })).url
}
```

Source of the pattern: https://developers.cloudflare.com/r2/examples/aws/aws4fetch/

**ADVICE:** a presigned PUT does not limit the size. After the upload, the browser calls a "confirm" call, and the server checks the size with a signed `HEAD`. Over 250 MB, the server deletes the object and refuses the file.

### 8.4 Data location

- Jurisdictions: `eu` (European Union), `fedramp`, `us`. "Once an R2 bucket is created, the jurisdiction cannot be changed." Source: https://developers.cloudflare.com/r2/reference/data-location/
- A jurisdiction bucket uses the endpoint `https://<ACCOUNT_ID>.<JURISDICTION>.r2.cloudflarestorage.com`. Source: same.
- **ADVICE:** make the bucket with the `eu` jurisdiction (Dashboard, Location, Specify jurisdiction), because the owner wants data in Europe.

### 8.5 CORS for browser uploads

`wrangler r2 bucket cors set` takes only the R2 form: a `rules` array, each rule with an `allowed` object of lower-case keys.
wrangler 4.147.0 refuses the S3 form: it stops on a `CORSRules` key, on a file with no `rules` array, and on the keys
`AllowedOrigins`, `AllowedMethods` and `AllowedHeaders` (checked in `node_modules/wrangler/wrangler-dist/cli.js`, 2026-10-16).
The S3 API and the dashboard use the S3 form instead.

The two files of Madar (`config/r2-cors.test.json`, `config/r2-cors.production.json`; `scripts/deploy/r2-cors.test.ts` checks
them). The production file:

```json
{
  "rules": [
    {
      "allowed": {
        "origins": ["https://madar.vado.sa", "https://www.madar.vado.sa", "https://madar-46r.pages.dev"],
        "methods": ["PUT", "GET"],
        "headers": ["Content-Type"]
      },
      "maxAgeSeconds": 7200
    }
  ]
}
```

The test file has `https://preview.madar-46r.pages.dev` and `http://127.0.0.1:5173` (the local port goes on the test bucket only).
No `exposeHeaders`: the screens read no R2 header. The browser sends only the upload PUT with `Content-Type` across origins.
A picture, the PDF preview (`iframe`) and a download link need no CORS.

```bash
npx wrangler r2 bucket cors set madar-files-test --file config/r2-cors.test.json --jurisdiction eu --force
npx wrangler r2 bucket cors set madar-files --file config/r2-cors.production.json --jurisdiction eu --force
npx wrangler r2 bucket cors list madar-files-test --jurisdiction eu
```

A change can take up to 30 seconds. A request without `Origin` gets no CORS headers. List each localhost port on its own. An expired
presigned URL gets 403 with no CORS headers, so the screen cannot read the error body. Source: https://developers.cloudflare.com/r2/buckets/cors/

---

## 9. Cloudflare Pages

### 9.1 Deploy a Vite build by direct upload

```bash
npx wrangler pages project create          # asks for the name and the production branch
npm run build                              # Vite writes dist/
npx wrangler pages deploy dist             # production
npx wrangler pages deploy dist --branch=preview   # a preview deploy
```

Source: https://developers.cloudflare.com/pages/get-started/direct-upload/

- In CI, Wrangler reads `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The action is `cloudflare/wrangler-action@v4`. Source: https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/
- A Direct Upload project has no production branch controls. Source: https://developers.cloudflare.com/pages/get-started/direct-upload/
- **OWNER:** make an API token for Pages deploys (account scope).

### 9.2 Limits on the free plan

| Limit | Value | Source |
|---|---|---|
| Builds a month | 500 (only builds that Cloudflare runs) | https://developers.cloudflare.com/pages/platform/limits/ |
| Files per site | 20,000 | same |
| Size of one file | 25 MiB | same |
| Custom domains per project | 100 | same |
| `_headers` rules | 100 | same |
| `_redirects` | 2,000 static and 100 dynamic | same |
| Projects per account | 100 | same |

With direct upload, GitHub Actions or the builder's machine runs `vite build`. So the limit of 500 builds in spec 2, section 15 does not apply.

### 9.3 SPA routes and `_headers`

- With no top-level `404.html`, Pages treats the site as a single-page application and serves the root for all unknown paths. Source: https://developers.cloudflare.com/pages/configuration/serving-pages/
- Assets stay cached on the CDN until the next deploy. Pages sends ETags. Source: same.
- `_headers` goes in the build output (for Vite: `public/_headers`, which Vite copies to `dist/`). Each line is at most 2,000 characters. Source: https://developers.cloudflare.com/pages/configuration/headers/

```text
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  X-Frame-Options: DENY
  Content-Security-Policy: default-src 'self'; connect-src 'self' https://<ref>.supabase.co wss://<ref>.supabase.co https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com; img-src 'self' data: https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com; frame-ancestors 'none'

/assets/*
  Cache-Control: public, max-age=31536000, immutable
```

**CHECK AT STEP 1:** the CSP must allow the fonts and every host that the screens call. Test it in the browser console.

### 9.4 Custom domain

- Pages project, Custom domains, Set up a domain. Source: https://developers.cloudflare.com/pages/configuration/custom-domains/
- An apex domain (`example.com`) needs the zone on Cloudflare: change the nameservers. Source: same.
- A subdomain with DNS elsewhere needs a CNAME to `<project>.pages.dev`. First add the domain in the Pages dashboard. A CNAME without this step gives a 522 error. Source: same.
- CAA records, if any, must allow Cloudflare's certificate authorities. Source: same.
- **OWNER:** choose the nameserver move or the subdomain, and add the records.

---

## 10. Resend

### 10.1 Free plan

| Item | Value | Source |
|---|---|---|
| Emails | 3,000 a month, 100 a day | https://resend.com/pricing |
| Domains | 3 | same |
| Data retention | 30 days | same |
| Day boundary | A UTC day. It resets at 00:00 UTC (03:00 Riyadh). | https://resend.com/docs/knowledge-base/account-quotas-and-limits |
| Recipients | Each `to`, `cc` or `bcc` address counts as one email. | same |
| API rate | 10 requests a second per team | https://resend.com/docs/api-reference/introduction |

**Effect:** invitations and password resets from Supabase Auth go through the same Resend account (section 3.4). They use the same 100 a day.

### 10.2 Send from Deno or Node

```ts
const res = await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${env('RESEND_API_KEY')}`,
    'Content-Type': 'application/json',
    'Idempotency-Key': `notice-${noticeId}`, // max 256 characters, kept 24 hours
  },
  body: JSON.stringify({
    from: 'Madar <notices@notices.<domain>>',
    to: [person.email],               // at most 50
    subject,
    html,                              // with dir="rtl" for Arabic
    text,
    tags: [{ name: 'kind', value: 'task_assigned' }],
  }),
})
// 200 => { id }
```

Source: https://resend.com/docs/api-reference/emails/send-email

### 10.3 Domain DNS records

- Resend asks for SPF (an MX record and a TXT record on the `send` subdomain), DKIM (a TXT record at `resend._domainkey`), and an optional DMARC TXT record at `_dmarc`. Source: https://resend.com/docs/dashboard/domains/introduction
- Resend recommends a subdomain (for example `updates.example.com`) to keep the sending reputation apart. A custom Return-Path subdomain is possible. Source: same.
- Sending regions: `us-east-1`, `eu-west-1` (Ireland), `sa-east-1`, `ap-northeast-1`. "It does not control where customer data is stored. All account data, including email metadata, logs, and API records, is stored in the United States." To change a region, delete the domain and add it again. Source: https://resend.com/docs/dashboard/domains/regions
- **OWNER:** add the domain with region `eu-west-1`, and add the DNS records that Resend shows.

### 10.4 SMTP for Supabase Auth

Host `smtp.resend.com`, port `465`, user name `resend`, password = an API key. Source: https://resend.com/docs/send-with-supabase-smtp . Details in section 3.4.

---

## 11. Nightly database backup with GitHub Actions

### 11.1 Connection

- Use the session pooler string (`aws-<index>-<region>.pooler.supabase.com:5432`, user `postgres.<ref>`). It is IPv4. Source: https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore ("Use the Session pooler connection string by default") and https://supabase.com/docs/guides/database/connecting-to-postgres
- GitHub-hosted runners connect over IPv4 only, so the direct IPv6 string fails with "Network is unreachable" (secondary sources: https://github.com/orgs/supabase/discussions/27034 , https://supabase.com/docs/guides/troubleshooting/supabase--your-network-ipv4-and-ipv6-compatibility-cHe3BP.md).

### 11.2 Schedule

- `on.schedule` takes a `timezone` key with an IANA name. Source: https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax
- Schedules can be late at high load, and "some queued jobs may be dropped". The start of each hour is a busy time. Scheduled workflows run only on the default branch. Source: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
- The 60-day auto-disable applies to public repositories. Source: same. The backup repository is private.
- GitHub Free: 2,000 Actions minutes a month and 500 MB of artifact storage for private repositories. Source: https://docs.github.com/en/billing/concepts/product-billing/github-actions

**ADVICE:** run at 02:07, not 02:00, to avoid the busy start of the hour.

### 11.3 Encryption with age

```bash
age-keygen -o madar-backup.key            # once, on the owner's computer; prints the public key
age -r <age1...public key> -o out.age in  # encrypt (on the runner)
age --decrypt -i madar-backup.key out.age > in   # decrypt (restore)
```

Install on Ubuntu 22.04 and later with `apt install age`. Source: https://github.com/FiloSottile/age

**OWNER:** keep `madar-backup.key` offline. A lost key means the backups cannot be read.

### 11.4 Dump and restore commands

```bash
supabase db dump --db-url "$DB_URL" -f roles.sql --role-only
supabase db dump --db-url "$DB_URL" -f schema.sql
supabase db dump --db-url "$DB_URL" -f data.sql --use-copy --data-only \
  -x "storage.buckets_vectors" -x "storage.vector_indexes"

psql --single-transaction --variable ON_ERROR_STOP=1 \
  --file roles.sql --file schema.sql \
  --command 'SET session_replication_role = replica' \
  --file data.sql --dbname "$RESTORE_DB_URL"
```

Source: https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore . The page also says: changes to the `auth` and `storage` schemas (triggers, policies, and policies on `realtime.messages`) need a separate restore with the CLI diff.

**Effect on the restore test (step 7):**

- Restore into the second free project (2 active projects allowed on Free: https://supabase.com/pricing).
- Create the Vault secrets again (section 5.3).
- Check that the Madar policy on `realtime.messages` and the access token hook came back.
- **CHECK AT STEP 7:** that `auth.users` rows (and so the passwords) are in `data.sql`.

### 11.5 Where to keep the encrypted copy (not Supabase, not R2)

| Option | Free amount | Owner work | Note | Source |
|---|---|---|---|---|
| GitHub release assets in a private repository | Each file under 2 GiB, up to 1,000 assets per release, "no limit on the total size of a release, nor bandwidth usage" | A private repository and a fine-grained token | Simple with `gh release`. Data is in the US. | https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases |
| Backblaze B2 | First 10 GB free, "no minimum storage duration fees", free egress up to 3 times the stored amount | A B2 account and an application key | No credit card at sign-up (secondary source). rclone supports it. | https://www.backblaze.com/cloud-storage/pricing , https://www.backblaze.com/b2/sign-up.html , https://rclone.org/b2/ |
| Google Drive through rclone | 15 GB (shared with Gmail) | A Google Cloud project, an OAuth client, and a published app | rclone's shared client ID "is being retired and will stop working during 2026". An app in "Testing" mode loses its grant "after a week". | https://rclone.org/drive/ |
| GitHub Actions artifacts | 500 MB on Free | None | Too small for 30 nightly copies once the data grows. | https://docs.github.com/en/billing/concepts/product-billing/github-actions |

**ADVICE:**

- **Database (nightly):** GitHub release assets in a private repository `madar-backups`. A compressed dump of a database under 500 MB is well under 2 GiB.
- **Files (weekly, spec 2, section 13):** Backblaze B2 with rclone. Encrypt with an rclone `crypt` remote (https://rclone.org/crypt/). The 10 GB free tier equals the R2 free tier, so at about 8 GB of files the owner pays B2 ($6.95 per TB a month: https://www.backblaze.com/cloud-storage/pricing) or removes old versions.

### 11.6 Workflow

```yaml
# .github/workflows/db-backup.yml (in the Madar repository or in madar-backups)
name: nightly-db-backup
on:
  schedule:
    - cron: '7 2 * * *'
      timezone: 'Asia/Riyadh'
  workflow_dispatch:
permissions:
  contents: read
jobs:
  backup:
    runs-on: ubuntu-latest
    env:
      DB_URL: ${{ secrets.SUPABASE_SESSION_POOLER_URL }}
      AGE_RECIPIENT: ${{ vars.AGE_RECIPIENT }}          # the public key only
      GH_TOKEN: ${{ secrets.BACKUP_REPO_TOKEN }}        # contents: read and write on madar-backups only
      BACKUP_REPO: <owner>/madar-backups
    steps:
      - uses: supabase/setup-cli@v1
        with:
          version: latest
      - run: sudo apt-get update && sudo apt-get install -y age
      - name: Dump
        run: |
          supabase db dump --db-url "$DB_URL" -f roles.sql --role-only
          supabase db dump --db-url "$DB_URL" -f schema.sql
          supabase db dump --db-url "$DB_URL" -f data.sql --use-copy --data-only \
            -x "storage.buckets_vectors" -x "storage.vector_indexes"
      - name: Encrypt
        run: |
          STAMP=$(date -u +%Y-%m-%dT%H%MZ)
          tar czf - roles.sql schema.sql data.sql | age -r "$AGE_RECIPIENT" -o "madar-db-$STAMP.tar.gz.age"
          rm -f roles.sql schema.sql data.sql
          echo "STAMP=$STAMP" >> "$GITHUB_ENV"
      - name: Upload
        run: gh release create "db-$STAMP" "madar-db-$STAMP.tar.gz.age" --repo "$BACKUP_REPO" --title "db $STAMP" --notes "nightly"
      - name: Keep 30 days
        run: |
          CUTOFF=$(date -u -d '30 days ago' +%s)
          gh release list --repo "$BACKUP_REPO" --limit 200 --json tagName,createdAt \
            --jq ".[] | select(.tagName | startswith(\"db-\")) | select((.createdAt | fromdateiso8601) < $CUTOFF) | .tagName" \
          | xargs -r -I{} gh release delete {} --repo "$BACKUP_REPO" --yes --cleanup-tag
```

Weekly file copy (sketch). rclone reads its remotes from `RCLONE_CONFIG_<NAME>_<KEY>` variables:

```yaml
    env:
      RCLONE_CONFIG_R2_TYPE: s3
      RCLONE_CONFIG_R2_PROVIDER: Cloudflare
      RCLONE_CONFIG_R2_ACCESS_KEY_ID: ${{ secrets.R2_READONLY_KEY_ID }}
      RCLONE_CONFIG_R2_SECRET_ACCESS_KEY: ${{ secrets.R2_READONLY_SECRET }}
      RCLONE_CONFIG_R2_ENDPOINT: https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com
      RCLONE_CONFIG_B2_TYPE: b2
      RCLONE_CONFIG_B2_ACCOUNT: ${{ secrets.B2_KEY_ID }}
      RCLONE_CONFIG_B2_KEY: ${{ secrets.B2_APP_KEY }}
      RCLONE_CONFIG_B2CRYPT_TYPE: crypt
      RCLONE_CONFIG_B2CRYPT_REMOTE: b2:madar-files-copy
      RCLONE_CONFIG_B2CRYPT_PASSWORD: ${{ secrets.RCLONE_CRYPT_PASSWORD_OBSCURED }}
    steps:
      - run: sudo apt-get install -y rclone
      - run: rclone sync r2:<bucket> b2crypt:current --backup-dir "b2crypt:old/$(date -u +%F)"
```

Sources: https://rclone.org/s3/ (Cloudflare R2 settings), https://rclone.org/b2/ , https://rclone.org/crypt/ . **CHECK AT STEP 7:** the exact rclone keys, and a cleanup of `old/` folders older than 30 days.

---

## 12. Railway (the same Hono app on Node)

### 12.1 Facts

- Railway uses a `Dockerfile` at the root of the source directory ("Using detected Dockerfile!"). The name must be `Dockerfile` with a capital D. `RAILWAY_DOCKERFILE_PATH` sets another path. A build-time variable needs an `ARG` line. Source: https://docs.railway.com/guides/dockerfiles
- With no Dockerfile, Railpack builds the image. For Node it takes the version from `RAILPACK_NODE_VERSION`, then `devEngines.runtime`, `engines.node`, `.nvmrc`, `.node-version`, else `lts`. The start command is the `start` script, then `main`, then `index.js` or `index.ts`. Source: https://railpack.com/languages/node
- The app must listen on `0.0.0.0` and on the port in the `PORT` variable that Railway injects. Source: https://docs.railway.com/networking/troubleshooting/application-failed-to-respond
- A custom domain needs a CNAME record and a TXT record. Source: https://docs.railway.com/guides/public-networking
- EU region: "EU West Metal", Amsterdam, `europe-west4-drams3a`. Source: https://docs.railway.com/reference/deployment-regions
- Plans: Free $0 (1 vCPU, 0.5 GB RAM, $1 of credit a month), Hobby $5, Pro $20. A new Trial account gets $5 once. "As of March 30th, Railway requires the use of a post-paid card." Source: https://docs.railway.com/reference/pricing/plans
- Outbound IPv6 from Railway to the direct Supabase connection fails (secondary source: https://github.com/orgs/supabase/discussions/43111). The transaction pooler is IPv4, so the same `DATABASE_URL` works.

**OWNER:** make a Railway account for the step-1 test deploy. Expect to add a card.

### 12.2 Code

```ts
// server/node.ts : the Node home of the same app
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { madarApi } from './app.js'
import { mcpApp } from './mcp.js'   // uses resourceServer/authorizationServer explicitly (section 6.7)
import { jobsApp } from './jobs.js'

const app = new Hono()
app.route('/api', madarApi)
app.route('/mcp', mcpApp)
app.route('/jobs', jobsApp)
serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3000), hostname: '0.0.0.0' })
```

Source of the pattern: https://hono.dev/docs/getting-started/nodejs

```dockerfile
# Dockerfile (based on the Hono Node example)
FROM node:22-alpine AS base

FROM base AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
COPY server ./server
RUN npm ci && npm run build:server && npm prune --omit=dev

FROM base AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 madar
COPY --from=builder --chown=madar:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=madar:nodejs /app/dist ./dist
COPY --from=builder --chown=madar:nodejs /app/package.json ./package.json
USER madar
EXPOSE 3000
CMD ["node", "dist/server/node.js"]
```

### 12.3 Portability rules

| Rule | Why |
|---|---|
| Read settings only through `env()` (section 1.4). | Deno has `Deno.env`, Node has `process.env`. |
| Use only web-standard APIs (`fetch`, `Request`, `Response`, `crypto.subtle`) in the app. | Both hosts have them. |
| Use `pg`, `jose`, `aws4fetch`, `hono`, `zod` and `@modelcontextprotocol/server`. | Each runs on Deno and on Node. |
| Check tokens in code, not with the Supabase gateway. | Railway has no gateway check (section 1.6). |
| Give `@supabase/server` the URLs explicitly on Node. | Its automatic URLs work only on Edge Functions (section 6.7). |
| On Deno, the Edge Function adds `basePath('/<name>')`. On Node, mount at `/<name>`. | The paths then match on both hosts. |

---

## 13. Checks for build step 1 (Proof)

1. JWT signing key is ES256 (section 3.6).
2. The Custom Access Token Hook sees `client_id` and may change `aud` (section 6.8).
3. One DCR agent (Claude Code) connects to the `mcp` function, approves on the consent page, and calls one tool (sections 6, 7).
4. A browser token gets 401 on `mcp`. An agent token gets 403 on `api` (section 6.8).
5. `pg` through the transaction pooler holds `pg_advisory_xact_lock` across a full load, run and save (section 2.3).
6. `realtime.send` inside a rolled-back transaction sends nothing (section 4.1).
7. A presigned PUT from the browser to the EU bucket works with the CORS policy (section 8).
8. One email through Resend from the function, and one invitation through Supabase SMTP (sections 3, 10).
9. The same app answers on Railway with the same `DATABASE_URL` and SSL setting (sections 2.5, 12).
10. CPU time of a heavy call stays under 2 s (section 1.1).
