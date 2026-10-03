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
