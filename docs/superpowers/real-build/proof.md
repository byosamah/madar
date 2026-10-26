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
2. The local pooler user is `postgres.pooler-dev` (tenant `pooler-dev`). **Corrected after C1 (2026-10-04):** the local pooler also accepts `madar_server.pooler-dev` and then runs as `madar_server` (`current_user = madar_server`; the user `madar_server` without the tenant gets `ENOIDENTIFIER`), so a local check of the server role can go through the pooler once that role has a login (section C1, fact 1). The first text said the pooler always connects as `postgres`.
3. The first serve on this Mac logged `CPU time soft limit reached` once for one isolate during the cold start, while the Mac's load average was about 170 (many agents at work). It did not repeat. Z0b measures the CPU of a cold start on the hosted platform (risk 3).
4. The health route opens one connection of its own for each call and closes it, with a lock key (`7310999`) that is never the office key. So it shows the database path on every host without a pool of the app.

**Re-run.** Take the Docker lock, `supabase start`, `npm run build:server`, then `supabase functions serve --env-file <file>` with `DATABASE_URL=postgres://postgres.pooler-dev:postgres@pooler:6543/postgres`, and call `curl -H 'x-madar-jobs-secret: <JOBS_SECRET>' http://127.0.0.1:54321/functions/v1/api/health` (with `JOBS_SECRET` in the env file; without the header the route answers from memory). `server/it/worker.it.test.ts` (E4) runs the same health check and the batch smoke on this host and on Wrangler.

## E4. Workers entry: the same smoke on Supabase and on Wrangler (2026-10-03)

**Result: PASS, with one design fact for the Workers path.** `server/it/worker.it.test.ts` builds the bundles, starts `supabase functions serve` (Deno) and `wrangler dev -c wrangler.server.toml` (workerd, `nodejs_compat`, Wrangler 4.147.0) against the local stack, and runs the same smoke on both: 10 of 10 tests pass.

| Check, on both hosts | Result |
|---|---|
| `GET /api/health`: `pg` through the transaction pooler, the transaction lock, `AsyncLocalStorage`, 108 shared calls | 200 on both, with the region of each host (`local-deno`, `local-workers`) |
| 13 entries, two overview calls, a body over 256 KB, an old `X-Madar-Build` | 413 `too_many_calls`, 413 `too_many_overviews`, 413, 409 `client_outdated` on both |
| A batch without a valid sign-in | a refusal on both (500 `not_built` while the token check is the T0 stub; 401 after track P) |
| `/api/batch` without a token, `/mcp`, `/jobs/run` | the same status and body on both hosts, never 404 |
| CORS preflight of the screens on Workers | 204, the allowed origin, `Access-Control-Max-Age: 7200` |

