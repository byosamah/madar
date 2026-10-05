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

**2026-10-04, security fix 8 follow-up (background review of 4b72ab6, "sensitive-data-at-rest").** The unsent row now holds the plain renew key next to the token hash. The renew route accepts a key only when the mail of its row went out (`RENEW_ROW_SQL` reads `sentAt`), and `SENT_SQL` drops the plain key in the same statement that writes `sentAt`. So a plain key that a reader of the outbox finds never works, and a sent row holds only the sha256. Unit proof (`server/auth/renew.test.ts`): a key read from an unsent row gets the same answer and sends nothing (on 4b72ab6 it made a new link and sent a mail). Database proof: `renew.it.test.ts` and `invites.it.test.ts`, 13 of 13.

## Z0b. The client address of a request on both hosts (S1 header probe, madar-test, 2026-10-04)

**Why.** The forgot route limits reset requests for each network address (task S1). The limit is only as good as the header it reads, and the P2 rule read the first `x-forwarded-for` entry, which the sender writes.

**What ran.** Track S1 deployed a short-lived probe function `probe-ip` to `madar-test` (`qdgwpnesxppnqsaabqzd`) only, sent it requests from the Mac with forged `x-forwarded-for`, `true-client-ip` and `cf-connecting-ip` headers, and logged the headers that arrived. The function is now a stub that answers 404; it goes when the owner says yes (TASKS.md, Z0b item). The Workers host gets `cf-connecting-ip` from Cloudflare itself (platform fact), so the result covers both hosts.

| Header | What arrives at the function | Use |
|---|---|---|
| `cf-connecting-ip` | The real address of the client: Supabase Edge Functions sit behind Cloudflare too. Cloudflare refuses a request that sends its own `cf-connecting-ip` ("error code: 1000"), so a sender cannot forge it. | The only one, on both hosts |
| `x-forwarded-for` | "client, client, proxy": a forged value is replaced, and the LAST entry is a rotating proxy address (for example 13.248.x.x, 172.69.x.x), not the client. Reading the last entry puts many clients under one proxy address, so one limit for many people. | Never |
| `true-client-ip` | Passes through forged. | Never |

**Result.** `clientAddress` (server/auth/forgot.ts) reads `cf-connecting-ip` on both hosts, and `unknown` only on local runs (S1, 2e43cb4). The rule "the last `x-forwarded-for` entry" of the first S1 commit is gone. The P2 design note above is corrected to match.

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

**Re-run.** On main 6aa0c56 (branch rb/Y), 2026-10-04: take the Docker lock, `supabase db reset` from the worktree, then `MADAR_IT=1 npx vitest run --project it server/it/loaders.it.test.ts server/it/officeCache.it.test.ts` (9 of 9 pass) and `npx vitest run --project server server/data/loaders server/data/officeCache` (46 of 46 pass).

## V. Every invitation mail counts against the daily mail quota (local stack, 2026-10-04, wave 6 track V)

**What changed.** Before, only a renewed invitation took a place in the daily mail quota (`mail_log`), so the invitations of `users.create`, `users.resendInvite` and the `auth.email` effect could send past the hard stop of 98 while Resend counted them. Now `sendInvitation` (`server/auth/invite.ts`) counts every invitation as sign-in mail with `sendCounted`, under the ref of its idempotency key (`invite:<inviteId>`), so a retry keeps its place and counts once. A row with no link yet reserves its place before Auth makes the link (an Auth link lives 1 hour, so a link made on a full day would be dead in the next day's mail). A full day throws `QuotaFull` (now in `server/mail/quota.ts`): `processOutbox` holds the row until the next UTC midnight and gives the attempt back, and `users.invites` shows no `sentAt` until the mail goes out. The reserve takes only the mail lock in a transaction of its own; the renew route keeps its order (office lock, then mail lock).

**What the Admin sees.** People shows the person with the calm "Invited" mark only: no alarm, no date, no new button (jsdom test in English and Arabic). The toast of "Send the invitation again" now says "The invitation is on its way to <name>." (`people.onItsWay`, `src/i18n/real/v.*.json`), which stays true on a full day. The waiting row also shows in Usage under the failed effects with the error "The invitation did not go out: the daily mail quota is full. The job sends it on the next UTC day.", as the waiting notice of S1 already does.

**Proof.** On rb/V (from main f30e5e7): take the Docker lock, `supabase db reset` from the worktree, then `MADAR_IT=1 npx vitest run --project it`. The new case in `server/it/invites.it.test.ts` passes: `users.create` and `users.resendInvite` each hold one `signin` place with the Resend id; with the day filled to 98, `users.create` still answers ok, the `auth.invite` row waits until 2026-10-05T00:00Z with 0 attempts and no token hash, the person has no `auth_user_id`, `users.invites` gives `sentAt: null`; after the wait, `processOutbox` sends the mail on 2026-10-05 with one place on that day, and its link sets a password. The two renew cases of `server/it/renew.it.test.ts` now count the first invitation too (2 places). Whole it run: 29 of 30 files, 226 passed, 8 skipped; the one failed file is `scripts/restore-check.test.ts`, which needs the `age` program (not on this Mac, MADAR_AGE not set).

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

- **Run 1** (full suite with AFTER_G and AFTER_M, then the walk): 147 failed, nearly all on one app bug. zod 4.6.5 tests for eval with `new Function` once; the page has `script-src 'self'`, so the browser reported a Content-Security-Policy violation on every load, although zod caught the error. Local runs never saw it: vite preview sends no CSP. Fix: `z.config({ jitless: true })` in `src/app/zodConfig.ts`, the first import of `main.tsx` (29a7dfd). Never add `'unsafe-eval'`.
- Run 1 also found: a cancelled batch request that `batchAs` waited on (now waits for an answered one), a mid-move size check that live loading cannot catch, and an Auth grant that agents.spec Z0a case 3 left on the Member (the test now removes it; the seed does not clear `auth.oauth_consents`).
- **Run 2** (after the fixes, screens redeployed): full suite 157 passed, 2 failed, 7 skipped by design; the CSP check is clean. The walk passed 143 of 144 steps; the one failure was `net::ERR_CONNECTION_CLOSED`, and a rerun of that variant passed 36 of 36. One failure was a contrast check on half-faded tiles: `settle()` in `tests/e2e-deploy/goto.ts` now waits for a quiet network and every finite animation (c4c62d1).
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

### Thmanyah Sans, the weight ladder and the direction rule (2026-10-05, 89ca770)

- **Screens only:** `pages.sh test`, then `pages.sh production` with the typed word. No migration, setting, secret or function changed.
- **Test copy:** the three OTF files serve as `font/otf` (241 KB each) under the real CSP (`font-src 'self' data:`); in Chrome the sign-in page loads Thmanyah Sans 400, 500 600 and 700 with no failed face.
- **Production quick check:** page 200, `POST /mcp` with no token 401, `api/health` 200, the three font files 200 `font/otf`, the same CSS file as the test copy.
- **Not run:** the deploy suite on the test copy. Local checks before the deploy: `npm test` 3,408 passed, the prototype smoke 87 of 87 (before the last five layout fixes), both builds.