**Design fact for the Workers path (C1, risk 18).** On Workers, a `pg.Pool` made at module level serves the first request and then hangs every later request: the runtime ties a socket to the request that opened it ("The Workers runtime canceled this request because it detected that your Worker's code had hung"). A probe with one module-level pool (`max: 1`) through the local pooler answered 200, then 500, 500. So the two module-level pools of plan 4.5 work on Supabase Edge Functions (Deno keeps the isolate's sockets across requests), but on Workers the `Db` must open its clients for each request and close them at the end (or use Hyperdrive). The health route already does this, which is why it passes on both hosts.

**The fix (review of E, 2026-10-03).** `server/entries/worker.ts` reads the values and builds the apps once for each isolate, but opens a new `Db` for each request (`pgDb(values.database)`), runs the request inside an `AsyncLocalStorage` scope (`server/entries/requestDb.ts`), and calls `close()` when the answer has ended, through `ctx.waitUntil`. A streamed body keeps its `Db` until its last byte. `server/entries/worker.test.ts` proves this with a fake `Db` that hangs after its request. What C1 must give: `pgDb` creates its two pools inside the call (never at module level), the pools open on the first query, and `close()` ends both pools; the `Db` port gains `close?(): Promise<void>` (merge lead patch). C1's `server/it` suite then sends two requests in a row through `deps.db` on `wrangler dev` and expects 200 on both. Nothing changes on Supabase, where the pools live for the isolate.

**Health route (review of E).** `GET /api/health` without a secret now answers from memory (`ok`, `region`, `calls`) and never opens a connection. The database check above runs only with `x-madar-jobs-secret` equal to `JOBS_SECRET`, and it takes a new lock key for each call in the two-key space (`pg_advisory_xact_lock(7310999, <random>)`), so two checks never wait on each other. The re-run of this smoke after the fix: 12 of 12 pass.

**Local fact.** The local Supabase gateway (Kong) adds `Access-Control-Allow-Origin: *` to function answers. So the local stack cannot show the CORS answer of the function itself. The CORS check runs on Workers here, and Z0a checks the answer of the hosted gateway on the test project.

## Z0a. Cloud proof, probes (2026-10-03)

**Project:** `madar-test` (`qdgwpnesxppnqsaabqzd`, `eu-central-1`) only. The probes refuse every other ref (`scripts/proof/lib.ts`).
**Scripts:** `scripts/proof/z0a.ts` (steps), `scripts/proof/storage.ts`, `scripts/proof/function/index.ts` (a short-lived probe Edge Function), `scripts/proof/worker/` (the Workers probe), `scripts/proof/supabase-root-2021-ca.crt` (the public Supabase root CA).
**Run:** `set -a; . ~/dev/madar/.env.local; set +a`, then `npx tsx scripts/proof/z0a.ts <step>` for `deploy keys region pg ssl hook realtime storage worker cleanup`, in this order. Each step prints a JSON report with every secret redacted.
**Method:** The probe Edge Function `z0a-probe` uses the keys that Supabase injects (`SUPABASE_SECRET_KEYS`, `SUPABASE_PUBLISHABLE_KEYS`), so no project key left Supabase. A random probe token, set as a function secret, guarded each route. SQL went through the session pooler as `postgres` with `MADAR_TEST_DB_PASSWORD`.
**Cleanup:** The `cleanup` step removed the function, its secret, the `madar_server` role, the hook function, the probe tables and policies, the probe users, the OAuth client and the bucket, and restored the Auth settings. A count after cleanup found 0 of each. **One setting stays changed on purpose:** "Enforce SSL on incoming connections" is now on for `madar-test`, as Z1 requires for both projects.

### Results

| # | Item | Result | Design change |
|---|---|---|---|
| 1 | ES256 signing key | **Pass** | None. Z1: revoke the old HS256 key. |
| 2 | Token hook on the hosted Auth | **Pass** | Yes: G1, P1, Z7, Z1, U, X (below). |
| 3 | `pg` as `madar_server` with the root CA and `pg_advisory_xact_lock` through the transaction pooler | **Pass** | None. Risk 19 does not happen. |
| 3b | A connection without TLS is refused | **Pass after a setting** | Z1 must turn on SSL enforcement. Off by default, so a plain connection worked. |
| 4 | `set local` timeouts through Supavisor | **Pass** | None. C1 keeps "only `set local`". |
| 5 | Realtime rollback by SQL | **Pass** | Yes: B1 or N1 grants and policy, N1 warning check (below). |
| 6 | Files on Supabase Storage from a browser, with an Arabic file name | **Pass** | Yes: F2 (upload life, checks, no upsert), F3 (size refusal), N3 (upload leftovers), O3 (CSP hosts) (below). |
| 7 | Portability: the Workers path with `wrangler dev` on the Mac | **Pass through Hyperdrive** | Yes: E4 must connect through a Hyperdrive binding (below). |
| 8 | `SB_REGION` of a call with `forceFunctionRegion` | **Pass** | None. The parameter is necessary. |
| 9 | One Resend send to the owner | **Pending the owner address** | Skipped in this wave. |
| 10 | R2 (bucket, CORS, `aws4fetch` disposition) | **Waits for R2** | Plan 2b, point 1: Storage replaces it for now. |

**Gate for C3:** No item stops C3. The items that touch track C (custom role on the pooler, CA, transaction lock, `set local`) pass with the planned design.

### 1. ES256 signing key

- Management API `config/auth/signing-keys`: ES256 has status `in_use`. The legacy HS256 key has status `previously_used`.
- `/auth/v1/.well-known/jwks.json` serves one key: `ES256`, `EC`, `P-256`.
- A `previously_used` key still verifies old tokens until someone revokes it. The server checks tokens against the JWKS (ES256 only), so it refuses HS256 tokens anyway. **Z1:** revoke the HS256 key in both projects.

### 2. Custom Access Token Hook on the hosted Auth

The probe turned on the OAuth 2.1 server and DCR through the Management API (`oauth_server_enabled`, `oauth_server_allow_dynamic_registration`, `oauth_server_authorization_path = /oauth/consent`) and set the hook (`hook_custom_access_token_uri = pg-functions://postgres/public/<fn>`). Then it ran a full agent flow inside the probe function.

| Step | Result |
|---|---|
| DCR `POST /auth/v1/oauth/clients/register` | 201, `client_type: public`, `registration_type: dynamic` |
| `GET /auth/v1/oauth/authorize` with PKCE S256 | 302 to `<Site URL>/oauth/consent?authorization_id=...` |
| `getAuthorizationDetails`, `approveAuthorization` | client name and scope returned; a code came back |
| Code exchange `POST /auth/v1/oauth/token` | 200. `aud` = `https://qdgwpnesxppnqsaabqzd.supabase.co/functions/v1/mcp`, `client_id` set |
| Refresh of the agent token | 200. The new token keeps the MCP `aud` and the `client_id` |
| The person's own token (password sign-in, then refresh) | `aud` stays `authenticated`, no `client_id` |
| Hook calls | 4: `password`, `oauth_provider/authorization_code`, `token_refresh` (agent), `token_refresh` (person) |

Answers to PF 6.8: (a) the hook sees `client_id` **inside `claims`**, not at the top level of `event`. The event keys are `claims`, `user_id`, `metadata`, `authentication_method`. (b) Auth accepts the changed `aud`. (c) A refresh keeps it, because the hook runs again on each refresh.

**Design changes:**

- **P1 (token check):** `aud` has two forms. A password sign-in token has `aud: ["authenticated"]` (an array). A refreshed token has `aud: "authenticated"` (a string). The `api` token check must accept both. `jose` `jwtVerify` with `audience` does. A hand check of `claims->>'aud'` or `payload.aud === 'authenticated'` does not.
- **G1 (hook):** the hook runs as `supabase_auth_admin`, which has no BYPASSRLS on the hosted project. It needs `usage` on the schema, `execute` on the hook, `select` on `platform_config`, **and an RLS policy on `platform_config` for `supabase_auth_admin`** (or a `security definer` reader). Without the policy the hook reads no URL. `claims->>'client_id'` is enough; the `coalesce` with `event->>'client_id'` is harmless.
- **Z7 and G (security):** Auth's own `GET /auth/v1/user` answers **200 to the agent token**. So an agent token is a full Auth session of the person at the Auth API, not only at `mcp`. The probe did not try a change (for example `PUT /auth/v1/user` with a new password or email). Z7 must check this. On `madar-test` today, `mailer_secure_email_change_enabled` is `true`, but `security_update_password_require_current_password` and `security_update_password_require_reauthentication` are `false`. Z1 should turn on `security_update_password_require_current_password` in both projects, so an agent token alone cannot set a new password. This setting has a cost for other tracks, and the gate below comes first.
- **The cost of "require current password" (owners: Z1, U, X).** With the setting on, Auth refuses `PUT /auth/v1/user` with a `password` unless the body has `current_password`. Only a session whose AMR is `otp`, `magiclink` or `recovery` is exempt (supabase/auth PR 2497, merged as 2502). The local stack cannot turn this setting on (supabase/cli issue 5846), so no unit, `db` or `it` test can catch a break.
  - **U (PasswordSection):** plan 5.1 calls `signInWithPassword` and then `updateUser({ password })`. With the setting on, that call fails in production. U sends `updateUser({ password, current_password })`. supabase-js 2.117.2 has `UserAttributes.current_password`. The check by `signInWithPassword` can then go, because Auth checks the current password itself.
  - **Welcome (invite `token_hash`):** the session from an invite link may have the AMR `invite`, which is not on the exempt list. Then an invited person cannot set a first password.
  - **Z1 gate:** Z1 turns the setting on only after a probe on `madar-test`, with the setting on, shows three results: (1) the Welcome flow (invite `token_hash`, then `updateUser({ password })`) sets a password; (2) the Reset flow (recovery) sets a password; (3) an agent token gets a refusal on `PUT /auth/v1/user` with a `password` and no `current_password`. If (1) fails, Z1 leaves the setting off and records it, and the Welcome flow needs another way (for example a server call through the Auth admin API, with a one-time check) before the setting goes on.
  - **X (browser checks on the test deployment):** add the same three cases.
- **Z7 and G (consent):** the same result means that an agent token could call the OAuth approval API (`getAuthorizationDetails`, then `approveAuthorization`) for a new DCR client that the agent registers itself. That skips Madar's consent screen and its warning for unknown hosts, and the first MCP call of that client makes a new agent link through `ensureAgentUser`. The probe did not try this. Z7 tries `approveAuthorization` with an agent token (the `oauth-flow` route of `scripts/proof/function/index.ts` has the code). If the call works, G adds a per-client approval: the ConsentScreen records the approval through `api` with the person's browser token before it calls `approveAuthorization`, and `ensureAgentUser` makes an agent link only for a client with a recorded approval. Agent tokens get 403 on `api`, so an agent cannot record one.

### 3. `pg` as `madar_server` through the transaction pooler

- Supavisor accepts the custom role: user `madar_server.<ref>` on `aws-1-eu-central-1.pooler.supabase.com:6543`. `current_user` is `madar_server`. The role owns 0 relations.
- TLS 1.3. The pooler certificate `*.pooler.supabase.com` chains to `Supabase Intermediate 2021 CA` and then `Supabase Root 2021 CA`, a **private** CA (valid until 2031-04-26, SHA-256 `80:70:25:AD:...:CA:FA`). `scripts/proof/supabase-root-2021-ca.crt` holds it.

| Connection | Result |
|---|---|
| `ssl: { ca, rejectUnauthorized: true, servername }`, no `sslmode` (planned, C1) | Connects. `encrypted: true`, `authorized: true` |
| `ssl: { rejectUnauthorized: true }` without the CA | Refused: `self-signed certificate in certificate chain` |
| URL with `sslmode=require` | Refused the same way. `pg` 8 treats `require` as `verify-full` and prints a security warning. This confirms the plan: the CA in `ssl`, no `sslmode` |
| No TLS, enforcement off (the default) | **Connects.** Plain text to the pooler works |
| No TLS, after "Enforce SSL" on (Management API `PUT /ssl-enforcement`) | Refused: `(ESSLREQUIRED) SSL connection is required for user: madar_server` (and for `postgres` on the session pooler) |
| CA, after "Enforce SSL" on | Connects |

**Lock** (`pg_advisory_xact_lock(7310001)`, three connections):

- Connection A takes the lock in a transaction and runs a second statement in the same transaction. The pooler keeps the backend for the whole transaction.
- Connection B, with `set local lock_timeout = '2s'`, fails with `55P03 canceling statement due to lock timeout` after 2.19 s.
- Connection C waits. A commits 1.5 s later; C gets the lock after 1.69 s. While C holds it, `pg_try_advisory_xact_lock` gives `false`; after C commits it gives `true`.

**C1:** copy the CA into the server tree (for example `server/data/supabase-root-2021-ca.crt`) or read it from a secret. **Z1:** turn on SSL enforcement in both projects (done for `madar-test`).

**O3 and C1 (the role password, a security rule):** the hosted projects log DDL text (`log_statement = ddl` on `madar-test`), and the `ALTER ROLE` documentation warns that a cleartext password then reaches the log. So `scripts/deploy/secrets.ts` never sends the plain password in `ALTER ROLE`. It computes the SCRAM-SHA-256 verifier in Node (PBKDF2-SHA-256, 4096 iterations, a random 16-byte salt, the form `SCRAM-SHA-256$4096:<salt>$<StoredKey>:<ServerKey>`) and sends `alter role madar_server with login password '<verifier>'`. Postgres then logs only the verifier. `scripts/proof/lib.ts` has `scramSha256Verifier` and `serverRoleSql`, with a test against the RFC 7677 example and a test that the statement never holds the password. O3 copies them and adds the same "no plain password in the statement" test. Checked on `madar-test` (2026-10-03): a role made with the verifier signed in through the session pooler with the plain password, and a wrong password got `password authentication failed`. The first probe runs sent the cleartext form, so their `madar_server` password may sit in the `madar-test` log. That role is dropped, so the password is dead. The probe now sends the verifier.

### 4. `set local` timeouts through Supavisor

- `set local statement_timeout = '1s'` then `pg_sleep(3)`: `57014 canceling statement due to statement timeout` after 1.18 s.
- `set local lock_timeout = '2s'`: see the lock result above. After the rollback, `lock_timeout` is `0` again. No `set local` value leaks.
- Role defaults: `lock_timeout = 0`, `statement_timeout = 2min`.
- **Caution for C1:** a plain session `SET statement_timeout = '7s'` (without `local`) stayed on the backend, and the next statement saw `7s`. In transaction mode the pooler gives that backend to other clients later, so a plain `SET` can leak into another isolate. Never use a plain `SET` on the pooler. A unit test in `sql.test.ts` that refuses `SET` without `LOCAL` would guard it.

### 5. Realtime rollback by SQL

A person signed in (inside the probe function) and joined the private channel `z0a-probe` (status `SUBSCRIBED`, with a select policy on `realtime.messages` for that topic). Then `madar_server` sent through the transaction pooler.

| Send as `madar_server` | Result |
|---|---|
| No grants | `WARNING WarnSendingBroadcastMessage: permission denied for table messages` |
| `usage` on schema `realtime` + `execute` on `realtime.send` | Same warning |
| + `insert` on `realtime.messages` | `WARNING ... new row violates row-level security policy for table "messages"` |
| + policy `for insert to madar_server with check (true)` on `realtime.messages` | Sent and received |
| `realtime.send` inside a transaction that rolls back | **Never received** |
| `realtime.send` inside a transaction that commits | Received |

**Design changes:**

- **B1 or N1 (grants):** plan 4.1 gives `madar_server` only `execute` on `realtime.send`. It needs four things: `usage on schema realtime`, `execute on function realtime.send(jsonb, text, text, boolean)`, `insert on realtime.messages`, and `create policy ... on realtime.messages for insert to madar_server with check (true)`. Suggested owner: N1, in `20261004000200_platform_realtime.sql`, next to its select policies.
- **N1 (sender):** `realtime.send` catches every error and raises only a `WARNING` (`WarnSendingBroadcastMessage: ...`). The statement succeeds. So the sender must listen to the `pg` `notice` event and count such a warning as a failed signal (log it, and report it to the meter). Without that, a missing grant fails silently. N1 should add a test: a send without the grant gives the warning, and the sender reports it.
- `realtime.send` is `security invoker` and owned by `supabase_realtime_admin`. The daily partitions existed for 3 days ahead.

### 6. Files on Supabase Storage

The probe function signed with the injected secret key, through the raw Storage API, as the server adapter will. A Chromium page on a local origin (`http://127.0.0.1:<port>`) sent the file with `XMLHttpRequest`. The bucket was private with `file_size_limit` 1 MB (to test the refusal cheaply).

| Check | Result |
|---|---|
| `POST /storage/v1/object/upload/sign/<bucket>/up/<intent>` | 200; the link token lives **7200 s**. A body `expiresIn: 600` and a header `x-expires-in: 600` change nothing |
| Browser `PUT` of `File` "مخطط الطابق الأرضي.pdf" (`application/pdf`) | 200. No `apikey` header needed. CORS answer: `access-control-allow-origin: *` |
| `GET /storage/v1/object/info/<bucket>/<key>` | 200 with `size`, `content_type`, `etag`, `version`: the preflight's `HEAD` |
| `POST /storage/v1/object/copy` staging to `prj-z0a/fil-1/1`, then delete staging | 200, 200 |
| A second `PUT` with the same link after the copy | 200: it writes a **new** `up/<intent>` object. The final object keeps its size and `etag` |
| A 2 MB file over the bucket limit | HTTP 400 with body `statusCode "413"`, `code "EntityTooLarge"`. Nothing stored |
| A `.pdf` sent as `image/png` | 200. Storage keeps `content_type: image/png`. The link does not fix the type |
| `POST /storage/v1/object/sign/...` `expiresIn: 600`, then `&download=<encodeURIComponent(name)>` | 200, `Content-Disposition: attachment; filename=<percent-encoded>; filename*=UTF-8''<percent-encoded>` |
| Chromium download of that link | Saved as **"مخطط الطابق الأرضي.pdf"**, exactly |
| The same link without `download` | No `Content-Disposition` (inline), `content-type: application/pdf`, `nosniff`: good for the PDF preview |
| An HTML file from a signed link | Served as `text/plain` with `nosniff` |
| An SVG file from a signed link | Served with `Content-Disposition: attachment` and `Content-Security-Policy: default-src 'none'; sandbox` |
| A download link with `expiresIn: 2`, used after 4 s | 400 `InvalidJWT`, `"exp" claim timestamp check failed` |

**Design changes:**

- **F2 (upload life):** a Storage upload link lives 2 hours and the API does not take a shorter life. A 10-minute limit on `files.upload` would count the transfer time too: a 50 MB file on a slow link, sent from minute 2 to minute 12, would be refused after Storage kept its bytes, and the limit adds almost no security while the link itself works for 2 hours. **Decision:** `upload_intents.expires_at` covers the link life plus the transfer. On Supabase Storage it is the link life (2 hours after `uploadStart`). On R2 it is the 10-minute link plus 60 minutes for the transfer, because R2 only checks that the signed `PUT` starts in time. `files.upload` refuses an intent past `expires_at`. N3's cleanup of `up/` objects older than 2 hours 10 minutes bounds the leftovers in both adapters. The download link keeps the 10-minute life (`expiresIn: 600` works).
- **N3 (uploads step):** a late `PUT` (up to 2 hours) and a second `PUT` after `files.upload` can both leave an `up/<intentId>` object. The job must delete every `up/` object older than 2 hours 10 minutes, also for used intents, not only the objects of unused intents.
- **F2 (checks):** the preflight reads `object/info` and compares `size` and `content_type` with the intent, as planned. Set the bucket `file_size_limit` to 52428800 (50 MB, the free-plan ceiling). The type comparison uses the stored `content_type` in lower case with its parameters removed (`TEXT/HTML; charset=utf-8` becomes `text/html`). If it differs from the intent type, the preflight refuses the call and deletes the object. The download-only list (HTML, SVG, XHTML and every XML type) uses the same comparison.
- **F2 (no upsert, a security rule):** the order "check the staging object, then copy it" is safe only while nobody can replace the staging object between the check and the copy. The probe signed without `x-upsert` (the default is false). Without upsert, Storage should refuse a second `PUT` to a key that exists. The probe did not try that case (its second `PUT` came after the staging object was gone), so F2's test below proves it. F2 signs every upload link without upsert: never the `x-upsert: true` header, never `createSignedUploadUrl(path, { upsert: true })`. F2 adds an `it` test: a second `PUT` to `up/<intentId>` before `files.upload` is refused. The preflight also compares `size` and `content_type` from the copy result (or an `object/info` call on the final key), not only from the staging key. The link does not fix the `Content-Type` (the `.pdf` sent as `image/png` row), so this check is the only type guard.
- **F3 (size refusal):** the browser sends the `PUT` straight to Storage, so only the client sees the size refusal. The server adapter `server/files/supabaseStorage.ts` never receives it. F3 maps it in `src/api/remote/upload.ts`: a `PUT` answer of HTTP 400 whose body has `statusCode "413"` or `code "EntityTooLarge"` becomes `ApiError('file_too_large')` with the limit from `session.get` `limits.maxFileBytes`, so the screen names the limit, not a generic error. F2 keeps the bucket `file_size_limit`.
- **F3:** risk 9 does not happen on Storage: the `download` parameter works with an Arabic name, so `downloadFile` needs no fetch fallback while the adapter is `supabase`. For the exact types `text/html` and `image/svg+xml`, Storage served the file so that it did not run (rows above). The probe did not try `application/xhtml+xml`, `text/xml`, `text/html; charset=utf-8` or `TEXT/HTML`, and Storage serves files from `https://<ref>.supabase.co`, the same origin as `/auth/v1` and `/functions/v1/mcp`. So no track may lean on Storage for this. The server signs HTML, SVG, XHTML and every XML type with `download` only (plan 5.2), with the type comparison of F2 above.
- **O3 (CSP):** while the adapter is `supabase`, the files come from `https://<ref>.supabase.co/storage/v1/...`. `img-src`, `frame-src` and `connect-src` need the Supabase host instead of the R2 host.

### 7. Portability: the Workers path with `wrangler dev`

`scripts/proof/worker/` is a Hono app on `workerd` (`wrangler dev`, wrangler 4.147.0, `nodejs_compat`). It connects as `madar_server` to the transaction pooler.

| Path | Result |
|---|---|
| `pg` straight from `workerd`, `ssl` with the CA | Fails: `Connection terminated unexpectedly` |
| `pg` straight, `ssl: true` / `rejectUnauthorized: false` | Fails the same way |
| `pg` straight, no TLS | Refused: `ESSLREQUIRED` |
| Raw `cloudflare:sockets`: SSLRequest gets `S`, `startTls()`, then a StartupMessage | Fails at the first data: `Network connection lost.` |
| Control: TLS to a public site from the same worker | Works (`HTTP/1.1 200 OK`) |
| **Hyperdrive binding** (local mode), `sslmode=verify-full&sslrootcert=<Supabase root CA>` | **Works**: `madar_server`, `pg_advisory_xact_lock`, `set local lock_timeout` in the transaction |
| Hyperdrive binding, `verify-full` with a wrong (self-signed) CA | Fails, so the local `verify-full` checks the CA |
| Hyperdrive binding, `sslmode=require` | Works |

Cause: the Workers socket TLS trusts only public roots and has no CA option. `pg-cloudflare` passes the `pg` options to `startTls()`, which ignores `ca`. The Supabase pooler certificate chains to a private root, so the handshake fails.

**Design change for E4:** `server/entries/worker.ts` gets its database from a Hyperdrive binding `DB` (`env.DB.connectionString`), not from `DATABASE_URL` with `ssl.ca`. `wrangler.server.toml` declares `[[hyperdrive]] binding = "DB"`. A local run sets `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_DB` to the pooler URL with `sslmode=verify-full&sslrootcert=<path of the CA>` (no password in the file). So C1's `pgDb` must also accept a finished connection string with no `ca` for this entry. A real Workers deploy (only if the fallback is ever needed) uploads the CA with `wrangler cert upload certificate-authority` and makes a Hyperdrive config with `verify-full`, that CA, and caching off. That deploy was not run: it changes the Cloudflare account, and section 2b asks for a local proof only.

Seen once, cause not proven: right after a probe set the `madar_server` password again, the pooler refused one connection with "Authentication credentials are invalid. Please reconnect with fresh credentials to restore pool functionality." The next run passed. `scripts/deploy/secrets.ts` (O3) should retry for up to a minute after it sets that password.

### 8. `SB_REGION` with `forceFunctionRegion`

| Call from the Mac (Al Khobar) | `SB_REGION` | `x-sb-edge-region` |
|---|---|---|
| `.../functions/v1/z0a-probe/region?forceFunctionRegion=eu-central-1` | `eu-central-1` | `eu-central-1` |
| The same URL without the parameter | `eu-central-2` (Zurich) | `eu-central-2` |

The parameter works, and it is necessary: without it, a call from Saudi Arabia runs in Zurich. R1 adds it to every URL (plan 4.10).

### 9. Resend

Pending the owner address. Resend sends only to the account owner's address until a domain exists, and the owner has not confirmed that address yet.

### 10. R2

Waits until the owner turns on R2 (plan 2b, point 1). Section 6 covers the files on Supabase Storage now. `scripts/storage/move-to-r2.ts` and the R2 smoke run when R2 is on.

## N1.0 Realtime rollback spike (local stack)

**Result: PASS.** A `realtime.send` inside a transaction that rolls back sends nothing. A `realtime.send` inside a transaction that commits arrives once on a private channel. The design of plan section 5.3 (send from SQL inside the save transaction) stands. No design change.

**Where and when.** 2026-10-03, branch `rb/N1`, local stack from `supabase start -x edge-runtime` (until track E merges; see fact 7) (CLI 2.119.0, image `supabase/realtime:v2.140.3`, `supabase/postgres:17.11.0.002`), after `supabase db reset`, under the Docker lock (holder `N1.0`). Rerun after the review fixes under the lock holder `N1-repair`, with the same images; the output below is that rerun.

**Script.** `scripts/proof/realtime-rollback.ts`, run with `npx tsx scripts/proof/realtime-rollback.ts`. Its verdict step `judge()` has 15 unit tests in `scripts/proof/realtime-rollback.test.ts` (in `npm test`). The script:

1. Creates two confirmed people through the Auth admin API: a member and a stranger.
2. Adds a select policy on `realtime.messages` for the run's own topic, for `extension = 'broadcast'`, and only for the member (`auth.uid()`). No insert policy. This is the shape of the section 5.3 policies.
3. Signs the member in, calls `realtime.setAuth(token)`, and joins the topic with `{ private: true }`.
4. Sends four marks from `pg` as `postgres`, each in its own transaction, in this order: commit, rollback, an error (`select 1 / 0`) that forces the rollback, commit. The last commit proves that the listener was still alive after the two rollbacks. Inside each transaction, before its end, it counts the row of the mark in `realtime.messages`. `realtime.send` turns a failed insert into a warning (fact 1), so this count proves that each send worked, also the sends that rolled back.
5. Waits 4 seconds, then counts the arrivals of each mark and the rows of each mark in `realtime.messages`.
6. Removes the policy, the two people and the channels.

**Output of the run** (the run id is random):

```
member join on the private channel n1-spike-b914fd71: joined
join with no session on the same private channel: refused (Unauthorized: You do not have permissions to read from this Channel topic: n1-spike-b914fd71)
join of a signed-in person whom the policy does not name: refused (Unauthorized: You do not have permissions to read from this Channel topic: n1-spike-b914fd71)
received in order: b914fd71-commit-1, b914fd71-commit-2
ok: the send of mark b914fd71-commit-1 inserted 1 row(s) before its commit or rollback; expected 1.
ok: the send of mark b914fd71-commit-2 inserted 1 row(s) before its commit or rollback; expected 1.
ok: the send of mark b914fd71-rollback inserted 1 row(s) before its commit or rollback; expected 1.
ok: the send of mark b914fd71-error inserted 1 row(s) before its commit or rollback; expected 1.
ok: committed mark b914fd71-commit-1 arrived 1 time(s) on the channel; expected 1.
ok: committed mark b914fd71-commit-2 arrived 1 time(s) on the channel; expected 1.
ok: rolled-back mark b914fd71-rollback arrived 0 time(s) on the channel; expected 0.
ok: rolled-back mark b914fd71-error arrived 0 time(s) on the channel; expected 0.
ok: committed mark b914fd71-commit-1 has 1 row(s) in realtime.messages; expected 1.
ok: committed mark b914fd71-commit-2 has 1 row(s) in realtime.messages; expected 1.
ok: rolled-back mark b914fd71-rollback has 0 row(s) in realtime.messages; expected 0.
ok: rolled-back mark b914fd71-error has 0 row(s) in realtime.messages; expected 0.
ok: a client with no session could not join the private channel (server: Unauthorized: You do not have permissions to read from this Channel topic: n1-spike-b914fd71).
ok: a signed-in person whom the policy does not name could not join the private channel (server: Unauthorized: You do not have permissions to read from this Channel topic: n1-spike-b914fd71).
PASS
```

The two refusals are the control. `judge()` counts a refusal only when the server reason is an authorization refusal (`Unauthorized` or `permission`), so a socket drop or a bad token cannot pass for the policy. They show that the policy, not chance, lets the member join. So the member's arrivals are a valid measure.

**Facts for N1.1 and R2** (read from the local stack, `realtime.send` source and `pg_inherits`):

1. `realtime.send` wraps its insert in `BEGIN ... EXCEPTION WHEN OTHERS THEN RAISE WARNING 'WarnSendingBroadcastMessage: %'`. A failed send never fails the save transaction; it gives only a warning. This confirms risk 12 of section 9. The sender in N1.1 should read the Postgres notices (or check the inserted row) if it must count failed sends.
2. The exception block makes a subtransaction for each call. One save sends 1 office signal plus 1 signal per person channel, so the cost stays small.
3. `realtime.send` keeps a payload `id` when the payload has one, and adds a random one when it has none. Madar's signal carries its own `id` (change 13), so the client can drop a signal it already applied by that `id`.
4. `realtime.send` runs `SET LOCAL realtime.topic` for the rest of the transaction. This has no effect on the Madar tables.
5. The Realtime service made the daily partitions of `realtime.messages` ahead of time (2026-10-02 to 2026-10-06 on 2026-10-03 UTC), before any client joined. A send with no listener stored its row. On the hosted project, Z0a checks the same thing (PF 4.1 says a WebSocket client makes the partition).
6. `config.toml` turns the Data API off, so `supabase status -o env` prints no `API_URL`. Kong still serves Auth and Realtime at `http://127.0.0.1:54321`. The script falls back to that address. The D and it harnesses need the same fallback.
7. `supabase start` stops with `failed to read file: open supabase/functions/api/index.ts` until track E writes the function entries, because `config.toml` declares `[functions.api|mcp|jobs]`. Until E merges, start the stack with `supabase start -x edge-runtime`.

**Not covered here.** The hosted project (`madar-test`) runs the same check by SQL in Z0a. The `office` and `person:<id>` policies with `madar_private.current_madar_user_id()` come in N1.1, after B and C3.

## C1. Diff writer, whole read and write, and `pgDb` on both hosts (2026-10-04)

**Result: PASS.** The save step and `pgDb` work on the local stack as `madar_server`, and the Workers entry runs `deps.db` through the Hyperdrive binding `DB` on `wrangler dev`: requests in a row and at the same time all answer 200.

**What ran.** Local stack of Supabase CLI 2.119.0 (Postgres 17, Supavisor transaction pooler on `127.0.0.1:54329`), reset from the `rb/C` worktree under the Docker lock. Wrangler 4.147.0 (`workerd`, `nodejs_compat`), local Hyperdrive mode with `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_DB` set to the local pooler. `npm run test:it`: 5 files, 55 of 55 pass.

| Check | Suite | Result |
|---|---|---|
| The B2 round trip on the real `writeState` and `loadWhole` | `server/data/schema.test.ts` | Pass: the sample office comes back exactly, with `undoneBy` filled from the undo event |
| The same round trip as `madar_server` through `pgDb` | `server/it/save.it.test.ts` | Pass |
| An update keeps `ord`; a new row goes last; a row that comes back after a delete gets a new `ord` | same | Pass |
| An office change raises `office_meta.version` once, sets `chg`, records `office_deletes`; a task change does not raise it | same | Pass |
| The office signal takes the next `office_seq`; a read mark raises only that person's `person_seq` and no office number | same | Pass |
| A save that changes an old event fails, and nothing of it is written | same | Pass |
| A task of a missing project fails inside the save (`set constraints all immediate`) | same | Pass |
| A comment whose target the call did not load gets its `project_id` from one lookup query | same | Pass |
| A write has `lock_timeout 5s` and `statement_timeout 10s`; a read only the statement timeout; a read is read only | same | Pass |
| A second transaction gives up on a held lock after 5 s with `55P03` | same | Pass (the test allows 4.5 to 9 s) |
| `deps.db` on `wrangler dev` through the binding, 3 requests in a row, as `madar_server` | `server/it/workerdb.it.test.ts` | 200, 200, 200: lock held, `5s` and `10s`, one statement |
| The same, 3 requests at the same time | same | 200 on each |
| The E4 smoke on both hosts, with the Worker on the binding | `server/it/worker.it.test.ts` | 12 of 12 (the health check of the Worker connects through Hyperdrive) |

**Design as built (from Z0a, items 3, 4 and 7).**

- TLS: `pgDb({ writeUrl, readUrl, ca })` passes `ssl: { ca, rejectUnauthorized: true, servername }`. It refuses a URL with `sslmode`, and a host that is not local without `ca`. The CA comes from the secret `DATABASE_CA` (the PEM text of `scripts/proof/supabase-root-2021-ca.crt`); no copy goes into the server tree, so a new root needs only a new secret.
- Every query refuses a plain `SET` or `RESET` and transaction control. Only `set local` and `set constraints` go through.
- `pgDb({ connectionString })` takes a finished string as it is, for both pools. `server/entries/worker.ts` uses it with `env.DB.connectionString`. The apps and the health route connect through the binding too. Without the binding the Worker uses `DATABASE_URL` (a local pooler without TLS only). `wrangler.server.toml` declares `[[hyperdrive]] binding = "DB"` with a placeholder id.

**Facts found on the way.**

1. The local pooler takes the server role: user `madar_server.pooler-dev` connects with `current_user = madar_server` (the user `madar_server` without the tenant gets `ENOIDENTIFIER`). This adds to E1, fact 2: a local test of the server role can go through the pooler. Supavisor drops startup options, so a test that needs its own schema (`search_path`) connects to Postgres directly.
2. The first run of the parallel case, with the user `postgres.pooler-dev`, gave 200, 500, 500 in 108 ms. The probe had no error text then. It did not happen again in 4 later runs, 32 parallel requests as `madar_server` and 15 as `postgres.pooler-dev`. Cause not proven. The probe now answers a failure with its message, so a repeat names its cause.
3. A local `wrangler dev` with `[[hyperdrive]]` needs `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_DB`, so `npm run start:server` and every local Worker run must set it.

**Re-run.** Take the Docker lock, `supabase db reset` from the worktree, then `npm run test:it`.

## P1. Token check and invitations on the local stack (2026-10-04)

**Result: PASS.** An invitation works with open sign-up off. Every token of the invited person passes `verifyBrowserToken`. The link type for a second invitation depends on one fact: did the person accept the first one.

**What ran.** Local stack of Supabase CLI 2.119.0 (Auth `gotrue:v2.197.0`, `enable_signup = false`), reset from the `rb/P` worktree under the Docker lock. `server/it/tokens.it.test.ts`: 8 of 8 pass. `server/auth/verify.test.ts` and `principal.test.ts` (unit, real ES256 keys): 18 of 18 pass. The bundle smoke on both hosts, `server/it/worker.it.test.ts`, still passes (12 of 12) with jose in the bundle.

### Token check (`server/auth/verify.ts`)

| Check | Result |
|---|---|
| Signing key of the local stack | ES256, one key in `/auth/v1/.well-known/jwks.json`. Issuer `http://127.0.0.1:54321/auth/v1`. |
| Token of the Welcome session, of a password sign-in, of a refresh | Pass, `authUserId` = the `auth.users` id |
| Form of `aud` on the local stack | The string `"authenticated"` after a password sign-in and after a refresh. The hosted Auth gives an array after a password sign-in (Z0a, item 2). The local stack cannot show the array form, so the unit test signs both forms. |
| The legacy `ANON_KEY` and `SERVICE_ROLE_KEY` (HS256 JWTs) and the `sb_publishable_` key as a bearer token | Refused, `unauthenticated` |

**Design (apply Z0a item 2, design change P1).** The check is `jwtVerify` of jose with `issuer`, `audience: 'authenticated'` and `algorithms: ['ES256']`, never a hand comparison of `aud`. The answers:

- A bad, expired or foreign token: `unauthenticated` (401). An expired token has `details.reason: 'token_expired'`.
- Any token with `client_id`: `forbidden` (403) with `details.reason: 'agent_token'` (plan section 2, change 6). This also holds when the token hook set `aud` to the MCP address: jose checks the signature before the claims, so the payload of the audience error is a signed payload.
- `role` must be `authenticated`, and `sub` must be a text that is not empty.
- A key set that cannot load: a plain `Error` that names the jose code or the cause. The batch route logs it and answers the hidden `failed` (500), so a JWKS outage never signs a person out and the operator sees why.
- The JWKS comes from `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`. The issuer is `${SUPABASE_URL}/auth/v1`, or `AUTH_ISSUER` when set. A local function sees `SUPABASE_URL=http://kong:8000`, but its tokens name `http://127.0.0.1:54321/auth/v1`, so a local `supabase functions serve` run with real tokens must set `AUTH_ISSUER`. Production leaves it unset.
- `principalOf` gives the `users` row linked by `auth_user_id`, or `unauthenticated` (401) when no row has the link. It also runs `resolveActor` before any call: a turned-off person, or a link to a `users` row that is gone, gets the whole-request `unauthenticated` with `details.reason: 'account_off'` (HTTP 403, plan 4.10), and a link to an agent row gets `forbidden` (403). No call runs, so no transaction opens and no office lock is taken. `runCall` checks the actor again on every call.

### Invitations with sign-up off

| Step | Result |
|---|---|
| `POST /auth/v1/signup` with the publishable key | 422 `signup_disabled` |
| `POST /auth/v1/admin/generate_link { type: 'invite' }` | 200. It makes the Auth user and gives `hashed_token`. The `sb_secret_` key and the service-role JWT both work. |
| `POST /auth/v1/verify { type: 'invite', token_hash }` (the Welcome button) | 200, a session. Its AMR is `otp`. |
| `PUT /auth/v1/user { password }` with that session | 200. The person then signs in with the password. |
| The same link a second time | 403 `otp_expired` |

### Which link type works for a second invitation

| State of the person | `invite` | `recovery` |
|---|---|---|
| Did not accept yet | 200, the same Auth user. The first invite link fails after it (403 `otp_expired`). | 200. Its use sets the password and confirms the email. |
| Accepted (password set) | 422 `email_exists` | 200. Its use gives a session (AMR `otp`) that sets a new password. |

Two more facts:

- The first link that a person uses makes every other open link of that person fail (403 `otp_expired`), whatever its type.
- A `recovery` link made after an `invite` link does not stop the `invite` link before one of them is used. Only a new `invite` link replaces the old `invite` link at once.

**For P2 (`users.resendInvite`).** Send `invite` while the Auth user has no `email_confirmed_at`, so the old link fails at once (the `invites.it` case "an old link fails"). Send `recovery` after the person accepted. When `invite` answers 422 `email_exists`, use `recovery`. The mail link carries the type of the link that the server made (`type=invite` or `type=recovery`), because the screen sends that type to `verifyOtp`.

**For the Z1 gate ("require current password").** On the local Auth, the sessions from an invite link and from a recovery link both have the AMR `otp`, which is on the exempt list. The hosted Auth may differ. The Z1 probe on `madar-test` still decides.

**Other facts found.** A reset to the same password gets 422 `same_password`. In an exploratory probe (not in the suite), `generate_link { type: 'magiclink' }` for an unknown address made a new Auth user with sign-up off: the admin API ignores `enable_signup`. So the server must call `generate_link` only for an address that a `users` row holds.

**Re-run.** Take the Docker lock, `supabase db reset` from the worktree, then `MADAR_IT=1 npx vitest run --project it server/it/tokens.it.test.ts`.

## P2 and P3. Invitations, reset mail, Auth effects and the first Admin on the local stack (2026-10-04)

**Re-run.** Take the Docker lock, `supabase db reset` from the worktree, then `MADAR_IT=1 npx vitest run --project it scripts/first-admin.test.ts server/it/auth.it.test.ts server/it/invites.it.test.ts`. All 19 tests pass (local Auth v2.197.0; rerun after the P2 review fixes). Mail goes to the fake mail port; every link of a mail goes to the real local Auth.

| Case | Result |
|---|---|
| `users.create` by the Admin | One `auth.invite` outbox row in the call's transaction. After the commit: an `invite` link, `users.auth_user_id` written with `setAuthUserId` (a warm office cache finds the person by the link), the mail with `/welcome?token_hash=...&type=invite`. |
| The person uses the link and sets a password | Sign-in works; `verifyBrowserToken` and `principalOf` give the new person; `users.invites` turns from `invited` (with `sentAt`) to `active`. |
| `users.resendInvite` | A new `invite` link; the old link answers 403 `otp_expired`; the new link works. |
| A retried `auth.invite` after a failed send | The retry keeps the token hash of the first link (outbox payload), and that link works. The sent row then holds no token hash (`sentAt`, `mailId` and `linkType` stay). |
| A retried older `auth.invite` after `users.resendInvite` made a newer link | The retry sends nothing (its stored link is dead: 403); the newer link works. |
| An email change before the person accepts (`auth.email`) | Auth gets the new email alone (no `email_confirm`), so the person stays unconfirmed: the new mail has an `invite` link, `users.invites` still says `invited`, and the link at the old email fails (403). With `email_confirm: true` Auth confirmed the person, and the next invite link answered 422 `email_exists`. |
| A name change (`users.update` with no email) | No `auth.email` row: the producer reads the `user.updated` event that the save just wrote. |
| An email change after the person accepted | Auth gets the new email, confirmed; a notice goes to the OLD email (no link); sign-in with the new email works; `users.invites` says `active`. |
| `users.deactivate`, then `users.reactivate` | The old token gets 403 `account_off` at once. Auth bans the person: a password sign-in answers 400 `user_banned`. After the reactivation, sign-in works again. |
| A Member token, then a role change by the Admin | The same token is refused (`forbidden`) on `users.invites`, then accepted: the role comes from `users`. |
| `POST /api/auth/forgot` | The same 200 answer for a person and an unknown email; the reset mail in the person's language with `/reset?...&type=recovery`, which sets a new password; 429 after 3 an hour for one email; `rate_limits` holds no email. |
| Arabic person (`language: 'ar'`, `gender: 'female'`) | The invitation and the reset mail in Arabic, `dir="rtl"`, with the feminine forms. |
| `scripts/first-admin.ts --env local` run twice (the command line, through `tsx`) | The first run makes `usr_001` (Admin, the given language and gender), `counters.usr = 1`, the `user.created` event and story, and the sign-in link; the Admin signs in. The second run refuses ("An Admin exists") and makes no Auth user. |

**Design notes for the merge.**

- The effects read the person again when they run, so a late retry never undoes a newer change (a ban does nothing for a person who is on again).
- An email change needs to know whether the person accepted, and `users.invites` needs the state of every person. Both read Auth (`getUser`, `listUsers`), which `AuthAdminPort` does not have yet: the merge lead patch of P2 adds them.
- The forgot route takes the network address from `cf-connecting-ip` only, on both hosts, and never from `x-forwarded-for` or `true-client-ip`; with no `cf-connecting-ip` (local runs only) the address is `unknown`. (Corrected on 2026-10-04 after the S1 header probe, section "Z0b. The client address of a request" below. The P2 text said "else the first `x-forwarded-for` entry", and kept an office limit `forgot:all`.) The limits are 3 reset requests in one window for each email (1 hour, no longer than the life of a reset link) and 10 an hour for each address, and the reset mail counts against the daily mail quota (`sendCounted`). There is no office-wide limit: S1 removed `forgot:all` and `forgot:day`, because they let one outsider who knows a few staff emails use up the reset mail of the whole office.
- The auth.email effect notes what it owes in the payload (`owesInvite`, or `notifyOld`) before it changes Auth, so a retry after a failed link or mail still sends it.
- Track M: `failedEffects` of `usage.get` returns the kind, the attempts and the error of a row, never its payload. An unsent invitation row holds a live token hash and a live renew key.
- The forgot route answers after the work (padded to 1.5 s). A slow Auth or Resend still makes the answer for a real account slower. Moving the work after the answer needs `after` (waitUntil) in the route handlers and a database that stays open after the answer on Workers; that is a host change for track E, not done here.

## G1. The token hook and the agent token (local stack, 2026-10-03)

**Result: pass.** Supabase Auth accepts a changed `aud`. The fallback of risk 4 (section 9 of the plan) is not needed.

**Where:** the local stack of Supabase CLI 2.119.0, Auth (GoTrue) v2.197.0, after `supabase db reset` from the `rb/G` worktree, with the migration `supabase/migrations/20261004000400_platform_auth_hook.sql`. The test is `server/it/hook.it.test.ts` (run with `MADAR_IT=1 npx vitest run --project it server/it/hook.it.test.ts`): 8 tests, 8 passed (6 at first, plus 2 probes of the G repair). Without the migration the same test fails (red run first).

**How:** the test runs the full OAuth 2.1 flow of an MCP client against the local Auth server: dynamic client registration (`POST /auth/v1/oauth/clients/register`, a public client with PKCE), `GET /auth/v1/oauth/authorize` (302 to `/oauth/consent?authorization_id=...`), the consent approval through the Auth API as the consent screen does it (`getAuthorizationDetails`, `approveAuthorization`), the code exchange with `code_verifier` at `/auth/v1/oauth/token`, and a refresh at the same endpoint.

| Check of platform facts 6.8 | Result |
|---|---|
| (a) The hook sees `client_id` | Yes, in `event.claims.client_id`, at the first token and at a refresh. The top level of the event has only `authentication_method`, `claims`, `metadata`, `user_id` (no `client_id`). `authentication_method` is `oauth_provider/authorization_code` at the first token and `token_refresh` at a refresh. The claims also carry `scope` (`email` here) and `session_id`. |
| The hook reads `platform_config.mcp_url` | Yes. A change of the row changes the `aud` of the next token, so each project gets its own value. |
| (b) Auth accepts the changed `aud` | Yes. Auth issues the token, signs it (ES256 on the local stack), and the token passes `jose` `jwtVerify` with the JWKS of `/auth/v1/.well-known/jwks.json`, `audience` = the MCP URL and `issuer` = `<api>/auth/v1`. The same token fails a check with `audience: 'authenticated'`. Auth's own `GET /auth/v1/user` answers the agent token with 200 and the person. This is not only a pass: Auth treats an agent token as a full session of the person (next row; Z0a, item 2; the Z7 password-change check). |
| Auth's own endpoints with an agent token (G repair probe) | The agent token has the full rights of the person there. `PUT /auth/v1/user {password}` gives 200, and the person then signs in to the Madar screens with the new password. `GET /auth/v1/user/oauth/grants` gives 200 and lists the grants of other agents. `DELETE /auth/v1/user/oauth/grants?client_id=<another agent>` gives 204, and the other agent's next refresh gets 400. Auth has no `client_id` or `aud` check on these routes (it uses only `requireAuthentication` for `/user`, `/user/oauth/grants`, `/logout` and `/factors`), and `config.toml` has `secure_password_change = false`. |
| (c) A refresh keeps the new `aud` | Yes. The refreshed token has `aud` = the MCP URL, the same `client_id` and the same `session_id`. |
| A browser token | Unchanged: `aud` is `["authenticated"]` (a list) at sign-in and there is no `client_id`. A refreshed browser token carries the string `"authenticated"` (G repair probe; Z0a, item 2 found the same on `madar-test`). |
| No `mcp_url` row | Auth refuses the agent token: the code exchange gets 500 with the hook's message "Madar has no MCP URL in platform_config, so it cannot issue a token for an agent." A person still signs in. So an agent token never goes out with `aud` "authenticated". |

**Decisions in the migration:**

- The hook is `security definer` with `search_path = ''`, so a row level policy on `platform_config` (track B turns RLS on for every table) can never hide the URL from Auth. It still grants `select` on `platform_config` to `supabase_auth_admin`, as section 4.2 says.
- The migration has `create table if not exists public.platform_config (key text primary key, value text not null)`, so the hook works on a stack with no B migration. B's migration runs first after the merge (0100 before 0400), and then this statement does nothing. B keeps the table definition.
- The migration holds no URL. `scripts/deploy/secrets.ts` (track O) writes `platform_config.mcp_url` for each project.

**Facts for track G3 (`server/mcp/auth.ts`) and track E (the `api` token check):**

- `aud` comes as a string on an agent token, as a list on a browser token at sign-in, and as a string on a refreshed browser token. So the form of `aud` never tells the two token kinds apart: only `client_id` does. Never test `Array.isArray(aud)`. The checks use `jose` with an `audience` option, which accepts both forms. A hand-written check must accept both too.
- `client_id` is a claim of every agent token, also after a refresh. The `api` function refuses any token with it.
- The local issuer is `http://127.0.0.1:54321/auth/v1`; the cloud issuer is `https://<ref>.supabase.co/auth/v1` (platform facts 6.2).
- Supabase Auth gives an agent token the full rights of the person on its own endpoints (`/user`, `/user/oauth/grants`, `/logout`, `/factors`). It has no `client_id` check there. So an agent can change the person's password or email outside the `mcp` function and the 36-tool allowlist, then sign in to the screens as that person (an Admin too). Removing the agent in Settings, Agents revokes the grant but does not undo the new password.
- An agent token keeps `role` `authenticated` and `sub` = the person. So a Realtime policy on `realtime.messages` (N1) lets it join the office and person channels unless the policy checks `client_id`.
- Z0a repeats this check on `madar-test`, with the cloud URL in `platform_config`.

**Mitigations (G repair; each owner track does its own):**

1. `supabase/config.toml` (T0, merge lead patch): `secure_password_change = true`. A password change then needs a sign-in in the last 24 hours. This only narrows the gap: an agent session is new at consent, so the agent passes the check on its first day. The stronger fix is Z0a's (rb/Z proof, Z7 and G bullet): Z1 turns on `security_update_password_require_current_password` in both cloud projects, so an agent token alone cannot set a new password. The local stack cannot turn it on, so no local test proves it.
2. N1: every policy on `realtime.messages` adds `and (auth.jwt()->>'client_id') is null`.
3. G4: the consent screen says in plain words that the agent can act as the person's account.

**For the security review (Z7), risk 4 of the plan, an owner decision:** the remaining gap is that an approved agent can take over its person's account through Auth's own endpoints, with no Madar code in the path. Options: refuse agent tokens for Admin people in the hook (the hook can raise for `client_id` plus an Admin row), or accept the risk and say it on the consent screen. Default until the owner decides: mitigations 1 to 3 only.

## G3. The MCP server on the local stack (2026-10-04)

**Result: pass.** An MCP client gets a token through the real OAuth 2.1 flow of the local Auth server, and the MCP app serves it on Node (in process) and on Deno (`supabase functions serve mcp`). Supabase CLI 2.119.0, Auth v2.197.0, edge runtime 1.77.1, after `supabase db reset` from the `rb/G` worktree.

**Re-run.** Take the Docker lock, `supabase db reset`, then `MADAR_IT=1 npx vitest run --project it server/it/mcp.it.test.ts server/it/hook.it.test.ts` (16 of 16 pass) and `npx tsx server/mcp/conformance.ts` (the second half of `npm run test:mcp`).

| Check | Result |
|---|---|
| DCR, authorize with PKCE, the approval through the Auth API, the code exchange; the first call | 200. The first call makes the agent user (`kind: agent`, owner = the person, the app name, `<id>@agents.madar.invalid`), its `agent_links` row and the `user.created` event with the person as actor. |
| The same app registered again by the same person | Supabase makes a new `client_id`; Madar links it to the same agent user. |
| A browser token on `mcp` | 401 with `WWW-Authenticate: Bearer resource_metadata=".../mcp/oauth-protected-resource", error="invalid_token"` (aud check). |
| An agent token on `api` | 403 `forbidden`, `agent_token` (P's check holds; proof.md Z0a item 2). |
| A write by the agent | The event names the agent (`actorKind: agent`) and its person (`actingForId`); the person undoes it through `api`. |
| A removed link (`agent_links.revoked_at`) | The next call gets 401 at once. Auth remembers the consent and gives the same client a new token at once; Madar still refuses it (401) and keeps the link removed (security review of G3: a new session is no new approval; G4 adds the approval the person records in Madar). |
| A client with the same name and first redirect host, plus one more redirect address | A new agent user: an agent user is reused only for the same whole set of redirect addresses (security review of G3). |
| The person turned off (`users.deactivate`) | `agents.revokeAll` removes the links in the same request's effects; the agent is refused; after `users.reactivate` the old token stays refused (401). A retry of the effect by the job after the person is on again still removes the links (the statement never asks whether the person is still off). |
| 61 tool calls in one minute for one person, over two clients | The 61st counts 61 and is refused; `last_used_at` is set in the same statement. A 2025-era batch with more than one `tools/call` gets 400 (-32600) before the limit, so one request is never more than one tool call (in process, `server/mcp/app.test.ts`). |

**Facts found:**

- A client that the person approved before needs no new approval: `getAuthorizationDetails` gives `redirect_url` at once, and `approveAuthorization` then fails with "authorization request is no longer pending" (platform facts 6.3, step 3). G4's consent screen must take that path.
- Auth keeps `auth.oauth_clients.redirect_uris` as one text, the addresses separated by commas. `auth.sessions.oauth_client_id` names the client of an agent session. `madar_private.agent_client` and `madar_private.agent_session_at` (`20261004000401_platform_agents.sql`) read them as their owner, for `madar_server` only.
- On Supabase, `postgres` is no superuser and may not take the role `madar_server` (`permission denied to set role`). The local `supabase_admin` may, so the public-schema suites run as `madar_server` through the startup option `-c role=madar_server` and never change the role's login.
- **Deno did not boot the mcp bundle** until the bundle lost its JSDoc comments: the Deno module graph reads a JSDoc `@param {import('../types/index').X}` in a JS file (a URI library under the SDK's Ajv) as a module and fails with "Module not found ... supabase/functions/types/index". The merge lead patch of G3 for `vite.server.config.ts` sets `output.comments: { legal: true, annotation: true, jsdoc: false }`. With it, `server/it/worker.it.test.ts` passes 12 of 12 (both hosts answer `/mcp` with the same 401).

**Conformance (`@modelcontextprotocol/conformance` 0.1.16).** The runner covers the 2025-era protocol only and cannot send a token. `server/mcp/conformance.ts` gets an agent token through the OAuth flow, serves the mcp function, puts a proxy that adds the token in front, and runs each server scenario on its own with a 45-second limit (the runner has none, and a fixture scenario never ends). 5 of 32 pass: `server-initialize`, `ping`, `tools-list`, `server-sse-polling`, `server-sse-multiple-streams`. The other 27 need the runner's fixture tools, prompts or resources, or (`dns-rebinding-protection`) expect a localhost Origin to pass; `server/mcp/conformance-baseline.yml` lists each with its reason, and a new failure or a stale entry fails the run. The 2026-07-28 points are in `server/mcp/app.test.ts` (34 tests, in process): each point of platform facts 7.2 that the SDK or Madar does has a test there, among them 3 (a notification gets 202 with no body), 6 (no `Mcp-Method`, or no `Mcp-Name` on `tools/call`: 400, -32020), 8 (an unknown method: 404, -32601), 10 (no protocolVersion or clientCapabilities in `_meta`: 400, -32602), 11 (an unsupported version: 400, -32022, `data.supported`), 12 (Madar never sends a request that needs an undeclared capability: a client with only URL elicitation gets the retry instruction, never -32021) and 27 (a valid token in the query string gets 401 with `WWW-Authenticate`).

## G4. The approval in Madar, the consent screen and Settings, Agents (local stack, 2026-10-04)

**Result: the gap of Z0a item 2 ("Z7 and G (consent)") is real, and G4 closes it.** An agent token can approve, at Auth, a new OAuth client that the agent registered itself. So Madar now links a client only when the person recorded an approval in Madar, and only a browser token can record one.

**Where:** the local stack of Supabase CLI 2.119.0, Auth v2.197.0, after `supabase db reset` from the `rb/G` worktree, with `supabase/migrations/20261004000402_platform_agent_approvals.sql`.
**Re-run:** take the Docker lock, `supabase db reset`, then `MADAR_IT=1 npx vitest run --project it server/it/consent.it.test.ts server/it/mcp.it.test.ts server/it/hook.it.test.ts` (22 of 22 pass: 5 in `consent.it.test.ts`, 9 in `mcp.it.test.ts`, 8 in `hook.it.test.ts`). After the review fixes of G4, `consent.it.test.ts` has 6 tests; the run of `consent.it.test.ts` with `mcp.it.test.ts` passes 15 of 15.

### The probe (the `oauth-flow` steps of `scripts/proof/function/index.ts`, with an agent token)

| Step | Result |
|---|---|
| The person connects app A (DCR, authorize with PKCE, consent, code exchange) | An agent token with `client_id` = A. |
| The agent registers client B (`https://evil.example/callback`) and starts the authorize step | 302 to `/oauth/consent?authorization_id=...`; the row in `auth.oauth_authorizations` is `pending` with no `user_id`. |
| `GET /auth/v1/oauth/authorizations/{id}` with the agent token | 200 with the client and the person. Auth writes the person into `user_id`. |
| `POST /auth/v1/oauth/authorizations/{id}/consent {action: approve}` with the agent token | **200 with a `redirect_url` and a code.** The row becomes `approved`. |
| The code exchange for B | 200. A token for B, `aud` = the MCP URL. |
| The person's `GET /auth/v1/user/oauth/grants` | Lists A and B. Auth cannot tell the two consents apart. |
| Before G4: the first MCP call with B's token | `ensureAgentUser` would make a new agent link for B: Madar's consent screen and its warning were skipped. |

### The design as built

- **`agent_approvals`** (`client_id`, `owner_user_id`, `approved_at`), RLS on, `select` and `insert` for `madar_server` only. **`madar_private.agent_authorization(authorization_id, auth_user_id)`** gives the client of a `pending`, unexpired authorization of that Auth user, else null; only `madar_server` may run it.
- **`POST /agents/approve`** on the api function (`server/mcp/approval.ts`): the browser token check (an agent token gets 403 `agent_token`), the person through `principalOf` (a turned-off person gets 403 `account_off`), and the client read from Auth's pending authorization, never from the browser. An answered, expired or foreign authorization gets 400 `authorization_ended`.
- **The consent screen** calls `getAuthorizationDetails`, then `POST /agents/approve`, and only then `approveAuthorization`. When Madar refuses, Auth is never asked. Deny records nothing. A client that Auth already knows gets its redirect at once, and the screen records nothing for it.
- **The return address** (security review of G4, main's TASKS.md): an AI app registers its own redirect addresses, so the screen leaves only for a safe one (`safeRedirect` in `src/features/oauth/knownHosts.ts`: https, http on loopback, an app scheme; never `javascript:`, `data:`, `vbscript:`, `blob:`, `file:`, `filesystem:`, `about:`), and after Approve or Deny only for the request's own address. A request with an unsafe address gets the plain error and no Approve.
- **`ensureAgentUser`** links a client only with an approval of the same person; else 403 with the reason `agent_not_approved` and no link, no agent user, no event.
- **Settings, Agents** lists the active agents (`agents.list`) and every grant of Auth whose client no active agent has, with "Has access to your account, but you did not approve it in Madar". So a self-approved client shows, and Remove revokes it at Auth.
- **Remove** calls `agents.remove` first (every live link removed, the agent user off with `user.deactivated` by the person), then `revokeGrant` for each client. When a revoke fails, the agent stays off and one Retry revokes what is left.
- **A grant that is already gone** (review of G4): Auth answers a revoke of a client with no active grant with 404 `oauth_consent_not_found` (checked on the local stack). The port takes that answer as done, so a lost answer, a second tab or an agent token that revoked the grant (G1) never leaves a Retry that cannot finish. A failed list of grants shows the load error with Retry, never "No AI app is connected".
- **A removed app that connects again with its cached client** (review of G4): Auth asks again (the grant is gone), and `POST /agents/approve` refuses with 403 `agent_removed` ("You removed this AI app in Madar. In the AI app, remove the Madar connection and add it again."), so Auth never approves a client whose link can never link again. Not covered: after `agents.revokeAll` Auth still holds the grant, so the screen gets the redirect at once and Madar records nothing; that AI app gets 401 until the person removes its grant in Settings, Agents.

### Checks on the local stack (`server/it/consent.it.test.ts`)

| Check | Result |
|---|---|
| The agent token records an approval through the consent port | 403 `agent_token`; no row. |
| The agent token approves its own client B at Auth, and B calls `mcp` | Auth: 200 and a token. Madar: 403 "You did not approve this AI app in Madar."; no `agent_links` row, no `agent_approvals` row. |
| The person's grants after that | B is listed, so Settings, Agents shows it for removal. |
| The consent port of the screens (`httpOAuthPort`) against the real Auth and the api app | `details` gives the client and redirect; `recordApproval` writes the row for the person; `approve` gives the code; the first MCP call links. A second `recordApproval` of the answered request gets 400 `authorization_ended`. |
| Deny | The redirect carries `error=access_denied`; no approval row. |
| `agents.list` and `agents.remove` through the batch | The list names the client, host `127.0.0.1` and the last use. Remove: `changed: true`, the link removed, the next MCP call 401, the `user.deactivated` event by the person; the list then shows the agent off with no clients. `revokeGrant` removes the grant. |
| A second revoke after Remove, then the same client again | The second `revokeGrant` gets 404 `oauth_consent_not_found` from Auth and resolves. A new authorize of the same client asks again (`details` gives `ask`); `recordApproval` gets 403 `agent_removed`; no new approval row; the link stays removed. |

**Conformance on Deno:** `npx tsx server/mcp/conformance.ts` records the approval of its runner client (`recordOn` in `server/it/oauthAgent.ts`) and gives 5 of 32, the same as G3, with no failure outside `conformance-baseline.yml`. Deno boots the mcp bundle only with the G3 merge lead patch of `vite.server.config.ts` (`comments.jsdoc: false`), which is not on `rb/G`: without it the function does not answer in 240 s. The run applied the patch for its time only.

**What stays as G3 built it:** a removed link never links again, also after a new approval of the same client: the AI app registers a new client, and the person approves that one on the Madar screen.

**Still open for Z7 and the owner (unchanged from G1):** an approved agent token keeps the full rights of the person on Auth's own endpoints (`/user`, `/user/oauth/grants`). The consent screen says so in plain words ("can also use your account outside the Madar screens, for example to change your password"). Z1's `security_update_password_require_current_password` narrows it on the cloud projects.

## H. The OAuth grant after agents.revokeAll, and invitation links after otp_expiry = 3600 (local stack, 2026-10-04, wave 5 track H)

**Result: no admin call exists, and the next connection still cannot act.** Supabase Auth v2.197.0 (CLI 2.119.0) removes one person's grant for one client only with that person's own token (`DELETE /user/oauth/grants?client_id=`, `UserRevokeOAuthGrant`, which also deletes the person's sessions of that client). The admin API has client-wide calls only (`/admin/oauth/clients/{client_id}`: get, update, delete, regenerate secret). Deleting a client would cut every person who uses it, so Madar does not use it. After `agents.revokeAll` the grant stays at Auth, the authorize step of that app gives a code at once, and the consent screen does not show for it.

**The gap found, and closed.** Before this change, an approval that the person recorded in Madar for an app that had not called Madar yet (no `agent_links` row) survived the turn-off. On the local stack, after `users.deactivate` and `users.reactivate`, that app got a code at once from Auth, its first tool call answered 200, and `ensureAgentUser` made a new link. Now the one statement of `agents.revokeAll` (`server/mcp/revokeAll.ts`) also deletes every approval of the person (`20261004000403_platform_agent_approvals_revoke.sql` grants `delete` on `agent_approvals` to `madar_server`).

**Where:** the local stack of CLI 2.119.0 after `supabase db reset` from the `rb/H` worktree. **Re-run:** take the Docker lock, `supabase db reset`, then `MADAR_IT=1 npx vitest run --project it server/it/revokeAll.it.test.ts server/it/renew.it.test.ts` (6 of 6). With `consent`, `mcp`, `invites`, `auth`, `guards`, `email` and `hook`: 9 files, 67 of 67.

| Check (`server/it/revokeAll.it.test.ts`) | Result |
|---|---|
| A linked app, then the person off and on again | The link is removed; Auth still lists the grant. `DELETE /admin/users/{id}/oauth/grants`, `GET /admin/users/{id}/oauth/grants` and `DELETE /admin/oauth/grants` answer 404. The app's next authorize gives a code at once; its token gets 401 from `mcp`; the link stays removed. |
| The consent screen is reachable | `agents.list` holds no live client for the app and Auth lists the grant, so Settings, Agents shows it. Its Remove (`revokeGrant`) ends the grant. The same client then gets the consent screen (`details` gives `ask`) and 403 `agent_removed`. A new registration of the app gets the consent screen, the approval in Madar, and 200. |
| An app approved before the turn-off that never called Madar | The turn-off deletes the approval. The app's next token gets 403 "You did not approve this AI app in Madar."; no link. After Remove in Settings, Agents and a new approval in Madar: 200. |

**Invitation links (security fix 7).** One Auth setting (`otp_expiry`) sets the life of every email link, so it goes back to 3600 s (merge lead patch of track H for `supabase/config.toml`; the hosted projects keep the Auth default of 3600 s). An invitation mail now carries an opaque random renew key; Madar keeps only its sha256. When the link is out of date, the Welcome screen offers one button, "Send me a new link", and `POST /api/auth/renew-invite` sends a new invitation to the address Madar holds. `server/it/renew.it.test.ts`: a link that Auth refuses as `otp_expired` (Auth compares `auth.users.confirmation_sent_at` with `otp_expiry`), its key gives a new mail whose link sets a password; a used, unknown, accepted or removed key gets the same answer and sends nothing; two presses at the same moment send one mail; the outbox holds no key; the renewal counts as sign-in mail.

**Still open:** Admin invitations (`users.create`, `users.resendInvite`) do not count against the daily mail quota (`sendInvitation` sends with `deps.mail.send`); only a renewal does. A proposal for G: when the consent screen gets the redirect at once for a client whose link Madar removed, it could revoke that grant with the person's token and show the `agent_removed` words, so the person never needs Settings, Agents for this case.

**2026-10-04, track H repair after review (security fix 7).** The renew key is no longer a new random value on each send attempt: it is the sha256 of the invite id and the random token hash of the link (`renewKeyOf`, 52 base32 characters), so a retry sends a mail that is the same byte for byte, and Resend (and `outboxMailPort`) gives the first answer instead of 409 `invalid_idempotent_request`. Unit proof: a mail fake with the Resend rule whose first send goes out and then times out; the retry returns `sent`, sets `sentAt`, drops the token hash and keeps one renew hash (on the first version it threw 409 on every retry). `RENEW_KEY_SQL` adds a hash only once. The renew route now counts the limit of the person and reserves the quota place inside the transaction under the office lock (office lock first, then the mail lock; no code takes them the other way), after it reads the key row again: a second press at the same moment counts nothing, and a refusal rolls back. `server/it/renew.it.test.ts` now also checks one `signin` row in `mail_log` for two presses at the same moment: 3 files (`renew`, `revokeAll`, `mailQuota`), 12 of 12 on the local stack after `supabase db reset` from `rb/H`. The out-of-date Welcome screen keeps the quiet "Back to sign in" link in both states, because Auth also answers `otp_expired` for a used link.

**2026-10-04, security fix 8 (on main after the wave 5 merge).** The renew key of `renewKeyOf` came from the invite id and the token hash of the link. The token hash of an Auth link is the sha224 of the email and a 6-digit code (`otp_length` 6), and the sent row keeps the invite id and the sha256 of the key. So a reader of the outbox (or of a backup of it) who knew the email could try the 1 million codes, find the token hash, and sign in as the person while the link lived (1 hour). The sent row drops the token hash to stop exactly that. Now the key is random (`newRenewKey`, 52 base32 characters, 260 bits) and names no link. The payload keeps it next to the token hash until the send, so a retry mails the same key and Resend still gives the first answer; `SENT_SQL` drops both. Unit proof (`server/auth/invite.test.ts`): two runs of the same row with the same token hash mail different keys (the old code mailed the same key); a failed send leaves `renewKey` and its hash in the row, the retry mails that key, and the sent row holds neither. Database proof: `renew.it.test.ts` and `invites.it.test.ts`, 13 of 13 on the local stack after `supabase db reset` from main, and the two SQL expressions checked by hand on a sample payload.

**2026-10-04, security fix 8 follow-up (background review of 882f1d7, "sensitive-data-at-rest").** The unsent row now holds the plain renew key next to the token hash. The renew route accepts a key only when the mail of its row went out (`RENEW_ROW_SQL` reads `sentAt`), and `SENT_SQL` drops the plain key in the same statement that writes `sentAt`. So a plain key that a reader of the outbox finds never works, and a sent row holds only the sha256. Unit proof (`server/auth/renew.test.ts`): a key read from an unsent row gets the same answer and sends nothing (on 882f1d7 it made a new link and sent a mail). Database proof: `renew.it.test.ts` and `invites.it.test.ts`, 13 of 13.

## Z0b. The client address of a request on both hosts (S1 header probe, madar-test, 2026-10-04)

**Why.** The forgot route limits reset requests for each network address (task S1). The limit is only as good as the header it reads, and the P2 rule read the first `x-forwarded-for` entry, which the sender writes.

**What ran.** Track S1 deployed a short-lived probe function `probe-ip` to `madar-test` (`qdgwpnesxppnqsaabqzd`) only, sent it requests from the Mac with forged `x-forwarded-for`, `true-client-ip` and `cf-connecting-ip` headers, and logged the headers that arrived. The function is now a stub that answers 404; it goes when the owner says yes (TASKS.md, Z0b item). The Workers host gets `cf-connecting-ip` from Cloudflare itself (platform fact), so the result covers both hosts.

| Header | What arrives at the function | Use |
|---|---|---|
| `cf-connecting-ip` | The real address of the client: Supabase Edge Functions sit behind Cloudflare too. Cloudflare refuses a request that sends its own `cf-connecting-ip` ("error code: 1000"), so a sender cannot forge it. | The only one, on both hosts |
| `x-forwarded-for` | "client, client, proxy": a forged value is replaced, and the LAST entry is a rotating proxy address (for example 13.248.x.x, 172.69.x.x), not the client. Reading the last entry puts many clients under one proxy address, so one limit for many people. | Never |
| `true-client-ip` | Passes through forged. | Never |

**Result.** `clientAddress` (server/auth/forgot.ts) reads `cf-connecting-ip` on both hosts, and `unknown` only on local runs (S1, 01c224e). The rule "the last `x-forwarded-for` entry" of the first S1 commit is gone. The P2 design note above is corrected to match.

## C2. Loaders and the office cache (local stack, 2026-10-04)

C2 left this section out because track Z owns this file; track Y writes it from the C2 commits (f490928, 0371ac5, 6f4538d and the three C2 fixes), merged into main with rb/C (39c57e6), and from a re-run on main.

**Result: PASS.** Each of the 108 shared calls has a loader that reads only the records the call needs, and every read gives the same rows from Postgres as from the whole office in memory. The office cache reloads only what changed.

**What C2 built.**

- `server/data/loaders/*.ts` and `LOADER_OF` (`index.ts`): a loader for each of the 108 calls (a unit test fails when a call has none), each with two sources behind one interface: `memorySource` (the whole office in memory, which the loader unit tests and the db-mode shadow run use) and `sqlSource` (Postgres). `compare.ts` (`runBoth`) and `sweep.ts` run one call on both and compare.
- `server/data/officeCache.ts`: the office lists in module memory with the `office_meta.version` they were read at. A change reloads only the rows whose `chg` is newer; a delete arrives through `office_deletes`; a cache older than the oldest kept delete loads everything again; the objects are deep-frozen.

**What ran.**

| Check | Suite | Result |
|---|---|---|
| The 18 places of AM 6 where a scoped load could leave out a record: the scoped load gives the same answer as the whole office | `server/data/loaders/loaders.test.ts` | Pass (31 tests on main today, with the A9 unread counts) |
| The office cache: version check, changed rows only, `office_deletes`, the delete window, frozen objects | `server/data/officeCache.test.ts` | Pass (15 tests on main today) |
| Every read that the loaders make during the sweep, run on both sources against the sample office plus an undo pair, a thread with a read mark, messages with the same stamp, a decision, a helper and a direct message with a file | `server/it/loaders.it.test.ts` | Pass |
| The whole sweep with the SQL source against the whole office in memory; the unread counts; the bytes read toward the egress meter | same | Pass (4 of 4) |
| One project change reloads one row; a task change reads only `office_meta`; a missed delete loads everything; a rolled-back write is never served; frozen objects; a sign-in link from `setAuthUserId` | `server/it/officeCache.it.test.ts` | Pass (5 of 5) |

**Found and fixed in C2's own review.**

1. The cache could keep a snapshot that its own open transaction wrote. When that transaction rolled back and a later commit reused its version number, the cache served the rolled-back rows. Now `office_meta` tells the cache when the reading transaction wrote the row (`xmin`), and the cache builds that snapshot for that read only (73d95e5).
2. `users.auth_user_id` changed outside the save step without a version raise, so a warm cache missed a new sign-in link. `setAuthUserId` is now the one statement for it, with a version raise and `chg` (73d95e5).
3. The memory source ranks in one pass, and the sweep tests get 30 seconds under a full parallel run (7562c23). Tests now guard the undone feed event, event ties past `evt_999`, the chat notices of a deleted project and the jobs loader; each fails when its guard is removed (ea61894).

**Follow-ups that C2 named, all done since:** unread counts from `State.counts` with one grouped SQL count for each chat (A9, wave 3); `setAuthUserId` in `auth.invite` and every later change of the sign-in link (P2); `clearOfficeCaches()` after each rollback and the reuse of `runBoth` and `memorySource` in the shadow run (D1); `office_deletes` kept for 7 days and the jobs loader `loadJobs` (N3.1).

**Re-run.** On main 14e2db7 (branch rb/Y), 2026-10-04: take the Docker lock, `supabase db reset` from the worktree, then `MADAR_IT=1 npx vitest run --project it server/it/loaders.it.test.ts server/it/officeCache.it.test.ts` (9 of 9 pass) and `npx vitest run --project server server/data/loaders server/data/officeCache` (46 of 46 pass).

## V. Every invitation mail counts against the daily mail quota (local stack, 2026-10-04, wave 6 track V)

**What changed.** Before, only a renewed invitation took a place in the daily mail quota (`mail_log`), so the invitations of `users.create`, `users.resendInvite` and the `auth.email` effect could send past the hard stop of 98 while Resend counted them. Now `sendInvitation` (`server/auth/invite.ts`) counts every invitation as sign-in mail with `sendCounted`, under the ref of its idempotency key (`invite:<inviteId>`), so a retry keeps its place and counts once. A row with no link yet reserves its place before Auth makes the link (an Auth link lives 1 hour, so a link made on a full day would be dead in the next day's mail). A full day throws `QuotaFull` (now in `server/mail/quota.ts`): `processOutbox` holds the row until the next UTC midnight and gives the attempt back, and `users.invites` shows no `sentAt` until the mail goes out. The reserve takes only the mail lock in a transaction of its own; the renew route keeps its order (office lock, then mail lock).

**What the Admin sees.** People shows the person with the calm "Invited" mark only: no alarm, no date, no new button (jsdom test in English and Arabic). The toast of "Send the invitation again" now says "The invitation is on its way to <name>." (`people.onItsWay`, `src/i18n/real/v.*.json`), which stays true on a full day. The waiting row also shows in Usage under the failed effects with the error "The invitation did not go out: the daily mail quota is full. The job sends it on the next UTC day.", as the waiting notice of S1 already does.

**Proof.** On rb/V (from main daa73d3): take the Docker lock, `supabase db reset` from the worktree, then `MADAR_IT=1 npx vitest run --project it`. The new case in `server/it/invites.it.test.ts` passes: `users.create` and `users.resendInvite` each hold one `signin` place with the Resend id; with the day filled to 98, `users.create` still answers ok, the `auth.invite` row waits until 2026-10-05T00:00Z with 0 attempts and no token hash, the person has no `auth_user_id`, `users.invites` gives `sentAt: null`; after the wait, `processOutbox` sends the mail on 2026-10-05 with one place on that day, and its link sets a password. The two renew cases of `server/it/renew.it.test.ts` now count the first invitation too (2 places). Whole it run: 29 of 30 files, 226 passed, 8 skipped; the one failed file is `scripts/restore-check.test.ts`, which needs the `age` program (not on this Mac, MADAR_AGE not set).

**2026-10-04, V repair after review.** Correction of the Usage sentence in section V above: Admin, Usage does not show a waiting invitation any more. FAILED_EFFECTS_SQL (`server/usage/meters.ts`) leaves out a row whose claim runs past now plus 2 minutes, which only WAIT_SQL makes (QuotaFull, until the next UTC midnight); a normal failure keeps the 2-minute claim of CLAIM_SQL at most. On a full day the Admin sees the emails meter, not a "Could not send ... Tries: 0" line with a Retry that cannot work before midnight. `server/it/usage.it.test.ts` proves it on the local database: a waiting row is left out, a row that just failed and a row that failed an hour ago stay. Three more checks on the local stack (`server/it/invites.it.test.ts`, 37 of 37 green with the usage, renew, mail quota and auth suites): the invitation of the auth.email effect takes its own sign-in place in mail_log with its Resend id; three invitation rows that waited on a full day (users.create and two users.resendInvite) send one mail with one place and one link on the next day, because an older row with no link gives way to a later auth.invite row of the person (LATER_INVITE_SQL in `server/auth/invite.ts`); and a later row that ended with no mail (the person was turned off) does not replace a waiting one, because users.reactivate writes no new invitation. The sign-in mail and the email-change notice now hold dir and text-align on a div inside the body, as the N2 pages do, because Gmail drops the html and body attributes.

## Deploy. Both projects and the Pages project (2026-10-04)

**Owner's choices:** the free Pages address now, an own domain later; mail from `Madar <madar@vado.sa>` (a verified Resend domain); the first Admin is o.khalil@mazj.org; the test copy too, with the sample office.

- **Pages:** wrangler 4.147.0 sends `wrangler pages project create` to the new "Pages on Workers" path, which needs a Worker entry and failed. `--force` made the project on the classic Pages path, once; later commands go there by themselves. The project name `madar` got the address `madar-46r.pages.dev`, because `madar.pages.dev` belongs to another account. Production is the branch main; the test copy is the branch preview (`preview.madar-46r.pages.dev`).
- **Settings:** `[remotes.test]` and `[remotes.production]` in config.toml carry `project_id`, `site_url` and `additional_redirect_urls`; `config-check.ts` passes for both. Both projects already had the ES256 key `in_use` and HS256 `previously_used`.
- **Secrets:** `secrets/<env>.env` holds DATABASE_URL (madar_server on the transaction pooler, a random password), APP_URL, ALLOWED_ORIGINS, MAIL_FROM, MAIL_DRIVER (outbox for test, resend for production), MADAR_FILE_STORE=supabase, FILES_BUCKET and JOBS_SECRET; production adds RESEND_API_KEY. `secrets.ts` set the role with a SCRAM verifier and the function secrets with DATABASE_CA.
- **`all.sh test` and `all.sh production`:** 14 migrations, the settings push, the secrets, the 3 functions (`api answers in eu-central-1`, 108 calls), and the screens. Both exit 0.
- **First Admin:** `first-admin.ts --env production` with `--password-stdin` cannot work in production: readline reads the typed word and pauses stdin, then the password read waits on a paused stream and Node exits 0 with nothing made. A run in a pseudo-terminal (`script`) worked: usr_001. Fixed the same day: with `--password-stdin` the script reads stdin once and takes the word and the password from it (`stdinAnswers`, tests in `first-admin-args.test.ts`).
- **Checks (no browser password):** on both projects a password sign-in through Auth gives a token, and `POST /api/batch` answers `session.get` (Hala Nasser on test, Osama Khalil on production, both admin), `projects.list` (9 on test, 0 on production) and `users.invites` (usr_001 active: the password mark of createUser works on the hosted Auth). The Data API answers 503. SSL enforcement: on in both (production turned on 2026-10-04). Realtime `private_only`: on for madar-test.
- **Not done by Claude (the safety system refused a secret-store write):** turning off the legacy anon and service_role keys and revoking the HS256 key. Supabase docs: Storage signed URLs use a separate key, and a revoked key can move back to standby.

### Deploy suite on the test copy (Z6, 2026-10-04 and 2026-10-05)

- **Run 1** (full suite with AFTER_G and AFTER_M, then the walk): 147 failed, nearly all on one app bug. zod 4.6.5 tests for eval with `new Function` once; the page has `script-src 'self'`, so the browser reported a Content-Security-Policy violation on every load, although zod caught the error. Local runs never saw it: vite preview sends no CSP. Fix: `z.config({ jitless: true })` in `src/app/zodConfig.ts`, the first import of `main.tsx` (86d7687). Never add `'unsafe-eval'`.
- Run 1 also found: a cancelled batch request that `batchAs` waited on (now waits for an answered one), a mid-move size check that live loading cannot catch, and an Auth grant that agents.spec Z0a case 3 left on the Member (the test now removes it; the seed does not clear `auth.oauth_consents`).
- **Run 2** (after the fixes, screens redeployed): full suite 157 passed, 2 failed, 7 skipped by design; the CSP check is clean. The walk passed 143 of 144 steps; the one failure was `net::ERR_CONNECTION_CLOSED`, and a rerun of that variant passed 36 of 36. One failure was a contrast check on half-faded tiles: `settle()` in `tests/e2e-deploy/goto.ts` now waits for a quiet network and every finite animation (0b553fb).
- **Expected failure, an open Z1 item:** Z0a case 3. With "require current password" off, an approved agent token set a new password for the person through `PUT /auth/v1/user` (200). The seed reset it. The auto-mode safety system refused the setting change for Claude; the owner turns it on in madar-test first, then the suite checks Welcome and Reset (Z0a cases 1 and 2) with it on, and only then production.
- **Production after the suite:** the fixed screens (pages.sh production), Realtime `private_only` true, SSL enforced; the end-to-end check passes (`session.get`, `usage.get` with the database meters).

### Z1 finished and the secrets rotated (2026-10-05)

- **Require current password:** on in madar-test first; account.spec (Welcome and Reset, EN and AR) and agents.spec passed 18 of 18 on the test copy, and Z0a case 3 now gets `current_password_required`. Then on in production. The invite session can still save a first password, so the Z1 gate of section Z0a item 2 holds.
- **Legacy keys and HS256:** turned off and revoked in both projects; a password sign-in and `session.get` worked after it. Supabase docs: Storage signed URLs use their own key.
- **Database passwords:** rotated with `PATCH /v1/projects/{ref}/database/password`; the session pooler accepted the new production password after a few seconds. madar_server has its own password and was not touched.
- **Resend:** a key with `sending_access` for the vado.sa domain only now serves production; the account-wide key stays for the owner's other apps until he rotates it.
- **Spam:** the first invitation landed in Gmail spam. Resend DKIM (`resend._domainkey`) and SPF on `send.vado.sa` pass, tracking is off, the links point to madar.vado.sa; vado.sa has no DMARC record. The owner adds `_dmarc` TXT `v=DMARC1; p=none; adkim=r; aspf=r` in the Vercel DNS.

### The short MCP address and the first backup (2026-10-05)

- **MCP:** https://madar.vado.sa/mcp is a Cloudflare Pages Function that forwards to the mcp function of the host's project with `x-region: eu-central-1`, after it drops the `cf-*` and client-address headers. MCP_URL of each project is the short address, so the 401 `WWW-Authenticate` and the resource metadata name it, and Auth gives tokens that audience. agents.spec through the test copy's short address: 10 of 10. The old Supabase function address still answers; its tokens now carry the short audience.
- **Backup:** the first `DB backup` run by hand succeeded (release `madar-db-20261005-070349Z` in byosamah/madar-backups, about 14 KB); `age -d` with the owner's key opened it, and it holds roles.sql, schema.sql, data.sql and manifest.json. The opened copy was deleted at once.

### Thmanyah Sans, the weight ladder and the direction rule (2026-10-05, 1b0180a)

- **Screens only:** `pages.sh test`, then `pages.sh production` with the typed word. No migration, setting, secret or function changed.
- **Test copy:** the three OTF files serve as `font/otf` (241 KB each) under the real CSP (`font-src 'self' data:`); in Chrome the sign-in page loads Thmanyah Sans 400, 500 600 and 700 with no failed face.
- **Production quick check:** page 200, `POST /mcp` with no token 401, `api/health` 200, the three font files 200 `font/otf`, the same CSS file as the test copy.
- **Not run:** the deploy suite on the test copy. Local checks before the deploy: `npm test` 3,408 passed, the prototype smoke 87 of 87 (before the last five layout fixes), both builds.

### The owner feedback batch (2026-10-05, 228c01b, then the sign-out fix)

- **Gates before the deploy:** `npm test` 3,772 passed; `test:db` 956 (24 skipped); `test:it` 240; the prototype smoke 87 of 87; the deploy suite on the local stack 159 passed (8 skipped), the walk 4 of 4 variants; `test:mcp` 104 and the conformance baseline.
- **Test copy at 228c01b:** `all.sh test` pushed `20261005000100_project_templates.sql` (each stage template became a project template). The config push first stopped with 402: the template value `storage.vector.enabled = true` asks for vector buckets, which the free plan has not; config.toml turns them off and config-check refuses them. The config diff still reports `api.enabled` true on madar-test after a push, but `/rest/v1/` answers PGRST002 (no schema cache), so no data is served.
- **Deploy suite on the test copy (AFTER_G, AFTER_M, MCP URL set):** 156 passed, 2 failed, 7 skipped, 2 not run; the walk 8 of 8 (144 of 144 steps); agents.spec in full. The 2 failures were an app race: after a sign-out, lists that loaded again went with no token, and their late 401 opened "Your session ended" over the next sign-in (3 of 6 groups in a 3x repeat of account.spec.ts). The fix: the remote client sends nothing with no token (`unauthenticated`, reason `no_session`), and AuthGate never opens the sheet for that reason.
- **Test copy at 69e3be7 (the sign-out fix and the Madar logo):** account.spec.ts with `--repeat-each=3` 28 passed, 0 failed (before the fix, 3 of 6 groups failed); agents.spec 10 of 10; an `initialize` with a test agent token gives serverInfo with `websiteUrl` and the two Madar icons of the test copy; `/favicon.ico` answers 200 `image/vnd.microsoft.icon`.
- **Production at 69e3be7 (owner OK in chat):** `all.sh production` applied `20261005000100_project_templates.sql`, deployed the 3 functions (health 112 calls) and the screens. Quick check: page 200, `POST /mcp` with no token 401, `api/health` 200, `/favicon.ico` 200 icon, `/icons/madar-192.png` 200.

### The follow-ups (2026-10-05, 02cd6a4)

- **What:** the quiet "Set date..." DateField in every draft form, Team names in full at 390 px, one main button with the New client box open (now an outlined group), payment and form messages that follow the person's changes, the 13 unused stage template words removed, and the test office seed step 5 (it revokes the AI app grants of the 4 accounts).
- **Local:** `npm test` 3,805 passed; the prototype smoke 87 of 87; the seed integration test 3 of 3 on the local stack.
- **Test copy at bfb599b:** the walk 144 of 144 steps, projects 13, account 8, work 10, dashboard 8.
- **Test copy at 02cd6a4:** the seed step 5 revoked a planted grant ("Revoked 1 AI app grant of member@madar.test"); agents.spec 10, projects.spec 17; the walk 36 of 36 at 1440 px in both languages. At 390 px the invite step found the mail day quota of madar-test full (98 mails today, outbox driver), the designed QuotaFull answer, so those two variants wait for the next day.
- **Production at 02cd6a4:** `all.sh production`, health 112 calls; page 200, `POST /mcp` with no token 401, `/favicon.ico` 200 icon.
- **Found:** the seed ends every Auth session of the 4 sample accounts (the password set of step 2), so a signed-in device must sign in again. The API accepts a browser token until it expires (jwt_expiry 3600) even after its Auth session is gone; agent tokens stop at once.

### Z7: a token of 15 minutes (2026-10-06, 746d694)

- **What:** `jwt_expiry = 900` in both projects. A browser token stays good after its Auth session ends (the API checks no session for it), so the gap after "Your other devices sign out" is 15 minutes at most. `config-check.ts` refuses a value above 900, and `signin.spec.ts` reads the token of the target.
- **Local:** `config-check.test.ts` 9 of 9.
- **Test copy at 746d694:** a sample sign-in gives `exp - iat` = 900. The deploy suite (AFTER_G, AFTER_M, WALK, a seed before and after): 165 passed, 3 skipped (the prototype-only "Preview as"), 0 failed; the walk 36 of 36 steps in each of the 4 variants.
- **A member session of 17 minutes on the test copy:** supabase-js renewed the token at 13 min 5 s (the renew answered 200). An Admin update reached the member page 1.8 s after the save, with no reload and no request from the member page since minute 5, so it came on Realtime. Then My Work loaded with 200 answers. All 14 `api/batch` answers were 200; no session sheet and no "No connection" banner in 34 checks; no console error.
- **Production at 746d694:** the config push changed `auth.jwt_expiry` from 3600 to 900; `GET /config/auth` gives `jwt_exp` 900. `db_schema` stays '' and `/rest/v1/` answers 401. Quick check: page 200, `POST /mcp` with no token 401, `api/health` 200.
- **Found:** the test office seed writes file rows (keys `blob_seed_*`) but no Storage objects (0 of 81 objects in `madar-files`), so on the test copy every sample file and the cover picture of prj_001 fail `files.link`. Production is not affected: real files come through `files.uploadStart`.

### The clean-up batch and the test office files (2026-10-06, 9b6bf07)

- **What:** the test office seed uploads its 72 sample files to Storage under real object keys (the pictures as PNG, `scripts/seed-pictures.ts`) and, with `MAIL_DRIVER=outbox`, empties `mail_log`. The clean-up batch of the 2026-10-03 review: 7 items done, 3 kept on purpose with reasons (TASKS.md), the sample office and `settleFuture` out of the server bundles (`check-bundles.ts server`), and two focus and Escape fixes in the sheets.
- **Local:** `npm test` 3,835 passed, 6 skipped; `npm run build` and `build:server` with the new bundle check pass. The clean-up branch also passed test:db (76), the changed integration files (runCall 10, realtime 8, worker 12) and the prototype smoke 87 of 87; 32 screenshot pairs of main and the branch match to the pixel.
- **Test copy at 9b6bf07:** a member signs in, and `files.link` of fil_001 gives `Cover render.png` (image/png, 6,919 bytes) and of fil_003 a real PDF. The deploy suite (AFTER_G, AFTER_M, WALK, a seed before and after): 165 passed, 3 skipped (the prototype-only "Preview as"), 0 failed, in 45 minutes; the walk 36 of 36 steps in each of the 4 variants. The About card of prj_001 shows the PNG cover. The end seed removed 39 rows of `mail_log`.
- **Production at 9b6bf07:** `all.sh production`, health 112 calls; page 200, `POST /mcp` with no token 401, `api/health` 200, `/favicon.ico` 200.

### The Dashboard accuracy batch (2026-10-06, 2bb11f5)

- **What:** the People tab has a Past due column first, the weeks count from today, and a task in review counts for its reviewers; every Dashboard link carries the Leader, Client and Team filters, and the lists read them; the area row names the projects with no area; the Health mix card and the weekly task chart left the screen (`healthMix` and `throughput` stay in the output), and "Submissions to clients per week" came in; new cards Waiting for our reply, Waiting for review, Payments to receive (`can(payment.manage)`) and Data gaps (`can(admin.manage)`); a past-due task marks its project At risk only from 3 calendar days.
- **Local:** `npm test` 3,894 passed, 6 skipped; `npm run build` and `build:server` pass. The branch also passed test:db 955, test:mcp 113 (the known conformance baseline), the changed integration files and the prototype smoke 87 of 87; screenshots in EN and AR, light and dark, 390 and 1440 px, and as a Member.
- **Test copy at 2bb11f5:** the deploy suite: 164 passed, 3 skipped, 1 failed: walk en-390 step "notices", `page.goto` with `net::ERR_CONNECTION_CLOSED`; the en-390 walk repeated 3 times passed 3 of 3. Role checks: the Admin sees Payments to receive (past due 1, SAR 320,000; next 30 days 3, SAR 268,000) and no Data gaps (the sample office has none); Accounting sees Payments and no gaps (`gaps` null); a Member gets `money` and `gaps` null. With a Leader filter, each of the 4 leaders shows 1 past-due task and its Task list holds 1 row, subtitle "Leader: <name>". The Past due cells add up to the Past-due tasks number (4).
- **Production at 2bb11f5:** `all.sh production`, health 112 calls; page 200, `POST /mcp` with no token 401, `api/health` 200.

### Office tasks and three layout fixes (2026-10-06, 9d5f447)

- **What:** tasks with no project ("office tasks", design in docs/superpowers/specs/2026-10-06-office-tasks-design.md), seen only by the maker, the lead, the helpers and the Admin; the Stale sign under a long name on a phone; a sheet that opens closes the toasts with no Undo, and on a phone the toasts sit above it; on a desk a sheet starts below the tab pill.
- **Privacy review:** 4 rounds by independent reviewers with probes as an outsider. Round 1: a comment body leaked through events.list after an Undo of a deleted office task, and 5 existence leaks (error texts, the office signal). Rounds 2 to 4: smaller existence and timing leaks in mixed Undo stories and the notice clean-up. All fixed with tests that failed first; the last verdict on 9d5f447: no leak found. Accepted limit: the sequential ids show that hidden records exist.
- **Local:** `npm test` 3,979 passed; test:db 1,001 passed; `npm run build` and `build:server` pass; the prototype smoke 87 of 87.
- **Test copy at 9d5f447:** the deploy suite ran during a network outage of the Mac: 72 passed, 93 failed, all failures `net::ERR_INTERNET_DISCONNECTED` or `ERR_NETWORK_CHANGED` and the failures that followed them. The owner stopped the rerun and asked for production.
- **Production at 9d5f447 (owner OK in chat):** `all.sh production`, health 112 calls; page 200, `POST /mcp` with no token 401, `api/health` 200.

### Requests and bugs: notices, Admin MCP tools, screenshots (2026-10-07)

- **What:** a new feature request or bug report gives each active Admin an in-app notice that opens /admin/feedback; a move
  from open to done gives the sender an in-app notice with words only (no link, no buttons); no mail for either, and no
  email switch; only an agent of an Admin sees `feedback.list`, `feedback.screenshot` and `feedback.setStatus`; the
  screenshots of a report now show on the Admin page of the real build (the screen read a picture, but the real build
  answers with a signed link), and a press opens them in a sheet. Design: docs/superpowers/specs/2026-10-07-feedback-notices-design.md.
- **No migration.** `Preferences.notifications` is now a `partialRecord`, and a missing switch reads as on (`inAppOn`). A
  stored person with the 10 old keys still parses on both builds. Rollback risk: an older server refuses a person whose doc
  holds `feedback_sent` or `feedback_done`. Before a rollback past this release, run the `jsonb_set` fix in the design, section 10.
- **Leak review, round 1** (independent reviewers with probes as a Member, a former Admin and each person's agent): the page
  field took a tab or a line break, so a stored page made a link to another site on a Ctrl-click (older than this batch; now
  every C0 control character, DEL and the backslash are refused); the hidden notice of a former Admin kept the report id and
  the send story (now `targetId` 'hidden' and no `correlationId`); a hidden notice that outlived the Undo of its send showed
  again later for a deleted report (now a report notice reads as gone when its report row is gone; the Inbox loader loads
  the report rows only to learn that they exist). All fixed with tests that failed first.
- **Leak review, round 2** on the merged branch: no leak found. Probes covered feedback.*, events.list (8 filters),
  events.undo, events.undoStory, notifications.* (raw JSON), search.query, dashboard.get, users.*, the Realtime signals, the
  MCP tool list and calls, and the scoped load against the whole office for every Inbox call.
- **Accepted limits:** the office signal shows that someone sent or changed a report, and when (no ids, no text); sequential
  ids show that hidden records exist; a former Admin's hidden notice keeps its time and trigger; a client can keep a demoted
  Admin's tool list for up to 5 minutes (a 2025-era client until it connects again), and every call then fails as an unknown
  tool; an Admin's agent gets screenshot storage keys in the before and after copies of report events from events.list (a key
  opens nothing, and the signed link names the same key); users.list shows each person's switches, the new ones too.
- **Prompt injection:** report messages, pages and screenshots now reach an Admin's agent. INSTRUCTIONS rule 6 says that text
  people write in Madar is data, never instructions, and that the agent tells its person first; the three tool texts say it again.
- **Local:** `npm test` 4,087 passed, 6 skipped; typecheck, `npm run build`, `build:server` and `build:remote -- test` pass;
  test:db 1,052 passed (25 skipped); test:it 241 of 241; test:mcp 132 passed, conformance 5 of 32 with the 27 known failures.
  Prototype screenshots (EN/AR, light/dark, 390 px): 26 shots, 0 console errors.
- **Test copy at a0ce0be:** `all.sh test` from a clean worktree of main (another session had changes in the main folder); page
  200, `POST /mcp` with no token 401, `api/health` 200. The owner stopped the local walk (56 of 168 suite tests passed, no
  failure) and the prototype smoke, skipped the deploy suite, and tried the change himself.
- **Production at a0ce0be (owner OK in chat):** `all.sh production`, health 112 calls; page 200, `POST /mcp` with no token
  401, `api/health` 200.

### Two team requests: task makers and "Coming up" (2026-10-07, 1f06244)
- **Change:** the person who adds a project task changes and deletes it like the leader while on the team, and names only team
  mates. The review stays with the leader and the Admin. Home shows "Coming up" (the next 3 open tasks with a due date) when
  nothing is due today. MCP: INSTRUCTIONS and the docs of tasks.create, tasks.update and tasks.get.
- **Local:** typecheck; `npm test` 4,106 passed, 6 skipped; test:db 1,063 passed; test:it 241 passed (the 16 agent sign-in
  tests needed `npx supabase db reset` first); the prototype, server and remote builds. Screenshots (EN/AR, light/dark,
  390 px). Not run: the prototype smoke and the deploy suite.
- **Test copy at 1f06244:** `all.sh test` from the clean worktree `.claude/worktrees/deploy-test`; the page title is "Madar",
  the bundle holds "Coming up", `api/health` 200.
- **Production at 1f06244 (owner OK in chat):** `all.sh production`; madar.vado.sa, www and madar-46r.pages.dev serve the new
  bundle; the Supabase `api/health` 200 with 112 calls; `POST /mcp` with no token 401. The first page check read an old cached
  copy for a short time. Note: `madar.vado.sa/api/health` answers with the app page, so read the health on the Supabase address.

### Security fix F1: an agent may not undo a change to a person (2026-10-07, c5c7622)
- **Change:** `assertMayUndo` (`handlers/history.ts`) refuses an agent every undo of a change to a person (an email, a role,
  off or on), also inside `events.undoStory`. An undo of an email change gave the sign-in email back to the old mailbox
  (security scan 2026-10-07, F1). MCP docs of `events.undo` and `events.undoStory`.
- **Local:** typecheck; `npm test` 4,107 passed; the three builds; test:db 1,065 passed; test:it 241 passed.
- **Test copy at c5c7622:** page 200, `POST /mcp` with no token 401, the Supabase `api/health` 200 with 112 calls.
- **Production at c5c7622:** the auto-mode safety check refused `all.sh production` from Claude twice, also after the owner's
  plain words, so the owner ran it with `!`. Page 200, `POST /mcp` with no token 401, `api/health` 200 with 112 calls. The
  config push said `api.enabled` true on the remote and pushed false: the known false difference (`supabase/CLAUDE.md`). A
  table read with the publishable key still answers PGRST002, so the Data API stays off.

### Drag and drop order on the Tasks screen (2026-10-07)
- **Change:** `Task.rank` and `tasks.arrange` (the rights of `task.updateOwn`); one shared order inside each date group of the
  Tasks screen, and Home follows it. A drag never changes a date. The tasks a person only helps with sit at the end of a group.
  MCP: the tool `tasks.arrange` (38 tools, 41 for an agent of an Admin), its docs and an INSTRUCTIONS line.
- **Local:** typecheck; `npm test` 4,131 passed, 6 skipped; the three builds; test:db 1,073 passed (25 skipped); test:it 241 of
  241. Prototype at 390 px (EN/AR, light/dark): a real mouse drag moved the row, "Order saved." showed, Undo gave the old order
  back, no console error. Not run: the prototype smoke and the deploy suite.
- **Test copy at 66586d0:** `deploy-test` got its own `node_modules` first (its link pointed to the main folder, which lacks
  `@dnd-kit/sortable`). `all.sh test`: health 113 calls, page 200, `POST /mcp` with no token 401, the bundle holds "Order saved."
  and its Arabic form.
- **Production at 66586d0 (owner OK, the owner ran `all.sh production` with `!`):** madar.vado.sa serves the new bundle (the
  same name as the deploy address), "Order saved." in it; `api/health` 200 with 113 calls; `POST /mcp` with no token 401;
  the Data API still answers PGRST002.

### The performance batch (2026-10-08)
- **Change:** the speed fixes of the performance audit (sections "Performance audit" below): screens on demand, early
  links, the font preload, one language at a time, memo lists, prefetch, the save reads in the request of the write, an
  hour of cache, the server work after the answer, a joined transaction start, the read indexes, the picture fixes. No
  visible change, no contract change, no new call. MCP: no change. The batch forwarder was measured and removed.
- **Local:** see "The merge and the measurements (2026-10-08)" below. Not run: the deploy suite, the prototype smoke.
- **Test copy at 62855bc:** `all.sh test`: the migration `20261007000100_read_indexes.sql` pushed, health 113 calls, page
  200, `POST /mcp` with no token 401, three font preloads in index.html, `POST /api/batch` 405 (no forwarder).
- **Production at 62855bc (the owner's words "deploy to test copy and production"):** `all.sh production`: the same
  migration pushed, health 113 calls, madar.vado.sa serves `index-BGsCDciP.js` (the name of the deploy address), page 200,
  `POST /mcp` with no token 401.

### Drag and drop order on Home and in the project task list (2026-10-08)
- **Change:** the shared order of tasks now works on Home (Today), the Tasks page and each stage of a project. One component
  (`SortableTaskRows.tsx`) serves all three. A drag stays inside one list and never changes a date. Coming up on Home has no
  grips, because its tasks fall on different days. No migration, no new call, no contract change. MCP: no change, because
  `tasks.arrange` already exists and its docs already cover the order.
- **Local:** typecheck; npm test 4,380 passed (436 files); the prototype build with the RTL and bundle checks. Browser checks
  on the prototype at 390 px in English and Arabic, light and dark: the project list, Home Today, and a keyboard drag on
  Home and in a stage. The drag saved the order and the live text read as expected. Console errors: 0.
- **Test copy at ef24a11:** `all.sh test` ran in the background. Its config step asked whether to push the api config, and
  no one answered, so the tool took its default (yes). That set `api.enabled` on the test project to false (local false,
  remote true). Pages deployed to preview.madar-46r.pages.dev. Not run: the deploy suite (about 45 minutes).
- **Production at ef24a11 (the owner ran `all.sh production` himself and typed the word):** the config step asked whether to
  push the api config, and the owner answered yes (`api.enabled` local false, remote true). The functions api, mcp and jobs
  deployed. `api` answers in eu-central-1 with 113 calls. Pages deployment dd4477ed. madar.vado.sa: page 200 with the title
  "Madar", `POST /mcp` with no token 401, `/favicon.ico` 200. `madar.vado.sa/api/health` answers with the app page, as noted
  above, so the health check is the Supabase address.

### Phone tab bar and the Admin's Waiting and Done tabs (2026-10-08)
- **Change:** on a phone the bottom tabs show icons only, and each tab keeps its word for screen readers (`83c6161`). The
  Admin's Requests and bugs list has two tabs, Waiting (the open reports, first) and Done (`ab2bbaf`). No migration, no new
  call, no contract change. MCP: no change (`feedback.list` and `feedback.setStatus` keep their shape).
- **Local:** typecheck; npm test 4,382 passed (437 files); the prototype build with the RTL and bundle checks. Browser checks on
  the prototype: the tab bar at 390 px in English and Arabic, light and dark, and at 1280 px; the Admin tabs in English and
  Arabic, with a report marked done and moved to Done.
- **Test copy at ab2bbaf:** `all.sh test`, run by the owner. Its config step asked whether to push the api config, and the
  owner answered yes. Health 113 calls, page 200, `POST /mcp` with no token 401, favicon 200.
- **Production at ab2bbaf (the owner ran `all.sh production` himself and typed the word):** the config step asked whether to
  push the api config, and the owner answered yes. The functions api, mcp and jobs deployed. `api` answers in eu-central-1 with
  113 calls. Pages deployment 855f49c0. madar.vado.sa: page 200 with the title "Madar", `POST /mcp` with no token 401, `/favicon.ico`
  200, and the live script is `index-ByrTDqz7.js`, the build of this release.
- Not run: the deploy suite on the test copy (about 45 minutes), the prototype smoke test.

### Browser push notifications (2026-10-08)
- **Change:** free Web Push to the browser or the installed app, with one fixed line and no data in it ("You have something new
  in Madar."), for every new bell notice and every new chat message, to the people who read them, never to the sender. One switch
  for each device in Settings. The new table `push_devices` (migration `20261008000100_push_devices.sql`), the calls
  `push.register`, `push.remove` and `push.mine` (all on the MCP deny list), the sender with VAPID keys (`server/push/`), the
  service worker `public/sw.js`, and `worker-src 'self'` in the policy. This replaces the 2026-10-03 decision "No phone push".
- **Local:** typecheck; npm test 4,550 passed (448 files); test:db 1,117 passed (25 skipped); test:it 261 passed (33 files, with
  `server/it/push.it.test.ts`); test:mcp 135 passed and the conformance runner exits 0; the prototype, server and remote builds.
  The prototype build holds no service worker. The builder also ran the real `runCall` on an in-memory Postgres 18 (pglite).
  One fix at the merge: the sender no longer sets `Content-Length` by hand.
- **Test copy at bf3fa9f:** `all.sh test`, run by the owner. The migration applied, the owner answered yes at the api config
  question, and the three VAPID secrets went out. Health 116 calls, page 200, `POST /mcp` with no token 401, `sw.js` 200 with
  `no-cache`, `worker-src 'self'` in the policy.
- **Production at bf3fa9f (the owner ran `all.sh production` himself and typed the word):** the migration applied, the owner
  answered yes at the api config question, and the production VAPID secrets went out (a pair of its own). The functions api, mcp
  and jobs deployed. `api` answers in eu-central-1 with 116 calls. Pages deployment 0cb3334c. madar.vado.sa: page 200 with the
  title "Madar", the live script `index-DocEIB-m.js`, `POST /mcp` with no token 401, `/favicon.ico` 200, `sw.js` 200 with
  `no-cache`, `worker-src 'self'` in the policy.
- **Not proven:** a real push on a real browser or phone. The first one shows only on a device. Not run: the deploy suite and the
  prototype smoke.

### Browser push on by default (2026-10-09)
- **Change:** "Notify me on this device" is on by default. A browser lets a page turn push on only after a tap on Allow, so Home
  shows one small card with one button on each new device (`PushAskCard`). After Allow, the check at the start of the app turns
  push on again by itself at each sign-in. A person who turns the switch off stays off on that browser (`madar.pushOff.<user id>`
  in localStorage, never on the server). Screens only: no migration, no server change, no contract change, no MCP change (the
  three push calls stay on the deny list). The old rule "the next person on a shared browser gets no push" is gone: that person
  gets push at their own sign-in.
- **Local:** typecheck; npm test 4,577 passed and 6 skipped (449 files, 27 new tests); the prototype, server and remote (test)
  builds; the first load is 1,119,098 B (the limit is 1,350,000 B). Screenshots of the card in EN and AR, light and dark, at 390 px,
  and one at 1280 px (headless Chromium over the fake API, with the card forced on and the permission set to "default"): the card
  fits, nothing is cut, Arabic reads right to left. Not run: test:db and test:it (no server code changed), the prototype smoke
  (the card does not show in the prototype).
- **Test copy at ef8e392:** `all.sh test`, run by the owner. The first run did not finish: no record of the commit, and the test
  copy still served the old code. The second run finished and recorded `ef8e392`.
- **Production at ef8e392:** `all.sh production` with the typed word, run by Claude after the owner's OK. The safety check did not
  refuse it. All steps done. `api` answers in eu-central-1 with 116 calls. Pages deployment 014ba99b. madar.vado.sa: page 200 with
  the title "Madar", the live script `index-Bj8qKkSD.js` (it holds `madar.pushOff`), the English and Arabic words of the card are in
  the live words files, `POST /mcp` with no token 401, `/favicon.ico` 200, `sw.js` 200 with `no-cache`.
- **Not proven:** the card and the silent turn on in a real browser with a real push service. Not run: the deploy suite.

### Team reports fbk_004, fbk_005, fbk_006 and MCP messages (2026-10-12)
- **Change:** a project with no named deadline shows "Stage ends" and the date of the current stage (fbk_004); the "+" before "Add a
  task" opens a new task panel (fbk_005); the avatar of a task row opens a pop-up for the lead and the helpers, with a "+" on hover
  for the helpers (fbk_006). An agent may open a direct chat, list chats and send a message (`chats.openDirect`, `chats.list`,
  `chats.send`): 44 tools for an Admin's agent. An agent never reads a chat, and a direct chat in `chats.list` has no preview.
  Guides: `src/CLAUDE.md`, `src/api/CLAUDE.md`, `server/mcp/CLAUDE.md`.
- **Gates (2026-10-12):** typecheck; `npm test` 4,607 passed and 6 skipped (452 files); the RTL check; `npm run build`,
  `build:server` and `build:remote -- test` with their bundle checks (first load 1,124,334 B of 1,350,000 B). Phone check at 390 px
  with real touch emulation, English and Arabic: the pop-up fits the screen, the "+" is gone on touch, the Arabic stage line wraps
  whole. The MCP migration-free change ran against the MCP tests (142 passed).
- **Test copy at cb0f7b9:** `all.sh test`, run by Claude on the owner's go. It had no keyboard, so the config question took its
  default (yes), as the owner answered on the earlier releases. No migration. The functions api, mcp and jobs deployed. `api`
  answers in eu-central-1 with 116 calls. Page 200, `POST /mcp` with no token 401.
- **Production at cb0f7b9:** `echo production | scripts/deploy/all.sh production` (Claude, after the owner's "deploy go"; the
  commit record matched HEAD and the tree was clean). No migration. The functions api, mcp and jobs deployed; `api` answers with 116
  calls. Pages deployment 43838635. madar.vado.sa: page 200 with the title "Madar", `POST /mcp` with no token 401, `/favicon.ico` 200.
  The live scripts hold `projects.stageEnds` (index), `taskPeople.open` and `canEditPeople` (the task row chunk).
- **Done in Madar:** fbk_004, fbk_005 and fbk_006 (story `sty_mjlygivmx4k7xlwgekxaps`).
- **Not proven:** the message tools on the live MCP. The session that deployed holds a connector whose tool list was fixed at session
  start, and the discover answer needs a token. Not run: `test:db`, `test:it` (Docker was off), the prototype smoke, the deploy suite.

### Agent names and Remove for a turned-off person (2026-10-12)
- **Change:** an agent user is named "<first name> <AI app> Agent" ("Osama Claude Agent"), and in Arabic "وكيل <first name> <AI app>" when
  the person has an Arabic name (`agentNamesOf`, `src/lib/agentName.ts`, used by `ensureAgentUser`). `agent_links.client_name` keeps the
  plain app name for the match of a reconnect. The migration `20261012000100_agent_names.sql` renamed the agents that existed. A
  turned-off person or agent can be removed from every list for good (`users.remove`, 117 calls, `User.removed`): the record stays for
  the History, the email stays reserved, the agents of a person go with them, and nothing in the screens brings them back. People
  screen: "Remove from the list" with a sheet that asks first. Guides: `src/api/CLAUDE.md`, `src/CLAUDE.md`, `server/mcp/CLAUDE.md`.
- **Gates (2026-10-12):** typecheck; `npm test` 4,626 passed and 6 skipped (455 files); the RTL check; `npm run build` and
  `build:server` with their bundle checks. The migration ran on an in-memory Postgres (pglite, outside the repo): 8 cases and a second
  run that changes nothing. Phone check at 390 px with real touch emulation, English and Arabic, light and dark: the menu and the sheet
  fit, no horizontal scroll.
- **Test copy at fe3ac49:** `all.sh test`, run by Claude. The migration applied. `api` answers with 117 calls.
- **Production at fe3ac49 (the owner ran `all.sh production` himself with `!` after the auto-mode check refused Claude's run once):**
  a read-only query on production first listed the 3 agents (all linked to the app "Claude") and the 3 names the migration would give.
  The migration applied, the functions api, mcp and jobs deployed, `api` answers with 117 calls. Pages deployment 5b9e534d. madar.vado.sa:
  page 200 with the title "Madar", `POST /mcp` with no token 401, `/favicon.ico` 200, the live main script `index-BDRLt0Om.js` holds
  `stageEnds`. Through the production MCP, `users.list` gives usr_004 "Osama Claude Agent", usr_011 "Faisal Claude Agent" (nameAr
  "وكيل فيصل Claude") and usr_012 "Tarek Claude Agent" (nameAr "وكيل طارق Claude").
- **Not proven:** `users.remove` and the People sheet on the live site (they need an Admin sign-in; the tests and the prototype
  walk cover them). Not run: `test:db`, `test:it` (Docker was off), the prototype smoke, the deploy suite.

### The MCP server names its release (2026-10-12)
- **Why:** after the message tools went live, the claude.ai connector of the owner kept the old 41 tools, also after a remove and a
  new add and a `/mcp` reconnect. The production `mcp` function (version 42) held `chats.send` and the Messages instructions, and a
  direct client of the test copy got the three chat tools (`agents.spec.ts` with `MADAR_E2E_AFTER_G=1`, 5 passed). So the server was
  right, and the client kept the tool list of the fixed serverInfo version "1.0.0".
- **Change:** serverInfo version "1.0.<number of commits>" (`releaseVersion`, `vite.server.config.ts`); `check-bundles.ts server` fails
  an unstamped bundle; `server/discover` keeps its answer 5 minutes, not 1 hour.
- **Gates:** typecheck; `npm test` 4,629 passed and 6 skipped (456 files); `build:server` with its bundle check.
- **Test copy and production at 6c78a25 (Claude ran both; the auto-mode check let production through this time):** `api` answers with
  117 calls. The production `mcp` function is version 44, and its bundle says `1.0.1158`. madar.vado.sa: page 200, `POST /mcp` with no
  token 401.
- **Not proven yet:** that claude.ai now shows the chat tools. That shows after a reconnect of the connector.

### A code of your own (fbk_003) and the Tracker type Government (2026-10-12)
- **Why:** Faisal (fbk_003): "allow a user to override project code verifying after a warning message". The owner: "the main thing
  is allow the user to use their code if not match the main code". The owner also asked to call the Tracker type "Balady"
  "Government", because the office deals with more government bodies than Balady.
- **Change:** a typed code outside the office pattern, or with the month and series of another contract, shows a warning and the
  tick "Use this code anyway" (new project, the Admin's correction); the server answers `code_format` or `code_taken` unless
  `codeAnyway: true`. MCP: the `projects.update` schema, `TOOL_DOCS` and the "Project codes" line of `INSTRUCTIONS`. The type
  `balady` shows as Government ("جهة حكومية"); the stored value stays.
- **Security:** two background notes on the first commit: a kept code could hold hidden direction marks and other invisible
  characters, so a code could show as other text. A new or changed code is now visible text only (`FREE_CODE_PATTERN`,
  `TYPE_PATTERN`); the record also keeps every code of the office pattern saved before (`RECORD_CODE_PATTERN`).
- **Gates:** typecheck; `npm test` 4,650 passed and 6 skipped (457 files; one record test pinned the old rule and moved to the new
  one); `npm run build`, `build:server`, `build:remote -- test`; `test:mcp` 147 passed. Not run: `test:db`, `test:it` and the MCP
  conformance runner (Docker off), the prototype smoke. Screenshots at 390 px in EN and AR, light and dark: they found
  "Government" wider than its quick-log tile, and the tiles now keep the width of their word.
- **Test copy at 23342eb (Claude, `all.sh test`).** **Production at 23342eb:** the owner ran `all.sh production`. The database,
  settings, secrets and functions steps ended well (`api` answers with 117 calls). The Pages step failed twice at Cloudflare with
  "Failed to publish your Function. Got error: Unknown internal error occurred." The forwarder in `functions/` had no change, and
  the test copy took the same bundle minutes before. Cloudflare showed no Pages incident. After 3 minutes Claude ran
  `pages.sh production` again: deployment 9cd5e473 is live. madar.vado.sa serves `index-i4G-1MRY.js`; `POST /mcp` with no token 401.
- fbk_003 marked done on 2026-10-12 at 13:18, so Faisal got the done notice.

### Two phone fixes, and the gates of the day with Docker on (2026-10-12)
- **Change:** the Tracker quick log gives a phone the example-only hint, and an empty field follows the side of the page (an empty
  field with `dir="auto"` was left to right, so a long Arabic hint lost its first word). Requests and bugs puts Mark done under the
  message on a phone. Checked at 390 px in claude-in-chrome (a fixed iframe): the hint fits (189 px of 207 in English, 173 of 200
  in Arabic), and the button has its own line.
- **Gates (they also cover the three earlier releases of the day):** `npm test` 4,654 passed and 6 skipped; the three builds;
  `test:db` 1,139 passed and 25 skipped; `test:it` 261 of 261; `test:mcp` 147 and conformance 5 of 32 with 27 known gaps; the
  prototype smoke 86 of 87, then 87 of 87: "Member daily work" waited for the Home panel "Today", which is "Coming up" on a day with
  nothing due (owner rule of 2026-10-07). The test now takes either name.
- **Test copy and production at 817355d** (the owner ran production). madar.vado.sa serves `index-CIYv85RI.js`; `POST /mcp` with no
  token 401; `api` answers with 117 calls.

### Files to R2 on production (2026-10-16, ae63498)
The owner's run of 2026-10-16: the files of both copies leave Supabase Storage for R2. The server stays on the Supabase functions,
because Workers Free stops a Madar call at 10 ms of CPU (section "The deploy suite on Workers Free").
- **Production calls:** 6,748 in October up to the 16th, about 422 a day (the owner's read-only check).
- **Setup:** `cloudflare-setup.ts --env production` made the Hyperdrive config `madar-db-production`
  (`21d31839432b41a8b2ca3f808891e04c`) and set the CORS rule of `madar-files`. `worker.sh production` made `madar-server-production`
  before the release, so `all.sh` only deploys it again. It stays unused (no Pages binding, the word stays `supabase`).
- **The R2 key** of production (bucket `madar-files` only): put, get and remove pass; a write to `madar-files-test` gives 403.
- **Moves:** the first copy and the copy right before the switch: 7 objects, 547,162 bytes, `"mismatched": []` both times.
- **Switch:** `secrets/production.env` `MADAR_FILE_STORE=r2` and `MIN_CLIENT_BUILD=2026.10.16.1`, then
  `echo production | VITE_MADAR_BUILD=2026.10.16.1 scripts/deploy/all.sh production` (the owner ran it: auto mode refused the lead,
  as `scripts/deploy/CLAUDE.md` says). `checks.sh`: health from `supabase` with `"fileStore":"r2"`, database check ok, `POST /mcp`
  with no token 401.
- **After:** `--copy-only`: 0 of 7 missing. `verify-r2-keys`: 7 of 7 present (1 file record, 17 feedback screenshots), none missing.
- **Live:** madar.vado.sa 200 with the title Madar, `/favicon.ico` 200, www 200, the live `index-C-wr3jRB.js` is the bundle of
  `cf92a0d3.madar-46r.pages.dev`, and the CSP names the R2 host.
- **Deploy suite on the test copy at ae63498** (the 13 spec files that failed on the Worker, on the Supabase host): 112 passed,
  3 skipped, 18 failed. 12 were the Settings test, which found two headings that start with "Notifications" (fixed in e0f0457:
  12 of 12 pass in the next run). 2 were single shell cases (no `h1` within 10 s; the language switch took more than 10 s). All 4
  walks failed: the quick add of a task (Enter in "Add a task") gave no row in the database at least once in each walk, and later
  steps failed after it. Open item in TASKS. The last full run of the suite before today was at 2bb11f5 (2026-10-06), so these
  three faults may be older than this release.

### The pooler client limit under load (2026-10-16, 9797fb3 and ff963e1)
The walk lost a task create in each of its 4 runs, and some screens showed "The data did not load". A network log inside the
walk caught the answer: a whole-batch 500 "Something went wrong" for the Admin, twice in one second.
- **Cause** (the function logs of madar-test, through the Management API `analytics/endpoints/logs`, ClickHouse SQL): the
  pooler refused new clients with `(EMAXCONN) max client connections reached, limit: 200`, from 18:00 UTC whenever the tests ran.
  Supabase served each request with a new worker: about one cold start for each request, every worker lived 75 s (p10 75.0 s,
  p99 75.04 s, 673 workers in 10 minutes), then stopped with `EarlyDrop`, and none took a second request. With the 120 s idle
  of the performance audit (SRV-3), each worker held up to 2 pooler clients for its whole life: about 85 workers at once filled
  the limit. The pooler log showed 730 clients opened and 706 closed in 4 minutes, so nothing leaked; the clients only stayed.
- **Production** (the same logs, read only): 212 cold starts on 2026-10-16 and 0 `EMAXCONN`. 15 people never fill the limit.
- **First fix, 9797fb3:** each Supabase entry closes its pools on `beforeunload`. The next run still had 34, then 129
  `EMAXCONN` in 5 minutes: alone it did not help.
- **Second fix, ff963e1:** `IDLE_TIMEOUT_MS` 1 s in place of 120 s (`server/data/sql.ts`). Under the same load (428 cold starts in
  5 minutes): 0 `EMAXCONN` and 0 failed batches. The deploy suite (acceptance, settings, shell, the 4 walks): 38 passed, 1
  skipped (Preview as), 0 failed, 19 minutes. A probe of 10 quick adds outside the walk had passed 10 of 10 before the fix.
- Not run for this change: `test:db` and `test:it` (the change is an entry and one pool setting; `npm test` 4,866 passed).
- **Production at ff963e1** (the owner ran `all.sh production`): `checks.sh` passed (health from `supabase`, `"fileStore":"r2"`,
  database check ok, `POST /mcp` 401), madar.vado.sa 200 with the title Madar, `/favicon.ico` 200, www 200, the live bundle is the
  one of `9e1127b4.madar-46r.pages.dev`, and the production logs had 0 `EMAXCONN` and 0 failed batches after the deploy.

### Test copy at b4eb2e6: exit waves 1 to 4 with the word supabase (2026-10-17, wave 5 R3)
- **Before the deploy:** the owner ran `npm install` in `deploy-test` (it added `bcryptjs`). GitHub started no CI job (the billing
  refusal of 13:08 UTC), so the gate ran on the Mac: `npm run typecheck` passed, `npm test` 5,393 passed and 6 skipped (532 files).
  `test:db`, `test:it` and `test:mcp` did not run again: after the wave 4 gate, only screens, two workflow files and their test
  changed.
- **`all.sh test`, run by Claude.** It had no keyboard, so the config question took its default (yes): the known `api.enabled`
  difference. No new migration. The functions api, mcp and jobs deployed; `api` answers in eu-central-1 with 117 calls.
- **The Worker `madar-server-test`** (version `1d1ba199`): the binding `OFFICE` (the empty office object, migration `office-v1`),
  `MADAR_TEST_TOOLS` on, `MADAR_DAY_CAP`, and the Cron `*/15 * * * *`. Its `scheduled()` returns at once while the word is
  `supabase`. The account has 1 Cron Trigger of 5 (`madar-server-test` only; read-only count through the API).
- **Not set yet:** `MADAR_EXPORT_SECRET` and `MADAR_OPS_SECRET` (wave 5 R2, the owner makes them). So the R3 check with the export
  secret waits for R2.
- **Checks:** `checks.sh` passed (health from `supabase`, `"fileStore":"r2"`, database check ok, `POST /mcp` with no token 401).
  `POST /api/office/export` and `/api/office/import` with no secret, and export with a wrong secret: 401 each. The test page is 200
  with the title Madar (`29694c3f.madar-46r.pages.dev`). Production did not change: madar.vado.sa 200, `x-madar-server: supabase`.
- **Not run:** the deploy suite. Production does not take this commit now; wave 5 R7 runs the suite on the office path.

### Wave 5 on the test copy, R1 to R5, and the pause (2026-10-18)
- **R2:** the owner made `MADAR_OPS_SECRET` and `MADAR_EXPORT_SECRET` (`scripts/office/new-secret.ts`; the second also as the GitHub
  secret `OFFICE_EXPORT_SECRET`). `auth-key.ts test` gave the Worker a new `MADAR_AUTH_PRIVATE_JWK` (kid `RC72NWU2...`), and
  `secrets.ts test` gave it both secrets. The sign-in key stays on the Worker: it is not in `WORKER_SECRETS`.
- **R3 check:** export begin with the secret gave schema 3, version 0, `officeSeq` 0 and 45 tables; the end of the hold answered.
- **R1:** 1 Cron Trigger of 5 in the account; 0 rows written by the office object of the UTC day before the import.
- **R4:** `import.ts --from test --mode empty`: 917 records and 4 sign-in rows in 22 parts, 8,878 rows planned, 20 s, version 2689,
  "The count and the hash of each table match the source." It ran at 09:48 Riyadh, not after office hours: it writes far under
  the cap of 50,000, and production uses none of the object limits before wave 6.
- **R5:** commit f7f504a (test `office`), `all.sh test` in office mode: health from `office;colo=JED` (117 calls), the office check
  passed, `POST /mcp` with no token 401 from the office host.
- **Speed** (`scripts/proof/server-time.sh 20`, 06:49 UTC, total medians): Supabase function anon 287 ms, health 334 ms, member
  350 ms; the page's own `/api` on the office host anon 140 ms, health 136 ms. The member step of the page path got 401 twenty
  times: the script signs in with Supabase Auth, and the office path takes only the tokens of the own sign-in. So this run gives
  no member call on the office path (a TASKS item).
- **The pause (owner, 2026-10-18):** the team asked for an important feature, so the move stops after R5. The test copy goes
  back to `supabase` in the same commit as this record: the test copy is the staging step of production, so it runs the stack of
  production. Nobody wrote on the office object after the import; it keeps the imported sample office, its secrets and its
  sign-in key. The Track R builder stopped after its rebase on main (no code; the note is 67ea87e on 0dad809). Production did not
  change at any step. The way back to the test phase: the word `office` again, `all.sh test`, and a fresh office with
  `import.ts --mode replace` or the seed, then R5 step 4.

### Production at 5350647 (2026-10-20, the owner ran it)
- The release: meetings wave 1 (5bc5458), the privacy page `/privacy` for Google (5e1e537), the chat batch (924eb2c, ced1a0a)
  and the chat on a phone (86ecc3c). `all.sh test` had put the same commit on the test copy, and the deploy suite passed at 924eb2c.
- First run: `db.sh` pushed `20261020000100_meetings.sql` and `20261020000200_message_search.sql`. Then `config.sh` stopped:
  the API step of `config push` got 500 from Supabase ("Postgrest config update did not succeed within the expected time
  frame", `ConfigPushApiUpdateStatusError`). `supabase/config.toml` had no change since b68a50e, and the Data API stayed off
  (`db_schema` empty; a read with the publishable key gave 503). The old release ran on the new tables with no fault.
- Second run of `all.sh production`: the migrations were up to date, the settings went through, then the secrets, the functions,
  the Worker and Pages (fb03c961). The checks passed: the health from `supabase` with 143 calls and the R2 file store, the
  database check, and `POST /mcp` with no token 401. The page answers 200 with the title Madar, `/privacy` 200 ("Madar
  privacy"), `/favicon.ico` 200, and the live page starts `bootstrap-BlRG-CER.js` of this build.
- Reports: fbk_030 and fbk_032 are done (the chat drop and paste). fbk_028 stays open: its part 2 (Mark as unread, owner
  2026-10-20) is in the meetings join.

### Production at 5a98255 (2026-10-20, the owner ran it)
- The release: the meetings join (be34823: meetings wave 2 with the minutes and Google Calendar, the team fixes fbk_028,
  fbk_029 and fbk_031, two security fixes), the Google calendar reuse (085ef64), the backup `--if-due` (6b18434) and the
  phone tab bar (5a98255). `all.sh test` had put the same commit on the test copy (the owner ran it). The deploy suite did
  not run on 5a98255.
- One run of `all.sh production`: `db.sh` pushed `20261021000100_meetings_settle.sql`, `20261021000200_google_calendar.sql`
  and `20261021000300_google_calendars.sql`; then the settings, the secrets (the three Google values are in
  `secrets/production.env`), the functions, the Worker and Pages (7d69fe6d). The checks passed: the health from `supabase`
  with 146 calls and the R2 file store, the database check, and `POST /mcp` with no token 401. The page answers 200 with the
  title Madar, `/favicon.ico` 200, the live page starts `bootstrap-BNuu_Fsn.js` of this build, and its index chunk holds the
  new phone bar.
- Reports: fbk_028, fbk_029 and fbk_031 wait for the owner's word that the release is live, then `feedback.setStatus` done.

### Production at 15a9815 (2026-10-20, the owner ran it)
- The release: the Arabic rewrite in the Thmanyah style (50093ad: 571 strings of the word files, the test pins, the mail
  snapshots and the rules in `src/i18n/CLAUDE.md`) and the What's new line 2026-10-23-32 (15a9815). No migration. `all.sh test`
  put the same commit on the test copy (the quick checks passed). The deploy suite did not run on 15a9815: only words changed,
  and the unit tests of the touched folders were green (363 of 364 files at the first run, the last pin fixed, then green).
- One run of `all.sh production` (the owner ran it): the database was up to date, then the settings, the secrets, the
  functions, the Worker and Pages (f1ec40c5). The checks passed: the health from `supabase` with 146 calls and the R2 file
  store, the database check, and `POST /mcp` with no token 401. The page answers 200 with the title Madar, and
  `/favicon.ico` 200.
- The commit of this record changes HEAD, so the next production needs `all.sh test` again.

### Production at 9a8aa6a6 (2026-10-20, meetings wave 3; Claude ran it on the owner's word)
- The release: meetings wave 3 (a meeting repeats every day Sunday to Thursday, every week or every 2 weeks; the edit and the cancel ask
  "This meeting" or "This and later meetings"; the 15-minute job keeps 8 meetings ahead with `meetings.extend`), the heavy test lock
  (`scripts/dev/heavy-lock.sh` in the npm scripts, 5 vitest workers), and the guide line that a backup runs only when the owner asks.
- Security review of `meetings.extend` (2026-10-20, two findings): it counted only the meetings that the caller sees and needed only the
  view. Now it counts the whole series (its loader reads every meeting of the series from today), and the caller must see the last meeting
  and may change it (`meeting.edit`). The job extends as the organizer, else the first active Admin of a project series; a private series
  of an organizer who left stops. A test reproduced the attack before the fix. The shadow run of `test:lite` found that the loader still
  dropped the hidden meetings; the loader fix closed it.
- Gates on the release commit: typecheck, npm test 7,909 (2 pinned script texts fixed after the lock; earlier timeouts passed alone),
  test:lite 2,008, test:office 38, the three builds (api bundle 757,096 of 760,000 characters), test:db 2,008, test:it 335, test:mcp 256
  with conformance 5 of 32, prototype smoke 87 of 87, 390 px shots of the repeat form, the scope question and the series line.
- `all.sh test` at 9a8aa6a6 (health 147 calls), `git push origin main`, then `all.sh production`: settings pushed, Pages 21c26e86, health
  from `supabase` with 147 calls and the R2 file store, the database check, `POST /mcp` with no token 401; the page 200 with the title
  Madar, `/privacy` and `/favicon.ico` 200, and the live page starts `bootstrap-l3Nn2aCd.js` of this build. No deploy suite ran before it:
  the owner chose speed. fbk_022 is done.

### Production at 55cae0c5 (2026-10-20, guides only; Claude ran it on the owner's word "merge to main, push then deploy")
- Three guide lines on top of 9a8aa6a6 (main without a folder, the pinned test scripts, the loader of a right on a hidden row), no code.
  `all.sh test` (147 calls), then `all.sh production`: health from `supabase` with 147 calls, the database check, `POST /mcp` with no
  token 401, the page 200.

### Production at 86bcf255 (2026-10-20, fbk_033: the Google Calendar connect; the owner ran it with `!` after the auto-mode check refused Claude)
- The cause, from the function logs: on production, 3 of the 4 connects between 12:05 and 12:08 Riyadh answered `google_unreachable` after
  3.5 to 3.7 s, and the one that worked ran 3.3 s. On the test copy the owner's connects ran 3.2 and 3.4 s and worked. A reconnect that reused
  the calendar was as slow, so the code swap (the first call to Google) takes most of the time, and the limit of 3 s cut it.
- The fix: the Google calls of `google.connect` share a budget of 15 s, at most 10 s for one call; a failed connect logs its step, code and HTTP
  status; the Ctrl+Z listener takes a keydown with no key (the TypeError in the report, from the password fill of Chrome); What's new 2026-10-23-55.
- Gates: typecheck, npm test 7,913 (6 skipped), the three builds, `server/it/google.it.test.ts` 12 of 12 on the local stack. `test:db`, the rest of
  `test:it`, the deploy suite and the screenshots did not run (no SQL change; the one visible change is a What's new line).
- The owner's connect on the test copy at 86bcf255 (13:10 Riyadh, a new Google account): state ok about 8 s after the callback, with three Google
  calls (the remembered calendar gave 404 for the new account, then a new calendar). The old limit would have failed it.
- `all.sh test` (147 calls), then `all.sh production`: health from `supabase` with 147 calls, the database check, `POST /mcp` with no token 401.
  Production serves `runtime-DFS4BLg9.js` with the new key check.

### Production at ab4b0d0a (2026-10-20, fbk_034 to fbk_036, the connection line, and the CLI update; the owner ran it with `!`)
- Changes: `tasks.help` (a team member joins a task as a helper with one tap, or leaves it; the lead gets `helper_joined`); `task.delete` for
  the lead of a project task, with `task_deleted` to the maker, and not for a lead who took the task themselves (`leadTookTask`, from the
  security review of the branch); the past-due sign of a task row wraps on a phone (`StatusSign wrap`); the connection line floats in the toast
  lane (`useStandingNotice`); What's new 2026-10-23-56 to 59. Before it on main: wrangler 4.151.2 and the Supabase CLI 2.121.0 (74a65de6),
  and the Arabic reset subject pin of `invites.it.test.ts` (2c19baea).
- Gates: typecheck, npm test 7,935 (2 files timed out under the load of another session and passed alone; the api bundle bound became 800,000
  at 760,035), the three builds, `test:db` 2,028, `test:it` 335, `test:mcp` 256 (conformance 5 of 32, as always), the prototype smoke 87 of 87,
  screenshots EN/AR, light/dark, at 390 and 1440. The deploy suite did not run.
- `all.sh test` (148 calls), then `all.sh production`: health from `supabase` with 148 calls, the database check, `POST /mcp` with no token 401.

### Production at adbc8e5f (2026-10-20, the past-due wrap in the Overview and the meeting views, and guide lines; the owner ran it with `!`)
- Changes: `StatusSign wrap` in `OverviewTab`, `MeetingProjects` and `PeopleStrip`; What's new 2026-10-23-58 names the four places;
  guide lines in `CLAUDE.md`, `src/CLAUDE.md`, `src/api/CLAUDE.md` and `tests/CLAUDE.md`.
- Gates: typecheck, the touched screen tests (21), `npm run build`, `build:remote -- test`, screenshots of the Overview (EN/AR,
  light/dark, 390). The owner asked to skip the full suite and the smoke (each over 5 minutes) for this one-flag change.
- `all.sh test` (148 calls), then `all.sh production`: health from `supabase` with 148 calls, the database check, `POST /mcp` with no token 401.

### Production at b84b0212 (2026-10-21, role rights version 2 and the past-due count of the office report; the owner ran it with `!` after the auto-mode check refused Claude)
- Changes (branch `rb/rr2`, spec `docs/superpowers/specs/2026-10-21-madar-role-rights-v2-*`): every power is a switch, 112 switches in
  13 sections, with places (Projects I lead, My projects, Every project, Office, No project), the leader powers and 13 AI assistant
  switches (one for each group of MCP tools; `ai_off`; `ai.connect` off stops every agent of the role). Member 64, Management 74,
  Accounting 68, the Admin all. Stored roles keep their meaning: an optional `off` list for the basics, the 17 old ids expand on read
  (`LEGACY_RIGHTS`), no migration. The 26 stand-in actions of `can()` are gone; every call and every control asks its own power.
  What's new 2026-10-23-75. Also in this release: a816c42a (session madar-e9), the office report counts past due to today while the
  period runs, with its test fix b84b0212.
- Proof that nobody gained or lost a power: `server/core/rightsParity.test.ts` records every shared call for 8 people (Admin,
  Management, Accounting, Member, an old custom role, a leader, a team member, an outsider) and the viewerCan flags, before the change;
  the record stayed equal, except the rows the owner approved (a new project or stage template is off for everyone but the Admin).
- Fixes found while building: the automatic security review (the Undo of another person's agent change needs the delete right; a
  checklist change that also ticks needs task.work); the merge (a stored switch whose need is off counts as off; the old "edit any
  project" keeps saving to-do templates); `test:it` (`reviewersOf` on an office loaded with no settings).
- Gates at 35a506ec (before the merge of main): typecheck, `npm test` 9,198 (757 files), the three builds (first load 1,216,617 B),
  `test:db` 2,907 (154 files), `test:it` 325 (the summary test after its fix), `test:mcp` 326 with conformance 5 of 32, the prototype
  smoke 87 of 87, screenshots EN/AR, light/dark, 390 px. After the merge of main: typecheck and 636 tests of the merged areas. Not run:
  the deploy suite (the owner chose the test copy now; the chat presence session stopped its own suite and took its two migrations off
  madar-test first).
- `all.sh test` at 90fd705, then at b84b021 (149 calls), then `all.sh production` by the owner: health from `supabase` with 149 calls,
  the database check, `POST /mcp` with no token 401, the page 200 with the title Madar, `/favicon.ico` 200; the live first-load script
  `permissions-*.js` holds the new switch ids.
- Rollback: after the first role save in the new form, the code before this release cannot read the new ids. A problem needs a fix.

### Production at 2701ea78 (2026-10-21, times in AM and PM; the owner chose "AM/PM to production now", Claude ran it)
- Changes: `clockFormat` (`src/lib/dates.ts`) writes English times on the 12-hour clock ("5:15 PM", the US form); Arabic was already
  12-hour («5:15 م»). The meeting view summary uses it in place of its own HH:MM. The fixed times in the words follow in both
  languages (the summary mail, the mail pause line, the Settings hint, the meeting start hint). What's new 2026-10-23-73. No MCP change.
- Gates: typecheck; `npm test` 8,216 (733 files); `npm run build`, `build:server`; shots at 390 px (EN/AR, light/dark). Not run: `test:db`,
  `test:it`, `test:mcp`, the prototype smoke, the deploy suite (no SQL, server or MCP change; the mail words have their render test).
- `all.sh test` at 2701ea7 (the presence session held its test deploy), then Claude's `all.sh production` passed the auto-mode check this
  time: health from `supabase` with 149 calls, the database check, `POST /mcp` with no token 401, and the live script holds the new clock.

### Production at 716c0a29 (2026-10-21, pictures for AI agents; the owner said "deploy" and ran it with `!`)
- Changes (branch `rb/mcp-pictures`): agents read the pictures that their person sees. The rows of `users.list` (`hasPicture`,
  `glow`), `subCompanies.list` (`hasLogo`), `projects.list`, `projects.get` and `reports.office` (`look`: the project color and the tile
  as an SVG) give the drawing rules; `withPictures: true` adds the picture data. The new tool `pictures.get` (no call of its own) gives
  one profile picture, logo, project tile or cover, as an MCP image block. One glow rule for the screens and the agents
  (`src/lib/glow.ts`). What's new 2026-10-23-72. In the team live week, on the owner's word.
- Gates: typecheck; `npm test` 8,214 (733 files); `npm run build`, `build:server`, `build:remote -- test`; `test:db` 2,212; `test:it` 325;
  `test:mcp` 278 (conformance 5 of 32, the normal result). Not run: `test:lite`, `test:office`, the prototype smoke, the deploy suite.
- Live check on the test copy at 716c0a2, as the member's agent (a script, no browser; `server/mcp/CLAUDE.md`): 53 tools with
  `pictures.get`, a real cover from R2 as a PNG image of 6,919 bytes, `prj_404` not_found; the script removed its agent.
- The second `all.sh test` stopped at the migration step: the chat presence proof had pushed `20261022000200_platform_presence.sql` to
  madar-test. Its session took the migration off (two policies dropped, `migration repair --status reverted`), then `all.sh test` at
  716c0a2 passed. Its later test deploy pushes the migration again.
- The auto-mode check refused Claude's `all.sh production`; the owner ran it with `!`: migrations up to date, settings and secrets,
  functions, the Worker, the screens; health from `supabase` with 149 calls, the database check, `POST /mcp` with no token 401.

### Production at e361e0cb (2026-10-21, the push line "Like WhatsApp"; the owner said "deploy", Claude ran it)
- Changes: the push carries a line encrypted for each browser (RFC 8291, `server/push/encrypt.ts`, the vector of Appendix A in its
  test): the name and the first words of a chat message, or the bell sentence of a notice, in the person's language. The server makes
  it by reading as the person (`server/push/line.ts`). `push.register` takes the keys of the browser; the start check sends them for a
  device saved before. `public/sw.js` shows the line and a press opens its link. What's new 2026-10-23-71. The stale office test of
  the 80% day meter warning went (its code went with the usage feature, b62c3787).
- Hand test on the test copy (owner's iPhone, member account): his phone sent its keys at the first open; a direct message, a group
  message and a task from the Admin gave three lines ("Hala Nasser" with the words, "Push test group" with "Hala Nasser: words", the
  project with "Hala Nasser gave you “Stair details”"), and each press opened its place. A second, older registration of the same
  person had no keys and got the empty push. Android was not tried by hand; the owner tries it on production.
- Gates: typecheck; `npm test` 8,188 (730 files); `npm run build`, `build:server` (the api bundle 774,427 of the bound 800,000),
  `build:remote -- test` (in `all.sh test`); `test:db` 2,212; `test:it` 325; `test:lite` 2,212; `test:office` 37 of 38, the one failure
  the stale test above (removed, then the file 4 of 4). The first `all.sh test` stopped at the screens build: `check-rtl` found raw
  direction marks that the Write tool saved in `src/lib/noticeSentence.ts`; the escapes fixed it (fbe62d77).
- `all.sh test` at e361e0c (149 calls), then `all.sh production`: health from `supabase` with 149 calls, the database check,
  `POST /mcp` with no token 401, the page 200 with the title Madar, `/favicon.ico` 200, and `/sw.js` holds the new `lineOf`.

### Production at fe21858a (2026-10-21, phone notifications for the Home Screen app, and the Apple fix; the owner said "Release now", Claude ran it)
- Changes (branch `rb/push-reach`): the Home card shows the 3 steps to the Home Screen on an iPhone or iPad in a browser tab; on Android
  one button opens the install box of Chrome (`src/app/remote/install.ts`); every push goes with `Urgency: high` and `TTL: 86400`;
  What's new 2026-10-23-70. These serve the Home Screen app until the store app comes (owner, 2026-10-20).
- **Apple fix.** In the owner's hand test on the test copy (2026-10-21), his iPhone (Home Screen app, Allow given) got no line. The
  outbox rows were done with no error, but the device had no `lastPushAt`, and the function logs (Management API
  `analytics/endpoints/logs`, ClickHouse SQL on the one `logs` table) showed "A push service refused a push" for `web.push.apple.com`.
  A direct post to his iPhone gave the reason: `400 {"reason":"BadWebPushTopic"}` for `Topic: madar`, also with the old headers
  (TTL 3600, Urgency normal) and a 1-hour token; `201` with no Topic, also with Urgency high and TTL 86400. So no iPhone got a
  Madar push from 2026-10-08 to this release. Apple now gets no Topic (`topicFor`, `server/push/send.ts`); the other services keep it.
  After the fix on the test copy, a message from the Admin reached the owner's iPhone.
- Gates: typecheck, `npm test` 8,149 (726 files), the three builds, `test:db` 2,205 (27 skipped), `test:it` 325, screenshots EN/AR,
  light/dark, 390 px (iPhone and Android, on the test copy), the deploy suite on the test copy at 68e209d: 206 passed, 0 failed,
  13 skipped by design. For the Apple fix (one header): typecheck and the server project 2,745.
- `all.sh test` at fe21858 (149 calls), then `all.sh production`: health from `supabase` with 149 calls, the database check,
  `POST /mcp` with no token 401, the page 200 with the title Madar, `/favicon.ico` 200.

## Performance audit (2026-10-07 to 2026-10-08)
Seven builders, one per track, on branches perf/track-<key> from perf/audit (8753a11). Each section is the proof of one track.

### Track B1: Home, Tasks and the lists
Branch perf/track-b1, 7 commits on 8753a11. Screen tests in jsdom over the sample office. No production contact, no contract change.
- RND-2 and RND-M1: a task panel that opens or closes renders no row again. Before, one open rendered every row again: Tasks +8, the Task list +4, the project Tasks tab +7, Home +2 task rows and +6 project rows, and New Project on Projects +9. After, all are 0, and the same holds on close. The render-count tests are in the WorkRenders, TaskListRenders, TasksTabRenders, HomeRenders and ProjectsRenders test files.
- RND-8: one Avatar makes 0 useTranslation calls (1 before). A language change still reaches pictures and dates at once.
- LIV-5: the project Tasks tab sends one taskTemplates.list {} in its first request. Before, it sent one call per stage (7 on prj_001), after tasks.list answered. The stage menus list the same templates in the same order.
- FET-8 (and LIV-4): with a stored role hint, an Admin's cold Home sends one projects.list {filter:'all'} in the first request. Before, it sent two, the second one round trip later.
- FET-9: over the sample office (11 people, 114 Home rows, 57 of them done), Home's mine list without the done rows equals tasks.list {filter:'mine', includeDone:false} for every person, in the same order. In the real build, Tasks shows these rows while its own answer loads.
- FET-12 b: a press on a project row starts projects.get, and the project page sends no second one.
Checks: npm run typecheck passes. 58 touched test files (357 tests) pass with --no-file-parallelism --testTimeout=60000, under a load average of 15 to 220 from other builders.

### Track D: the server request path
Probe: `scripts/proof/pooler.ts` (steps `start` and `idle`). The probe connects as postgres through the transaction pooler (aws-1-eu-central-1.pooler.supabase.com:6543) with the Supabase root CA and the host name, as the server does. It ran from the Mac with the sandbox off. Production was not touched.

1. Joined start (SRV-9). One simple query `begin isolation level repeatable read, read only; set local statement_timeout = '10s'` gives statement_timeout 10s, repeatable read and read_only on inside the transaction. After commit, the values are the outside values again: statement_timeout 2min (the role default of postgres), read committed, read_only off. The write form `begin; set local lock_timeout = '5s'; set local statement_timeout = '10s'` gives lock 5s and statement 10s inside. After rollback and after commit, the values are lock 0 and statement 2min. A joined start with a bad value (lock_timeout 'not a time') fails with 'invalid value for parameter "lock_timeout"'. The rollback after it succeeds, and the settings stay the outside values. Time from the Mac, median of 20: joined 98.7 ms against 324.3 ms for the three separate queries. Result: the pooler accepts the joined start, and the settings keep their scope.

2. Idle connections (SRV-3). A plain pg.Client with keepAlive gave 'select 1' in 98 ms. After 60 s idle it gave it in 169 ms, and after 120 s more idle (180 s in all) in 96 ms, with no client error. A pg.Pool with the new server settings (max 1, idleTimeoutMillis 120000, keepAlive true) did its first query in 954 ms (a new TLS connection from the Mac). After 60 s idle, the query took 116 ms on the same connection (1 connect). After 125 s idle, the pool had removed the connection (1 remove), and the next query opened a new one in 764 ms (2 connects in all). Result: the pooler keeps an idle connection at least 180 s, so the 120 s pool idle time is safe. A new connection costs about 650 to 850 ms more than a query on an open one from the Mac. In the region the cost is smaller, but it is still many round trips.

Not proved here: the joined start through Hyperdrive (Workers) and pg keepAlive on Deno. The it suites cover them (see the merge notes of track D).

### Track F: pictures and uploads
Branch perf/track-f, commits b5c6577, d9ebb3a and 5a4ad63. The track holds findings BGR-4 (steps 1 and 2), BGR-M1 and BGR-M2. The tests run on fakes and stubs only. No network, no Supabase project and no real browser was used.

- BGR-4: the signed link of a picture stays in the query cache for LINK_STALE_MS after the screen closes, in the real build only. Test: unmount, 6 minutes on fake timers, mount again. The result is the same URL and no new files.link call. Before the change, the same test gave link-2 and a second call. After LINK_STALE_MS plus 1 s, the next mount asks for a new link. The prototype keeps a gcTime of 300,000 ms. The Files row and meeting drawing pictures carry loading="lazy" and decoding="async".
- BGR-M1: with a canvas stub that gives image/png for 'image/webp' and image/jpeg for 'image/jpeg' (the Safari case), a 4032 x 3024 JPEG source gives an image/jpeg thumb of 960 x 720. The canvas writes WebP first, then JPEG, both at quality 0.8. PNG, GIF, WebP and AVIF sources give null. A JPEG that is not smaller than the source gives null. With WebP support, the result stays WebP after one encode. The upload adapter with the real makeThumb sends files.uploadStart with thumb.mimeType image/jpeg and sends the thumb PUT. On the server, files.uploadStart signs the thumb PUT with Content-Type image/jpeg, and the files.upload preflight keeps a JPEG staging thumb as thumbKey.
- BGR-M2: with a PUT stub that holds each upload, the thumb PUT starts before the file PUT ends. files.upload goes only after both end, in either order. A file PUT answered with the Storage 413 body still throws invalid_input, reason file_too_large, with the limit of session.get. A file PUT with status 0 still throws failed, reason upload_failed. In both cases files.upload never goes, also while the thumb PUT is still open.
- Not verified: a real iPhone upload of a portrait photo (EXIF orientation 6) from Safari. The code path is the same as for Chrome uploads today (see the merge notes).

### Track A: the first load and the fonts
Builds: the base 8753a11 (a git archive copy in $TMPDIR) and the head of perf/track-a (64c7524). Each remote build used the public values of config/remote.test.env and `VITE_MADAR_API=remote VITE_MADAR_BUILD=2026.10.7 npx vite build --mode remote-test`. Each prototype used `npx vite build`. The first load is the scripts of index.html, their static imports and the modulepreload links. Sizes are in bytes. gzip is level 9, file by file.

- Before: index.html starts 1 script (index, 1,785,586 B). That script imports the bootstrap chunk (227,579 B) with a dynamic import. Together they are 2,013,165 B, 573,386 B gzip. Both languages are in the index chunk.
- After: index.html starts 1 script and preloads 21 chunks, the bootstrap and supabase chunks included. That is 22 files, 1,041,965 B, 314,381 B gzip. The words of one language load next to them. With the English words: 24 files, 1,103,050 B, 333,857 B gzip (minus 45 % raw, minus 42 % gzip). With the Arabic words: 1,141,072 B, 339,659 B gzip.
- gzip of the first load after each step: base 573,386; BND-1 393,659; BND-2, 3 and 4 393,659 (the same bytes, which now start with the page); BND-5 384,950; BND-6 359,248; BND-7 333,856.
- Fonts: the three Thmanyah files (726,216 B) do not change. The remote index.html now preloads them. The digits and the middle dot came from the Inter Latin file (72,920 B). Now they come from a 10,340 B subset.
- CSS: 67,221 B (14,090 B gzip) before, 67,207 B (14,087 B gzip) after.
- Prototype file: 1,964,078 B (566,341 B gzip) before, 2,027,757 B (597,812 B gzip) after. BND-1 causes the growth. The one script file inlines the dynamic imports of src/app/screens.ts, and Rolldown wraps those modules in lazy start functions.
- The bundle check of the head fails the base remote build on 8 rules. It passes the head builds: remote on 12 rules with the public values, prototype on 4 rules.
- The Inter subset: fontTools (pyftsubset 4.63) gives the same outlines and widths for the 11 kept characters at wght 100, 400, 500, 600, 700 and 900 and opsz 14, 20 and 32 (198 drawings). It gives the same for the 10 tabular digits (180 drawings). The vertical metrics, the name records, the axes and the MVAR tags are the same. Two runs give the same bytes (sha256 05f8c1ce...).
- zod: `config` of `zod/v4/core` is the same function as `z.config`, and its object lives on globalThis (src/app/zodConfig.test.ts). So the jitless setting reaches every schema.

### Track E: the database
Where: the local stack, from the worktree of perf/track-e. Growth data of about one year goes in one transaction that rolls back: 60,900 events (900 with officeTaskId), 6,100 tasks, 20,000 comments, 15,000 messages, 30,000 notifications and 3,000 posts. EXPLAIN (ANALYZE) takes the best of 3 to 7 runs and compares the old loader code with the new code. In each case below, the answer is JSON-equal. The one exception is the DB-5 events read, which sends fewer rows on purpose; the whole dashboard.get answer is equal.

Proven:
- Statistics on doc->'officeTaskId' alone made the events.list read of a member after a meeting start slower: 22.9 ms became 37.5 ms. The text bound on created_at collate "C" with events_created_c makes it 0.04 ms. A member's events.list with limit 50 went from 59.3 ms to 0.10 ms.
- The local Postgres accepts `fetch first ($n::int) rows with ties` in a LATERAL subquery. The plans use events_project_created and messages_conversation_newest. The feed events of 120 projects went from 169.7 ms to 1.75 ms. The newest message of 342 chats went from 33.6 ms to 3.7 ms.
- comments_target_id and events_target_id serve the lookups by target_id alone. The comment count of one task went from 3.3 ms to 0.05 ms, and the delete events of gone targets went from 17.3 ms to 0.05 ms.
- The jsonb_build_object pick gives the same doc as jsonb_each and jsonb_object_agg. The tasks of 120 projects went from 22.4 ms to 8.9 ms.
- Whole loaders: projects.list of the Admin went from 72.4 ms to 11.5 ms. dashboard.get of the Admin went from 32.1 ms and 1.65 MB to 18.7 ms and 0.95 MB. chats.unreadCount of the Admin went from 63.4 ms and 231 KB to 28.4 ms and 92 KB. notifications.count of the Admin went from 138 KB to 67 KB (0.65 ms became 1.08 ms). events.undo of one task.created went from 33.4 ms to 16.2 ms.
- server/it/readIndexes.it.test.ts pins these plans on the local stack.

### The merge and the measurements (2026-10-08)
- Merge: the seven tracks into perf/audit, then main (two guide commits). One conflict (an import line of bootstrap.ts).
- Gates: typecheck; npm test 4,379 and 4,375 passed in two runs, each failure a load timeout that passed alone; the three
  builds and their bundle checks; db reset; test:db 1,097 passed (25 skipped); test:it 253 of 253; test:mcp 134 passed.
- Two fixes at the merge: the task panel prefetch put the zod schemas into the first load again (rowKeys.ts, limits.ts);
  the restore check took "public" of CREATE STATISTICS ... FROM "public"."events" for a role.
- First load of the remote build: the scripts 572,306 B gzip before, 318,488 B after (22 files); with the English words
  337,638 B, with the Arabic words 343,361 B. The prototype file: 566,359 B before, 574,611 B after.
- Live before (test copy at 66586d0, member and admin, 5 rounds, 1-minute load 3.3 to 5.9): page TTFB 69 ms; FCP 636 to
  680 ms; LCP 1,732 to 1,888 ms; first batch answer 1,588 to 1,720 ms; 3 CORS preflights; script 557 KB, fonts 353 KB.
  Lighthouse on the sign-in page: mobile 0.74 (FCP 4,070 ms), desktop 0.99. No console warning or error.
- The batch forwarder (FET-10), measured from the office city on the test copy: a POST through it 305 to 339 ms, a direct
  POST 285 to 287 ms, a direct preflight plus POST 537 to 558 ms. Not faster over a session: removed.
- Not measured: the live numbers after the deploy and the font priority test (the owner stopped them), the prototype smoke.


## Hyperdrive probe on madar-test (2026-10-16)

**Result: GO on the session pooler (port 5432), NO GO on the transaction pooler (port 6543).** Through real Hyperdrive in
front of the session pooler, the office lock waits and releases correctly, `lock_timeout` gives 55P03, the joined start keeps
its settings inside the transaction, `set local` works, and RAISE WARNING reaches the pg `notice` event. In front of the
transaction pooler, statements hang. Production was not touched.

**What ran.** Supabase `madar-test` only. Cloudflare account `d76d34779c63849f5acdf3d6af3751cd`:
- CA `supabase-root-2021-ca` (`056db33b-f928-46b0-8302-e167f5d1d832`), uploaded from `config/supabase-root-2021-ca.crt`.
- Hyperdrive `madar-db-test` (`1c4fc4b830234fad8956b6e80c52f4fc`): the session pooler, port 5432. Hyperdrive
  `madar-db-test-tx` (`5dee5c010db64061a45c5fd3ff592136`): the transaction pooler, port 6543. Both: host
  `aws-1-eu-central-1.pooler.supabase.com`, user `madar_server.qdgwpnesxppnqsaabqzd`, database `postgres`, `verify-full`
  with that CA, caching off. Both creates passed with `verify-full`, so the `require` fallback was not needed.
- Worker `madar-probe` (`[placement] region = "aws:eu-central-1"`, bindings `DB_SESSION` and `DB_TX`, secret
  `PROBE_SECRET`) and Worker `madar-probe-edge` (no placement, service binding `PROBE`). Both use pg 8.23.1,
  `nodejs_compat`, compatibility date 2026-09-01, and a pg Client for each request.
- Scripts in `scripts/proof/hyperdrive/`: `setup.ts` (the CA check and the configs, a second run makes no copy), `probe.ts` and
  `edge.ts` (the Workers), `run.ts` (the Mac side: `cases`, `cross`, `placement`, `e2e`, `sample`), `control.ts` (the same
  statements straight to the transaction pooler, no Hyperdrive). `lib.test.ts` tests the helpers. The probe repeats the
  statements of `server/data/sql.ts` (START, the two-key lock 7310999) and `server/signal/realtime.ts` (SEND, the warning text).

| Case | Session pooler (5432) | Transaction pooler (6543) |
|---|---|---|
| a. `select $1::int + 1` | 42, 15 of 15 (14 to 80 ms in the Worker) | Hung: `Query read timeout` after 8 s, 15 of 15; also with a 25 s wait (3 of 3) |
| b. Joined read start, `show` inside and after | Inside 10s, repeatable read, read only on; after: 2min, read committed, off (12 of 12) | Hung |
| b. Joined write start | Inside lock 5s, statement 10s; after 0 and 2min. The pid stays the same inside each transaction. A joined start with a bad value fails (22023), and the rollback leaves the outside values | Hung |
| c. Lock, three clients in one request | B waited 1,144 to 1,230 ms (867 ms in the one queued run) and got the lock within 4 ms of A's commit; C got 55P03 after 307 to 320 ms; D waited 6 to 26 ms (17 of 17 at limit 10) | Hung at `begin` |
| c. Lock across two HTTP requests | B waited 1,135 to 1,237 ms and got the lock within 7 ms of A's commit, two isolates in 7 of 8 (8 of 8 at limit 10) | Hung (12 of 12 requests); A answered once |
| c. Stale answers (`pg_locks` while the lock is held) | None: the same text, other text, simple query and inside a transaction all follow the lock (13 of 13 at limit 10) | "Protocol Error: Tried to recycle a connection still in a transaction" (once, at once) |
| d. `RAISE WARNING` | The `notice` event fires with severity `WARNING`, outside and inside a transaction | Hung |
| e. `realtime.send` (the server's SEND), then rollback | No error. Both sends gave `WarnSendingBroadcastMessage: no partition of relation "messages" found for row` (see fact 4), and the server's warning check counted 1 failed signal each | Hung |
| f. Timing in the Worker | New connect 2 to 12 ms; 20 x `select 1`: median 10.5 ms, max 14 to 17 ms; 5-statement transaction 34 to 95 ms (median 49.5 ms in 10 rounds) | Hung |
| g. Placement | Direct: runs in FRA 6 of 6, `cf-placement: remote-FRA`. Through the binding: the edge in MRS, the probe in FRA 6 of 6 | |
| h. Mac to the edge, one 5-statement transaction | New connection each round: median 419 ms (223 ms after TLS). One open connection: median 163 ms. In the Worker: 56 ms; the edge with the binding hop: 106 ms | |

**Facts found.**

1. **The transaction pooler behind Hyperdrive hangs.** 55 of 57 requests hung on a statement with no error (mostly the first
   statement, even `select 1` and `begin`), one failed at once with the Protocol Error above, and one answered. A 25 s wait and
   a limit of 10 connections changed nothing. This matches the field report in the Cloudflare move map.
2. **The connection limit decides the queue.** At `origin_connection_limit` 5 (the lowest value), one request often got only 1
   or 2 origin connections: the 5 pids of the pool came back, but a second transaction waited in its `begin` until the first one
   ended (up to 1,243 ms). Two transactions never held the lock at the same time; the wait only moved from the lock to the
   `begin`. `lock_timeout` does not cover that wait. A request that waits on its own open transaction (the probe's cache case)
   hung until the client timeout (3 of 12). At limit 10, the queue showed once in 17 lock runs (351 ms), and no case hung. Both
   configs now have limit 10, under the default Supavisor pool size of madar-test (`default_pool_size` not set).
3. **Placement.** `request.cf.colo` names the data center where the request came in (ZRH, MRS), also inside the placed Worker.
   The run location shows in the answer header `cf-placement: remote-FRA` and in the colo of a `/cdn-cgi/trace` subrequest
   (FRA). The Worker sees no `cf-placement` request header. A call through a service binding runs the placed Worker in FRA.
4. **madar-test has no Realtime partition for today.** `realtime.messages` has partitions up to `messages_2026_10_15`. The
   control (`control.ts`, straight to the transaction pooler, as the live test server sends) gives the same warning, so every
   change signal on the test copy fails today with or without Hyperdrive. A public channel join answered `PrivateOnly`, and the
   partition did not appear after it. The success path of `realtime.send` through Hyperdrive is therefore not proved here;
   the failure path (the WARNING that the server counts) is.
5. **The time of one statement.** Through Hyperdrive and the session pooler, one statement costs about 10 ms from FRA, not the
   1 to 3 ms that the Hyperdrive FAQ names. The repo has no number for the same statement from Supabase Edge Functions.
6. **Plan limits.** No error 1102 or other plan limit in about 280 probe requests.
7. Seen once, cause not proven: the control's first joined start on a new connection to the transaction pooler (no Hyperdrive)
   gave the notice "there is already a transaction in progress". Two later runs did not.

**Design consequences for the Workers track.**
- The Worker binding `DB` uses `madar-db-test` (the session pooler), with an origin connection limit of at least 10.
- `pgDb` sets no pg `query_timeout`, and `statement_timeout` starts only when the backend has the statement. A wait for an
  origin connection therefore has no limit in the server today. The Workers path needs a client-side limit (for example
  `query_timeout` on the pool config of the binding).
- The read pool and the write pool of `pgDb` share one Hyperdrive config, so under a queue a read can wait behind a write.
- The rule "the Worker stays only if it measures faster" needs the same batch call measured on both hosts (fact 5).

**After the probe.** Both probe Workers run again with `workers_dev = false`: their workers.dev addresses answer 404
(error 1042). The two configs, the CA and the secret stay. Nothing was deleted.

**Re-run.** Set `workers_dev = true` in both `wrangler.*.toml` files of `scripts/proof/hyperdrive/`, deploy `madar-probe`, then
`madar-probe-edge` (`npx wrangler deploy -c <file>`, sandbox off), then
`PROBE_SECRET_FILE=<file> node --import tsx scripts/proof/hyperdrive/run.ts <step>`. Set `workers_dev = false` and deploy again
after the run.

## The test copy on the Worker (2026-10-16)
Commit 59aa740 (`config/server-host.json`: test `workers`, production `supabase`), `all.sh test` on the Workers Free plan
(owner: "free is enough for now"). The first two runs stopped and were fixed: `checks.sh` stopped with no message on an answer
without `cf-placement` (221db29), and the Hyperdrive password PATCH got 2013 right after the new verifier (59aa740 tries again).
One `db.sh` run gave `DbPushMissingLocalError` with both files in the folder; `db.sh` alone passed a minute later.
- **Checks:** `preview.madar-46r.pages.dev/api/health` answers from `workers;colo=JED` with `cf-placement: remote-FRA` (the
  entry in Jeddah, the run in Frankfurt next to the database). The database check (database, lock, asyncContext) is ok through
  Hyperdrive, and `POST /mcp` with no token gives 401 from the Worker.
- **Speed** (`scripts/proof/server-time.sh 20`, from the Mac, 15:23 UTC). Medians of the whole request, in ms:

| Call | Supabase api function | Page api, then the Worker |
|---|---|---|
| CORS preflight (the screens pay it on Supabase only) | 305 | none |
| `session.get`, no token (401) | 308 | 148 |
| `session.get`, member (200) | 393 | 251 |
| `GET /api/health` with the jobs secret | 317 | 203 |

  The Worker is faster on each call (owner rule: it stays only if faster).
- **CPU time** (`wrangler tail madar-server-test --format json`, 60 events, every outcome `ok`): median 14 ms, p90 66 ms, max
  137 ms (a batch). Workers Free allows 10 ms for each request (error 1102 above it), so a median call is over the Free limit.
  No call failed in this run, but production on Free cannot count on that.
- **Statements** (`pg_stat_statements` of madar_server through the Management API, read only): 752 statements for 40 member
  calls, 40 health checks and 40 refusals (both paths). That is about 15 statements for each call at most (Hyperdrive counts one query for
  a joined start that Postgres counts as two or three statements).
- **How strict is the Free CPU limit** (throwaway Worker `madar-cpu-probe`, a fixed CPU loop, 2026-10-16 15:40 UTC; now
  `workers_dev` false, 404). The plan of the account is Free: a call with 60 fetches stopped at 50 with "Too many subrequests"
  (Paid allows 10,000). Yet the CPU limit of 10 ms did not stop calls: 60 calls of about 26 ms and 20 of about 150 ms all gave
  200; 10 calls of about 500 ms gave 9 times 200 and once 503 (error 1102). The heaviest Madar call measured 137 ms. This is
  Cloudflare behaviour that the documents do not promise (they say 10 ms): it can change without notice.

### The deploy suite on Workers Free (2026-10-16, fac41ca)
The deploy suite on the test copy with the server on `madar-server-test` (Workers Free), with `MADAR_E2E_AFTER_G`,
`MADAR_E2E_AFTER_M` and `MADAR_E2E_WALK`, 15:53 to 17:47 UTC, with `wrangler tail madar-server-test --format json` beside it.
The files were already on R2 (`MADAR_FILE_STORE=r2`, 72 sample files in `madar-files-test`).
- **Result:** 79 of 168 tests failed. The lead stopped the last test (walk en-390) after 15 minutes. One failure is a test
  fault: "Member daily work" waited for the Home panel "Today", and on a Friday with nothing due that panel is "Coming up" (the
  prototype smoke test got the same fix on 2026-10-12). The other 78 failed on server errors.
- **Cause: the Free CPU limit.** The tail gave 1,712 Worker events: 1,241 `ok` and 471 `exceededCpu` ("Worker exceeded CPU
  time limit.", answer 503). From 15:53:25, the first 474 calls passed with 24 s of CPU in total (460 of them over 10 ms, up to
  320 ms). From 16:00:20, Cloudflare stopped calls at 10 ms: the stopped calls have a median of 10 ms CPU. After that, about
  45% of the calls in each 10 minutes failed. The calls that passed have a median of 37 ms, p90 98 ms, max 320 ms.
- **What it means:** the short probe of 15:40 saw a grace that a steady load uses up in minutes. A Madar call needs more than
  10 ms, so neither copy can run its server on Workers Free. Both copies go back to `supabase` in `config/server-host.json`
  (the way back of `scripts/deploy/CLAUDE.md`). The Worker stays deployed and unused. Workers Paid ($5 a month) would lift the
  limit; the owner refuses paid plans (2026-10-16).
- **Database:** `pg_stat_statements` of madar_server went from 1,111,266 to 1,159,078 statements (47,812) for 1,232 calls of
  the usage meter, with one seed inside. On the Worker, Hyperdrive counts each one against the 100,000 queries a day of Free.
- **Files on R2:** no failure points at the files. The file store does not follow the server host, so the files stay on R2.


## Wave 0 of the Supabase exit: the office object on Workers Free (2026-10-16)
The question of the exit plan (`docs/superpowers/specs/2026-10-16-madar-cloudflare-exit-design.md`): does a Durable Object on
Workers Free get more than 10 ms of CPU for each call under a steady load? The probes are in `scripts/proof/do-cpu/`:
`madar-do-probe` (one SQLite Durable Object `Office`; each call runs a fixed loop and writes one row) and `madar-cpu-probe`
(the same loop in a plain Worker, the control). Both had a workers.dev address with a secret header during the runs; now
`workers_dev` is false (404). `wrangler tail --format json` read the CPU of each event.
- **Round 1** (18:03 to 18:34 UTC, one call each second to each probe): the object passed 1,797 of 1,797 calls (one network
  fault on the Mac, no answer from Cloudflare). Every one of its 1,795 logged events used more than 10 ms: median 16 ms, p90 47 ms,
  max 70 ms, `ok` each time. The control in the same minutes: 488 passed, 1,309 gave 503 `exceededCpu`.
- **Round 2** (18:35 to 18:50 UTC, the object only, heavier calls in turn): 899 of 899 passed, CPU min 32 ms, median 75 ms,
  p90 118 ms, max 135 ms, 67 s of CPU in 15 minutes. No event other than `ok`.
- **The front Worker** of the object used 0 to 3 ms for each call (it only hands the request on).
- **PBKDF2** with 100,000 rounds (SHA-256) inside the object: 30 to 35 ms of CPU (3 calls).
- **What it means:** on this account, the Free plan held a plain Worker to 10 ms, but did not stop the office object at 10 ms in
  45 minutes of steady load, up to 135 ms a call. This matches the 30 s of the Durable Object limits table, not the FAQ line.
  Cloudflare does not promise it in one clear place, so the exit plan keeps its way back.
- Not measured yet (the rest of wave 0): the rows read of heavy calls on one year of data, a socket to an object that sleeps,
  bcrypt.

### Wave 0, the rest: rows, sockets and sign-in crypto (2026-10-16)
Two probes of the exit plan, in `scripts/proof/do-rows/` (local `wrangler dev`, nothing in the cloud) and
`scripts/proof/do-socket/` (`madar-socket-probe` on Workers Free, now `workers_dev` false, 1042).
- **Rows, the counter rules** (local workerd, SQL cursor `rowsRead` and `rowsWritten`): an insert writes 1 row, plus 1 for each
  index, plus 1 for the hidden key index of a `text primary key` table. An update writes 1 plus 1 for each indexed column in
  SET (also with the same value). A delete writes 1. An `order by` with no matching index reads each row twice. A statement
  takes at most 100 bound values. `ANALYZE` read 1.67 million rows and made two notification reads about 260 times worse.
- **Rows on one year of made-up data** (15 people, 138,053 records, 146,680 rows with the server rows, 90 MB): the chat badge
  `chats.unreadCount` reads 21,064 rows for a member and 56,258 for the Admin on each call (it counts the message history and
  scans every task comment), about 75% of all rows read. Home open: 32,783 (member) and 66,859 (Admin). `dashboard.get` 6,015,
  `projects.list` about 4,000, `tasks.list` (mine) 4,431, `search.query` 2,795 to 8,074, `notifications.count` 99 to 2,585.
  Writes: `tasks.complete` 39 rows, `tasks.update` 36, `comments.create` 44, `chats.send` 22. A cold wake reads 1,459 rows
  from the tables or 1 from a one-row snapshot (232 KB). The nightly export reads 146,681 rows (3% of a day).
- **A day of rows** (production 422 and the test copy 2,000 a day, a work-day mix in `day.mjs`): as ported, 3.3 million rows
  read (65% of Free) if those counts are calls, 7.25 million (145%) if they are requests of 2.5 calls. With a stored unread
  number for each person and chat (an estimate, not measured): 1.9 million (38%). Rows written: 21,000 to 47,000 (21 to 47%).
  A deploy suite day: 172,030 read and 33,971 written.
- **The import of a year** writes 980,549 rows, almost 10 Free days of writes. Today's production is small, so an import now
  is cheap.
- **Sockets** (Hibernation API, 3 clients, 32 minutes): the object slept after under 15 s of quiet, and 5 of 5 broadcasts after
  gaps of 15 s to 10 minutes woke it and reached every open socket. The auto-response answered 59 of 60 pings and never woke
  the object. Cloudflare closed no idle socket in 10 minutes. One socket broke with code 1006, and the object kept it in
  `getWebSockets` for at least 17.7 minutes with no `webSocketClose`: a sweep by the auto-pong time is needed. 0.04 GB-s of
  duration in 32 minutes.
- **Sign-in crypto CPU**: bcrypt cost 10 (the Supabase hashes) 77 to 95 ms in the object, 20 of 20 passed. ES256 verify in the
  front Worker 0.59 ms median, 1.13 ms p99. ES256 sign in the object under 1 ms.
- **What it means:** sockets and crypto fit Workers Free. Rows read is the tight limit, and the chat badge decides it. The plan
  needs a stored unread number, sorts in JavaScript, no ANALYZE, and a test that pins the rows read of each heavy read.

### Wave 1: the transaction facts of the office object (2026-10-17)
Probe `scripts/proof/do-tx/` (exit plan, wave 1 Task 1), on local workerd through wrangler 4.147.0 `createTestHarness`. It
never deploys. Run: `node scripts/proof/do-tx/run.mjs` (sandbox off).
- **rollback**: `{"error":"stop","rows":[]}`. A `ctx.storage.transaction(async ...)` closure that writes, awaits, writes and
  then throws keeps no row. The async transaction rolls back.
- **microtask** and **timer**: the log of A is `["A:start","A:end"]`, and the log after the race is
  `["A:start","A:end","B"]`. The second request (B) runs only after the open transaction ends, also when the closure waits on
  20 timers. No request runs inside an open transaction.
- **timerFail**: A throws after its timers. The log of A is `[]`, the log after is `["B"]`. B ran after the rollback and kept
  its row: B never joins the transaction of A.
- **rolledBackWritten**: 2. The cursor of a rolled-back insert reports 2 rows written (the row and its key). Whether the bill
  counts them stays unknown; the meter of wave 3 counts them.
- **foreignKeys**: `pragma foreign_keys` is 1 (on by default). The schema has no foreign key (plan, Global Constraints).
- **subsec**: `unixepoch(x, 'subsec')` works (1792141200.5). **julian**: `julianday` compares with milliseconds (later = 1).
- **numbered**: `?2` and `?1` bind in number order. **dollar**: `$1` with one value gives that value. The rule stays "never
  `$1`": SQLite binds it as a named value in the order of first use, so two names in another order bind wrong.
- **boolean**: the object binds a JS `true` as the text `'true'` (node:sqlite refuses it). The host converts a boolean to 1 or 0
  before it binds (Task 4), so both hosts store the same value.
- **values100** passes, **values101** fails with "too many SQL variables". **indexedBy** works. The `before update` trigger
  refuses an update ("events only grow", `SQLITE_CONSTRAINT_TRIGGER`). **returning** gave the insert order here; the code
  still never trusts it. **tableValuedPragma** works. **sqliteMaster** read 8 rows for one name. **missingTable** gives
  "no such table: schema_version". **fullkey** gives `$.a[0]` and `$.a[1]`.
- **Decision:** option B holds (an async `transaction()` closure with a synchronous `sql.exec` behind the async query). Wave 1
  continues with Task 2. The rule "no await on the network, a timer or `crypto.subtle` inside a transaction" stays: the object
  holds every other request while a transaction is open, so a slow await stops the whole office.
- **Limit:** local workerd only. The deployed object runs the same runtime; wave 5 checks the race again on the test copy.

### Wave 1: the SQL texts of test:db (2026-10-17)
Exit plan, wave 1 Task 2. A logger that was not committed wrapped `client.query` in `server/test/db.ts` and wrote each text and
its test file to a file. Run: `MADAR_SQL_LOG=<file> npm run test:db` under the Docker lock, at 6119fdf.
- **Result:** 81 files, 1,141 passed, 25 skipped (the same as CI at 4cbdc95). 2,755 calls, 17.6 ms a call in `runCall`.
- **Texts:** 170,578 statements, 210 distinct texts (`$1`, `$2` read as `$n`, first 140 characters). 79 are the loader selects of
  `sqlSource.ts`; 131 are hand texts or texts that a builder makes from a table name.
- **No idempotency text ran:** test:db sends no statement of `server/core/idempotency.ts`. Task 12 ports its texts from the code.
- **No story read ran:** only `insert into stories`. The other texts of `server/core/story.ts` also come from the code (Task 12).
- **Postgres only:** the texts of `pgDb` (`savepoint madar_tx`, `set local statement_timeout`, `set local lock_timeout`) need no
  SQLite form: the SQLite Db has no savepoint and the host gives its own transaction. `pg_advisory_xact_lock` (the office lock)
  needs none in the office object, because the object runs one request at a time (Task 12).
- **Out of wave 1:** `server/auth/invite.ts`, the sign-in link of `officeCache.ts`, `server/mcp/revokeAll.ts`,
  `server/calls/people.ts` (`users.invites`) and `server/calls/agents.ts` (`agents.list`) are wave 2. `server/mail/quota.ts` is
  wave 3. These are the names of `LATER_CALLS` and `LATER_KINDS` (Task 14).

The table folds each text that a builder makes from a table name into one row. "Distinct" is the count of distinct texts in the
row. Rows are sorted by calls.

| Text (first 80 characters) | Calls | Distinct | Source file | Wave |
|---|---|---|---|---|
| select doc from <table> order by ord (24 tables) | 105264 | 24 | server/data/rows.ts selectDocsSql (loadWhole, the harness read-back) | wave 1 (Task 14, liteLoadWhole) |
| savepoint / release / rollback to savepoint madar_tx; set local statement_timeout, lock_timeout | 11971 | 5 | server/data/sql.ts (pgDb) | none (Postgres only: liteDb has no savepoint) |
| set local role; set constraints all deferred; savepoint madar_down; alter table events disable/enable trigger; select current_schema(); delete from counters | 10958 | 9 | server/test/db.ts | wave 1 (Task 14) |
| insert into <table> (id, doc, ...) select r->>'id', r->'doc' ... from jsonb_array_elements($1::jsonb) with ordinality (the tables that the save writes) | 6854 | 25 | server/data/rows.ts upsertSql (save, harness write-down) | wave 1 (Task 8) |
| select t.ord / x.ord / ord, doc / t.<col> as v / b.k as v (the loader selects) | 6224 | 79 | server/data/loaders/sqlSource.ts | wave 1 (Tasks 9 to 11) |
| select prefix, n from counters | 6220 | 1 | server/data/rows.ts (sqlSource.ts, whole.ts) | wave 1 (Tasks 8, 10) |
| select md5(string_agg(...)) (the leak checksum); select tablename from pg_tables | 5622 | 2 | server/test/invariants.ts | wave 1 (Task 14, liteChecksum) |
| select version, now() as at, coalesce(xmin::text::bigint = (pg_current_xact_id_i | 2766 | 1 | server/data/officeCache.ts | wave 1 (Task 7, readLiteOffice) |
| set constraints all immediate | 2164 | 1 | server/data/save.ts, server/test/db.ts | wave 1 (Task 8: none, no foreign key) |
| insert into counters (prefix, n) select key, value::integer from jsonb_each_text | 2039 | 1 | server/data/rows.ts COUNTERS_UPSERT_SQL | wave 1 (Task 8) |
| select pg_advisory_xact_lock($n::bigint) | 1848 | 1 | server/core/lock.ts | wave 1 (Task 12: none in the object) |
| insert into stories (id, actor_id, created_at) values ($n, $n, $n) | 1822 | 1 | server/core/story.ts | wave 1 (Task 12) |
| begin / rollback | 1460 | 2 | server/test/db.ts (one transaction for each test) | wave 1 (Task 14) |
| select 'users' as c, id, ord, doc, auth_user_id::text as auth from users where c | 1163 | 1 | server/data/officeCache.ts | wave 1 (Task 7, readLiteOffice) |
| update office_meta set version = version + $n, office_seq = office_seq + $n retu | 1080 | 1 | server/data/save.ts | wave 1 (Task 8) |
| update office_meta set version = version + 1 returning version | 809 | 1 | server/test/db.ts (write-down) | wave 1 (Task 14) |
| insert into person_seq (user_id, seq) select unnest($n::text[]), 1 on conflict ( | 457 | 1 | server/data/save.ts | wave 1 (Task 8) |
| select id, undoes from events where undoes = any($n::text[]) | 455 | 1 | server/data/loaders/sqlSource.ts | wave 1 (Task 10) |
| select tbl, id from office_deletes where chg > $n::bigint | 323 | 1 | server/data/officeCache.ts | wave 1 (Task 7: none) |
| select <col> as v, count(*)::integer as n from <table> where <col> = any($1::text[]) group by <col> | 267 | 2 | server/data/loaders/sqlSource.ts | wave 1 (Task 10) |
| delete from <table> where id = any($1::text[]) (21 tables) | 220 | 21 | server/data/rows.ts deleteSql | wave 1 (Task 8) |
| insert into / select from / update upload_intents | 159 | 3 | server/files/intents.ts | wave 1 (Task 13) |
| insert into outbox ...; update outbox set claimed_until / done_at / error | 99 | 4 | server/core/effects.ts | wave 1 (Task 12) |
| select doc, auth_user_id ... from users; select 1 ... from outbox where kind = 'auth.invite'; update outbox set payload ... (5 texts) | 86 | 5 | server/auth/invite.ts | wave 2 |
| pg_advisory_xact_lock(int, int); with today as (...) from mail_log; update mail_log set resend_id | 60 | 3 | server/mail/quota.ts | wave 3 |
| insert into office_deletes (tbl, id, chg) select $n, unnest($n::text[]), $n::big | 53 | 1 | server/data/rows.ts OFFICE_DELETES_SQL | wave 1 (Task 8: none, no office_deletes) |
| select doc from users / files / tasks / feedback where id ... | 51 | 4 | server/files/records.ts | wave 1 (Task 13) |
| with mine as (select distinct target_id from comments where target_type = 'task' | 36 | 1 | server/data/loaders/sqlSource.ts | wave 1 (Task 10; the badge, Track R) |
| select (doc->'after') ? 'email' as changed, doc->>'actingForId' as actor from ev | 14 | 1 | server/auth/effects.ts | wave 1 (Task 13) |
| with v as (update office_meta set version = version + 1 returning version) updat | 12 | 1 | server/data/officeCache.ts (the sign-in link) | wave 2 |
| with links as (update agent_links set revoked_at = now() where revoked_at is nul | 9 | 1 | server/mcp/revokeAll.ts | wave 2 |
| select doc->'versions' as versions from files where project_id = $n union all se | 9 | 1 | server/files/effects.ts | wave 1 (Task 13) |
| select id, auth_user_id::text as auth from users where kind = 'human' | 1 | 1 | server/calls/people.ts (users.invites) | wave 2 |
| select payload->>'userId' as user_id, max((payload->>'sentAt')::timestamptz) as  | 1 | 1 | server/calls/people.ts (users.invites) | wave 2 |
| select client_id::text as client_id, agent_user_id, redirect_host, approved_at,  | 1 | 1 | server/calls/agents.ts (agents.list) | wave 2 |
| select k as key from unnest($n::text[]) as k where exists (select 1 from files f | 1 | 1 | server/files/effects.ts | wave 1 (Task 13) |

### Wave 1: test:lite (2026-10-17)
Exit plan, wave 1 Tasks 14 and 15. `npm run test:lite` runs the rule tests of `src/api` and the shadow run on node:sqlite
(Node 22.23.1), with the mirror backend of `server/test/liteHarness.ts`: a new in-memory office for each test, no Docker.
Both runs at 5a58fba, load average about 4 on the Mac.
- **test:lite:** 81 files passed; 1,141 passed, 25 skipped (the db-mode skip list). Speed line: `lite mode: 2755 calls, 1.5 ms
  a call in runCall, the run took 6 s.`
- **test:db** (under the Docker lock): 81 files passed; 1,141 passed, 25 skipped. Speed line: `db mode: 2755 calls, 15.1 ms a
  call in runCall, the run took 30 s.` Postgres did not change, and both runs make the same calls.
- **Fixes:** none. The first whole run was green: Tasks 9 to 13 had given every text that the rule tests send a SQLite form.
- **The log of every call:** a run that was not committed wrote each warn and error line of the fakes to a file. All 37 lines
  are names of `LATER_CALLS` and `LATER_KINDS`, each with the host refusal of a Postgres text: the kinds `auth.invite` (12),
  `auth.ban` (9), `agents.revokeAll` (9), `auth.email` (3), `auth.unban` (2), and the calls `users.invites` (1) and
  `agents.list` (1). No other text failed.
- **The check can fail:** with the update of a task row taken out of `server/data/lite/save.ts` (not committed), test:lite
  failed 181 tests in 23 files, each with the shadow message (`tasks.complete: the database saved another change than the
  whole office in memory`).
- **LATER_CALLS (wave 2 unless named):** `users.invites` and `users.resendInvite` (the invite texts of `server/calls/people.ts`
  and `server/auth/invite.ts`), `agents.list` and `agents.remove` (the agent links of `server/calls/agents.ts`), `usage.get`
  and `usage.retryEffect` (wave 3: the meters of `server/usage/meters.ts` and the outbox job on SQLite). Only `users.invites`
  and `agents.list` ran in this suite, and both may answer an error (`src/api/handlers/pushLeaks.test.ts`).
- **LATER_KINDS (wave 2):** `auth.invite`, `auth.ban`, `auth.unban`, `auth.email`, `auth.emailNotice` (the sign-in effects of
  `server/auth/effects.ts` and `server/auth/invite.ts`) and `agents.revokeAll` (`server/mcp/revokeAll.ts`). Their outbox
  rows fail and stay for the job, as in db mode. `auth.emailNotice` did not run in this suite.

### Wave 1: the rows pins on one year of data (2026-10-17)
Exit plan, wave 1 Tasks 17 and 18. `server/office/pins.wd.test.ts` runs in `npm run test:office` on local workerd (wrangler
4.147.0 `createTestHarness`, sandbox off). The year office of Task 17 (`server/office/test/yearOffice.ts`) grows the sample
office to 132,221 records: 6 copies of the project work, 62,000 events, 26,000 notices, 20,000 messages, 12,000 comments,
6,000 files, 2,600 posts and 1,500 Tracker entries, each record valid for its zod schema. Measure run:
`MADAR_PINS_MEASURE=1 npm run test:office -- server/office/pins.wd.test.ts --silent=false` (vitest prints the lines of a test
that passes only with `--silent=false`). Each ceiling is the measured value plus 10% (`Math.ceil`).

| Read | Person | Wave 0 rows (first ceiling) | Wave 1 rows | Ceiling |
|---|---|---|---|---|
| chats.unreadCount | usr_005 (member) | 21,064 | 15,449 | 16,994 |
| chats.unreadCount | usr_001 (Admin) | 56,258 | 15,425 | 16,968 |
| chats.list | usr_001 | 56,516 | 15,445 | 16,990 |
| notifications.count | usr_005 | 2,585 | 1 | 2 |
| notifications.list | usr_005 | 4,934 | 107 | 118 |
| tasks.list (mine) | usr_005 | 5,432 | 2,221 | 2,444 |
| tasks.list (review_for_me) | usr_002 | 3,200 | 2,305 | 2,536 |
| projects.list (all) | usr_001 | 5,094 | 1,843 | 2,028 |
| dashboard.get | usr_001 | 6,015 | 4,100 | 4,510 |
| search.query "plan" | usr_005 | 3,059 | 1,038 | 1,142 |
| search.query "zqxv" (no match) | usr_005 | 8,074 | 7,034 | 7,738 |
| events.list (limit 50) | usr_001 | 680 | 79 | 87 |
| events.list (limit 500, the last hour) | usr_001 | 653 | 17 | 19 |
| events.list (prj_001, limit 50), new | usr_001 | none | 62 | 69 |

- **Writes** (the call of `everyCall` on the year office): `tasks.complete` 59 rows written (wave 0: 39; ceiling 65),
  `tasks.update` 16 (36; 18), `comments.create` 21 (44; 24), `chats.send` 11 (22; 13).
- **Why tasks.complete is over its wave 0 value:** the call completes tsk_007 as the Admin. It writes 4 events, 1 comment
  (5 rows), 1 Tracker entry (3), 2 task updates, the project, the story (3), `office_meta`, 3 counters and 1 snapshot part. Each
  event writes 10 rows: the row, its key and 8 indexes. The same call writes 59 rows on the sample office too, so the office
  size does not change it. The wave 0 number came from the probe's own call on generated data. Step 5 found no event index that
  no read needs, so the ceiling goes over the wave 0 value.
- **Import:** 132,221 records, 912,969 rows written, 6.90 for each record (wave 0: 7.1; ceiling 7.5). The count includes the
  schema of the first request.
- **Cold wake:** the first call after an evict reads 2 more rows (the schema version and the snapshot part; ceiling 4).
  workerd refuses an evict while a stub to the object is alive ("it still has active references"), and the miniflare proxy frees
  a stub only after Node collects it. So the pins test sends every call of the year office through fetch (`/rpc` of the test
  object, `officeByFetch` in `server/office/test/harness.ts`). The import also needs `load` to replace the settings row, because
  the schema makes it.
- **ANALYZE:** the year office has no `sqlite_stat` table after all the pins.
- **The event indexes (Step 5):** one-off runs (not committed), one new year office for each index, with that index dropped:

| Index | The read that needs it | Rows read with it | Rows read without it | Decision |
|---|---|---|---|---|
| events_project | events.list with projectId prj_001 | 62 | 12,815 | kept |
| events_target_id | notifications.list of usr_002, with tsk_010 taken out before the import (919 notices with a gone target) | 4,189 | 65,842 | kept |
| events_project_created | projects.list (all); projects.get; updates.list | 1,843; 29; 37 | 183,416; 17,670; 17,672 | kept |
| events_story | events.list with the story of one new tasks.update | 4 | 62,003 | kept |

- Only projects.list of the 13 wave 0 read pins moved when one index was dropped: no pin had a read with a project, a story
  or a gone target. So the rule "keep it out when every read pin stays under its ceiling" alone would cut three indexes that a
  read needs. Task 18 added the pin of events.list with a project. The reads of events_target_id and events_story need a gone
  target and a new story, which the year office does not have (TASKS.md).
- **Result:** no index is cut. `LITE_SCHEMA_VERSION` stays 1, and `PINNED_SHA256` stays. One dropped event index saves 1 row
  for each event: `tasks.update` 18 to 17 and `tasks.complete` 57 to 53 in the cut runs.
- The copies of the year office keep the story ids of the seed, so one seed story holds 5,460 events. events.list with that
  story reads 10,926 rows with events_story and 1,749 without it. A real story holds a few events.
- **A day of rows** (the mix of `scripts/proof/do-rows/day.mjs`, run as a copy outside the repo, so `day.json` did not change):
  production on the year office with the wave 1 numbers where Task 18 measured them (one person each), and the wave 0 numbers
  for the other calls, the jobs and the export; the test copy at the wave 0 numbers of the sample office; a cold wake reads 2
  rows. If 422 and 2,000 are calls: 1,980,047 rows read (39.6% of the Free 5 million) and 20,333 written (20.3% of 100,000).
  At 2.5 calls a request: 4,290,072 read (85.8%) and 45,700 written (45.7%). Wave 0, as ported: 65% and 145%.
- The chat badge (`chats.unreadCount` and `chats.list`) is still 2,548 of the 3,169 rows of an average production call (80%).
  Track R (the stored unread number) still decides the budget. The badge pins keep the ported number until it merges.

### Wave 1 of the Supabase exit: done (2026-10-17)
Exit plan, wave 1 Task 19. The merge gate ran once on `rb/cloudflare` at d27f504 (the tip before this record), on top of
`origin/main` 97bbf1c (the rebase changed nothing). The main session merges the branch. Load average about 2.5 to 3.
- `npm run typecheck`: pass.
- `npm test`: 481 files passed; 4,954 passed, 6 skipped (about 74 new tests in wave 1).
- `npm run build`: pass (bundle check of the prototype). `npm run build:server`: pass; no `cloudflare:workers` import in
  `supabase/functions/_build/{api,mcp,jobs}.js` or `dist-server/worker.js`. `npm run build:remote -- test`: pass (sandbox off).
- `npm run test:lite`: 81 files passed; 1,141 passed, 25 skipped (the db-mode skips). `lite mode: 2755 calls, 1.4 ms a call in
  runCall, the run took 6 s.`
- `npm run test:office`: 2 files, 8 passed (the host checks, `everyCall` parity, two writes at one time, the five rows pins
  tests). Sandbox off.
- `npm run test:db` (under the Docker lock, after `npx supabase db reset` from this worktree): 81 files passed; 1,141 passed,
  25 skipped, the same as at the start of the wave. `db mode: 2755 calls, 12.1 ms a call in runCall, the run took 25 s.`
- `npm run test:it` (under the Docker lock): 33 files, 276 passed. Wave 1 changed no file in `server/it` or `src/api`.
- No change of behaviour on either copy: no deploy, no change to `wrangler.server.toml` or `config/server-host.json`.
- Open items for waves 2 and 3 (TASKS.md): wave 2, the calls of `LATER_CALLS` (`users.invites`, `users.resendInvite`,
  `agents.list`, `agents.remove`) and the effect kinds of `LATER_KINDS` on SQLite, and the sign-in link of `officeCache.ts`;
  wave 3, `usage.get` and `usage.retryEffect`, the mail quota, the mail and push producers with the notice ids of the Diff, a
  day meter that counts rolled-back writes, and the rows pins of the reads that keep `events_target_id` and `events_story`;
  Track R, the badge pins drop when the stored unread number merges; wave 5, the transaction race on the deployed object.

### Wave 2 of the Supabase exit: sign-in and agents (2026-10-17)
Exit wave 2 plan, Tasks 1 to 22 (`docs/superpowers/plans/2026-10-17-madar-exit-wave2-signin-plan.md`), on `rb/exit-signin`
(46a1eff to 760d4c6). The own sign-in for people and AI agents on the SQLite path: schema version 2, PBKDF2 passwords, ES256
tokens, links, sessions, the copied bcrypt hash (owner decision 4), OAuth 2.1 with the Madar approval inside, and the two screens
ports. Nothing changed for production or the test copy: no deploy, `config/server-host.json` stays
`{"test":"supabase","production":"supabase"}`, no `VITE_MADAR_AUTH` line, no file in `functions/`, no Worker secret.

The facts of this wave, each with its source:
- PBKDF2 on local workerd (wrangler 4.147.0 `createTestHarness`, in the object and in a plain Worker): 100,000, 100,001 and
  600,000 rounds all pass. Deployed Workers Free refuse more than 100,000 (Cloudflare Community, 6 October 2026: "Pbkdf2 failed:
  iteration counts above 100000 are not supported (requested 240000)"; workerd issue 1346). The code keeps 100,000, and
  `server/auth/own/password.test.ts` pins it.
- ES256 on local workerd: P-256 `generateKey`, `sign` (64 bytes) and `exportKey('jwk')` work in the object; a binding that the
  config does not name is `undefined` in the object env (the wave 2 plan, facts checked on 17 October 2026).
- jose 6.2.12 exports `SignJWT`, `importJWK`, `exportJWK`, `generateKeyPair`, `calculateJwkThumbprint`, `createLocalJWKSet`,
  `jwtVerify` and `base64url` (the package exports).
- bcryptjs 3.0.3 (April 2026, the latest) is an ES module and imports the bare module `crypto` (index.js line 32). It bundles and
  runs in the office object on local workerd with `nodejs_compat`: `compareSync` of a cost 10 hash passes, and the row then holds
  a `pbkdf2-sha256$100000$` hash (`server/office/signin.wd.test.ts`). It has no dependency of its own.
- The MCP client discovery of `@modelcontextprotocol/sdk` 1.32.0 (`buildDiscoveryUrls`) for the issuer `https://madar.vado.sa/mcp`
  tries `/.well-known/oauth-authorization-server/mcp`, then `/.well-known/openid-configuration/mcp`, then
  `/mcp/.well-known/openid-configuration`. The OIDC form needs `jwks_uri`, `subject_types_supported` and
  `id_token_signing_alg_values_supported` (SDK schema `OpenIdProviderMetadataSchema`). `server/mcp/oauth/sdk.test.ts` runs the
  whole flow with the SDK on node:sqlite: discovery, registration, the code through the Madar approval, the PKCE exchange,
  `tools/list` (41 tools), the refresh, and the refusal of a used code.
- The MCP draft: a client uses a Client ID Metadata Document when the server says so, else Dynamic Client Registration (RFC 7591).
  Madar keeps registration and does not say `client_id_metadata_document_supported` (that document is a fetch, and the office
  object does no network work).
- `npx wrangler pages functions build` accepts `functions/.well-known/oauth-authorization-server/[[path]].ts` and routes
  `/.well-known/oauth-authorization-server/*` (checked in a scratch folder). Wave 5 adds that file; `server/http/pagesWellKnown.ts`
  holds its logic.
- `auth.users` of Supabase has `id`, `email`, `encrypted_password` (bcrypt `$2a$10$...`), `email_confirmed_at`, `banned_until`,
  `raw_user_meta_data` and `deleted_at`. The local Supabase Auth stores `$2a$10$...`, and `SIGNIN_EXPORT_SQL` reads it
  (`server/it/signinExport.it.test.ts`). The nightly backup dump holds `auth.users` (`scripts/backup/check.test.ts`).
- node:sqlite: `json_set` with `json_insert(..., '$[#]', ...)` keeps a list and adds a key once; `json_patch` after `json_remove`
  drops the token and the renew key. The partial index `outbox_signin` serves a query only when it repeats the exact term
  `kind in ('auth.invite', 'auth.email')`; `kind = 'auth.invite'` alone scans the outbox.
- The miniflare 5.20261001.0-alpha Node RPC proxy cannot carry a rejected Durable Object call ("The expression evaluated to a falsy
  value: (typeHeader === \"Promise\")"). A refusal test goes through the `/rpc` fetch path of the harness (`officeByFetch`).

The merge gate ran once, on `rb/exit-signin` at 760d4c6 with no rebase (the main session does the merge), under the Docker lock
`wave2-gate` for the whole run. Load average 3 to 20 on 10 cores; no test failed.
- `npm run typecheck`: pass.
- `npm test`: 502 files passed; 5,092 passed, 6 skipped (wave 1 ended at 4,954: 138 new tests).
- `npm run build`: pass (the prototype bundle check: no "supabase" in any case, one script file).
- `npm run build:server`: pass. `grep -l 'pbkdf2-sha256' supabase/functions/_build/*.js dist-server/worker.js` printed only
  "no own sign-in in the bundles".
- `npm run build:remote -- test` (sandbox off): pass; the first-load scripts are 1,128,685 B of 1,350,000 B.
- `npm run test:lite`: 81 files passed; 1,141 passed, 25 skipped. `lite mode: 2755 calls, 1.7 ms a call in runCall, the run took 7 s.`
- `npm run test:office` (sandbox off): 3 files, 11 passed.
- `npx supabase start -x edge-runtime` and `npx supabase db reset` from this worktree, then `npm run test:db`: 81 files passed;
  1,141 passed, 25 skipped (Postgres did not change). `db mode: 2755 calls, 12.6 ms a call in runCall, the run took 24 s.`
- `npm run test:it`: 34 files, 277 passed (with `server/it/signinExport.it.test.ts`).
- `npm run test:mcp`: 19 files, 173 passed; "conformance: 5 of 32 scenarios pass; 27 expected failures" (the baseline of today).
- The prototype smoke runs at the merge (main session).

The sign-in specs of the deploy suite (`account.spec.ts`, `signin.spec.ts`, `agents.spec.ts`) and the screenshots of the Madar
port run at the merge of waves 2 and 3 on a local `wrangler dev` (Merge notes, item 13): before wave 3, no Worker serves the
office object.

Open items (TASKS.md): wave 3 connects `SigninOffice` to the object method for one batch, passes `ownApiRoutes` and `mountOAuth`
in the hosts, `liteAgentOf` and `liteAuthAdmin` in the object, and runs `cleanupSignin` once a day; the merge of waves 2 and 3 runs
the sign-in specs and the screenshots; wave 4 reads `SIGNIN_EXPORT_SQL`, calls `importSigninRows` and copies `SIGNIN_TABLES` in
the restore check, and names `MADAR_AUTH_PRIVATE_JWK` in `scripts/deploy/secrets.ts`; wave 5 adds the `.well-known` Pages
Function and `VITE_MADAR_AUTH=madar` for the test copy; Client ID Metadata Documents only if an AI app needs them.

### Wave 3 of the Supabase exit: the office object, live updates and jobs (2026-10-17)
Exit wave 3 plan (`docs/superpowers/plans/2026-10-17-madar-exit-wave3-live-plan.md`). Nothing deployed. Built on `rb/exit-live`
from main 1782ca9 in four blocks; the main session rebases and merges the branch.
- Facts checked while planning (17 October): a Worker RpcTarget passed into an object method is callable from the object until the
  method returns, also with a timer on the Worker side (local workerd probe); tags, attachments and the auto-pong time survive an
  evict with `webSockets: 'hibernate'`, and a message wakes a new boot that still finds every socket; `worker.scheduled()` of the
  harness runs `scheduled` and its `waitUntil`; wrangler 4.147.0 gives `[env.production]` no binding, no migration and no Cron with
  `migrations = []` and `crons = []`, and inherits the top-level migration and Cron in `[env.test]`; calls on a stub inside one
  RPC session are not billed as more Durable Object requests (pricing page); a DO error carries `overloaded` or `retryable`.
- The merge gate ran once at 611cffc, with no rebase (the main session rebases at the merge). It held the Docker lock
  (`wave3-gate`) from the first full suite to the last. Load average 65 during `npm test` (another wave ran beside it), 5 to 14
  after it.
  - `npm run typecheck`: pass.
  - `npm test`: 492 files; 5,050 passed, 6 skipped, 5 failed. The 5 were 5 s timeouts at a load average of 65 in 2 files that
    wave 3 did not change (`src/features/projects/TeamFilter.test.tsx`, `scripts/deploy/deploy.test.ts`). Both files alone
    (`--no-file-parallelism --testTimeout=60000`): 55 of 55 passed. So 5,055 passed, 6 skipped (about 100 new tests in wave 3).
  - `npm run build`: pass. `npm run build:server`: pass; `cloudflare:workers` once in `dist-server/worker.js`, never in
    `supabase/functions/_build/{api,mcp,jobs}.js`. `npm run build:remote -- test`: pass (sandbox off).
  - `npm run test:lite`: 82 files; 1,149 passed, 26 skipped. `lite mode: 2755 calls, 1.5 ms a call in runCall, the run took 6 s.`
    The 26th skip is the fake test of `live.ticket` (`src/api/handlers/serverFakes.test.ts` skips each fake server call in lite
    and db mode), not a lost test.
  - `npm run test:office`: 5 files, 27 passed, 53 s (the host checks, `everyCall` parity and the rows pins of wave 1; the batch
    suite 8, the socket suite 6, the Cron suite 4 and the Cron pin of wave 3). Sandbox off.
  - `npm run smoke:office`: 6 of 6 ok (the real `dist-server/worker.js` on `wrangler dev` with the office path on).
  - `npm run test:db` (after `npx supabase db reset` from this worktree): 82 files; 1,149 passed, 26 skipped. `db mode: 2755
    calls, 12.7 ms a call in runCall, the run took 24 s.`
  - `npm run test:it`: 33 files, 276 passed, 3 min 56 s. `npm run test:mcp`: 15 files, 148 passed; "conformance: 5 of 32
    scenarios pass; 27 expected failures."
  - Not run by the builder: the prototype smoke (the main session runs it, as the contract and `bootstrap.ts` changed).
- The Cron rows pins (`CRON_PINS`, `server/office/test/pins.ts`), on the year office after a first run wrote its reminders:
  quarter 1,486 rows read (first ceiling 3,012, now 1,635), hourly 14,695 (first ceiling 10,000, now 16,165). The hourly value is
  above its first ceiling. The trace of the run: `FILES_BYTES_LITE` (`server/usage/meters.ts`) reads 13,200 rows, one for each of
  the 6,000 files and one for each of their 7,200 versions (`json_each` counts each element it gives); the dedupe lookup of the
  reminders reads 750, the trigger loader 708 in 54 statements, the rest under 25. The first ceiling counted one row for each file
  only. A day: 72 quarter runs and 24 hourly runs, about 460,000 rows read of the 5 million of Free (about 9%).
- The Cron Triggers of the account before the merge: not counted by the builder (no Cloudflare API call in the build). The main
  session counts them before the first `all.sh test` (plan Task 19 Step 3).
- Facts of the last block: the `tasks.move` entry of `everyCall` moves `tsk_007` to `in_progress`, which is its seed status, so
  on a fresh sample office it changes nothing and sends no signal; the live suites use the `tasks.update` entry. `wrangler dev`
  keeps the object storage in `.wrangler/` beside its config, so a smoke that checks "no job run yet" passes only once there; the
  smoke keeps its state in its own temporary folder (`--persist-to`). The Cron suite passed at a load average of 65.

### The merge of exit waves 2 and 3 (2026-10-17)
`rb/exit-live` (wave 3, a39db27) took main (e8992a3: waves 1 and 2 and two wave 2 security fixes) with one merge commit
(4580e70), then the sign-in parts on the office object (item 8 of the wave 3 Merge notes), one security fix and one check of the
effects. Nothing deployed: no push, no account change, no Cloudflare API call, no `MADAR_DATA` in any deployed env.

The conflicts and the rulings of the main session:
- `server/data/lite/schema.ts`: `LITE_SCHEMA_VERSION = 3`; `SERVER_SQL` and `SERVER_INDEXES` hold the tables of both waves;
  `LITE_STEPS = { 3: [USAGE_DAY_SQL] }` with no step for the sign-in tables; `SIGNIN_TABLES` stays. The new `PINNED_SHA256` is
  `c49f6537d134306da01fa3de218c05d543bb4cc86453e27b5fe3424f71888137`. The step test (it drops only `usage_day`, from version 2)
  passes unchanged.
- `server/mail/quota.ts`: the two SQLite `reserve` forms did the same work (count the day, "ok" for a known ref, else add a row).
  The merge keeps the forms of wave 2 (`DAY_COUNT_LITE`, `RESERVE_LITE`, whose insert also does nothing on a known ref, so it
  cannot throw), `RELEASE_LITE` and `RECORD_SENT_LITE`, and the forms of wave 3 for `markFirstRefusal` and `sentToday`
  (`REFUSAL_MARK_LITE`, `SENT_TODAY_LITE`). No other file named the removed `RESERVE_COUNT_LITE` and `RESERVE_ADD_LITE`. The quota
  tests of both waves pass.
- `server/test/liteHarness.ts`: `LATER_CALLS` and `LATER_KINDS` are empty; the harness keeps `liteAuthAdmin`.
- `src/app/remote/bootstrap.ts`: `liveKindOf(auth, flag)`. The Madar build opens the live socket (it has no Supabase client), the
  Supabase build keeps Realtime unless `VITE_MADAR_LIVE=socket`. `quietChangeSource` is gone.
- `server/office/test/{pinOffice,harness}.ts`: `cron`, `signin`, `importSignins` and `peek` in every list.
  `server/workerGraph.test.ts`: both describes.

The sign-in parts on the office object:
- (a) `officeParts` takes `liteAuthAdmin({ db, clock })`: the invite and auth effects run in the object, only the mail goes
  through the Worker port.
- (b) `Office.signin({ signin, input })` runs `runSigninOp` with the keys of `MADAR_AUTH_PRIVATE_JWK` (imported once for each
  value of the secret, before any transaction). Each of the 13 names reaches its step; an unknown name answers not_found; no key
  answers failed and logs the name of the secret.
- (c) `officeRoutes` takes `routes` and mounts them under `/api` inside the Workers host (`runInHost`, so `clientAddress` reads
  `x-madar-client-address`). `officeEntry` passes the routes of `ownApiRoutes` when the key is set
  (`server/entries/officeSignin.ts`). Fact: `ROUTES` holds the forgot and renew routes, and they read the database, which the
  Worker of the office path does not have (`refusingDb`). So each runs in two object calls: `Office.mailRoute` (the shape check
  and the limits, answered at once with the value of the mail work) and, after the answer, `Office.mailWork` (the mail). The
  Worker pads the answer to 1.5 s as the routes do. The routes take a `work` option for it.
- (d) The step `signin` (`cleanupSignin`) runs in the first Cron run after 00:00 UTC (`server/office/jobs.ts`).
- (e) `/mcp` on the office path: the Worker hands each request to `Office.mcp` in one call (plain data: url, method, headers,
  text body). The object runs the MCP app with the own issuer, the own agent token check, `liteAgentOf`, `mountOAuth`, the server
  secret key for the reason key, and a fetch that refuses (no region hop in the object). Each tool call runs on the batch path
  (`runOfficeEntries`, the who kind `agent` through `principalOfWho`), so its effects run as for a batch and its mails and pushes
  run after the answer (`runEffects`). With no key, `/mcp` answers 503. CORS of the office path covers `/api/*` only, as on the
  Postgres path. Reason for the form: each step of the MCP app reads or writes the database (agent check, rate limit, office),
  so in the Worker each request would need three or four object calls and a copy of the office snapshot.
- Fact (smoke:office): with `MADAR_AUTH_PRIVATE_JWK` set, `verifyBrowserToken` needs `MCP_URL` (the issuer of the own tokens);
  without it every batch answered a hidden 500. The smoke sets both for the run.

The security fix (from the background check of ebd74fe): `runOfficeBatch` gave `officeChanged` from `batch.office` at the end
of the batch. A later read entry loads the office again, so `[users.deactivate, users.list]` reported no change and the sockets
of the turned-off person stayed open. The flag is now set after each entry (`runOfficeEntries`). The test failed before the fix.

The check of the effects in the object: one `users.deactivate` batch through `officeParts` wrote one outbox row (`auth.ban`;
`agents.revokeAll` runs inside the turn-off transaction on SQLite), ran it with no error and no host refusal, banned the sign-in
row, and ended the agent link, the approval and both sessions. Nothing needed a fix.

The merge gate ran once under the Docker lock `merge-gate`:
- Load average 3 before `npm test`, 17 during `test:office`; no test failed and no suite ran twice.
- `npm run typecheck`: pass.
- `npm test`: 515 files; 5,228 passed, 6 skipped (wave 3 alone 5,055, wave 2 alone 5,092).
- `npm run build`: pass. `npm run build:server`: pass; `cloudflare:workers` once in `dist-server/worker.js` and never in
  `supabase/functions/_build/{api,mcp,jobs}.js`; `pbkdf2-sha256` once in `dist-server/worker.js` (the own sign-in of the office
  path, allowed by Merge note 11 of wave 3) and never in the three Supabase bundles. `npm run build:remote -- test` (sandbox
  off): pass.
- `npm run test:lite`: 82 files; 1,149 passed, 26 skipped. `lite mode: 2755 calls, 1.5 ms a call in runCall, the run took 6 s.`
- `npm run test:office` (sandbox off): 7 files, 32 passed (the suites of waves 1 to 3, `signin.wd.test.ts` of wave 2 and the new
  `mcp.wd.test.ts`).
- `npm run smoke:office`: 10 of 10 ok (the 6 of wave 3, the key set, a password step, the OAuth metadata and the token refusal of
  `/mcp`).
- `npx supabase start -x edge-runtime` and `npx supabase db reset` from this worktree, then `npm run test:db`: 82 files;
  1,149 passed, 26 skipped. `db mode: 2755 calls, 12.6 ms a call in runCall, the run took 27 s.`
- `npm run test:it`: 34 files, 277 passed. `npm run test:mcp`: 19 files, 176 passed; "conformance: 5 of 32 scenarios pass; 27
  expected failures."
- Not run by the merge builder: the prototype smoke and every Playwright run (the main session), the sign-in specs of the deploy
  suite and the screenshots of the Madar port (moved to wave 4: they need the seed of wave 4).

### Wave 4 of the Supabase exit: backups, import and deploy (2026-10-17)
Exit wave 4 plan (`docs/superpowers/plans/2026-10-17-madar-exit-wave4-ops-plan.md`), on `rb/exit-ops`. Nothing deployed: both copies
say `supabase`, no Worker got a secret, `office-backup.yml` is off (no `vars.OFFICE_BACKUP_URL`), and no Cloudflare or GitHub call ran.
- Facts checked while planning (17 October): wrangler 4.147.0 `deploy --var KEY:VALUE` gives a plain-text binding; the forgot and
  renew routes need the database; the summary job sends again without its `job_runs` row; the sample office holds 908 records.
- The round trip of the year office (Task 15): 132,221 records, 912,996 rows written, 6.91 for each record; every table equal.
- One seed of the sample office (Task 16, `server/office/ops.wd.test.ts`): 908 records, 6,216 rows written for a replace of an
  earlier seed (its deletes and the new rows). Decision 6 used about 7,000 for each seed.
- The local office stack (Task 22, `npm run dev:office`): the seed wrote 908 records and the 4 accounts; `POST /api/auth/token` as
  the Admin answered 200 and `POST /mcp` with no token 401; the screens answered on 127.0.0.1:4174; every one of the 35 SQLite forms
  of `tests/e2e-deploy/office.ts` ran through the peek route of the real bundle. The stop left no port, state folder or `run.env`.
- Facts of the deploy suite on the office path (Task 17): the walk sends 36 SQL texts (the plan named 18); 35 have a SQLite form,
  and the `storage.objects` count needs none (office copies keep their files on R2). The `users` table of the object holds only
  `id` and `doc` (email, kind and active live in the doc), and the sign-in link is `auth_users.user_id`. SQLite has no array: a
  list goes as JSON text into `json_each(?n)`, `json_group_array` gives one back, and a count goes as text (`cast(count(*) as
  text)`), the type of the Postgres form. The batch answer is `results[i].output`.
- `parseSecretsFile` (`scripts/deploy/secrets.ts`) takes `MADAR_OPS_SECRET` and `MADAR_EXPORT_SECRET` (the Worker gets them on every
  host word, the Supabase functions never) and refuses `MADAR_AUTH_PRIVATE_JWK` in a file.
- The local do-tx race with the secret guard (Task 21): the same answers as "Wave 1: the transaction facts" (rollback rows `[]`;
  the micro and timer races log `["A:start","A:end","B"]`).
- The merge gate, each command once, under the Docker lock `wave4-gate` (no rebase on main: the main session merges):
  - `npm run typecheck`: pass.
  - `npm test` (load 3.5): 532 files, 1 failed: `scripts/playwright-deploy-config.test.ts` (a spec that calls `passwordOf` must turn
    traces off; the grant cleanup of `agents.spec.ts` called it). The fix f1c6cd1 takes the browser token of the page instead. The
    second run (load 8.6): 532 files; 5,389 passed, 6 skipped (125 s).
  - `npm run build`: pass. `npm run build:server`: pass; `cloudflare:workers` once in `dist-server/worker.js` and never in
    `supabase/functions/_build/{api,mcp,jobs}.js`. `npm run build:remote -- test` (sandbox off): pass, with the api function as
    `VITE_API_URL` (the test copy still says `supabase`).
  - `npm run test:lite`: 82 files; 1,149 passed, 26 skipped. `lite mode: 2755 calls, 1.5 ms a call in runCall, the run took 6 s.`
  - `npm run test:office` (sandbox off, load 18 at the start): 9 files, 37 passed (90 s).
  - `npm run smoke:office`: 10 of 10 ok.
  - `npx supabase start -x edge-runtime` and `npx supabase db reset` from this worktree; `npm run test:db`: 82 files; 1,149 passed,
    26 skipped (`db mode: 2755 calls, 11.6 ms a call in runCall, the run took 23 s.`); `MADAR_AGE=... npm run test:it`: 35 files,
    279 passed (238 s); `npm run test:mcp`: 19 files, 176 passed, "conformance: 5 of 32 scenarios pass; 27 expected failures.";
    `npx supabase stop`.
- Not run by the builder: every Playwright run (Task 22 Step 6: the sign-in, account and agents specs on the local office stack and
  the 20 screenshots of the Madar sign-in screens; the main session's delegated helper) and the prototype smoke (no screen changed).
- Task 22 Step 6, the main session (2026-10-17, delegated helpers on `npm run dev:office`, one worker):
  - First run: `account.spec.ts` 8 of 8, `agents.spec.ts` 6 of 6, `signin.spec.ts` 18 of 23. The 5 failures read the kept session
    under `madar.auth`, the Supabase key; the own sign-in keeps it under `madar.session`, with other field names and the end in
    milliseconds. The same fault was in the first load: `main.tsx` read only `madar.auth`, so a madar build loaded the Sign in
    screen also for a signed-in person. Fix c50d0d0 (test first): `SESSION_KEYS` and `hasStoredSession` in
    `src/app/remote/authMode.ts`; the spec picks the key and the fields from the target. Run again: `signin.spec.ts` 23 of 23.
  - The consent screen showed "can also use your account outside the Madar screens" on the own stack, where every own route
    refuses an agent token (the Z7 risk does not exist there). Fix 8f5eac5 (test first): `agentReachesAccount: false` of
    `madarOAuthPort` leaves the line out; the Supabase build keeps it. Run again: `agents.spec.ts` 6 of 6, 3 lines in EN and AR.
  - The screenshots (390 px, EN and AR, light and dark): sign-in, forgot, reset, welcome, the session sheet and consent. No cut
    text, overlap or sideways scroll. The prototype smoke after c50d0d0: 87 of 87. `npm run build` and `build:remote -- test`
    after 8f5eac5: both bundle checks pass (first load 1,131,652 B).
  - The local sign-ins of one run stayed under the own limit (30 for one address in 15 minutes): no limit refusal.

## Map basemap probe (2026-10-18, fbk_017, Task 11)

**Status: pending: the file is not built and not uploaded; waits for the owner OK.** Nothing in Cloudflare changed: no

**Update 2026-10-19 (owner): the screens use OpenFreeMap now.** The street map is free with no account, no key and no bill: tiles from
`https://tiles.openfreemap.org/planet` (OpenMapTiles schema, CORS open), glyphs from `/fonts/{fontstack}/{range}.pbf`. Probe with curl: the
stacks `Noto Sans Regular` and `Noto Sans Bold` answer 200 for 0-255 (76 KB) and 1536-1791 (96 KB, the Arabic block); the presentation-form
ranges answer 404, and the Arabic labels still shape correctly with the RTL text plugin (Playwright shots, 2026-10-19). The style is written by hand
in `src/features/map/mapStyle.ts`. The Arabic text plugin is a file of the build (`?url`). The own file below stays in the repo as the later
option (`functions/map`, `server/http/pagesMap.ts`, `scripts/map/build-basemap.sh`); no screen reads it, and nothing in Cloudflare changed.
The short Google Maps link has its own small Pages Function `/maplink` (`server/http/pagesMapLink.ts`): it follows the redirect and keeps nothing.
binding, no bucket and no wrangler setting.

- Built in the repo: `server/http/pagesMap.ts` (the key rule, the range rule, the content types and the route), its test
  `server/http/pagesMap.test.ts` (21 tests), and the Pages Function `functions/map/[[path]].ts`.
- Until a binding named `MAP` exists, every request under `/map` answers 404 with `map_not_ready`, on every host.
- Written, not run: `scripts/map/build-basemap.sh`. It builds `sa.pmtiles` (Saudi Arabia, up to zoom 15), the
  glyph files of Noto Sans Regular (they hold the Arabic block too), and `rtl-text.js`. Without `--upload`, it uploads nothing.
- Checks for this section: `server/http/pagesMap.test.ts`, 21 of 21 pass. `npm run typecheck` passes.

Open for the owner (Task 11, Steps 3 to 5):
- The newest Protomaps daily build. The owner or the merge lead sets `PMTILES_SOURCE`. No build is chosen yet.
- The OK for the R2 upload. Then the bucket (default name `madar-map`) and the `MAP` binding in the Pages project.
- The size of `sa.pmtiles`.
- The measurement on the test copy: the time to the first tiles from Al Khobar, and the requests for one map view. The
  results go here after the run.
- The fallback (free OpenFreeMap tiles, same style) when the probe fails.

### Wave 4 report data: reports.office (2026-10-18, Task 28)

- The read `reports.office` gives one office report for a week, a month, a quarter or a year. Only the right `report.office` reads it.
- The loader counts the stage moves, the completions and the pauses of the period in SQL, one count for each key. It reads the review
  events of the period once, with four fields each, and the handler counts the reviews of each person from them. It loads the tasks
  of the projects (a task has no date column), the Tracker entries and, for the payment right, the payments.
- The condition `atBefore` gives the exact end of a period. It is a timestamp test in SQL, in the memory source and in the SQLite
  compile. Its text bound (36 hours after the time, in UTC text) lets the created_at index stop at the end of the period. Before this fix
  the upper end had no text bound, so each read ran from the start of the period to the end of all the data.
- Rows read by `reports.office` (the office harness, rowsRead of the office object), on the year office of the pins (10 active people,
  62,000 events, 864 tasks, 1,500 Tracker entries). Each period starts on a day of the period shown:
  - Year (start 2026-01-01): 240,966 rows. Before this fix: 782,202 rows.
  - Quarter (start 2026-07-01): 86,150 rows. Before this fix: 356,931 rows.
  - Month (start 2026-09-01): 23,194 rows. Before this fix: 183,802 rows.
  - Week (start 2026-09-28): 5,138 rows. Before this fix: 133,675 rows.
- Rows pin: `reports.office` (year 2026, Admin) in `server/office/test/pins.ts` has a ceiling of 265,063 rows: the measured 240,966
  rows plus 10%, rounded up. The ceiling is high on purpose. Each of the four event reads visits every event of the period, because
  the events table has no index on the verb. A verb index would cut the rows, but it is a schema change, so it is not in this fix.
- Server time of a year report on the test copy (2026-10-18, commit 7183347, sample office with 11 projects, as the Admin, from the
  Mac in Al Khobar, 7 samples for each read, 500 ms between samples, script `report-time.mts` of the merge lead):
  - First run: median 0.43 s for the year read.
  - Second run (load average 3.6 on the Mac): `session.get` median 659 ms (an empty call, the reference), `reports.office` week
    median 703 ms, year median 696 ms. The slowest year sample was 1,590 ms.
  - The year read costs about 40 ms more than the empty call. Most of the time is the trip from the Mac to Cloudflare and to
    Supabase, not the report. The whole request stays under 2 s in every sample but one outlier of the empty call (2,508 ms), so the
    Supabase limit of 2 s of CPU for each request is not near.
  - The sample office is small. The row pin above (240,966 rows for the year office of the pins) is the guard for a large office.

### The team requests on the test copy: the deploy suite (2026-10-18, 7183347)

- The test copy runs commit 7183347 (all 13 requests). Health: host supabase, 134 shared calls, file store r2.
- First run of the deploy suite from deploy-test, 55.6 minutes, 168 tests: 163 passed, 2 failed, 3 skipped, 0 flaky.
  - The 3 skipped tests call `skipPreviewAs()`: they skip by design on the preview host.
  - Failure 1, "New message starts a direct chat" (`tests/e2e-deploy/owner.spec.ts`): the test clicked the first button of the
    "Pick a person" sheet. That button is now "Make a group" (fbk_011), so the page stayed on /inbox. The product was right and the
    test was stale. Fix: the test skips the "Make a group" button, as the prototype smoke test does since the wave 2 to 4 gates.
  - Failure 2, "walk en-1440" (`tests/e2e-deploy/walk.spec.ts`): the Admin sign-in step failed with `EAUTHQUERY auth_query secret
    check timed out`, an error of the database pooler on a sign-in. The other three walks (ar-1440, en-390, ar-390) passed with
    the same sign-in, and so did the Management and Member sign-ins of this walk.
- Second run, after the fix, each of the two specs alone, once: both passed (the chat test 4.5 s, the walk 3.8 min).
- Result: 165 passed, 3 skipped, 0 failed. The seed ran before and after each run and exited 0.
- No `.playwright-mcp` folder and no new file appeared in either folder.

### The UX audit of the 13 team requests on the test copy (2026-10-19, d9b320a)

- 4 auditors found 91 findings; 4 builders fixed them on `rb/ux-chats`, `rb/ux-projects`, `rb/ux-integration` and `rb/ux-admin`,
  joined on `rb/ux-all`. The merge lead added 4 fixes: the pin of a location link only for a person who may edit the project (security
  review), the person signal keeps its story (INT-16 kept for the office signal), the map tests count the paused projects, and the calm
  test allows the sub-company logo.
- Gates on the Mac: typecheck, npm test 6,294 passed (6 skipped), the three builds, test:lite 1,504, test:office 37, test:db 1,504,
  test:it 283 (one Realtime test failed, fixed, then 8 of 8), test:mcp 194 and the conformance run (5 of 32, as expected), prototype
  smoke 87 of 87 (one calm test fixed, then 11 of 11).
- Deploy suite on the test copy: 164 passed, 1 failed, 3 skipped by design. The failure was "walk ar-1440", which hit the 15-minute
  limit on Settings; the Arabic phone walk passed in the same run. A rerun of the walk alone passed in 3.1 minutes.
- The free map on the test copy (as the Admin, Dashboard Map tab): the map canvas drew, 5 pins, tiles 5 of 5 and glyphs 3 of 3 from
  tiles.openfreemap.org, no CSP violation (the Arabic plugin runs under `'wasm-unsafe-eval'`), at 1440 px and 390 px.

### Chat search: the trigram index and the SQLite scan (track find, 2026-10-19)

Method (chat design 2026-10-19, item 16). One fold serves the body and the query: `normalizeForSearch(plainText(body))`. The save writes it into
`messages.search_text` and `comments.search_text` (a deleted message keeps null). Postgres has one GIN trigram index on each column
(`pg_trgm` in the schema `extensions`). The loader sends `contains` as an escaped LIKE, so the index serves it. A query matches when the
folded text holds every word. A query with no word of 3 letters finds no message, because a 2-letter pattern has no trigram. The group has
at most 5 hits.

Facts checked on a throwaway Postgres 17.11 (Homebrew, locale en_US.UTF-8, a socket only, no Docker), with the migration
`20261020000200_message_search.sql`:
- The migration applies. The backfill gives `ask @reem about the riser` for a message with a mention, null for a deleted message, and
  `اسعار المواد` for an Arabic comment.
- `search_fold` gives the text of `bodySearchText` for 13 sample bodies (NBSP and the other white space, tashkeel, tatweel, the alef
  forms, taa marbuta, alef maqsura, Arabic-Indic digits, mentions, emoji, full-width letters, a 4,000-character body). One known
  difference: `İ` (U+0130) folds to `i` in SQL and to `i` plus a dot in JavaScript.
- Arabic text has trigrams in this locale: `show_trgm('اسعار المواد')` gives 12.
- With 30,000 messages and 30,000 comments (1 in 1,000 holds "riser"), the loader read of a message search uses `messages_search`, and the
  comment read uses `comments_search`, with no sequential scan. With 6,000 comments Postgres chose to read every row, so
  `server/it/messageSearch.it.test.ts` uses 30,000 rows for each table.
- To check on madar-test after the test deploy (not run by the builder): `select current_setting('lc_ctype'), extensions.show_trgm('اسعار المواد')`.

The office path (SQLite, the paused Supabase exit) keeps `contains` as `instr`, a scan of `search_text`. Rows read on the year office
(`test:office`, `server/office/pins.wd.test.ts`, as usr_005), measured:

| Read | Before | After the messages | After the task comments |
| --- | --- | --- | --- |
| `search.query` `plan` | 1,038 | 4,127 | 16,200 |
| `search.query` `zqxv` | 7,034 | 19,505 | 31,578 |

The ceilings in `server/office/test/pins.ts` are the measured rows plus 10%. The office path scans `messages` and `comments` with `instr`
until the restart. The new ceilings are 17,820 and 34,736. The comment read costs most: no index of `comments` gives the order of `created_at`, so
the read takes every comment of the 50 projects and tests `instr` on each row. `exit-handoff.md`, section 7, names the FTS5 index for the restart.


### Chat batch: the waits pin on the office path (merge lead, 2026-10-19)
- `chats.waiting {}` as usr_005 on the year office read 22,579 rows after the new wait rules of item 22 (a group waits only when a
  message names the person, and a 👍 or ✅ on the message that waits answers it). The rule reads the reactions and the reply links of
  the newer messages. Before: a ceiling of 21,488 (the measured rows of 2026-10-18 plus 10%). The new ceiling is 24,837 (22,579 plus 10%).
  The Admin form (usr_001, 48,725) stays under its ceiling.
- The other chat reads on the year office stay under their ceilings (`npm run test:office`: 36 of 37 passed before this change).

### Chat batch: the merge gate (merge lead, 2026-10-19, branch rb/chat-campfire)
The 52 tasks of the chat plan (`docs/superpowers/plans/2026-10-19-madar-chat-campfire-plan.md`), joined with main 5e1e5371 (meetings
fbk_022). Each suite ran once; a suite ran again only for the files of a fix.
- `npm run typecheck`: green. `npm test`: 689 files, 7,277 passed, 4 failed, 6 skipped. The 4: two backup tests pinned schema version 5
  (now 6), the api bundle bound of 700,000 characters (711,111 now: about 23 KB of chat code; the bound is 760,000, it still proves the
  minify), and one deploy-script test that timed out under load and passed alone. All 4 files pass after the fixes.
- `npm run build`, `build:server`, `build:remote -- test`: green, with every bundle check.
- `test:lite`: 126 files, 1,840 passed, 26 skipped. `test:office`: 37 of 37 after the waits pin (section above).
- `test:db`: 1,839 passed, 1 failed, 26 skipped; the failed one (a 30 s timeout in `chatsUx.test.ts`) passed alone (20 of 20).
- `test:it`: 303 passed, 2 failed, both in `push.it.test.ts` and both faults of the test (the task id of `tasks.create`, and the still
  office clock that gave the unread message the stamp of the read mark). 11 of 11 after the fix.
- `test:mcp`: 242 passed; conformance 5 of 32 scenarios pass, 27 expected failures.
- Prototype smoke: 85 of 87, then 87 of 87. The 2 (`toastUndo.spec.ts`) found a real fault: a long press in the task panel opened no
  sheet on a phone, because Vaul cannot open a bottom sheet inside the bottom sheet of the task. The task panel keeps the "..." button
  for a finger (`BubbleActions.inSheet`). The spec now waits for the menu of its own comment, which shows after the save (instant send).
- Screens: 32 phone shots (390 px; English and Arabic, light and dark; the Inbox, a direct chat with the New line, the long-press sheet,
  Notify me, search, a task thread, the task panel) and checks in Chrome on a computer (New line, menu, ✅ that answers a wait, Reply,
  edit with the Up key, a search hit that opens the chat at the message with its frame, Notify me). Fixes from them: the preview line
  of the phone sheet keeps the direction of its own language; the grey mark of a search hit leaves the punctuation of a word outside.
- Seen and not changed (on main before this batch): in a task thread at 390 px the "Open task" button cuts the title to a few letters,
  and the empty box shows its placeholder on three lines.

### Chat batch: the test copy and the deploy suite (merge lead, 2026-10-19 to 2026-10-20, main 924eb2c)
- `all.sh test` put 924eb2c on the test copy (https://preview.madar-46r.pages.dev). The health check answered with 143 shared calls
  and the R2 file store. The trigram probe on madar-test passed: the search of messages and comments uses the two GIN indexes.
- The deploy suite ran one spec file at a time, after a seed of the sample office: 161 passed, 0 failed, 3 skipped by design
  (acceptance 1, menus 2). No rerun was necessary. The walk passed in its 4 variants (English and Arabic, 1,440 px and 390 px).
- The longest file was `full.spec.ts` (15 tests, 12 minutes). A second seed after the suite removed the test Auth users that the
  suite made. The folder stayed clean: no `.playwright-mcp` folder, and `test-results/` is ignored by git.
- The runner loads only the `R2_` lines of `secrets/test.env`, line by line: the bash of macOS (3.2) cannot source a process
  substitution, and a full source of that file stopped with a syntax error on its line 5.

### Chat batch: the phone fixes (merge lead, 2026-10-20, branch rb/chat-polish)
- The task thread at 390 px: the back button, the task picture, Open task and the menu left about 100 px for the title, so the title
  showed 4 letters ("Bala..."). Under 640 px the picture now hides (it only decorates; the line under the title says "Task thread"),
  and the title takes up to two lines. At 1,280 px and 960 px nothing changed: one line, with the picture.
- The message box at 390 px has 167 px for text (195 px less 2 x 14 px of padding); at 360 px, 137 px. The full hint ("Write a
  message. Type @ to mention someone.") took 3 lines. "Type @ to mention someone." still took 2. The phone hint "Use @ to mention."
  takes 1 line at 360 px and 390 px. In Arabic, «اكتب @ لذكر شخص.» took 2 lines at 360 px, because «إرسال» is wider than "Send";
  «اكتب @ لذكر أحد.» takes 1. At 320 px a hint of this length takes 2 lines.
- The hint keeps the @ tip on a phone: a project chat pushes only the people that a message names, so a person who does not know @
  reaches nobody with a push.
- Gates: 5 new tests first (3 failed before the fix; 2 hold what stays: one line for a chat title, the full hint on a computer), then `npm test` 689 files, 7,288 passed, 6 skipped; `npm run build`
  green. Shots (390 px: English and Arabic, light and dark; 360 px: English and Arabic) in the session scratchpad `shots-polish/`.
- The reaction pills: the shot script reported each pill as 28 px high, under the touch size of 44 px. The script measured only the
  visible pill. The button has an invisible strip of 8 px above and below it (`after:-inset-y-2`), and `min-w-11` makes it 44 px
  wide. In a 390 px window, `elementFromPoint` at 242 points of the 44 x 44 px area hit the button at every point, also with a 👍
  and a ✅ under each message of a run in a project chat. The only misses came from 2 pills that had scrolled under the top bar.
  No change was necessary. A size audit must test the press area with `elementFromPoint`, not the box of the element.

### Production at 3cb6e144 (2026-10-20, the four owner fixes; Claude ran it on the owner's "go production now")
- Changes: the satellite view on every map (one small button; Esri World Imagery through the own route `/satellite`, Pages Function
  `functions/satellite`, Madar's own Esri key as the Pages secret `ESRI_KEY` on preview and production; the key ends 2027-10-19); the
  sub-company badge in a gap cut out of the project tile (no ring, no pill); the chat filter (All, Projects, To-dos, People); "Tasks" holds
  To-dos and Meetings (209 English texts say to-do, plus 8 texts and 3 What's new lines of fbk_034 to fbk_036; the switch and the project tab
  say «قائمة المهام»; an MCP INSTRUCTIONS line); What's new 2026-10-23-60 to 63.
- Probes: Esri answers the key with a picture (status 200, JPEG) with the referrer https://madar.vado.sa, and also with none: the referrer
  lock did not save at Esri. The test copy route: signed out 401, signed in as admin@madar.test 200 JPEG in 0.85 s (zoom 10) and 0.63 s
  (zoom 17). Production route signed out: 401.
- Gates: typecheck, npm test 7,943 (one deploy test timed out under load and passed alone), the 18 test files of fbk_034 to fbk_036 after the
  merge (236 passed), build, build:server. Not run (owner chose speed): `test:db`, `test:it`, `test:mcp`, the prototype smoke, the deploy
  suite, the screenshots (the Chrome extension was off; the Playwright helper was refused the sign-in by the auto-mode check).
- `all.sh test` (148 calls), then `all.sh production`: health from `supabase` with 148 calls, the database check, `POST /mcp` with no token 401.
### Production at a115a281 (2026-10-20, the owner batch of 7 items; Claude ran it after the owner's "deploy to production")
- Changes: the chat filter keeps its choice; the role rights in 7 sections (17 rights, 10 new, an All switch for each section of two or
  more); fbk_037, Edit and Cancel meeting in the footer of the meeting sheet; the To-dos / Meetings switch in its own row; `meetings.delete`
  for a cancelled meeting, with the owner's series rule (only "Cancel this and later" ends a repeat, a delete changes no repeat); the
  Admin's "What reaches me"; the usage feature removed (the tables `usage_month` and `usage_warnings` stay, unused). What's new 64 to 69.
- Gates: typecheck, the shared rule and server tests (217 files, 3,170 tests), the touched screen tests (154 files), `npm run build`,
  `build:server`, screenshots in Chrome (EN/AR, 390 and 960). Not run (owner rule, each over 5 minutes): the full `npm test`, `test:db`,
  `test:it`, `test:mcp`, the deploy suite, the prototype smoke.
- `all.sh test` (149 calls), then `all.sh production`: health from `supabase` with 149 calls, the database check, `POST /mcp` with no token 401.

## Chat presence: the Realtime probe (2026-10-21)

**Result: all facts hold; one is not probed in a real socket.** A person tracks only on the own topic `status:<own Madar id>`, and every
active person reads every status topic. A track on the topic of another person fails at once. An agent token (with `client_id`) cannot even
join to read. The typing event on `person:<id>` reaches the person. A dead socket leaves after 49 to 66 s. The cost check says the 50% line
of the design is passed by the new parts alone, so steps 1 to 3 of the design apply (see "Cost check").

**Project.** `madar-test` only (`qdgwpnesxppnqsaabqzd`). The only change: the migration `20261022000200_platform_presence.sql`, pushed with
`scripts/deploy/db.sh test` after the CLI showed that this file was the only pending one (24 of 24 older migrations were applied). It adds two
policies on `realtime.messages`, both `to authenticated`:
- `madar_status_track` (insert): `extension = 'presence'`, topic = `'status:' || current_madar_user_id()`, no `client_id`.
- `madar_status_read` (select): `extension = 'presence'`, topic like `'status:%'`, a Madar id exists, no `client_id`.

**Scripts.** `scripts/proof/presence.ts`, run with `set -a; . ~/dev/madar/.env.local; . ~/dev/madar/secrets/test-accounts.env; set +a;
npx tsx scripts/proof/presence.ts <policies|status|agent|typing|counts|drop|usage|cleanup|all>` (the network needs the sandbox off). It signs in
with the password grant of the four sample accounts (admin `usr_001`, member `usr_002`, management `usr_010`, accounting `usr_011`), opens real
Realtime sockets with supabase-js 2.117.2, and counts every frame that the server sends to each socket (the `message` event of the socket).

**Method.**
1. Track and read: the member joins `status:usr_002` (private, presence key), tracks; the admin joins the same topic and must see the key.
2. Another topic: the member joins `status:usr_001` and tracks; the admin (owner of that topic) must not see the key. Control: the admin tracks
   on the own topic and the same listener sees it.
3. Agent token: a real OAuth 2.1 flow (register a client, authorize with PKCE, consent as the member, code exchange), then a Realtime join with
   that token. The OAuth client is deleted in the cleanup.
4. Typing: the member holds two sockets on `person:usr_002`, one that listens to `typing` and one that listens only to `changed`. `realtime.send`
   runs as `madar_server` (`set local role`) inside a transaction, then commit. Control: the admin tries to join `person:usr_002`.
5. Drop: a child process (the member) joins and tracks, then the parent freezes it with `SIGSTOP`. The socket stays open and sends nothing: no
   heartbeat, no close frame (the same as a phone in flight mode, seen from the server). The time runs from the freeze to the `leave` event at the
   admin. The freeze comes 1 s, 9 s and 17 s after the join, so the three runs sit at three points of the 25 s heartbeat cycle. A fourth run kills
   the process (the operating system closes the socket).
6. Counts: 3 listeners (admin, management, accounting) and the member on two sockets. Each step lists the frames to each socket and the supabase-js
   callbacks.
7. The same policies run in SQL (`set local role authenticated`, the JWT claims set, inside a transaction that rolls back) for the cases that a
   socket probe cannot reach without a change of data: a turned-off person (`active` set to false inside the transaction), a person with no Madar
   user, and a `broadcast` insert on a status topic.

| # | Fact | Result | Numbers |
|---|---|---|---|
| 1 | The member tracks on `status:<own id>`; another person reads it | **Pass** | join `SUBSCRIBED`, `track` returns `ok`, the admin sees the key. In SQL: own id allowed; a select sees the row for an active person (1) and none for a `client_id` token, a person with no Madar user, or a turned-off person (0) |
| 2 | A track on the topic of another person fails | **Pass** | the join of `status:usr_001` as the member works (the read policy allows it), `track` returns `error` at once, the owner sees no key; control track `ok` and seen. In SQL: denied |
| 3 | A token with `client_id` cannot track | **Pass** (real socket and SQL) | token claims: `client_id` present, `role` authenticated, `aud` is the MCP address of the Pages copy (not `authenticated`). The join of `status:usr_002` (the own topic of its person) gives `CHANNEL_ERROR: Unauthorized: You do not have permissions to read from this Channel topic`; nothing is seen. In SQL a `client_id` claim is denied on insert and on select |
| 3b | A turned-off person cannot track or read | **Pass in SQL only** | `update ... set doc = jsonb_set(doc, '{active}', 'false')` inside a rolled-back transaction: insert denied, select 0 rows. Not probed on a socket: it needs a real turn-off of a sample account |
| 4 | `realtime.send(..., 'typing', 'person:<id>', true)` as `madar_server` reaches the member; a listener of only `changed` does not get it | **Pass** | no warning from `realtime.send`; the `typing` listener got 1 event (event `typing`, payload `{v: 1, ...}`) after 312 ms and 348 ms (two runs). The `changed`-only listener got 0 typing events; its control `changed` arrived. The frame itself reaches every socket joined on `person:<id>` (2 binary frames at each socket: typing and changed); the client filter drops it. The admin cannot join `person:usr_002` (`CHANNEL_ERROR`). No new policy was needed: `madar_server_send` already allows `person:%` |
| 5 | Time from a dead socket to the leave event | **Pass** | 65.0 s, 57.0 s, 48.9 s (freeze 1 s, 9 s, 17 s after the join). A first set with the freeze at one fixed point gave 66.0 s, 66.0 s, 66.0 s. A killed process (socket closed by the operating system): 2.9 s and 3.0 s. So a phone that loses the network shows Offline after at most about 66 s |
| 6 | Presence frames for one track, one untrack, one join | **Pass** | see the table below |

**Frames (fact 6, and the cost basis).** Every number is the count of frames that Realtime sent to one socket.

| Event | To each of the 3 other listeners | To the person that acts |
|---|---|---|
| A listener joins a topic with nobody on it | | `phx_reply` 1 + `presence_state` 1 (2) |
| A device joins the topic, no track yet | 0 | 2 (`phx_reply`, `presence_state`) |
| One track (online) | 1 `presence_diff` (callbacks: 1 sync, 1 join) | 2 (`phx_reply` + own `presence_diff`) |
| A state change (online to away, same key) | 1 `presence_diff` (callbacks: 1 sync, 1 join, 1 leave) | 2 |
| A second device joins and tracks | 1 `presence_diff` | 1 (its own diff, other socket) |
| One untrack | 1 `presence_diff` (sync + leave) | 1 |
| A tracked device leaves the channel (a closed page) | 1 `presence_diff` (sync + leave) | |

So one change is one frame for each socket that is joined on the topic, the changing person included. A state change is one frame, not two.
A join gives the joiner one `presence_state` frame for each topic and the others nothing. The Supabase page "Manage Realtime Messages usage"
(read 2026-10-21) says: a broadcast counts as one sent plus one for each receiving client; a database change counts one for each listening
client; it names Presence among the counted messages but gives no rule for it.

**Usage of the month (step 3): not found by API.** The Management API with the token has no endpoint for the Realtime message count or the
Edge Function count: `/platform/organizations/<slug>/usage` and `/platform/projects/<ref>/usage` answer 401 "Unsupported access token",
`/v1/organizations/<slug>/usage` answers 404, the logs endpoint (`analytics/endpoints/logs`) knows only the table `logs` (pooler and database
lines) and a 24-hour window, and `usage.api-counts` gives only requests of Auth, Realtime (socket connects), REST and Storage. Its numbers for
the last 7 days: production 170 Realtime requests (2 to 83 a day), 7,594 Auth, 20 REST, 282 Storage; madar-test 5,807 Realtime requests
(this probe and the earlier work), 32,650 Auth. The count that matters sits only on the dashboard page "Organization, Usage" (one organization,
MADAR, holds both projects). The owner reads it there. Reads on production were GET only.

**Cost check (design, "Cost and the free plan").** The inputs are the design's own: 15 people, 22 work days, 30 phone opens a day with 3 state
changes each (1,350 changes a day) plus about 150 computer changes, about 20 open screens, a screen that joins 15 status topics, 3,000 typing
signals a day to about 4 members. With the measured frames:
- Status: 33,000 changes x 20 screens = 660,000 frames, plus 600 screen loads a day x 15 topics x 1 `presence_state` x 22 days = 198,000.
  About 0.86 million (the design said 0.9 million).
- Typing: 3,000 x 22 x 4 = 264,000 frames for one socket per person, up to about 400,000 for 1.5 sockets per person (every socket on
  `person:<id>` gets the frame).
- New parts together: about 1.1 to 1.3 million, which is 56% to 63% of the free 2 million. The 50% line (1 million) is passed by the new parts
  alone, before the messages that Madar sends today (change signals on `office` and `person:`), which no API gives.
- Steps of the design: **step 1 (a phone out of view leaves its topic after 1 minute), step 2 (typing every 5 s, not 3 s: typing falls by
  40% to about 0.16 to 0.24 million) and step 3 (a computer tab out of view for 30 minutes leaves) all apply.** Steps 1 and 3 cut the number of
  screens that listen. If they bring 20 listening screens down to 12, status falls to about 0.59 million, and the total with step 2 is about
  0.75 to 0.83 million (38% to 42%). That is an estimate: the real count of listening screens and changes is unknown until the build runs.
  Step 4 (stop and ask the owner) is not reached on these numbers, but it stays open until someone reads today's use on the dashboard page.

**Other facts for the build.**
- A track on another person's topic does not fail the join. It fails at the `track` call (`error`). The adapter must read the track result.
- An agent token reaches the socket (no connect error), but every private join of a status topic is refused.
- Broadcast frames arrive as binary frames in supabase-js 2.117.2; presence frames arrive as text (`presence_state`, `presence_diff`).
- The admin login `postgres` cannot `SET ROLE madar_server` (its membership has the SET option off). The probe added its own grant for the run
  and revoked it. A migration test that sends as `madar_server` must connect as that role.

**Cleanup (verified).** The OAuth client of the agent probe was deleted (101 clients before and after; 48 authorizations, 28 consents and 0
agent sessions before and after). The typing rows of the run in `realtime.messages` were deleted (0 left). The temporary grant of `madar_server`
to `postgres` was revoked (only the original grant of `supabase_admin` is left). The four sample users are unchanged (all active). No probe user was
made. On `realtime.messages` there are five policies: the three of `20261004000200` and the two of this migration. The channels and the
presence entries live in memory and are gone when the sockets close. Production was not changed.

- 2026-10-21 (merge lead): the migration `20261022000200_platform_presence.sql` was taken off madar-test after this probe (the
  two policies dropped, `migration repair --status reverted 20261022000200`), because the release of `rb/mcp-pictures` from
  another session ran `all.sh test` from a main that does not have the file. The test deploy of the chat presence batch pushes
  it again. Cost steps 1, 2 and 3 of the design are in the build (base report: typing every 5 s, shown for 8 s; rest after 1
  minute out of view on a phone and 30 minutes on a computer).

### Chat presence batch: the merge gate (merge lead, 2026-10-21, branch rb/chat-presence)

- Joined: base B1 to B6, proof P1, live L1 to L4, faces F1 to F5, emoji E1 to E4, and main at 2701ea78 (AM and PM). Merge lead
  fixes after the join: the 21st reaction kind gives the reason `reactions_full` (its own toast); the MCP text of `chats.messages`
  keeps every word its tests ask for (561 characters); on a phone the Send button is a round icon and the row is tighter, so the
  empty box keeps one line next to the emoji button (the owner's rule of 2026-10-20).
- `npm run typecheck`: pass. `npm test`: 8,509 passed, 3 failed (the MCP text), fixed; `server/mcp` again: 278 passed. The later
  fixes: their files again (42 and 341 passed).
- `npm run build`, `npm run build:server`, `npm run build:remote -- test`: pass (remote first load 1,207,911 B of 1,350,000; the
  emoji panel is a lazy chunk of 347,560 B, 93,390 B gzip; the prototype script grows by about 356 kB).
- Under the Docker lock: `db reset` with both new migrations, `test:db` 2,260 passed (27 skipped), `test:it` 325 passed, `test:mcp`
  "5 of 32 scenarios pass; 27 expected failures" (the normal result). `test:lite` 2,260 passed (27 skipped). `test:office` 40 passed
  (no rows pin moved).
- `npm run smoke`: 87 of 87.
- Screenshots (prototype, a Node Playwright script in the scratchpad): the chat with dots, Online, Seen and typing in English and
  Arabic, light and dark, 390 px and a computer; the chat list with typing; Seen by 2 with its names; the emoji panel and sheet;
  the + of a reaction; the Away switch. The Arabic forms show as planned (قرأتها, ريم تكتب..., قرأها شخصان, متصلة).

### Chat presence batch: the test copy (merge lead, 2026-10-21, branch rb/chat-presence at 1eddb950)
- `all.sh test` from the branch (not main) applied `20261022000100` and `20261022000200` and passed its checks (health from supabase,
  149 calls; remote first load 1,218,106 B).
- Live check (`scripts/proof/presence-live.ts`, admin and member and accounting, no browser): status Online after 1,526 ms, Away after
  3,019 ms, Offline 2,990 ms after a leave; a typing signal 617 ms from the call to the event; the accounting account got no typing
  event and its `chats.typing` answered `not_found`; the seen signal reached the author 648 ms after the look, and the chat view held
  the seen time. A presence join needs a presence listener set before the subscribe (supabase-js asks for presence only then); the
  screens do it (`src/app/remote/presence.ts`).
- Deploy suite, stopped by the owner's choice (role rights first on the test copy): 15 of 17 files ran, 181 passed, 0 failed, 3
  skipped by design (acceptance 1, menus 2). `walk.spec.ts` was cut mid-run and `full.spec.ts` did not run. Both run again before
  the release.
- Then both migrations came off madar-test again (the index and the two policies dropped, `migration repair --status reverted`), so
  `rb/rr2` could deploy from main. Next: merge main (rr2 and `a816c42a`, the reports.office fix that the owner wants in the same
  release), the gates, `all.sh test`, the whole deploy suite, the owner's two-phone hand test.
- 2026-10-21, the owner read the Supabase page Organization, Usage: Realtime Messages 15,878 of 2,000,000 used in the period; the
  busiest day about 2,900 (19 October, the team week). The page says one broadcast to 4 listeners counts as 5 messages (1 sent, 4
  received), which is the rule of the cost estimate. Today's use plus the new parts after cost steps 1 to 3 is about 0.85 to 0.92
  million a month (about 45%): cost step 4 does not apply.

### Chat presence: the release (merge lead, 2026-10-21)
- The owner asked for production in chat ("go to production"), with role rights and the report fix in the same main. Main was
  fast-forwarded to `rb/chat-presence` at faaa6f76 (it holds main 00f26fa6). After the merge of role rights v2: typing names nobody
  for a person whose role may not write in a direct or group chat; the What's new test finds the role rights entry by its id; the
  api bundle bound is 850,000 (803,793 now). Gate on the merged code: `npm test` 9,498 passed and 3 failed, fixed (48 passed again);
  builds, `test:db`, `test:it` 325, `test:mcp` 326 (conformance normal), `test:lite`, `test:office` 40: all passed.
- `all.sh test` put faaa6f7 on the test copy with both migrations. The live check passed 8 of 8 (Online 305 ms, typing 560 ms, the
  seen signal 644 ms; no typing leak; an outsider's typing call answered `not_found`). The owner chose no browser suite this time.
- `all.sh production` from deploy-test applied `20261022000100` and `20261022000200` on production and passed the quick checks
  (health from supabase, 149 calls).

### The Madar report from the AI assistant: the release (2026-10-21)
- The owner asked to make his Claude skill "madar-office-report" part of the MCP, then "merge to main and deploy to production". Main
  was fast-forwarded to `rb/report-guide` at 7b0ea2ce, on top of the chat presence release (f27d6e5f).
- Gates: typecheck. `npm test` on the earlier base: 9,217 passed and 1 failed (the api bundle bound of 800,000; chat presence raised it
  to 850,000 at the same time, and the api bundle is 826,972 bytes now). After the rebase on f27d6e5f: the touched tests (21 files,
  366 tests), `test:lite` of the report tests (53), `build:server`, `npm run build`. Not run: `test:db` and `test:it` (the chat presence
  gate held Docker; the loader reads the same rows as before, only the days change).
- `all.sh test` put 7b0ea2c on the test copy. A read-only check as admin@madar.test: a range of 1 to 21 October answered with the kind
  range, 6 trend weeks and the guide (16,888 characters); a week with from and to was refused (`invalid_input`, fields from and to);
  a plain week came without the guide.
- `all.sh production` passed the quick checks (health from supabase, 149 calls). A live call through the owner's Claude connector, which
  still held the old tool list, with period range for 18 to 21 October answered the kind range, the trend and the 8 design colors.
- An AI app keeps its tool list for a while: a new chat in Claude Desktop gets the new tool text.
- 2026-10-21, later: on the owner's "deploy to production", `all.sh test` and `all.sh production` took 23b2c902 (only TASKS.md and
  proof.md notes on top of 7b0ea2ce, no shipped file changed). Both quick checks passed (health from supabase, 149 calls).

## Speed audit 2 (2026-10-21 to 2026-10-22)
Branch `rb/perf2`. Audit report: `docs/reviews/2026-10-21-performance-audit/`. Each subsection is the proof of one track.

### Instance reuse probe (madar-test, 2026-10-21, performance audit SV-1)

Question: does a Supabase function reuse its worker, and does our entry block the reuse? Method: one probe function on madar-test,
redeployed for six variants, each answering with a module id and a counter; 15 calls back to back and 10 calls with a 2 s gap, all with
`forceFunctionRegion=eu-central-1`. Result: a plain `Deno.serve` (variant 1) got 15 new workers in 15 calls and 9 in 10 calls with a gap;
`export default { fetch }`, `EdgeRuntime.waitUntil`, a `beforeunload` listener, an `npm:pg` pool with a 1 s idle close, and the real api
bundle (/health only) gave the same: 14 to 15 new workers in 15 calls. In 80 calls each, the real bundle reached an old worker 4 times and the
plain function 6 times (5% and 7.5%). Conclusion: the platform spreads the calls over new workers; our entry does not block the reuse; no
code fix. The idle close of the pool still works on a reused worker. The cost stays about 230 ms and 110 ms of CPU for each call on a new
worker; only a smaller import lowers it (SV-2 lazy segmenter, SV-3 bundled pg). `probe-reuse` was deleted from madar-test on the owner's word (2026-10-22).

### Track 5: the database
Branch `worktree-wf_92fa548c-685-5` (head 15027449), merged into `rb/perf2`. Report file PERF2-REPORT-database.md of that worktree.
- DB-5: Unread count joined jsonb_to_recordset to messages; at 15,000 messages Postgres scanned every message (6.6 to 8.2 ms per count). chats.unreadCount member 25.0 ms database time, 9 statements. Now: One LATERAL index read for each chat key. chats.unreadCount member 15.1 ms (with DB-6, DB-4 and SV-10). Tests: sqlSource.test.ts text pin changed (this item changes exactly what it pins); readIndexes.it.test.ts plan test for DB-5; loaders.it.test.ts equality with the memory form.
- DB-6: The task threads statement scanned the comment table twice. Now: Index comments_author_task (target_type, doc->>'authorId', target_id); threads statement 13.4 to 9.5 ms in the audit. Tests: readIndexes.it.test.ts plan test for DB-6.
- DB-9: notifications.list sorted every read notice of the person to keep 100 (2.7 ms). Now: Plain LIMIT form for an ordered read with the id in the order, and index notifications_inbox_c with collate C (replaces notifications_inbox). notifications.list 0.6 ms. Tests: sqlSource.test.ts pin of the rows after one message changed (same reason); readIndexes.it.test.ts plan test for DB-9.
- DB-10: reports.office (year) 79.0 ms database time, 2.22 MB, events scanned four times. Now: 28.1 ms, 1.24 MB (with DB-4). Partial index events_report_verbs and a 6-field Tracker pick. Tests: readIndexes.it.test.ts plan test for DB-10; perf2.test.ts (report equals the whole office).
- DB-2: The 15-minute job loaded every open task whole: 1,629 rows, 675,577 bytes, task read 13.7 ms, load wall 27.5 ms, trigger pass 13.3 ms. Now: Only tasks past due or due within 4 days, 7 fields (and DB-4 array form): 1,133 rows, 111,140 bytes, task read 9.7 ms, load wall 23.7 ms, trigger pass 5.9 ms. Tests: perf2.test.ts: seven fields, due bound, notices equal the whole office on 14 days in a row, no-time run loads every open task.
- DB-8: notifications.count loaded every unread notice whole: 67,025 bytes. Now: 7 fields in count mode: 28,511 bytes (includes DB-4). The list and the writes keep whole rows. Tests: perf2.test.ts count mode versus list and writes.
- DB-11: tasks.list (all, admin) 5 statements, 9,659 rows, 2.19 MB. Now: 4 statements, 9,152 rows, 1.98 MB. A narrow list still reads again. Tests: perf2.test.ts: one read for a list with no narrowing and for one project; second read kept for a narrow list.
- DB-4: Picked rows repeated key names in every row. reports.office 1.89 MB, dashboard.get admin 1.35 MB, projects.list admin 0.84 MB, notifications.count 43 KB (measured on HEAD before DB-4). Now: Array plus absent mask, object rebuilt in sqlSource from the pick list: reports.office 1.24 MB, dashboard.get 0.89 MB, projects.list 0.60 MB, notifications.count 29 KB. Table rows unchanged. Tests: sqlSource.test.ts (text, absent versus null, jsonb key order, 50-key mask, object-form fallback above 50 keys); loaders.it.test.ts (SQL equals memory at 50 and 51 keys).
- SV-10: chats.unreadCount 9 to 10 statements, chats.list 10 to 11, chats.waiting 12, chats.markRead 13, each a network round trip. With a simulated 10 ms to the database: unreadCount member 145 ms, list admin 183 ms, waiting member 195 ms. Now: 3 statements for unreadCount, list and waiting; markRead 6. Same simulated 10 ms: 58 ms, 66 ms, 71 ms. Local wall with no pause 25.7 to 22.2 ms. Database time unchanged within noise; bytes down 3 to 14%. Tests: build.test.ts (Load.batch), sqlSource.test.ts (batchSql text, renumbered values, decode, empty read, single read, thread order), loaders.it.test.ts (at most 3 statements for badge and list, at most 4 for waiting, scoped load equals whole office).

### Track 4: the server request path
Branch `worktree-wf_92fa548c-685-4` (head d2a40804), merged into `rb/perf2`. Report file PERF2-REPORT-server.md of that worktree.
- SV-2: Deno import of api.js: median 64 ms Now: 53 ms (8 runs each). The Intl.Segmenter is built on the first emoji check. Tests: src/api/contract/emoji.test.ts (passes)
- SV-14: A comment said the typing signal runs outside a transaction Now: Comment says db.statement is begin, select, commit. No code change. Tests: none (comment only)
- SV-5 (a): Cold read batch of 4 calls: 27 statements Now: 24 statements. The write batch stays at 23. Tests: server/http/batchJoin.test.ts (new), server/http/roundTrips.test.ts (pin changed). Merge lead: test:db and test:it for the runCall and batch suites.
- SV-9: 3 push reads under the office lock for each chat message or comment Now: 1 statement (PUSH_FACTS_SQL) Tests: server/push/notify.test.ts (old pin changed from 3 to 1). Merge lead: test:it server/it/push.it.test.ts (passed on a local Postgres 17).
- DB-12 (safe part) (safe part only): Each write sent a separate select of the counters after the office read Now: META_COUNTERS_SQL returns the version and the counters in one statement Tests: server/data/officeCache.test.ts, server/data/loaders/sqlSource.test.ts, server/it/writeStatements.it.test.ts (new). Merge lead: test:db, test:it (runCall, lock, officeCache suites).
- SV-11: 12 adjacent files.link entries: 36 statements Now: 1 prefetch statement for the run (FILES_DOCS_SQL) Tests: server/http/batchLinks.test.ts (new). Merge lead: test:it server/it/files.it.test.ts (needs MinIO).
- DB-3 (CPU part): dashboard.get handler in memory: median 329 ms on the year office scaled to 6,100 tasks; 77 ms on the plain year office (864 tasks) Now: 62 ms (scaled) and 49 ms (plain). Answer hashes equal before and after (1686e9bb9a8f8b6e plain, 0fafa2ea2f818f7f scaled). Task-list reads per call: 163 down to at most 8. Tests: server/office/dashboardYear.test.ts (new: 3 answer hashes pinned from the old code, plus the task-list read count); src/lib/dates.test.ts (2 new: stampDay equals the Date formula for 14 stamps, and makes no Date for a +03:00 stamp). Ran 254 files / 3,872 tests in src/api, src/lib, inbox, meetings: pass. No database needed.
- SV-12: skipped. Not plainly safe. The two pools exist so a read never waits behind a write that waits for the office lock. 'One request for each isolate' comes from logs of madar-test, not a guarantee. A second request or the after-answer effects would wait on the one connection up to the 5 s connect timeout. A real DATABASE_READ_URL needs its own pool. The gain is small per the skeptic.

### Track 1: the first load
Branch `worktree-wf_92fa548c-685-1` (head b622ea0b), merged into `rb/perf2`. Report file PERF2-REPORT-firstload.md of that worktree.
- FL-1+FL-4: 50 files, 1,236,844 B raw, 383,624 B gz Now: 33 files, 1,108,439 B raw, 337,567 B gz Tests: lazyOverlay.test.tsx, HomeScreen.test.tsx, overlays.test.ts, firstLoadImports.test.ts
- FL-10: 3.9 KB gz of zod core in the first script Now: none Tests: zodConfig.core.test.ts
- FL-5+FL-3: vaul, Radix and 3 unused Supabase clients in the vendor chunk Now: overlay chunk plus a stand-in; 33 files, 984,332 B raw, 302,041 B gz Tests: supabase.stubbed.test.ts, unusedClients.test.ts, vite-config.test.ts, check-bundles.test.ts
- FL-8 (safe part only): idle prefetch loads sign-in screens and Admin for everyone Now: skipped for a stored session and for people who cannot open Admin; about 36 KB gz of data less in a cold session Tests: prefetchRules.test.ts, screens.test.ts
- FL-7: other language (38 to 48 KB gz) loaded at the first render Now: loads 3 s after the first reads settle; a switch still works at any time Tests: otherLanguage.test.ts
- FL-17+LV-10: library request started only after the MapCanvas chunk ran; nothing started at a Map tab press Now: library request starts with the chunk request (lazyMapCanvas); pointer down on the Dashboard Map tab starts the chunk and the library (warmMap); no map, no tile, not in the idle prefetch Tests: mapLib.test.tsx (new test for the flag), DashboardMapWarm.test.tsx, Tabs.test.tsx, MapCanvas.test.tsx
- LV-11: first project page loads Inter Latin 73,949 B for U+00B2 Now: subset has U+00B2 (10,796 B, was 10,340 B); no big Inter file for m2 Tests: scripts/fonts/subset-inter.test.ts (new sha, args, 12 characters, range), tokens.test.ts
- FL-11: limit 1,350,000 B raw, no gzip bound, no file bound Now: 1,015,000 B raw, 312,000 B gz, 34 files, plus none-rules for [data-new-line] (MessageLog), data-vaul-drawer and StorageUnknownError. Real: 985,040 B, 302,322 B, 33 files Tests: check-bundles.test.ts: 5 new tests (limits near real size, gzip fail, file count fail, markers fail and lazy pass); the size message pin changed because the bound changed

### Track 2: lists and rendering (task rows, projects, notices, files)
Branch `worktree-wf_92fa548c-685-2` (head c69d599e), merged into `rb/perf2`. Report file PERF2-REPORT-lists.md of that worktree.
- RN-4: A new message in a chat of 200 rendered 200 bubbles Now: 1 bubble Tests: ChatRenders.test.tsx, bubbles.test.tsx (first builder)
- RN-5: One saved task rendered every task row (about 150 of 150) Now: At most 2 rows Tests: RowRenders.test.tsx (red before the fix, green after). Memo TaskRowItem and drag row, hoisted sensor options, memo ids, one stable handler, today passed as a prop.
- FL-2: First load 50 files, 1,237,088 B raw, 383,763 B gz Now: First load 37 files, 1,181,792 B raw, 357,441 B gz (gzip -9 sum of the scripts and modulepreload links of dist/index.html, remote test build) Tests: DragLayerSwap.test.tsx (focus stays, no new entrance, new day gives new due words, no layer without a grip), dragLayerLoader.test.ts (Safari path), check-bundles.test.ts (none-rule DndDescribedBy)
- RN-6: One changed project rendered 109 rows (100 extra projects) Now: At most 2 rows Tests: ProjectRowRenders.test.tsx (red before the fix, green after)
- RN-7: Marking one notice read rendered all 100 rows Now: At most 2 rows, and Age still moves on in unchanged rows Tests: NoticeRenders.test.tsx (red before the fix, green after; also checks the age moves from 1h to 3h)
- BG-7: A Files tab with N picture rows sent N files.link calls at the first open Now: No link call until a row is within 400 px; then one call for that row Tests: FilesTab.remote.test.tsx (stubbed IntersectionObserver; red before the fix, green after)
- RN-14: Same as BG-7 (links asked at mount) Now: Same as BG-7 Tests: Same test as BG-7

### Track 2b: lists and rendering (chat, Inbox, emoji, faces)
Branch `worktree-wf_1a0bc691-ccc-3` (head 03b9e8eb), merged into `rb/perf2`. Report file PERF2-REPORT-chatlists.md of that worktree.
- RN-4: A new message in a chat at its limit of 200 rendered 200 bubbles Now: 1 bubble Tests: ChatRenders.test.tsx, bubbles.test.tsx
- RN-10: 30 useTranslation calls for 30 faces with a live port Now: 0 calls; label from a cache by language, state, grammar form and name Tests: PersonFace.test.tsx: call count with a mocked hook, plus a language change (en, ar, en) that reaches the label
- RN-3: Sample office on a finger: 7 message menus and 17 row menus built Now: 0 on a finger; the desk is unchanged Tests: TouchMenus.test.tsx (7 tests): desk, finger, pointer change both ways, narrow screen with a mouse keeps the message button, task sheet keeps its menu on a finger, row menu on pointer coarse and under 640 px
- RN-2: 167 rows at the first paint (17 chats plus 150 groups) Now: 40 rows at the first paint, the rest at the idle step; same final list and order Tests: ChatListStage.test.tsx (3 tests)
- RN-8: About 1,888 cells at the first paint; a focus move built every entry again Now: 537 cells at the first paint, the other 7 groups at the idle step; a focus move renders 2 cells and at most 1 group Tests: EmojiStage.test.tsx (6 tests); two old pins in EmojiPanel.test.tsx now wait for the Flags group with findByRole
- RN-1: 200 bubbles at the first paint of a chat of 200 Now: 60 bubbles at the first paint, the rest at the idle step; same final DOM order Tests: MessageLog.stage.test.tsx (11 tests): order, no staging at 60 or fewer, bottom reader stays at the bottom, scrolled reader keeps the distance from the bottom, focus message in the first mount, late focus message, New line (large and small unread), Earlier press before the idle step, new message while staged, whenIdle route. ChatRenders.test.tsx waits for the idle step.

### Track 3: client calls
Branch `worktree-wf_92fa548c-685-3` (head d675f2b3), merged into `rb/perf2`. Report file PERF2-REPORT-calls.md of that worktree.
- LV-2: A save sent a second request when the Realtime frame came before the own answer. Now: One request: the pass keeps the frame id until the own answer names it. Tests: src/app/signals.test.tsx, src/app/afterWrite.test.tsx
- LV-4: Each send added one chats.markRead for the own message. Now: No extra mark: the seen check looks at the newest message of another person. Tests: src/features/inbox/SeenWhileActive.test.tsx
- LV-3: A message of another person waited 1 s in the merge window. Now: 150 ms while a chat is open and no own write is on the wire (0.85 s sooner). Tests: src/app/signals.test.tsx
- DF-5: Closed sheets read: Projects 2 extra reads in 1 extra request, Search 3, project page 2 for the Admin. Now: Reads only while open. The opening button starts them on pointerdown. Tests: src/features/projects/ClosedSheetReads.test.tsx
- DF-6: Cold Home asked meetings.list in a second round. Now: In the first request (one round trip less). Tests: src/features/home/HomeMeetingsRound.test.tsx
- DF-7: Dashboard, Meeting view, Open space, Admin read one round trip after session.get (+355 ms live). Now: Reads start with the session; a cached session without the switch starts none. Tests: src/app/GuardReads.test.tsx
- DF-13: Tasks tab deep link: taskTemplates.list in round 2. Now: In round 1 with projects.get when the cached session may add a to-do and the list view shows. Tests: src/features/project/tabs.test.tsx (3 new tests; the first fails without the fix)
- DF-11: push.mine: 2 calls at a cold Home, 1 at each later Home visit. Now: 1 call for each page, person and key. Turn on, turn off and sign-out check again. Tests: src/features/settings/PushCheckOnce.test.tsx (4 tests; 2 fail without the fix)
- DF-10: chats.typing every 5 s while a person types, also when everyone is Offline. Now: No call while the port knows each other person who sees the chat and each is Offline. Away, unknown state, unknown list, and a port without knowsState still send. Tests: src/app/live/typing.test.tsx (5 new), src/app/remote/presence.test.ts (2 new), src/app/remote/officeLive.test.ts (1 new)
- DF-4 (safe part only): Phone: visibility pass then join pass gave 18 calls on Home where one reload is 9. Now: A join within 1 s after the visibility pass adds no second pass. Later joins run as before. Tests: src/app/signals.test.tsx (3 new; 2 fail without the fix)
- LV-9: First open of Projects, Dashboard, Inbox and the bell waited a full trip after the click. Now: The main read starts on pointerdown (about 50 to 150 ms earlier). Hover starts nothing. Tests: src/app/PressReads.test.tsx (6 tests)
- BG-4 (safe part only): A missed heartbeat in a hidden tab waited for the slow reconnect timer. Now: heartbeatCallback calls supabase.realtime.connect() on timeout or disconnected; connect() is a no-op while the socket is up. Tests: src/app/remote/supabase.test.ts (3 tests; the old options pin changed because this item adds the realtime option)

### The merge (2026-10-22)
- Six tracks merged into `rb/perf2` with four text conflicts (sqlSource.ts signature, check-bundles markers, src/CLAUDE.md, the `whenIdle` export, a HomeScreen import). `whenIdle` lives in `src/app/whenIdle.ts`; no screen part imports `screens.ts` for it.
- Builds after the merge: prototype, server and remote all pass their bundle checks. First load of the remote build: 34 files, 941,244 B raw, 286,908 B gzip (was 50 files, 1,236,844 B, about 384 KB gzip on 1d45aae5; 318,488 B gzip on 2026-10-08). The limits are now 970,000 B, 296,000 B gzip and 35 files.

### Wave 2: instant Home after a relaunch (DF-14, owner yes 2026-10-21)
Branch `worktree-wf_adeeec9a-475-1` (head 3d127dc4), merged into `rb/perf2`. Report PERF2-REPORT-instanthome.md of that worktree.

Home now shows the person's last lists at once after a relaunch. With the network held for 600 ms, the first Home rows took 654 to 657 ms before (3 runs). They take 42 to 53 ms with a stored record (jsdom, includes React render). The fresh answers then replace the stored ones. The real build keeps the first-request reads of a cold Home in a small IndexedDB of its own (`madar-home-cache`, no new package, one record per auth user id): session.get, both tasks.list, projects.list of the role, today's meetings.list, chats.unreadCount, notifications.count, subCompanies.list and users.list. A record of another build or older than 7 days is ignored and deleted. The read runs beside the first request and gives up after 150 ms. Each stored answer goes into the query cache with its stored time, only where the query has no data. The same read is sent at once and joins the request already on the wire, so no extra request goes out. The write runs at idle after the Home reads settle, then at most once a minute. It never writes a record over 1 MB, answers from a stored life, or anything after a sign-out. The record is cleared at every sign-out path, at session expiry, when another person signs in, at a start with no session, and when the fresh session.get shows another role or other rights. In that last case the shown stored answers are reset at once. A fresh session that arrives before a late read also blocks a record of the old role. IndexedDB that throws, fails or is missing gives the plain load with no error on screen. The prototype stores nothing.

Tests: New tests: HomeInstant.test.tsx (15) and homeCache.test.ts (10), plus 2 in AuthGate.test.tsx and 1 in signOut.test.tsx for the clears. They cover: rows before any answer, fresh replace, no duplicate request, a hidden project disappearing, another user id, other build and over 7 days, role change, a late read, sign-out and expiry clears, IndexedDB throw, fail and missing, the 1 MB limit, the write gap, no write after sign-out, and the prototype storing nothing. Ran npm run typecheck (clean) and 42 related test files (415 tests, all pass): home, auth, app/remote, firstLoadImports, runtime, GuardReads, PressReads and the other heldRemoteApp users. Did not run the full npm test, builds, test:db, test:it, test:mcp or the smoke.

### Wave 2: direct and group chat signals to the members only (SV-7, DF-2, owner yes 2026-10-21)
Branch `worktree-wf_adeeec9a-475-2` (head 4e3060ab), merged into `rb/perf2`. Report PERF2-REPORT-chatsignal.md of that worktree.

A direct or group chat message no longer sends the anonymous office signal. Each member of each touched chat, before and after the change, gets a person signal. A person taken out or added gets it too. Project chats keep their office signal with actor and story. A save that also touches other kinds keeps its office signal for those kinds only, without the chat kinds and without the chat office flag. The old nameless office signal stays only as a fallback for a chat that neither State holds. Numbers for one chats.send (writeDiff statements plus the one realtime.send). Direct message: before 7 statements and 2 signal rows (1 office, 1 person), woke every open tab; after 6 statements (no office_meta update) and 2 person rows, wakes only the 2 members' tabs. Group of 5: before 7 statements and 2 rows; after 6 statements and 5 person rows, woken tabs only the members'. The person_seq upsert stays one statement (a group writes one row per member: 1 to 5 rows for 5 members, 50 for 50). Realtime stays one send per save.

Tests: npm run typecheck is clean. Green: the touched files (server/core/chatSignalMembers.test.ts 12 new, server/core/chatSignalLeaks.test.ts 8 new, server/data/save.test.ts 65 with about 8 new and 7 rewritten, server/core/chatsGroupSignal.test.ts 2 rewritten, src/app/signals.test.tsx 56 with 7 new). Side-effect check also green on server/core, data, signal, test, http, push (81 files, 923 tests) and server/office, mcp, google, mail, calls, jobs, auth, files, entries (106 files, 1,287 tests). Leak tests cover an outsider (Admin in a direct chat, Member in a group): no signal on office or the outsider topic, no change of person counter, office counter or office version, same answers on chats.list, chats.unreadCount, notifications.list and count, search.query, events.list, same error text as a missing chat for chats.messages, markRead, send, archive. Agent test included. The merge lead must run: npm test, test:db, test:it (server/it/save.it.test.ts, runCall.it.test.ts, realtime.it.test.ts, loaders.it.test.ts), test:lite, test:office.

### Wave 2: the CORS preflight on WebKit, and the page's own /api for WebKit (DF-12, LV-6)
Branch `worktree-wf_adeeec9a-475-3` (head 8c9aaad1), merged into `rb/perf2`. Report PERF2-REPORT-webkitcors.md of that worktree.

Decision: BUILD. WebKit browsers (Safari on a Mac, and every browser on an iPhone or iPad) now send their batch calls through the page's own /api. Every other browser keeps the direct address.

Measured on the test copy with WebKit 26.6 (iPhone 15 profile) and Chromium, about 150 API calls.

Preflight cache life, counted in the Supabase edge logs:
- Chromium kept the preflight for the full 11 minutes.
- WebKit sent no OPTIONS at 30 s, 2 min, 6 min or 9 min. It sent one at 11 min. That fits a 10 minute cap. Calls took 350 to 462 ms up to 9 min and 616 to 703 ms at 11 min.
- Caveat: the log stream dropped the warm-phase and 1 s rows of the WebKit run. The warm calls themselves took 504 to 760 ms, which fits a preflight each.

Time of one call, median / p90 in ms, 15 rounds each:

| | direct, new preflight | direct, cached preflight | page /api |
| --- | --- | --- | --- |
| WebKit | 656 / 768 | 370 / 459 | 383 / 417 |
| Chromium | 660 / 700 | 378 / 437 | 378 / 439 |

The forwarder costs about 13 ms more than a cached preflight and about 275 ms less than a new one. The 2026-10-08 audit found it 20 to 50 ms slower than direct on Chromium with a cached preflight. Here it is equal.

For a person who calls every 2 to 10 minutes, a new preflight falls on about g/10 of the calls (g = minutes between calls). The direct extra time per call is 55 ms at 2 min, 137 ms at 5 min and 275 ms at 10 min, against about 13 ms for the forwarder. The break-even is a call every 30 seconds.

What changed:
- New `src/api/remote/pageApi.ts` with `isWebKit` and `batchApiUrl`.
- `build:remote` sets `VITE_API_PAGE_HOSTS` only when the Supabase function is the host. The dev server does not get it, and the public env file may not set it.
- `bootstrapRemote` passes `batchApiUrl(...)` to the batch client.
- The choice needs a `*.supabase.co` build address, the page host in the list (a deployment hash host has no /api and would get 404), and a WebKit user agent. Sign-in, forgot, renew, OAuth and the live socket keep the direct address.
- The live CSP already allows it (`connect-src 'self'`).
- The Worker host already uses /api for everyone and is untouched.

Tests: Tests were written first and seen to fail. New: `src/api/remote/pageApi.test.ts` (user agents, host list, address shapes), 2 tests in `scripts/build-remote.test.ts`, 1 test in `src/app/remote/bootstrap.test.ts` (WebKit gets /api/batch, Chrome gets the Supabase address with the region). `src/api/remote`, `src/app/remote`, `scripts/build-remote.test.ts` and `scripts/vite-config.test.ts`: 27 files, 357 tests passed. `npm run typecheck` is clean. I did not run the full suite, test:db, test:it, test:lite, test:office, test:mcp, the smoke or the build size check (the new code is about 1 KB raw).

Not proven: a real iPhone. After the deploy, wait 11 minutes on an iPhone, press a tab, and check that no OPTIONS reaches the function. Every WebKit call now also counts as one Pages Functions request (free limit 100,000 a day, shared with the satellite tiles).

### The gates of the speed release (2026-10-22)
- Docker suites once on bb8d8527 (GP-1 touches none of their code): db reset; test:db 2,979 passed (27 skipped); test:it 332 of 332;
  test:mcp 330 passed and the conformance runner at its normal 5 of 32; test:lite 2,979 passed; test:office 40 of 40.
- npm test once on 4c55ff97 (after GP-1): 9,794 passed, 6 skipped, 1 failed. The failure was real: DF-13 started the template read for
  a person off the project team, against the LIV-5 pin of 2026-10-07. Fix 29170b22: the early read only for a right that covers every
  project. src/features/project again: 725 of 725.
- Builds once: prototype, server and remote, each with its bundle check. First load of the remote build: 34 files, 947,778 B raw,
  289,341 B gzip (1d45aae5: 50 files, 1,236,844 B, about 384 KB gzip).
- Prototype smoke once on 29170b22: 87 of 87.

### Release record: production at b8bb9e42 (2026-10-22)
- On the owner's "deploy to production", `all.sh production` took b8bb9e42, the commit of the test deploy. It applied the migration
  20261022000300_read_indexes_perf2.sql (three read indexes, one old index dropped). The quick checks passed: health from supabase
  (149 calls), database, lock and asyncContext ok, /mcp with no token 401. madar.vado.sa serves 34 first-load scripts and the new
  vendor file. The after numbers and the screenshots of the test copy come from a delegated agent (Chrome and WebKit iPhone).

### After numbers on the test copy (2026-10-22, b8bb9e42, delegated agent; report and raw JSON in the session scratchpad after/)
- Desktop Chromium, cold, member / admin: first paint 964 / 1,078 ms before, 384 / 588 ms after; first Home rows 2,038 / 2,025 before,
  1,357 / 1,560 after; 6 batches (7 before); 3 OPTIONS (Chromium keeps the direct address). Warm first rows about 815 ms before,
  174 / 245 after. Instant Home: rows before the first batch answer in 12 of 12 warm and reload loads.
- Ended token: first paint 764 ms before, 186 ms after (first rows 247 ms with stored lists).
- One save: 3 batches before, 2 after (a second tasks.list still follows the write); answer 714 ms before, 674 ms after.
- Chat, member to admin: 2,175 ms before, 1,123 ms after. A third tab (management) got 0 signal frames and 0 calls for a direct chat
  it is not in (4 of 4).
- Phone (Chromium, 4G, CPU 4x, load average 4 to 5): first paint 4,960 to 3,972 ms; LCP 6,296 to 5,684; first rows 6,172 to 5,110.
- WebKit, iPhone 15: every batch call went to the page's own /api, none to supabase.co, 0 OPTIONS; first rows 1,033 to 1,533 ms.
- Screenshots: 54 for each engine (EN/AR, light/dark, 11 screens); no blank screen, cut-off, layout break, raw key or fallback font;
  the square sign of m2 draws from the 11.8 KB Inter subset. WebKit wraps "See what's new" on two lines on Home.
- Open: the idle prefetch starts 67 chunks (562 KB) at 805 ms, 64 of them before the first rows on a cold load; the save still sends
  a second batch; the three font preloads stay (LV-1).

### Release record: production at fbe8ac55 (2026-10-22, the two speed follow-ups)
- On the owner's "deploy to production now", `all.sh production` took fbe8ac55, the commit of the test deploy (the idle prefetch after the
  first data, and one trip for each save under the cost budget). No migration. The quick checks passed: health from supabase (149
  calls), database, lock and asyncContext ok, /mcp with no token 401. Gates once on dffe9a1a and fbe8ac55: npm test 9,832 passed; test:db
  2,990; test:it 332; test:mcp 330 and conformance 5 of 32; test:lite 2,990; test:office 40; the three builds. The prototype smoke and the
  live check of one save ran after the test deploy, on the owner's "deploy" (checks after).

### Live check of the two follow-ups (test copy at fbe8ac55, 2026-10-22, delegated agent; raw JSON in the scratchpad after2/)
- One save (task title, member, Chromium): 1 request in 10 of 10 saves (was 2 in 5 of 5); the write request holds 9 calls and 7.3 to 7.9 KB
  (was 6.4 KB). Answer 717 ms median (568 to 1,334) against 675 ms (619 to 714): no felt gain, because the second request came after the
  answer. The gain is one Edge call less for each save. Server CPU of the save request, from the isolate shutdown lines: 175, 287 and 261 ms
  (the cold start included), far under 2,000 ms.
- Phone cold load (Pixel 5, 4G, CPU 4x, member, 5 runs): the idle download starts at about 7.9 s (was 4.1 s), after the first rows; no
  screen chunk starts before the rows (36 files then: the 34 of the first load and the 2 word files); 656 KB loaded by 5 s (was 772 KB).
  First rows 5,458 ms (5,181 to 5,899) against 5,110 ms; LCP 5,732 against 5,684; the Mac load average was 10 to 14 (about 5 before), so
  the times are not a fair compare. The rows wait for the first batch answer, which the change does not move.
- Open: the limit of 3 imports at a time counts screens, not files: a screen import pulls its own chunks together (26 requests in flight
  at 8.3 s for ProjectsScreen and its parts). A second phone measure at a low load is still to do.

### Release record: production at 8903f5a7 (2026-10-22, team reports batches A and C)
- On the owner's "Production now" (AskUserQuestion), `all.sh production` took 8903f5a7, the commit of the test deploy: batch A (fbk_038
  picture zoom, fbk_040 file chip and one picture inside the bubble and the file names once, fbk_043 checklist order, fbk_045 upload bars,
  fbk_046 and fbk_047 paste and drop in the Tracker, posts and minutes) and batch C (fbk_042 the Board view of Tasks). Screens only: no
  migration, no handler or loader change; the MCP docs of `tasks.update` name the checklist order. The quick checks passed: health from
  supabase (149 calls), database, lock and asyncContext ok, /mcp with no token 401; the page title Madar, `/favicon.ico` 200, and the live
  `WorkScreen` chunk holds the board code.
- Gates once on the join (main f798195a plus A and C): typecheck; npm test 9,908 passed, 2 Inbox timing tests failed under a load
  average of 12 and pass alone (`ChatListStage`, `ReactionAny` 3 of 3); the three builds (first load 946,527 B, 284,743 B gzip, 21 files);
  screenshots EN and AR, light and dark, 390 px (the chat bubble, the zoom, the checklist grip and its keyboard move, the Tracker drop
  frame, the Board with "Your review"). Not run: test:db, test:it, test:mcp, the prototype smoke and the deploy suite (screens only).
  The upload bars were not seen in a browser: the prototype upload ends at once.

### Release record: production at 6f7c3538 (2026-10-22, team reports batch B)
- On the owner's "Production now" (AskUserQuestion, told that the office goes quiet from 5 PM Thursday to Sunday 9 AM), `all.sh production`
  took 6f7c3538, the commit of the test deploy: quiet hours (fbk_048: work days and one range for each person, the office default and
  the lock Sunday to Thursday 9 AM to 5 PM, no push and no email in quiet hours, one push when they end through the job step `quietEnd`,
  the morning summary at the start of each person's work hours), @everyone (fbk_041: `@everyone`, `@all`, `@الجميع`, the right
  `chat.mentionEveryone`, bell and push, never email), and the photo decode fix (a file over 2 MB decodes to 960 px wide). No
  migration. The quick checks passed: health from supabase (149 calls), database, lock and asyncContext ok, /mcp with no token 401; the
  page title Madar, `/favicon.ico` 200, and the live words hold the Quiet hours section.
- Gates once on main c83ad4fb plus B: typecheck; npm test 10,074 passed (1 Home timing test passes 2 of 2 alone); test:db 3,037;
  test:it 333 (one pin of the push device row updated for the two new columns); test:mcp 335 and conformance 5 of 32; the four builds;
  screenshots EN and AR, light and dark, 390 px. Not seen live yet: a push held in quiet hours and sent at their end.

### Release record: production at 01af2203 (2026-10-22, team reports batch D)
- On the owner's "Production now" (AskUserQuestion), `all.sh production` took 01af2203, the commit of the test deploy: hidden projects,
  "See every project" and internal projects (fbk_044, waves D1 to D4: four rights, 117 switches; `Project.access` and `Project.kind`; the
  view rule that fails closed; every door, list, SQL limit, Realtime signal, notice, push, summary line and Google Calendar row follow
  it; the call `projects.setAccess`; the New project choice, the "Who sees this project" block, the lock mark and the word Internal), and
  the wider mention list on a phone. No migration. Release day changes nothing for anyone: every project stays open and every role keeps
  "See every project". The quick checks passed: health from supabase (150 calls), database, lock and asyncContext ok, /mcp with no token
  401; the page title Madar, `/favicon.ico` 200, and the live words hold "Who sees this project".
- Gates once on the join: see TASKS.md (npm test 10,316; test:db 3,176 after two test-only fixes; test:it 333; test:mcp 339; builds;
  api bundle bound raised to 900,000 with its history line; screenshots EN and AR, light and dark, 390 px, with a person off the team
  who sees no row and a not-found page). Not run: the prototype smoke and the deploy suite.

### Release record: production at f90bd7e7 (2026-10-22, fbk_049 and the What's new dates)
- On the owner's "Production now" (AskUserQuestion), `all.sh production` took f90bd7e7: the Settings section "When Madar notifies you"
  with one live line of the quiet time and picked days that look picked (fbk_049), the built-in office hours and lock Sunday to Thursday
  8:00 AM to 5:00 PM, and the What's new page dated by release day (19, 20, 21 and 22 October). No migration.
- The first run stopped at the secrets step: "The Management API refused the key list with 500" (Supabase; migrations and config were up
  to date, nothing deployed). The second run passed every step: health from supabase (150 calls), database, lock and asyncContext ok,
  /mcp with no token 401; the page title Madar, `/favicon.ico` 200, and the live words hold "When Madar notifies you".

### Release record: production at 139ad4ba (2026-10-22, fbk_050 and fbk_051)
- On the owner's "Production now" (AskUserQuestion), `all.sh production` took 139ad4ba: "Download all" as one ZIP made in the browser under
  every message, to-do comment and post comment with 2 or more files and on the Files tab (fbk_050), and the two times of "When Madar
  notifies you" in the order of the quiet line, "Quiet from" then "Until" (fbk_051). Screens only, no migration. The quick checks passed:
  health from supabase, database, lock and asyncContext ok, /mcp with no token 401; the page title Madar, `/favicon.ico` 200, the live words
  hold "Quiet from", and the lazy `zip-*.js` chunk answers 200.
- The read of a file from the page: the EU bucket `madar-files` (`wrangler r2 bucket cors list madar-files --jurisdiction eu`) allows
  `PUT, GET` from madar.vado.sa, and a preflight to `<account>.eu.r2.cloudflarestorage.com` answers 204 with
  `Access-Control-Allow-Origin: https://madar.vado.sa`. A probe of the host without `.eu.` answers 403: always use the EU host.

### Release record: production at 9fba0e25 (2026-10-22, phone Direction D and the icon-only tab bar)
- On the owner's "it works, release to production" (2026-10-22, after his try on the test copy), `all.sh production` took 9fba0e25 at
  21:14: phone Direction D (Today, Inbox, Work and Me; 63847d10), the 4 deploy-suite fixes of `rb/phone-d-suitefix` (test files and
  `tests/CLAUDE.md` only), and the icon-only tab bar that the owner asked for during his try (48 px tabs, 24 px block icons in the middle,
  a 60 px bar, What's new 2026-10-23-99 names each icon). Screens only, no migration. The quick checks passed: health from supabase,
  database, lock and asyncContext ok, /mcp with no token 401; the page title Madar, and the live English words hold "Inbox (the tray)".
- The deploy suite ran green on the test copy at 63847d1 (after the test-only fixes). It did not run on 9fba0e2: the owner asked for
  production after his try, and the change since 63847d1 is the tab bar and test files. The gates of 9fba0e2: typecheck; npm test
  11,088 passed, 6 skipped (944 files), with 8 unhandled "Worker is not defined" errors from the map tests that predate it (TASKS.md);
  the new bar check of `tests/e2e/owner.spec.ts` passed in Chromium and WebKit on the dev server (each icon 0 px from the middle of its
  tab, in English and Arabic); bar screenshots EN/AR, light/dark, 390 px.

### Release record: production at 10c7191b (2026-10-25, the Inbox line of fbk_056 and projects from the AI agent of fbk_057)
- On the owner's "plan and build both, don't stop until you finish" and his answer "all the way to production" (2026-10-25), Claude ran
  `all.sh test` and then `echo production | scripts/deploy/all.sh production`, which took 10c7191b at 12:43 (Riyadh) on the first try.
  Plan: `docs/superpowers/plans/2026-10-25-madar-inbox-line-agent-projects-plan.md`. Two Sonnet builders (`rb/inbox-line`,
  `rb/agent-projects`), joined on main by the lead with What's new `2026-10-23-100` and `-101`.
- fbk_056: a filtered Inbox list shows one quiet line with the unread messages of the other kinds and "Show all". The cause was the
  persistent "People" filter of an Admin; the badge stays as it was. fbk_057: the AI switch `ai.projectSetup` (Admin only by default,
  118 switches, 89 powers) opens `projects.create`, `clients.create`, `clients.list` and `projectTemplates.list` to an agent (an Admin's
  agent has 61 tools); the lists are lean (no client phone or email, no template tasks). No migration, no new call.
- Gates of 10c7191b, each once: typecheck; npm test 11,147 passed, 6 skipped (947 files); prototype smoke 135 of 135 (with
  `npm run build`); `build:server`; `build:remote -- test`; test:db 3,185 (27 skipped); test:lite 3,185; test:it 333; test:office 40;
  test:mcp 372 with conformance normal (5 of 32). Screenshots of the Inbox line (desk and 390 px, EN and AR, light and dark) and of the
  role sheet switch, in the session scratchpad.
- Live checks: the quick checks of both copies passed (health from supabase, `fileStore` r2, 150 calls; database, lock and
  asyncContext ok; /mcp with no token 401). The live English words of both copies hold "unread messages are in other chats" and
  "AI creates projects and clients"; the production page title is Madar and `/favicon.ico` answers 200. The deploy suite did not run:
  the change has no new call and no migration, and the in-process MCP tests cover the tool lists of each role.

### Release record: production at 4df7db3d (2026-10-25, four team reports, the PostHog insight and three to-do fixes)
- On the owner's "take the filter too and go production" (2026-10-25), Claude ran `all.sh test` and then `echo production | scripts/deploy/all.sh
  production`, which took 4df7db3d at 15:28 (Riyadh) on the first try. One release for three sessions, by the owner's choice: madar-6a (lead),
  madar-52 (`rb/posthog`) and madar-4e (`rb/task-fixes`, cherry-picked on the owner's word).
- Team reports (plan `docs/superpowers/plans/2026-10-25-madar-team-reports-2-plan.md`): fbk_052 Ctrl+Z on an Arabic keyboard, Undo toasts stay 8 s,
  a swipe on a notice shows Undo; fbk_055 the Open space "Show more / Show less" with 5 steps, a sub-company column, deadline and checklist cards,
  the refit on resize, a zoom up to 1.6 on a wide screen, and the phone fixes found by the 390 px check (one screen high, the first view fills the
  box, short Detail words); fbk_058 the morning summary only on the office work days; fbk_059 the project chat as a docked sidebar in Focus mode
  with a switch to the to-do thread and a compact box (the owner's three changes during the join). What's new 103 to 106.
- PostHog insight (design `docs/superpowers/specs/2026-10-25-madar-posthog-insight-design.md`): usage, errors and masked replays; What's new 102
  stays first. The test copy check of madar-52 passed on 3b40b13c after two fixes: 4d07d7bb (connect-src gains `https://eu-assets.i.posthog.com`
  for the project settings) and 89ce45c7 (the harmless "ResizeObserver loop" warning stays out of the error list). Production carries both.
- To-do fixes of madar-4e: the title and the description of the task panel save on their own, a drop across groups saves nothing, the meetings
  card clock ticks on every screen; What's new 107.
- Gates of 4df7db3d (npm test and the smoke on 4df7db3d; the database suites on 80b5d585: the later commits 4d07d7bb to 4df7db3d touch
  screens, the deploy header rules and guides only, no server code): typecheck; npm test 11,395 passed, 6 skipped (963 files); prototype smoke 135 of 135; `build:server`;
  `build:remote -- test` (first load 293,042 B gzip, 25 files); test:db 3,192 (27 skipped); test:lite 3,192; test:it 333; test:office 40; test:mcp
  372, conformance normal. Screenshots in the session scratchpad (`shots`, `shots2`, `shots3`).
- Live checks: the quick checks passed (health from supabase, `fileStore` r2, 150 calls; database, lock and asyncContext ok; /mcp with no token
  401); the production page title is Madar, `/favicon.ico` 200, the served policy holds `eu-assets.i.posthog.com`, and the live English words hold
  "Which chat", "Show more", "Undo stays longer", "Morning summary on office days", "Madar records errors and usage" and "Fixes for to-dos and Home".

## Daftra study on the Mazj account (2026-10-26)

A read-only study for the Daftra link (`TASKS.md`, flow A: Madar only reads Daftra). The owner gave a key of the Mazj Daftra
account (`DAFTRA_MAZJ_KEY`, `DAFTRA_MAZJ_SITE` in `.env.local`). The probe `scripts/proof/daftra-read.sh` sent GET only. Nothing in
the Mazj books changed. Mazj is a business incubator, not the office: its invoices are small and it has no work orders.

- Address and key: `https://<site>/api2/<entity>.json`, header `apikey: <key>`. The site of the account works (the docs name
  `{subdomain}.daftara.com`). `site_info.json` answers the account: currency SAR, country SA.
- Size of Mazj: 1,719 invoices, 837 clients, 1,734 invoice payments, 43 products, 0 work orders.
- Speed: one call takes 1.0 to 1.4 s; a page of 100 invoices takes 3.4 s and 523 KB. No rate-limit header comes back, and the docs
  name no limit. So Daftra calls belong in a job, never inside a screen request, and a read asks small pages with filters.
- Filters that the study used: `client_id`, `payment_status` (0 unpaid, 1 part paid, 2 paid; -2 due, -3 overdue, -1 draft),
  `created_from` and `created_to` (also `date_from`, `due_date_from`). `limit` has no maximum.
- The invoice list sorts by the invoice date, not by the day of entry: a back-dated invoice (entered 2026-10-21, dated 2026-09-29)
  sits below newer dates. So "new invoices since the last look" uses `created_from`.
- `summary_total` is the amount with VAT. `summary_paid` can be larger than the total (860.87 paid on a 260.87 invoice): never
  compare it with the total. The paid state is `payment_status` 2.
- `GET /invoices/<id>.json` holds the invoice with `InvoiceItem`, `InvoicePayment`, `InvoiceTax` and `Client` inside the `Invoice`
  object. So Madar needs only two entities: invoices and clients.
- The list and the single answer differ in types and dates: the list gives strings and ISO dates (`2026-10-04`); the single
  invoice gives numbers and the date format of the account (`29/09/2026`). Read the dates from `created` or the payment rows,
  or parse both forms.
- An invoice payment row gives `date` (the day the money arrived, not the day of entry) and `amount` with up to 4 decimals
  (`283.9465`). Round to 2 decimals before a match. "Received" takes the date of the last payment row.
- Clients: the VAT number (`bn1`) was empty on 5 of 5 sampled clients. A client match by VAT number fails; the accountant
  confirms each client match once.
- Key roles (new in the docs since 2026-10-06): Settings, API, API Key, Roles: "Only Allow" a list of entities (for example
  `invoice`, `client`); any other entity answers 403. A role limits the entities, not read against write. The real office key
  should be "Only Allow" `invoice` and `client`.

### Release record: production at a9c0841e (2026-10-26, team reports fbk_060 and fbk_062 to fbk_066)
- On the owner's "ok production" (2026-10-26), Claude ran `echo production | scripts/deploy/all.sh production` from deploy-test, which took the
  recorded commit a9c0841e on the first try (the test copy took it the same day, `all.sh test`). Session madar-83 (named madar-tileshape) led;
  three Sonnet builders, one track each: `rb/b26-small`, `rb/b26-names`, `rb/b26-folders`, joined on `rb/b26-join`.
- fbk_064 the lead button of a to-do row never ends on the error page: the people list loads through `lazyOverlay` (a failed chunk reloads the
  page once) and a fault inside the list shows a toast. Faisal's error came 49 minutes after the release of 12:44 on 2026-10-25, so a tab that
  asked for an old chunk is the likely cause; no data cause was found. fbk_060 the leader picture has an ink ring and is 34 px in project rows.
  fbk_063 the desk person menu has two groups (Away, Mode, Language first) and loads at its first use. fbk_065 "Only my work" also limits Home
  "Your projects" and the bare Projects link. fbk_062 a project has an optional Arabic name. fbk_066 folders in each stage of Files & Links,
  "+ Folder", Move to, the drag between stages and folders, a computer file dropped on a folder (the folders live in the project document, so no
  migration). What's new 108 to 112. Join fixes: the word "New" of What's new follows the newest day (it never showed under the pinned usage entry);
  the reach rule lives in a light file and the person menu panel is a lazy chunk, so the first load is 957,655 B raw (limit 970,000) and
  291,903 B gzip.
- Gates: typecheck; npm test 11,559 passed, 6 skipped (981 files) on 15d1c5c4, then the touched files of each later fix (doc words, the lazy
  panel, the light reach file: 128, 203 and 221 tests); `build`, `build:server`, `build:remote -- test` (every bundle line ok); test:db 3,231
  (27 skipped); test:it 333; test:mcp normal (conformance 5 of 32, 27 expected failures). Not run in this release: test:lite, test:office and the
  prototype smoke. Screenshots in Chrome (prototype build of a9c0841e): the leader ring (EN light, AR dark), the person menu (AR dark, EN light),
  folders with Move to (EN light desk, AR dark 390 px), the Arabic name (form, AR header, 390 px), "Only my work" on Projects (AR dark).
- Live checks: the quick checks passed (health from supabase, `fileStore` r2, 154 calls; database, lock and asyncContext ok; /mcp with no token
  401); the production page title is Madar, `/favicon.ico` 200, and the served first load holds the new `adminReach` and `projectReach` chunks.

### Release record: production at 7e785d4f (2026-10-26, hotfix: the leader ring, the person menu, the What's new order)
- On the owner's "production" (2026-10-26), after he saw an oval leader ring and an uneven person menu in production, Claude ran `all.sh test`
  and then `echo production | scripts/deploy/all.sh production` from deploy-test; both passed on the first try.
- The leader ring: each picture box of `AvatarStack` is `flex shrink-0`. A photo (an inline img) in a plain box sat on a text line, the box grew a
  gap under it, and the ring drew an oval with the photo at its top; initials have no gap, so the prototype screenshots of a9c0841e missed it. The
  ring is 1.5 px, and the leader of a project row is 32 px (owner: a little smaller). Live check: the leader box measures 36 by 36 px on madar.vado.sa.
- The person menu: Away keeps its switch; Mode and Language are one button each that names the other choice; the three controls share one height
  (31 px) and one end edge (owner's choice through AskUserQuestion). What's new: the page sorts the entries by day, so each day shows once (it showed
  25 Oct, 26 Oct, 25 Oct).
- Gates: typecheck; check-rtl; the touched and caller tests (components, projects, space, project tasks, Admin, app shell, auth, Me, settings,
  What's new: 731 and 76 tests); `all.sh test` builds (remote screens, server, every bundle line ok). Not run: the full npm test and the database
  suites (screens only, no server change). `focusInert.test.tsx` fails under a load of 16 on the production commit a9c0841e too (TASKS). Screenshots
  in Chrome with real photos: the Home rows (prototype EN dark, production dark), the menu (EN dark, AR light).
- Live checks: the quick checks passed (health from supabase, `fileStore` r2, 154 calls; database, lock and asyncContext ok; /mcp with no token 401);
  the production page title is Madar, `/favicon.ico` 200.

### Release record: production at 5bfb2df7 (2026-10-26, tile shapes fbk_061 and the Daftra link, one release)
- On the owner's "khalas go to production" (2026-10-26), Claude (madar-tileshape) shipped `rb/tile-shape` on top of `rb/daftra` (bbc0a779): the
  daftra session had already put bbc0a779 on main and on the test copy (migration 20261026000100_daftra.sql on madar-test), so a rewind was not
  possible; the owner chose "both together" (in the daftra session). `all.sh test` and `echo production | scripts/deploy/all.sh production` both
  passed on the first try; 156 calls. Daftra is dormant in production (no DAFTRA keys): only the role switch, the due notice and one What's new line show.
- Tile shapes: `Project.shape` (one SVG path in the 18 box, empty clears), set by `projects.update` patch.shape under project.details, drawn by
  `ProjectTile` and `MarkForm` at 62% with evenodd (the random form stays at 45%), and by `look.tile`. The MCP INSTRUCTIONS carry the owner's procedure
  (ask for the inspiration source, about 5 options as an artifact, iterate until the person accepts, only then set the shape) and the drawing rules
  (a solid mass, the real outline, special places as holes). What's new 114. Shapes set after the release (story sty_2ofxcyenxnamn4f7uot2yy): Madar,
  Hayyez and Kutla logos on prj_015, prj_016, prj_017; the Eastern Corniche (prj_010) the owner's pick B4 (the plaza and the leaf on the promenade wave).
- Gates for the tile shapes: typecheck; the builder's wide runs (src/api, server/data, server/mcp 4,117; the tile screens 1,777; 1,333 more); the overlap
  tests after the rebase on Daftra (623); `npm run build` (prototype bundle check ok); `all.sh test` builds. The full npm test was stopped after it ran
  long under the Docker load of daftra (owner rule: stop past 5 minutes and deploy); the one failure seen, ReactionAny, passed alone. Not run for the
  tile shapes: test:db, test:it (Daftra ran its own full gates on bbc0a779). Screenshots: shaped tiles in the prototype (EN dark desk, AR light 390 px)
  and in production (the Projects list).
- Live checks: the quick checks passed (health from supabase, `fileStore` r2, 156 calls; database, lock and asyncContext ok; /mcp with no token 401);
  the production page title is Madar, `/favicon.ico` 200; the four shapes show in the live Projects list.

### Release record: production at 1f240dbb (2026-10-26, Daftra follow-up: the Link button, the fresh look, the look limit)
- The owner tried the Daftra link on the test copy with the MAZJ test key (sub-company MAZJ, prj_001, payment pay_003): match a Mazj client, a new
  invoice (1521961, 34.50 SAR) suggested, Link, "Invoiced", and after Daftra said paid the 13:15 job set "Received 26 Oct" by itself. Two gaps from
  that try, fixed on `rb/daftra-fix`: Link was a fifth footer button that fell off the sheet (it sits in the Daftra box now), and an invoice made after
  the last copy waited up to 15 minutes (the sheet now looks in Daftra at once when no invoice matches, at most once a minute for each client).
  A background security review found that the minute must count from the look itself (a client with no invoice, a failed look): fixed, with a test.
- Before it, on `rb/daftra` (released in 5bfb2df7): the Undo guard (an Undo never gives one invoice to two payments, also on Postgres), Madar's own
  read-only lock (`server/daftra/readOnly.ts`: Daftra has no read-only key), and four code review fixes (the job never starves a link; one odd row
  no longer fails a Daftra list). Claude Security scan of the branch (medium, 132 files): no findings, stamp verified.
- Gates of the follow-up: typecheck; the touched tests (234); `npm run build`, `build:server`, `build:remote -- test`; `all.sh test`; then
  `echo production | scripts/deploy/all.sh production`, run by the owner. Not run for the follow-up: the full npm test, test:db, test:it and the deploy
  suite (owner: speed; the change is one server read and one screen part). Daftra stays dormant in production until the five keys.
- Live checks: the quick checks passed (health from supabase, `fileStore` r2, 156 calls; database, lock and asyncContext ok; /mcp with no token 401).
