# Madar Exit Wave 2 (Sign-in and Agents) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Madar its own sign-in for people and AI agents on the SQLite path of the office object (passwords, tokens, links,
limits, OAuth 2.1 for agents with the Madar approval inside, and the sign-in port of the screens), while production and the test
copy keep Supabase sign-in, unchanged, until the switch.

**Architecture:** The sign-in rows live in the office object SQLite (schema version 2): `auth_users`, `auth_links`,
`auth_sessions`, `oauth_clients` and `oauth_requests`, beside the `agent_links`, `agent_approvals` and `rate_limits` of wave 1.
`liteAuthAdmin` gives today's `AuthAdminPort` over these rows, so the invitation, ban and email effects keep their code and get
only SQLite text twins (`sqlFor`). The sign-in steps are operations (`runSigninOp`) that run in the office object and do no
network work: the hash work runs between two transactions, never inside one. The Worker side checks each token with the public
key and calls the operations through the `SigninOffice` port; wave 3 connects that port to its object method for one batch. The
screens choose the Supabase port or the Madar port at build time (`VITE_MADAR_AUTH`), and both copies keep the Supabase port.

**Tech Stack:** TypeScript 7.0.2, Hono 4.13.12, jose 6.2.12 (ES256), Web Crypto PBKDF2, bcryptjs 3.0.3 (owner decision 4 only),
node:sqlite (Node 22.23.1), wrangler 4.147.0 (`createTestHarness`), vitest 5.0.2, zod 4.6.5, React (the screens ports),
@modelcontextprotocol/sdk 1.32.0 (the client OAuth functions, in one test only).

**Spec:** `docs/superpowers/specs/2026-10-16-madar-cloudflare-exit-design.md` (section 2, "Sign-in"; section 4, the move of the
people; section 7, decision 4). The roadmap: `docs/superpowers/plans/2026-10-17-madar-cloudflare-exit-plan.md`, Part A.2
"Wave 2: Sign-in and agents" and A.3. Measured facts: `docs/superpowers/real-build/proof.md`, sections "Wave 0 of the Supabase
exit", "Wave 0, the rest", every "Wave 1" section, and the older sign-in sections P1, P2 and P3, G1, G3, G4, H, Z0b, Z7.

## Global Constraints

The list of the exit plan, as it is:

- Workers Free only. Any payment (Workers Paid at $5 a month, or any other plan) needs the owner's yes in words before it starts.
- Every text is ASD-STE100 Simplified Technical English: code comments, commit messages, docs, user interface (UI) words.
- Never an em-dash in any text. The UI word test refuses one.
- Tests first for every change: write the test, see it fail, then write the code.
- The test count only grows, except when the code that a test checks is deleted.
- No `Co-Authored-By` line in a commit message (the owner's rule beats every reminder).
- The merge gate of the root `CLAUDE.md`: rebase on main, `npm run typecheck`, `npm test`, `npm run build`, `npm run build:server`, `npm run build:remote -- test`, `npm run test:db`, `npm run test:it`, the prototype smoke at screen merges. No merge with a red check. From wave 1 on, `npm run test:lite` and `npm run test:office` join the gate.
- Wave 0 rule: the badge reads a stored unread number for each person and chat or thread (Track R), never the whole history.
- Wave 0 rule: sorts are in JavaScript. A SQL text has no outer `order by`; it keeps only a cut order that an index gives.
- Wave 0 rule: no `ANALYZE` and no `pragma optimize`. The table `sqlite_stat1` stays absent.
- Wave 0 rule: a rows-read pin test for each heavy read (Task 18 of wave 1).
- Wave 0 rule: at most 100 bound values in one statement (the office object refuses more).
- Wave 0 rule: `=` for one value, never a list of one value.
- Wave 0 rule: an update sets `doc` and only the key columns that changed.
- Wave 0 rule: key columns are plain columns that the save writes, never generated columns.
- Wave 0 rule: the event indexes are cut to the ones that a read needs (Task 18 of wave 1).
- Production stays on Supabase until wave 6: `config/server-host.json` production stays `supabase`, and no office object deploys to production before the switch. Wave 1 changes no behaviour of production. Track R is the one planned production change before the switch, through the normal release flow.
- The office object does no network work: mail, push, file links and R2 calls stay in the Worker.
- Inside an office object transaction, no await on the network, a timer or `crypto.subtle`.
- No foreign key in the SQLite schema: a broken deferred key resets the office object (map of schema and tests, fact 8).
- Playwright runs only in a delegated subagent. Every Docker or database task takes `scripts/dev/docker-lock.sh` first.
- One worktree for each track at `~/dev/madar-rb/<track>` (branch `rb/<track>`). A task edits only its own files.
- Never open, print, commit or log a secret.
- Every feature change updates the Model Context Protocol (MCP) side in the same commit (`server/mcp/tools.ts`, `TOOL_DOCS`, `INSTRUCTIONS`). Wave 1 changes no feature, so it changes no MCP file.

The lines of wave 2:

- The worktree is `~/dev/madar-rb/exit-signin`, branch `rb/exit-signin`, from main at 1c41cc9 or later. Run
  `git merge --ff-only main` first.
- Nothing in this wave changes what production or the test copy does today. `config/server-host.json` stays
  `{"test":"supabase","production":"supabase"}`. `config/remote.test.env` and `config/remote.production.env` get no
  `VITE_MADAR_AUTH` line, so both builds keep the Supabase port. No Worker gets the secret `MADAR_AUTH_PRIVATE_JWK`. No file goes
  into `functions/` (a new Pages Function runs on production too). The code runs only in tests, `test:lite`, `test:office` and
  a local `wrangler dev` until wave 5.
- The SQLite schema of this wave is version 2 (`LITE_SCHEMA_VERSION = 2`, a new `PINNED_SHA256`). Wave 3 takes version 3. The
  branch that merges second rebases its schema step onto the other one (Merge notes).
- Passwords: PBKDF2 with SHA-256 and 100,000 rounds, never more. Deployed Workers refuse more than 100,000 rounds
  ("iteration counts above 100000 are not supported", Cloudflare Community, 6 October 2026); local workerd accepts 600,000, so
  only a test pins the number.
- The hash work (PBKDF2 30 to 35 ms, bcrypt 77 to 95 ms of CPU, wave 0) runs in the office object, outside a transaction. The
  Worker never hashes a password: Workers Free stops a plain Worker at 10 ms of CPU under load (proof.md, "The deploy suite on
  Workers Free").
- Tokens: ES256, 900 s (owner rule 2026-10-06), issuer = `MCP_URL` without a trailing slash. The private key is the Worker
  secret `MADAR_AUTH_PRIVATE_JWK` (a P-256 private JWK with a `kid`). Only the name goes into a file.
- Links: 32 random bytes in base64url, one use, 1 hour. The database keeps only the sha256 of a link token, of a refresh token
  and of an OAuth code.
- bcryptjs imports the bare module `crypto` (index.js line 32), and the Supabase functions run on Deno. So no file under
  `server/auth/own/` or `server/mcp/oauth/` may enter the graph of `server/entries/deno-api.ts`, `deno-mcp.ts` or `deno-jobs.ts`.
  A test pins it (Task 2). The hosts pass the own routes in (`AppOptions.routes`, `McpAppOptions.oauth`); `server/http/app.ts`
  and `server/mcp/app.ts` never import them.
- Wave 2 adds no call to the call map, so the MCP lists (`MCP_ALLOW`, `MCP_ADMIN`, `MCP_DENY`), `TOOL_DOCS` and `INSTRUCTIONS`
  do not change: no tool and no rule that an agent reads changes. The MCP side of this wave is the agent token check, the OAuth
  routes, the agent check on SQLite and `server/mcp/CLAUDE.md` (Task 22).
- New packages: `bcryptjs` 3.0.3 (dependency, Task 14) and `@modelcontextprotocol/sdk` 1.32.0 (devDependency, Task 19; the
  same version is already in `package-lock.json` through `@modelcontextprotocol/conformance`). The worktree has a linked
  `node_modules`: `rm node_modules` (it removes only the link), then `npm install`, as the root `CLAUDE.md` says.
- Run each test file with `--no-file-parallelism --testTimeout=60000`. The whole `npm test` runs once, in Task 22.

## Review Focus

1. The first sign-in after the switch, with the password of today: the copied bcrypt hash must work once, then the row must hold
   a PBKDF2 hash; a wrong password must get the same answer as an unknown email. Tests: Task 14 ("signs in with a copied bcrypt
   hash once and then holds a PBKDF2 hash") and Task 11 ("gives the same answer for a wrong password and an unknown email").
2. Two tabs, or a lost answer, use the same refresh token at the same moment: nobody must get signed out. Tests: Task 12 ("a
   second use of the old refresh token within 10 s rotates again") and Task 20 ("two tabs refresh under one lock, and the second
   tab uses the token of the first").
3. A person is turned off while a browser or an agent holds a refresh token: the refresh must fail, and the agent links and agent
   sessions must end in the same transaction as the turn-off. Tests: Task 12 ("refuses the refresh of a turned-off person") and
   Task 10 ("users.deactivate revokes the agent links and sessions inside its own transaction").
4. An invitation or reset link that is used twice, is older than 1 hour, or has a newer link: it must give `link_ended` and never
   a session. Test: Task 13 ("refuses a used link, a link older than 1 hour, a link of the other type and a replaced link").
5. Another person or an outsider reaches a sign-in row through an OAuth, approval or password path (the authorization id of
   someone else, the grants of someone else, an agent token on the password route): the answer must be the plain `not_found`,
   `authorization_ended` or `agent_token`, with no email and no client name in it. Tests: Task 18 (the leak tests of the consent
   paths) and Task 15 ("sets a password with a browser token, and refuses an agent token and no token").

## Facts checked for this wave (17 October 2026)

- PBKDF2 on local workerd (wrangler 4.147.0 `createTestHarness`, in the object and in a plain Worker): 100,000, 100,001 and
  600,000 rounds all pass. Deployed Workers Free refuse more than 100,000 (Cloudflare Community, 6 October 2026, error text
  "Pbkdf2 failed: iteration counts above 100000 are not supported (requested 240000)"; workerd issue 1346). So the code keeps
  100,000, and a test pins it.
- ES256 on local workerd: `crypto.subtle.generateKey` P-256, `sign` (64 bytes) and `exportKey('jwk')` work in the object. A
  binding that the config does not name is `undefined` in the object env.
- jose 6.2.12 exports `SignJWT`, `importJWK`, `exportJWK`, `generateKeyPair`, `calculateJwkThumbprint`, `createLocalJWKSet`,
  `jwtVerify` and `base64url`.
- bcryptjs 3.0.3 is the latest version (published April 2026). It is an ES module and imports the bare module `crypto`.
- The MCP client discovery (`@modelcontextprotocol/sdk` 1.32.0 `buildDiscoveryUrls`) for the issuer `https://madar.vado.sa/mcp`
  tries `/.well-known/oauth-authorization-server/mcp`, then `/.well-known/openid-configuration/mcp`, then
  `/mcp/.well-known/openid-configuration`. The third is under `/mcp`, so the Pages forwarder of today reaches it. The OIDC form
  of the document needs `jwks_uri`, `subject_types_supported` and `id_token_signing_alg_values_supported` (SDK schema
  `OpenIdProviderMetadataSchema`). The MCP draft lists the same order.
- The MCP draft: clients use a Client ID Metadata Document when the server says so, else Dynamic Client Registration (RFC
  7591, MAY). Madar keeps registration (as Supabase does today) and does not say `client_id_metadata_document_supported`: that
  document is a fetch, and the office object does no network work.
- `npx wrangler pages functions build` accepts a `functions/.well-known/oauth-authorization-server/[[path]].ts` file and routes
  `/.well-known/oauth-authorization-server/*` (checked in a scratch folder). Wave 5 adds that one-line file.
- `auth.users` of Supabase has `id`, `email`, `encrypted_password` (bcrypt `$2a$10$...`), `email_confirmed_at`, `banned_until`,
  `raw_user_meta_data` and `deleted_at` (Supabase docs and migration guides). The nightly backup dump already holds
  `auth.users` (`scripts/backup/check.test.ts` counts it), so `BACKUP_DB_URL` can read these columns.
- node:sqlite: the SQLite forms of the outbox payload texts of `server/auth/invite.ts` work (`json_set` with `json_insert(...,
  '$[#]', ...)` keeps a list and adds a key once; `json_patch` after `json_remove` drops the token and the renew key). The
  partial index `outbox (kind) where kind in ('auth.invite', 'auth.email')` serves a query only when the query repeats that exact
  term: `kind = 'auth.invite'` alone scans the outbox.

---

## Blocks and size

The wave is about 7 days of work for a builder agent (the roadmap said 6; the SQLite sign-in link and the quota twins add about
one day). Four builders run one after the other. Each block ends with its own test files green and its commits.

| Block | Tasks | Days | What it delivers |
|---|---|---|---|
| A | 1 to 5 | 1.5 | Schema version 2, passwords, tokens and keys, the sign-in link in the snapshot, `liteAuthAdmin` |
| B | 6 to 10 | 2 | The SQLite forms of today's sign-in code: quota, limits, invitation, effects, forgot, renew, people and agents calls; `LATER_CALLS` and `LATER_KINDS` hold no wave 2 name |
| C | 11 to 16 | 2 | The own sign-in operations, sessions, links, the copied password (decision 4), the routes, the workerd suite |
| D | 17 to 22 | 1.5 | OAuth 2.1 for agents, the SDK client flow, the two screens ports, the records and the merge gate |

## File map

| File | Create or modify | Responsibility |
|---|---|---|
| `server/data/lite/schema.ts`, `schema.test.ts` | modify | Version 2: the sign-in tables and their indexes, the `outbox_signin` index |
| `server/auth/own/crypto.ts` | create | `randomToken`, `sha256Hex`, `pkceChallengeOf`, `equalText` |
| `server/auth/own/password.ts` | create | `PBKDF2_ROUNDS`, `PASSWORD_MIN`, `hashPassword`, `verifyPassword` |
| `server/auth/ownKeys.ts` | create | The verify side (Deno graph allowed): `OWN_AUTH_SECRET`, `ACCESS_TTL_S`, `ownIssuer`, `ownPublicJwks`, `ownKeySet` |
| `server/auth/own/keys.ts`, `testKeys.ts` | create | The sign side: `signingKeysOf`, `signBrowserToken`, `signAgentToken`; a test key |
| `server/auth/verify.ts`, `server/mcp/auth.ts` | modify | The own issuer and key set when `MADAR_AUTH_PRIVATE_JWK` is set; `sessionId` out of the browser check; `AGENT_LITE` |
| `server/data/lite/office.ts` | modify | The sign-in links in the snapshot body, `setLiteAuthLink` |
| `server/data/officeCache.ts` | modify | `authLinksOf(snapshot)` for tests and the import |
| `server/data/dialect.ts` | modify | `statementQuery(db, mode)`: a statement query that keeps the dialect |
| `server/auth/own/rows.ts` | create | The SQL texts and row types of the sign-in rows |
| `server/auth/own/liteAdmin.ts` | create | `liteAuthAdmin`: the `AuthAdmin` port over the sign-in rows |
| `server/auth/{rateLimit,invite,effects,forgot,renew}.ts`, `server/mail/quota.ts` | modify | The SQLite twins of their texts |
| `server/calls/{people,agents}.ts`, `server/core/{types,runCall}.ts` | modify | The calls on SQLite; `ServerCallCtx.data` |
| `server/mcp/{revokeAll,agentUser,approval,app}.ts` | modify | The agent rows on SQLite; revoke inside the call transaction; the `oauth` option |
| `server/test/liteHarness.ts`, `liteHarness.test.ts` | modify | The harness on `liteAuthAdmin`; `LATER_CALLS` and `LATER_KINDS` without wave 2 names |
| `server/auth/own/testOffice.ts` | create | `signinOffice()`: the sample office on node:sqlite with the sign-in deps, for the tests |
| `server/auth/own/limits.ts`, `sessions.ts`, `ops.ts` | create | The limits, the sessions, the browser sign-in operations |
| `server/auth/own/bcrypt.ts`, `import.ts` | create | Owner decision 4: the bcrypt check once, the export columns and the import |
| `server/auth/own/office.ts`, `routes.ts` | create | `SigninOffice`, `runSigninOp`, `localSigninOffice`; the HTTP routes of the api app |
| `server/office/test/pinOffice.ts`, `server/office/signin.wd.test.ts` | modify, create | The sign-in operations on local workerd |
| `server/mcp/oauth/{metadata,redirects,rows,ops,routes}.ts` | create | OAuth 2.1 for agents: the documents, registration, authorize, consent, token, grants |
| `server/mcp/oauth/agent.ts`, `testApp.ts` | create | `liteAgentOf` (the agent check of the office object); the MCP app of the own stack for tests |
| `server/auth/own/cleanup.ts` | create | `cleanupSignin`: the sign-in rows that ended a day ago, for the Cron of wave 3 |
| `server/http/pagesWellKnown.ts` | create | The forwarder logic of `/.well-known/...` for wave 5 (no file in `functions/` in this wave) |
| `src/app/auth.ts`, `src/env.d.ts` | modify | `refresh?()` on the port; `VITE_MADAR_AUTH` |
| `src/app/remote/{authMode,authMail,madarAuth}.ts` | create | The build-time choice, the shared mail requests, the Madar sign-in port |
| `src/app/remote/{auth,bootstrap}.ts` | modify | The shared mail requests; the choice of the port |
| `src/features/oauth/{madarOAuthPort.ts,oauthPort.tsx}` | create, modify | The OAuth port over the own routes; the choice |
| `server/workerGraph.test.ts` | modify | The Deno entries load no file of `server/auth/own/` or `server/mcp/oauth/` |
| `package.json`, `package-lock.json` | modify | bcryptjs 3.0.3, @modelcontextprotocol/sdk 1.32.0 (dev) |
| `docs/superpowers/real-build/proof.md`, `TASKS.md`, the guides | modify | The records of wave 2 |

Commands used in every task:
- One server test file: `npx vitest run --project server <file> --no-file-parallelism --testTimeout=60000`.
- One screens test file: `npx vitest run --project unit <file> --no-file-parallelism --testTimeout=60000`.
- Types: `npm run typecheck`.

---

# Block A: the sign-in rows and the crypto (Tasks 1 to 5, 1.5 days)

### Task 1: Schema version 2, the sign-in tables

**Files:**
- Modify: `server/data/lite/schema.ts:14` (`LITE_SCHEMA_VERSION`), `:52-70` (`SERVER_SQL`), `:72-79` (`SERVER_INDEXES`)
- Modify: `server/data/lite/schema.test.ts:11` (`PINNED_SHA256`), `:28-33`, `:72-75`

**Interfaces:**
- Consumes: `SERVER_SQL`, `SERVER_INDEXES`, `NOW` of `schema.ts` (wave 1).
- Produces: the tables `auth_users`, `auth_links`, `auth_sessions`, `oauth_clients`, `oauth_requests`; the export
  `SIGNIN_TABLES: readonly string[]`; the indexes `auth_users_email`, `auth_users_user`, `auth_links_auth`,
  `auth_sessions_refresh`, `auth_sessions_prev`, `auth_sessions_auth`, `oauth_requests_code`, `outbox_signin`.

- [ ] **Step 1: Write the failing tests**

In `server/data/lite/schema.test.ts`, change the server tables test (lines 28 to 33) and the pin test (lines 72 to 75), and add
two tests:

```ts
  it('keeps the server tables of Postgres, apart from office_deletes and platform_config, and adds its own', async () => {
    const { raw } = await freshLite();
    const kept = SERVER_TABLES.filter((table) => table !== 'office_deletes' && table !== 'platform_config');
    const expected = [...TABLES.map((spec) => spec.table), COUNTERS_TABLE, ...kept, 'agent_approvals', 'office_snapshot', 'schema_version', ...SIGNIN_TABLES];
    expect(tablesOf(raw)).toEqual(expected.sort());
  });

  it('holds the sign-in rows of wave 2 with their columns', async () => {
    const { raw } = await freshLite();
    expect(columnsOf(raw, 'auth_users')).toEqual(['id', 'user_id', 'email', 'password_hash', 'password_set', 'email_confirmed', 'banned', 'created_at', 'updated_at']);
    expect(columnsOf(raw, 'auth_links')).toEqual(['token_hash', 'auth_id', 'type', 'expires_at', 'used_at', 'created_at']);
    expect(columnsOf(raw, 'auth_sessions')).toEqual(['id', 'auth_id', 'client_id', 'amr', 'refresh_hash', 'prev_hash', 'rotated_at', 'link_until', 'expires_at', 'last_used_at', 'revoked_at', 'created_at']);
    expect(columnsOf(raw, 'oauth_clients')).toEqual(['id', 'name', 'redirect_uris', 'created_at']);
    expect(columnsOf(raw, 'oauth_requests')).toEqual(['id', 'client_id', 'redirect_uri', 'state', 'code_challenge', 'scope', 'resource', 'auth_id', 'status', 'code_hash', 'code_until', 'expires_at', 'created_at']);
  });

  it('keeps one email and one Madar person for each sign-in row', async () => {
    const { raw } = await freshLite();
    raw.exec("insert into auth_users (id, user_id, email) values ('a1', 'usr_001', 'hala@madar.test')");
    expect(() => raw.exec("insert into auth_users (id, user_id, email) values ('a2', null, 'hala@madar.test')")).toThrow('UNIQUE');
    expect(() => raw.exec("insert into auth_users (id, user_id, email) values ('a3', 'usr_001', 'other@madar.test')")).toThrow('UNIQUE');
    raw.exec("insert into auth_users (id, user_id, email) values ('a4', null, 'four@madar.test')");
    raw.exec("insert into auth_users (id, user_id, email) values ('a5', null, 'five@madar.test')");
  });

  it('pins the schema text to its version', () => {
    const sha256 = createHash('sha256').update(liteSchemaSql().join('\n')).digest('hex');
    expect({ version: LITE_SCHEMA_VERSION, sha256 }).toEqual({ version: 2, sha256: PINNED_SHA256 });
  });
```

Add `SIGNIN_TABLES` to the import from `./schema`.

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run --project server server/data/lite/schema.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL. `SIGNIN_TABLES` is not exported; the column test says "no such table: auth_users"; the pin test shows version 1.

- [ ] **Step 3: Add the tables and the indexes**

In `server/data/lite/schema.ts`, set `export const LITE_SCHEMA_VERSION = 2;` and change the comment above it to say "Version 2
(Supabase exit, wave 2): the sign-in rows." Add these lines at the end of `SERVER_SQL`, before `schema_version`:

```ts
  // The sign-in rows (Supabase exit, wave 2). id is the auth.users id of Supabase for an imported person, else a new uuid.
  `create table auth_users (id text primary key, user_id text, email text not null, password_hash text, password_set integer not null default 0, email_confirmed integer not null default 0, banned integer not null default 0, created_at text not null default (${NOW}), updated_at text not null default (${NOW}))`,
  `create table auth_links (token_hash text primary key, auth_id text not null, type text not null check (type in ('invite', 'recovery')), expires_at text not null, used_at text, created_at text not null default (${NOW}))`,
  `create table auth_sessions (id text primary key, auth_id text not null, client_id text, amr text not null, refresh_hash text not null, prev_hash text, rotated_at text, link_until text, expires_at text not null, last_used_at text, revoked_at text, created_at text not null default (${NOW}))`,
  `create table oauth_clients (id text primary key, name text, redirect_uris text not null, created_at text not null default (${NOW}))`,
  `create table oauth_requests (id text primary key, client_id text not null, redirect_uri text not null, state text, code_challenge text not null, scope text, resource text, auth_id text, status text not null default 'pending', code_hash text, code_until text, expires_at text not null, created_at text not null default (${NOW}))`,
```

Add these entries at the end of `SERVER_INDEXES`:

```ts
  { table: 'auth_users', name: 'auth_users_email', columns: 'email', unique: true },
  { table: 'auth_users', name: 'auth_users_user', columns: 'user_id', unique: true, where: 'user_id is not null' },
  { table: 'auth_links', name: 'auth_links_auth', columns: 'auth_id' },
  { table: 'auth_sessions', name: 'auth_sessions_refresh', columns: 'refresh_hash', unique: true },
  { table: 'auth_sessions', name: 'auth_sessions_prev', columns: 'prev_hash', where: 'prev_hash is not null' },
  { table: 'auth_sessions', name: 'auth_sessions_auth', columns: 'auth_id' },
  { table: 'oauth_requests', name: 'oauth_requests_code', columns: 'code_hash', unique: true, where: 'code_hash is not null' },
  // The invitation texts of server/auth/invite.ts repeat this exact term, else SQLite scans the whole outbox (checked on node:sqlite).
  { table: 'outbox', name: 'outbox_signin', columns: 'kind', where: "kind in ('auth.invite', 'auth.email')" },
```

Add the export after `SERVER_INDEXES`:

```ts
/** The sign-in tables of wave 2: the import of wave 4 and the restore check copy them with the office. */
export const SIGNIN_TABLES: readonly string[] = ['auth_users', 'auth_links', 'auth_sessions', 'oauth_clients', 'oauth_requests'];
```

- [ ] **Step 4: Run the tests, then pin the new text**

Run: `npx vitest run --project server server/data/lite/schema.test.ts --no-file-parallelism --testTimeout=60000`
Expected: every test passes except the pin test, which shows the new sha256 in its diff. Copy that value into
`PINNED_SHA256` (line 11) and run again. Expected: PASS, 10 tests.

- [ ] **Step 5: Run the SQLite tests that read the schema**

Run: `npx vitest run --project server server/data/lite --no-file-parallelism --testTimeout=60000`
Expected: PASS. No test of wave 1 reads a table count other than the one above.

- [ ] **Step 6: Commit**

```bash
git add server/data/lite/schema.ts server/data/lite/schema.test.ts
git commit -m "Exit wave 2: SQLite schema version 2 holds the sign-in rows and their indexes"
```

### Task 2: Passwords with PBKDF2, and the bundle guard

**Files:**
- Create: `server/auth/own/crypto.ts`, `server/auth/own/password.ts`
- Test: `server/auth/own/password.test.ts`
- Modify: `server/workerGraph.test.ts` (add one `describe` at the end)

**Interfaces:**
- Produces: `randomToken(bytes = 32): string`; `sha256Hex(text: string): Promise<string>`;
  `pkceChallengeOf(verifier: string): Promise<string>`; `equalText(a: string, b: string): boolean`;
  `PBKDF2_ROUNDS = 100_000`; `PASSWORD_MIN = 8`; `hashPassword(password: string): Promise<string>`;
  `type PasswordCheck = { ok: boolean; upgrade: boolean }`;
  `verifyPassword(password: string, stored: string | null): Promise<PasswordCheck>`.

- [ ] **Step 1: Write the failing tests**

```ts
// server/auth/own/password.test.ts
import { describe, expect, it } from 'vitest';
import { equalText, pkceChallengeOf, randomToken, sha256Hex } from './crypto';
import { hashPassword, PASSWORD_MIN, PBKDF2_ROUNDS, verifyPassword } from './password';

describe('the passwords of the own sign-in (server/auth/own/password.ts)', () => {
  it('uses 100,000 rounds: deployed Workers refuse more, and local workerd does not show it', () => {
    expect(PBKDF2_ROUNDS).toBe(100_000);
    expect(PASSWORD_MIN).toBe(8);
  });

  it('keeps the rounds, the salt and the hash in one text', async () => {
    expect(await hashPassword('a good password')).toMatch(/^pbkdf2-sha256\$100000\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
  });

  it('accepts the right password and refuses a wrong one', async () => {
    const stored = await hashPassword('a good password');
    expect(await verifyPassword('a good password', stored)).toEqual({ ok: true, upgrade: false });
    expect(await verifyPassword('a good passworD', stored)).toEqual({ ok: false, upgrade: false });
  });

  it('gives each hash its own salt', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('refuses a stored hash with more rounds than the Workers allow, and a text of another form', async () => {
    const [, , salt, hash] = (await hashPassword('x')).split('$');
    expect(await verifyPassword('x', `pbkdf2-sha256$100001$${salt}$${hash}`)).toEqual({ ok: false, upgrade: false });
    expect(await verifyPassword('x', 'plain text')).toEqual({ ok: false, upgrade: false });
    expect(await verifyPassword('x', null)).toEqual({ ok: false, upgrade: false });
  });

  it('asks for a new hash when a stored hash has fewer rounds', async () => {
    const [, , salt] = (await hashPassword('x')).split('$');
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('x'), 'PBKDF2', false, ['deriveBits']);
    const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: Uint8Array.from(atob(salt.replace(/-/g, '+').replace(/_/g, '/') + '=='), (c) => c.charCodeAt(0)), iterations: 1000 }, key, 256));
    const hash = btoa(String.fromCharCode(...bits)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(await verifyPassword('x', `pbkdf2-sha256$1000$${salt}$${hash}`)).toEqual({ ok: true, upgrade: true });
  });

  it('makes random tokens of 32 bytes and the sha256 and PKCE forms of a text', async () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(randomToken());
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    // RFC 7636, appendix B.
    expect(await pkceChallengeOf('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    expect(equalText('abc', 'abc')).toBe(true);
    expect(equalText('abc', 'abd')).toBe(false);
    expect(equalText('abc', 'abcd')).toBe(false);
  });
});
```

Add at the end of `server/workerGraph.test.ts`:

```ts
/**
 * The own sign-in (Supabase exit, wave 2) runs in the office object. bcryptjs imports the bare module "crypto", which the
 * Supabase functions on Deno may not load, so no Supabase entry loads a file of server/auth/own/ or server/mcp/oauth/. The hosts
 * of wave 3 pass the own routes in (AppOptions.routes, McpAppOptions.oauth).
 */
describe('the Supabase entries and the own sign-in', () => {
  it.each(['server/entries/deno-api.ts', 'server/entries/deno-mcp.ts', 'server/entries/deno-jobs.ts'])('%s loads no file of the own sign-in', (entry) => {
    const graph = staticGraph(entry);
    expect(graph).toContain('server/auth/verify.ts');
    expect([...graph].filter((file) => file.startsWith('server/auth/own/') || file.startsWith('server/mcp/oauth/'))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run --project server server/auth/own/password.test.ts server/workerGraph.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL with "Failed to load url ./crypto". The graph test passes already (no such file yet), and it must keep passing.

- [ ] **Step 3: Write the two modules**

```ts
// server/auth/own/crypto.ts
import { base64url } from 'jose';

/**
 * The small crypto steps of the own sign-in (Supabase exit, wave 2). crypto.subtle is async, so a caller in the office object
 * runs these before or after a transaction, never inside one (Global Constraints).
 */

/** A random secret: link tokens, refresh tokens, OAuth codes. 32 bytes is 256 bits. */
export function randomToken(bytes = 32): string {
  return base64url.encode(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** The sha256 of a text in hex. The database keeps this form of every token, never the token. */
export async function sha256Hex(text: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...hash].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The S256 challenge of a PKCE verifier (RFC 7636, section 4.2). */
export async function pkceChallengeOf(verifier: string): Promise<string> {
  return base64url.encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

/** A compare that takes the same time for each text of one length. */
export function equalText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
```

```ts
// server/auth/own/password.ts
import { base64url } from 'jose';

/**
 * The password hash of the own sign-in (Supabase exit, wave 2; spec section 2): PBKDF2 with SHA-256.
 * - 100,000 rounds. Deployed Workers refuse more ("iteration counts above 100000 are not supported"); local workerd accepts more,
 *   so only the test of this file pins the number. A stored hash with more rounds can never verify on a Worker: it is refused.
 * - The CPU: 30 to 35 ms in the office object (wave 0). The Worker never hashes: Workers Free stops it at 10 ms under load.
 * - The form: pbkdf2-sha256$<rounds>$<salt, 16 bytes>$<hash, 32 bytes>, base64url.
 * - A stored text of another form (no password yet, an unknown email) runs one hash anyway, so the answer takes the same time.
 */

export const PBKDF2_ROUNDS = 100_000;
/** The shortest password: minimum_password_length of supabase/config.toml and MIN_PASSWORD of the screens. */
export const PASSWORD_MIN = 8;
const PREFIX = 'pbkdf2-sha256';
const SALT_BYTES = 16;
const HASH_BYTES = 32;

export type PasswordCheck = { ok: boolean; upgrade: boolean };

async function derive(password: string, salt: Uint8Array, rounds: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: rounds }, key, HASH_BYTES * 8));
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  return `${PREFIX}$${PBKDF2_ROUNDS}$${base64url.encode(salt)}$${base64url.encode(await derive(password, salt, PBKDF2_ROUNDS))}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<PasswordCheck> {
  const parts = (stored ?? '').split('$');
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    await derive(password, new Uint8Array(SALT_BYTES), PBKDF2_ROUNDS);
    return { ok: false, upgrade: false };
  }
  const rounds = Number(parts[1]);
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > PBKDF2_ROUNDS) return { ok: false, upgrade: false };
  let salt: Uint8Array;
  let want: Uint8Array;
  try {
    salt = base64url.decode(parts[2]);
    want = base64url.decode(parts[3]);
  } catch {
    return { ok: false, upgrade: false };
  }
  return { ok: equalBytes(await derive(password, salt, rounds), want), upgrade: rounds < PBKDF2_ROUNDS };
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run --project server server/auth/own/password.test.ts server/workerGraph.test.ts --no-file-parallelism --testTimeout=60000`
Expected: PASS (7 tests in password.test.ts; the graph tests stay green).

- [ ] **Step 5: Commit**

```bash
git add server/auth/own/crypto.ts server/auth/own/password.ts server/auth/own/password.test.ts server/workerGraph.test.ts
git commit -m "Exit wave 2: PBKDF2 passwords at 100,000 rounds, and no Supabase entry loads the own sign-in"
```

### Task 3: Tokens and keys

**Files:**
- Create: `server/auth/ownKeys.ts`, `server/auth/own/keys.ts`, `server/auth/own/testKeys.ts`
- Modify: `server/auth/verify.ts:21-22` (`TokenChecker`), `:54-73` (`browserTokenChecker`), `:86-97` (`checkerFromEnv`)
- Modify: `server/mcp/auth.ts:81-96` (`agentTokenCheckerOf`, `authIssuerOf`)
- Test: `server/auth/own/keys.test.ts`

**Interfaces:**
- Produces: `OWN_AUTH_SECRET = 'MADAR_AUTH_PRIVATE_JWK'`; `ACCESS_TTL_S = 900`; `ownIssuer(mcpUrl): string`;
  `ownPublicJwks(privateJwk: string): JSONWebKeySet`; `ownKeySet(privateJwk: string): JWTVerifyGetKey`;
  `type SigningKeys = { kid: string; key: CryptoKey; issuer: string; mcpUrl: string }`;
  `signingKeysOf(privateJwk: string, mcpUrl: string): Promise<SigningKeys>`;
  `signBrowserToken(keys, { authId, sessionId, now }): Promise<string>`;
  `signAgentToken(keys, { authId, sessionId, clientId, now }): Promise<string>`; `testPrivateJwk(): Promise<string>`;
  `TokenChecker` now gives `{ authUserId: string; sessionId?: string }`.

- [ ] **Step 1: Write the failing tests**

```ts
// server/auth/own/keys.test.ts
import { afterEach, describe, expect, it } from 'vitest';
import { setEnvSource } from '../../env';
import { agentTokenChecker, agentTokenCheckerOf } from '../../mcp/auth';
import { ACCESS_TTL_S, OWN_AUTH_SECRET, ownIssuer, ownKeySet, ownPublicJwks } from '../ownKeys';
import { browserTokenChecker, verifyBrowserToken } from '../verify';
import { signAgentToken, signBrowserToken, signingKeysOf } from './keys';
import { testPrivateJwk } from './testKeys';

const MCP_URL = 'https://madar.test/mcp';
const NOW = new Date('2026-10-17T06:00:00Z');

afterEach(() => setEnvSource(undefined));

describe('the own tokens (server/auth/own/keys.ts, server/auth/ownKeys.ts)', () => {
  it('signs a browser token that the browser check of today accepts, with the own issuer and key set', async () => {
    const jwk = await testPrivateJwk();
    const keys = await signingKeysOf(jwk, `${MCP_URL}/`);
    const token = await signBrowserToken(keys, { authId: 'a-1', sessionId: 's-1', now: new Date() });
    const check = browserTokenChecker({ issuer: ownIssuer(MCP_URL), jwks: ownKeySet(jwk) });
    expect(await check(`Bearer ${token}`)).toEqual({ authUserId: 'a-1', sessionId: 's-1' });
  });

  it('gives a token of 15 minutes', async () => {
    const keys = await signingKeysOf(await testPrivateJwk(), MCP_URL);
    const token = await signBrowserToken(keys, { authId: 'a-1', sessionId: 's-1', now: NOW });
    const claims = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    expect(claims.exp - claims.iat).toBe(ACCESS_TTL_S);
    expect(ACCESS_TTL_S).toBe(900);
    expect(claims).toMatchObject({ iss: MCP_URL, aud: 'authenticated', sub: 'a-1', role: 'authenticated', session_id: 's-1' });
  });

  it('keeps the two token kinds apart', async () => {
    const jwk = await testPrivateJwk();
    const keys = await signingKeysOf(jwk, MCP_URL);
    const agent = await signAgentToken(keys, { authId: 'a-1', sessionId: 's-2', clientId: 'c-1', now: new Date() });
    const browser = await signBrowserToken(keys, { authId: 'a-1', sessionId: 's-1', now: new Date() });
    await expect(browserTokenChecker({ issuer: MCP_URL, jwks: ownKeySet(jwk) })(`Bearer ${agent}`)).rejects.toMatchObject({ code: 'forbidden', details: { reason: 'agent_token' } });
    const agents = agentTokenChecker({ issuer: MCP_URL, audience: MCP_URL, jwks: ownKeySet(jwk) });
    expect(await agents(`Bearer ${agent}`)).toMatchObject({ authUserId: 'a-1', clientId: 'c-1', sessionId: 's-2' });
    await expect(agents(`Bearer ${browser}`)).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('refuses a token of another key', async () => {
    const keys = await signingKeysOf(await testPrivateJwk(), MCP_URL);
    const token = await signBrowserToken(keys, { authId: 'a-1', sessionId: 's-1', now: new Date() });
    await expect(browserTokenChecker({ issuer: MCP_URL, jwks: ownKeySet(await testPrivateJwk()) })(`Bearer ${token}`)).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('serves only the public part of the key', async () => {
    const jwks = ownPublicJwks(await testPrivateJwk());
    expect(jwks.keys).toHaveLength(1);
    expect(Object.keys(jwks.keys[0]).sort()).toEqual(['alg', 'crv', 'kid', 'kty', 'use', 'x', 'y']);
    expect(JSON.stringify(jwks)).not.toContain('"d"');
  });

  it('names the secret, never its value, when the key is wrong', () => {
    expect(() => ownPublicJwks('{"kty":"RSA"}')).toThrow(`${OWN_AUTH_SECRET} must be a P-256 private JWK with a kid.`);
    expect(() => ownPublicJwks('not json')).toThrow(`${OWN_AUTH_SECRET} is not JSON.`);
  });

  it('checks a token with the own key when the Worker has the secret, and with Supabase when it has not', async () => {
    const jwk = await testPrivateJwk();
    const keys = await signingKeysOf(jwk, MCP_URL);
    const token = await signBrowserToken(keys, { authId: 'a-9', sessionId: 's-9', now: new Date() });
    setEnvSource({ [OWN_AUTH_SECRET]: jwk, MCP_URL, SUPABASE_URL: 'http://127.0.0.1:54321' });
    expect(await verifyBrowserToken(`Bearer ${token}`)).toEqual({ authUserId: 'a-9', sessionId: 's-9' });
    const agent = await signAgentToken(keys, { authId: 'a-9', sessionId: 's-8', clientId: 'c-9', now: new Date() });
    expect(await agentTokenCheckerOf({ supabaseUrl: 'http://127.0.0.1:54321', mcpUrl: MCP_URL })(`Bearer ${agent}`)).toMatchObject({ clientId: 'c-9' });
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run --project server server/auth/own/keys.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL with "Failed to load url ../ownKeys".

- [ ] **Step 3: Write the key modules**

```ts
// server/auth/ownKeys.ts
import { createLocalJWKSet, type JSONWebKeySet, type JWK, type JWTVerifyGetKey } from 'jose';

/**
 * The verify side of the own tokens (Supabase exit, wave 2): the Worker checks each token with the public part of its key, with
 * no network. This file holds only jose, so the Supabase entries may load it (server/workerGraph.test.ts).
 * - The secret MADAR_AUTH_PRIVATE_JWK: a P-256 private JWK with a kid. Error texts name the secret, never a value.
 * - The issuer of every own token is MCP_URL without a trailing slash: the OAuth metadata names it, and the browser tokens use it too.
 */

export const OWN_AUTH_SECRET = 'MADAR_AUTH_PRIVATE_JWK';
/** 15 minutes (owner rule 2026-10-06, Z7). */
export const ACCESS_TTL_S = 900;

export function ownIssuer(mcpUrl: string): string {
  return mcpUrl.replace(/\/+$/, '');
}

function privateJwkOf(text: string): JWK {
  let jwk: JWK;
  try {
    jwk = JSON.parse(text) as JWK;
  } catch {
    throw new Error(`${OWN_AUTH_SECRET} is not JSON.`);
  }
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || typeof jwk.kid !== 'string' || typeof jwk.d !== 'string' || typeof jwk.x !== 'string' || typeof jwk.y !== 'string') {
    throw new Error(`${OWN_AUTH_SECRET} must be a P-256 private JWK with a kid.`);
  }
  return jwk;
}

/** The public key set: kty, crv, x, y, kid, alg and use. Never d. */
export function ownPublicJwks(privateJwk: string): JSONWebKeySet {
  const jwk = privateJwkOf(privateJwk);
  return { keys: [{ kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, kid: jwk.kid, alg: 'ES256', use: 'sig' }] };
}

let held: { text: string; set: JWTVerifyGetKey } | undefined;

/** The local key set of the own tokens, made once for each value of the secret. */
export function ownKeySet(privateJwk: string): JWTVerifyGetKey {
  if (held?.text !== privateJwk) held = { text: privateJwk, set: createLocalJWKSet(ownPublicJwks(privateJwk)) };
  return held.set;
}
```

```ts
// server/auth/own/keys.ts
import { importJWK, SignJWT, type JWK } from 'jose';
import { ACCESS_TTL_S, ownIssuer, ownPublicJwks } from '../ownKeys';

/**
 * The sign side of the own tokens (Supabase exit, wave 2). The office object signs (ES256 under 1 ms, wave 0), outside a
 * transaction. The claims keep the shape of the Supabase tokens, so the checks of today accept them:
 * - browser: aud "authenticated", role "authenticated", sub = the auth_users id, session_id.
 * - agent: aud = MCP_URL, role "authenticated", sub, client_id, session_id (server/mcp/auth.ts needs all three).
 */

export type SigningKeys = { kid: string; key: CryptoKey; issuer: string; mcpUrl: string };

export async function signingKeysOf(privateJwk: string, mcpUrl: string): Promise<SigningKeys> {
  ownPublicJwks(privateJwk);
  const jwk = JSON.parse(privateJwk) as JWK;
  const key = (await importJWK(jwk, 'ES256')) as CryptoKey;
  return { kid: jwk.kid as string, key, issuer: ownIssuer(mcpUrl), mcpUrl: ownIssuer(mcpUrl) };
}

function base(keys: SigningKeys, claims: Record<string, unknown>, o: { authId: string; now: Date }, audience: string): Promise<string> {
  const iat = Math.floor(o.now.getTime() / 1000);
  return new SignJWT({ role: 'authenticated', ...claims })
    .setProtectedHeader({ alg: 'ES256', kid: keys.kid, typ: 'JWT' })
    .setIssuer(keys.issuer)
    .setAudience(audience)
    .setSubject(o.authId)
    .setIssuedAt(iat)
    .setExpirationTime(iat + ACCESS_TTL_S)
    .sign(keys.key);
}

export function signBrowserToken(keys: SigningKeys, o: { authId: string; sessionId: string; now: Date }): Promise<string> {
  return base(keys, { session_id: o.sessionId }, o, 'authenticated');
}

export function signAgentToken(keys: SigningKeys, o: { authId: string; sessionId: string; clientId: string; now: Date }): Promise<string> {
  return base(keys, { session_id: o.sessionId, client_id: o.clientId }, o, keys.mcpUrl);
}
```

```ts
// server/auth/own/testKeys.ts
import { calculateJwkThumbprint, exportJWK, generateKeyPair } from 'jose';

/** For tests only: a new P-256 private JWK with a kid, in the form of the secret MADAR_AUTH_PRIVATE_JWK. */
export async function testPrivateJwk(): Promise<string> {
  const { privateKey } = await generateKeyPair('ES256', { extractable: true });
  const jwk = await exportJWK(privateKey);
  return JSON.stringify({ ...jwk, kid: await calculateJwkThumbprint(jwk) });
}
```

- [ ] **Step 4: Change the two checks of today**

In `server/auth/verify.ts`, change the checker type (line 22) and the end of `browserTokenChecker` (lines 69 to 71):

```ts
export type TokenChecker = (header: string | null) => Promise<{ authUserId: string; sessionId?: string }>;
```

```ts
    if (hasClientId(payload)) throw agentToken();
    if (payload.role !== AUDIENCE || typeof payload.sub !== 'string' || payload.sub === '') throw signIn();
    const sessionId = typeof payload.session_id === 'string' && payload.session_id !== '' ? payload.session_id : undefined;
    return sessionId === undefined ? { authUserId: payload.sub } : { authUserId: payload.sub, sessionId };
```

Change `checkerFromEnv` (lines 86 to 97) so the own key comes first, and the return type of `verifyBrowserToken` to
`ReturnType<TokenChecker>`:

```ts
function checkerFromEnv(): { check: TokenChecker; keys: { reload(): Promise<void> } } {
  // The own sign-in (Supabase exit, wave 2): the Worker of the office object holds MADAR_AUTH_PRIVATE_JWK. No copy has it before wave 5.
  const own = env(OWN_AUTH_SECRET);
  if (own !== undefined) {
    const issuer = ownIssuer(requireEnv('MCP_URL'));
    // The kid is in the key of the cache: a new key (a key change) gets a new checker.
    const id = `own|${issuer}|${String(ownPublicJwks(own).keys[0].kid)}`;
    let checker = checkers.get(id);
    if (!checker) {
      checker = { check: browserTokenChecker({ issuer, jwks: ownKeySet(own) }), keys: { reload: async () => undefined } };
      checkers.set(id, checker);
    }
    return checker;
  }
  const auth = issuerOf(requireEnv('SUPABASE_URL'));
  const issuer = env('AUTH_ISSUER') ?? auth;
  const id = `${auth}|${issuer}`;
  let checker = checkers.get(id);
  if (!checker) {
    const keys = createRemoteJWKSet(new URL(`${auth}/.well-known/jwks.json`));
    checker = { check: browserTokenChecker({ issuer, jwks: keys }), keys };
    checkers.set(id, checker);
  }
  return checker;
}
```

Add the import `import { OWN_AUTH_SECRET, ownIssuer, ownKeySet, ownPublicJwks } from './ownKeys';`.

In `server/mcp/auth.ts`, change `agentTokenCheckerOf` and `authIssuerOf` (lines 81 to 96):

```ts
export function agentTokenCheckerOf(o: { supabaseUrl: string; mcpUrl: string; issuer?: string }): AgentTokenChecker {
  const own = env(OWN_AUTH_SECRET);
  if (own !== undefined) return agentTokenChecker({ issuer: ownIssuer(o.mcpUrl), audience: o.mcpUrl, jwks: ownKeySet(own) });
  const auth = issuerOf(o.supabaseUrl);
  const issuer = o.issuer ?? env('AUTH_ISSUER') ?? auth;
  const id = `${auth}|${issuer}|${o.mcpUrl}`;
  let checker = checkers.get(id);
  if (!checker) {
    checker = agentTokenChecker({ issuer, audience: o.mcpUrl, jwks: createRemoteJWKSet(new URL(`${auth}/.well-known/jwks.json`)) });
    checkers.set(id, checker);
  }
  return checker;
}

/** The issuer that the metadata document names: the own issuer (MCP_URL) with the secret, else AUTH_ISSUER or ${SUPABASE_URL}/auth/v1. */
export function authIssuerOf(supabaseUrl: string, mcpUrl?: string): string {
  if (env(OWN_AUTH_SECRET) !== undefined && mcpUrl !== undefined) return ownIssuer(mcpUrl);
  return env('AUTH_ISSUER') ?? issuerOf(supabaseUrl);
}
```

Add `import { OWN_AUTH_SECRET, ownIssuer, ownKeySet } from '../auth/ownKeys';`. In `server/mcp/app.ts:231`, pass the MCP
address: `const issuer = o.issuer ?? authIssuerOf(config.supabaseUrl, config.mcpUrl);`.

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run --project server server/auth/own/keys.test.ts server/auth/verify.test.ts server/mcp/auth.test.ts server/mcp/app.test.ts --no-file-parallelism --testTimeout=60000`
Expected: PASS. The tests of today stay green: with no secret, both checks are the Supabase checks of today, and a Supabase
browser token now also gives its `session_id` (verify.test.ts compares with `toEqual`: where a test token holds
`session_id`, add `sessionId` to its expected value).

- [ ] **Step 6: Run the types and commit**

Run: `npm run typecheck` (Expected: no error).

```bash
git add server/auth/ownKeys.ts server/auth/own/keys.ts server/auth/own/testKeys.ts server/auth/own/keys.test.ts server/auth/verify.ts server/auth/verify.test.ts server/mcp/auth.ts server/mcp/app.ts
git commit -m "Exit wave 2: ES256 tokens of 15 minutes with the own key, and the token checks use it when the Worker has the secret"
```

### Task 4: The sign-in link in the SQLite office snapshot

The Postgres office cache keeps `users.auth_user_id` beside the snapshot (`userIdOfAuth`, `officeCache.ts:89`), and
`principalOf` reads it. On SQLite the link lives in `auth_users.user_id`. The snapshot body carries the links, so a cold wake
still reads 2 rows (the pin of wave 1 Task 18), and `principalOf` works unchanged.

**Files:**
- Modify: `server/data/lite/office.ts:46-55` (`writeOfficeSnapshot`), `:57-66` (`listsFromTables`), `:72-83` (`readLiteOffice`); add `setLiteAuthLink`
- Modify: `server/data/officeCache.ts:86-91` (add `authLinksOf`)
- Test: `server/data/lite/office.test.ts` (add one `describe`)

**Interfaces:**
- Consumes: `snapshotOf(lists, version, auth)` and `userIdOfAuth` of `officeCache.ts`; `liteDbOf`, `onCommit` of `lite/db.ts`.
- Produces: `LINKS_LITE`; `setLiteAuthLink(q: Query, userId: string, authId: string | null): Promise<boolean>`;
  `authLinksOf(snapshot: OfficeSnapshot): ReadonlyMap<string, string>`. The snapshot body is `{ lists, links }`; a body of
  wave 1 (the lists alone) reads as lists with no link.

- [ ] **Step 1: Write the failing tests**

Add to `server/data/lite/office.test.ts` (import `setLiteAuthLink` from `./office` and `userIdOfAuth` from `../officeCache`):

```ts
describe('the sign-in links in the office snapshot (Supabase exit, wave 2)', () => {
  async function linked() {
    const { raw, db } = await freshLite();
    await writeOffice(db, { usr_001: user('usr_001'), usr_002: user('usr_002') });
    raw.exec("insert into auth_users (id, email) values ('auth-1', 'one@madar.test'), ('auth-2', 'two@madar.test')");
    expect(await db.tx('write', (q) => setLiteAuthLink(q, 'usr_001', 'auth-1'))).toBe(true);
    return { raw, db };
  }

  it('keeps the links in the snapshot, so a wake reads no sign-in row', async () => {
    const { raw } = await linked();
    const log: string[] = [];
    const woken = liteDb(nodeHost(raw, { log }));
    const office = await woken.tx('read', (q) => readLiteOffice(woken, q));
    expect(userIdOfAuth(office, 'auth-1')).toBe('usr_001');
    expect(log).toEqual(['select version from office_meta where id = 1', 'select version, body from office_snapshot order by part']);
  });

  it('raises the office version, moves a link to a new sign-in row and clears it', async () => {
    const { raw, db } = await linked();
    const before = (await db.tx('read', (q) => readLiteOffice(db, q))).version;
    await db.tx('write', (q) => setLiteAuthLink(q, 'usr_001', 'auth-2'));
    let office = await db.tx('read', (q) => readLiteOffice(db, q));
    expect(office.version).toBe(before + 1);
    expect([userIdOfAuth(office, 'auth-1'), userIdOfAuth(office, 'auth-2')]).toEqual([undefined, 'usr_001']);
    expect(raw.prepare('select id, user_id from auth_users order by id').all()).toEqual([{ id: 'auth-1', user_id: null }, { id: 'auth-2', user_id: 'usr_001' }]);
    await db.tx('write', (q) => setLiteAuthLink(q, 'usr_001', null));
    office = await db.tx('read', (q) => readLiteOffice(db, q));
    expect(userIdOfAuth(office, 'auth-2')).toBeUndefined();
  });

  it('keeps the links through a later write of an office list', async () => {
    const { raw, db } = await linked();
    await writeOffice(db, { usr_001: user('usr_001', 'هالة ناصر'), usr_002: user('usr_002') });
    const woken = liteDb(nodeHost(raw));
    expect(userIdOfAuth(await woken.tx('read', (q) => readLiteOffice(woken, q)), 'auth-1')).toBe('usr_001');
  });

  it('reads the links from the sign-in rows when the snapshot is older than office_meta', async () => {
    const { raw, db } = await linked();
    raw.exec("update auth_users set user_id = 'usr_002' where id = 'auth-2'");
    raw.exec('update office_meta set version = version + 1');
    const office = await db.tx('read', (q) => readLiteOffice(db, q));
    expect(userIdOfAuth(office, 'auth-2')).toBe('usr_002');
  });

  it('keeps the old links in memory after a rollback', async () => {
    const { db } = await linked();
    await expect(db.tx('write', async (q) => {
      await setLiteAuthLink(q, 'usr_001', 'auth-2');
      throw new Error('stop');
    })).rejects.toThrow('stop');
    expect(userIdOfAuth(await db.tx('read', (q) => readLiteOffice(db, q)), 'auth-1')).toBe('usr_001');
  });

  it('gives false and writes nothing for a person who is not in the office', async () => {
    const { raw, db } = await linked();
    const version = raw.prepare('select version from office_meta').get();
    expect(await db.tx('write', (q) => setLiteAuthLink(q, 'usr_404', 'auth-2'))).toBe(false);
    expect(raw.prepare('select version from office_meta').get()).toEqual(version);
  });

  it('never puts a sign-in id into the office lists that the calls read', async () => {
    const { db } = await linked();
    const office = await db.tx('read', (q) => readLiteOffice(db, q));
    expect(JSON.stringify(office.lists)).not.toContain('auth-1');
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run --project server server/data/lite/office.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL with "setLiteAuthLink is not a function" (the wave 1 tests still pass).

- [ ] **Step 3: Write the links into the snapshot**

In `server/data/officeCache.ts`, after `userIdOfAuth` (line 91), add:

```ts
/** Every sign-in link of a snapshot (auth id to Madar user id): the SQLite snapshot writes them, and the tests read them. */
export function authLinksOf(snapshot: OfficeSnapshot): ReadonlyMap<string, string> {
  return authOf.get(snapshot) ?? new Map();
}
```

In `server/data/lite/office.ts`, change the file comment rule to "The rule for every write of an office table or of a sign-in
link (the save, the harness write-down, the import, `setLiteAuthLink`)", then add and change these parts:

```ts
/** The sign-in links (Supabase exit, wave 2): auth_users.id to users.id. The snapshot body carries them, for principalOf. */
export const LINKS_LITE = 'select id, user_id from auth_users where user_id is not null';

type Links = [authId: string, userId: string][];
type Body = { lists: OfficeLists; links: Links };

async function linksOf(q: Query): Promise<Links> {
  return (await q<{ id: string; user_id: string }>(LINKS_LITE)).map((row) => [row.id, row.user_id]);
}

/** A body of wave 1 holds the lists alone and no link. */
function bodyOf(text: string): Body {
  const parsed = JSON.parse(text) as Record<string, unknown>;
  return Array.isArray(parsed.links) && parsed.lists !== undefined ? (parsed as unknown as Body) : { lists: parsed as unknown as OfficeLists, links: [] };
}

/**
 * Writes the snapshot of the office lists and the sign-in links at a version, inside the transaction of q, and puts it into memory
 * after the commit. The links come from auth_users (about 15 rows read, only on an office write), so a save never needs them.
 */
export async function writeOfficeSnapshot(q: Query, lists: OfficeLists, version: number): Promise<void> {
  const office = listsOf(lists);
  const links = await linksOf(q);
  const parts = partsOf(JSON.stringify({ lists: office, links } satisfies Body));
  await q('delete from office_snapshot where part >= ?', [parts.length]);
  for (const [part, body] of parts.entries()) {
    await q('insert into office_snapshot (part, version, body) values (?, ?, ?) on conflict (part) do update set version = excluded.version, body = excluded.body', [part, version, body]);
  }
  const db = liteDbOf(q);
  onCommit(q, () => MEMORY.set(db, snapshotOf(office, version, new Map(links))));
}
```

In `readLiteOffice`, replace the last four lines (lines 79 to 82) with:

```ts
  const body = current ? bodyOf(parts.map((part) => part.body).join('')) : { lists: await listsFromTables(q), links: await linksOf(q) };
  const snapshot = snapshotOf(body.lists, version, new Map(body.links));
  if (!wroteIn(q)) MEMORY.set(db, snapshot);
  return snapshot;
```

Add at the end of the file:

```ts
/**
 * Writes (or with null clears) the sign-in link of a Madar person, the SQLite twin of setAuthUserId (officeCache.ts). One
 * transaction: the link moves off any other sign-in row, office_meta.version rises and the snapshot holds the new links, so every
 * later read of the office object and every wake sees it. The lists come from the office before the version rises, so the write
 * reads no office table. False, and no write, for a person who is not in the office.
 */
export async function setLiteAuthLink(q: Query, userId: string, authId: string | null): Promise<boolean> {
  const office = await readLiteOffice(liteDbOf(q), q);
  if (!office.lists.users[userId]) return false;
  const stamp = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
  await q(`update auth_users set user_id = null, updated_at = ${stamp} where user_id = ?1 and id is not ?2`, [userId, authId]);
  if (authId !== null) await q(`update auth_users set user_id = ?1, updated_at = ${stamp} where id = ?2`, [userId, authId]);
  const [meta] = await q<{ version: number }>('update office_meta set version = version + 1 where id = 1 returning version');
  await writeOfficeSnapshot(q, office.lists, Number(meta.version));
  return true;
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run --project server server/data/lite/office.test.ts server/data/lite/save.test.ts server/data/lite/callData.test.ts --no-file-parallelism --testTimeout=60000`
Expected: PASS (the 8 tests of wave 1 and the 7 new ones). A test of wave 1 that compares the whole statement log of a save of
an office row now also sees `select id, user_id from auth_users where user_id is not null` before the snapshot statements: add
that line to its expected log, and change nothing else.

- [ ] **Step 5: Run the rows pins on local workerd**

Run (sandbox off): `npm run test:office`
Expected: PASS, 8 tests. The cold wake still reads 2 rows: the links are in the body, and the year office has no sign-in row.

- [ ] **Step 6: Commit**

```bash
git add server/data/lite/office.ts server/data/lite/office.test.ts server/data/officeCache.ts
git commit -m "Exit wave 2: the SQLite office snapshot carries the sign-in links, and setLiteAuthLink moves one"
```

### Task 5: liteAuthAdmin, the Auth admin port over the sign-in rows

The effects of today call `AuthAdminPort` (`server/core/ports.ts:86-96`) and the `AuthAdmin` extras (`server/auth/admin.ts:22-26`).
`liteAuthAdmin` gives the same port over the SQLite rows, with the same refusals as Supabase (`email_exists` for an invite link
of a confirmed email, proof.md P1), so `invite.ts`, `effects.ts`, `forgot.ts`, `renew.ts` and `users.invites` keep their logic.

**Files:**
- Create: `server/auth/own/rows.ts`, `server/auth/own/liteAdmin.ts`
- Test: `server/auth/own/liteAdmin.test.ts`

**Interfaces:**
- Consumes: `AuthAdmin`, `AuthAdminError`, `AuthUserInfo` (`admin.ts`); `randomToken`, `sha256Hex` (Task 2); `hashPassword`.
- Produces: the row types `AuthUserRow`, `LinkRow`, `SessionRow` and every SQL text of the sign-in rows in `rows.ts` (names
  below); `LINK_LIFE_MS = 3_600_000`; `liteAuthAdmin(o: { db: Db; clock: Clock }): AuthAdmin`. The port field `tokenHash` now
  holds the link token itself: the mail carries it as `token_hash`, and the table keeps only its sha256.

- [ ] **Step 1: Write the failing tests**

```ts
// server/auth/own/liteAdmin.test.ts
import { describe, expect, it } from 'vitest';
import { freshLite } from '../../data/lite/testDb';
import { fixedClock } from '../../test/fakes/clock';
import { linkFor } from '../invite';
import { sha256Hex } from './crypto';
import { liteAuthAdmin } from './liteAdmin';
import { verifyPassword } from './password';

async function setup() {
  const { raw, db } = await freshLite();
  const clock = fixedClock('2026-10-17T06:00:00Z');
  return { raw, db, clock, admin: liteAuthAdmin({ db, clock }) };
}

describe('liteAuthAdmin (server/auth/own/liteAdmin.ts)', () => {
  it('makes the sign-in row and one link of 1 hour for an invitation, and keeps only the sha256 of the token', async () => {
    const { raw, admin } = await setup();
    const link = await admin.generateLink('invite', 'New.Person@Madar.test');
    expect(link.tokenHash).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(raw.prepare('select id, email, password_hash, email_confirmed from auth_users').all()).toEqual([{ id: link.authUserId, email: 'new.person@madar.test', password_hash: null, email_confirmed: 0 }]);
    expect(raw.prepare('select token_hash, type, expires_at, used_at from auth_links').all()).toEqual([
      { token_hash: await sha256Hex(link.tokenHash), type: 'invite', expires_at: '2026-10-17T07:00:00.000Z', used_at: null },
    ]);
    const everything = JSON.stringify(raw.prepare('select * from auth_links').all()) + JSON.stringify(raw.prepare('select * from auth_users').all());
    expect(everything).not.toContain(link.tokenHash);
  });

  it('ends the open links of the person when it makes a new one', async () => {
    const { raw, admin, clock } = await setup();
    await admin.generateLink('invite', 'p@madar.test');
    clock.advance(60_000);
    await admin.generateLink('invite', 'p@madar.test');
    expect(raw.prepare('select used_at from auth_links order by created_at').all()).toEqual([{ used_at: '2026-10-17T06:01:00.000Z' }, { used_at: null }]);
  });

  it('refuses an invite link for a confirmed email, as Supabase does, so linkFor sends a recovery link', async () => {
    const { raw, admin } = await setup();
    await admin.generateLink('invite', 'p@madar.test');
    raw.exec('update auth_users set email_confirmed = 1');
    await expect(admin.generateLink('invite', 'p@madar.test')).rejects.toMatchObject({ status: 422, code: 'email_exists' });
    expect((await linkFor(admin, 'p@madar.test')).type).toBe('recovery');
  });

  it('refuses a recovery link for an email with no sign-in row', async () => {
    const { raw, admin } = await setup();
    await expect(admin.generateLink('recovery', 'nobody@madar.test')).rejects.toMatchObject({ status: 404, code: 'user_not_found' });
    expect(raw.prepare('select count(*) as n from auth_users').get()).toEqual({ n: 0 });
  });

  it('ends every session of a banned person, and an unban opens none again', async () => {
    const { raw, admin } = await setup();
    const { authUserId } = await admin.generateLink('invite', 'p@madar.test');
    raw.exec(`insert into auth_sessions (id, auth_id, amr, refresh_hash, expires_at) values ('s1', '${authUserId}', 'password', 'h1', '2026-11-17T06:00:00.000Z'), ('s2', '${authUserId}', 'oauth', 'h2', '2026-11-17T06:00:00.000Z')`);
    await admin.setBanned(authUserId, true);
    expect(raw.prepare('select banned from auth_users').get()).toEqual({ banned: 1 });
    expect(raw.prepare('select id, revoked_at from auth_sessions order by id').all()).toEqual([{ id: 's1', revoked_at: '2026-10-17T06:00:00.000Z' }, { id: 's2', revoked_at: '2026-10-17T06:00:00.000Z' }]);
    await admin.setBanned(authUserId, false);
    expect(raw.prepare('select banned from auth_users').get()).toEqual({ banned: 0 });
    expect(raw.prepare('select count(*) as n from auth_sessions where revoked_at is null').get()).toEqual({ n: 0 });
  });

  it('confirms a new email only when asked, and refuses an email of another sign-in row', async () => {
    const { admin } = await setup();
    const one = await admin.generateLink('invite', 'one@madar.test');
    await admin.generateLink('invite', 'two@madar.test');
    await admin.updateEmail(one.authUserId, 'One.New@madar.test');
    expect(await admin.getUser(one.authUserId)).toEqual({ authUserId: one.authUserId, email: 'one.new@madar.test', confirmed: false, passwordSet: false });
    await admin.updateEmail(one.authUserId, 'one.new@madar.test', { confirm: true });
    expect((await admin.getUser(one.authUserId))?.confirmed).toBe(true);
    await expect(admin.updateEmail(one.authUserId, 'two@madar.test')).rejects.toMatchObject({ status: 422, code: 'email_exists' });
  });

  it('lists every sign-in row for users.invites, and gives null for an unknown id', async () => {
    const { admin } = await setup();
    const one = await admin.generateLink('invite', 'one@madar.test');
    expect(await admin.listUsers()).toEqual([{ authUserId: one.authUserId, email: 'one@madar.test', confirmed: false, passwordSet: false }]);
    expect(await admin.getUser('00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('makes a first Admin with a PBKDF2 password, confirmed and marked', async () => {
    const { raw, admin } = await setup();
    const { authUserId } = await admin.createUser('Admin@madar.test', 'a good password');
    const row = raw.prepare('select email, password_hash, password_set, email_confirmed from auth_users where id = ?').get(authUserId) as { password_hash: string };
    expect(row).toMatchObject({ email: 'admin@madar.test', password_set: 1, email_confirmed: 1 });
    expect(await verifyPassword('a good password', row.password_hash)).toEqual({ ok: true, upgrade: false });
    await expect(admin.createUser('admin@madar.test', 'x')).rejects.toMatchObject({ code: 'email_exists' });
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run --project server server/auth/own/liteAdmin.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL with "Failed to load url ./liteAdmin".

- [ ] **Step 3: Write the SQL texts of the sign-in rows**

```ts
// server/auth/own/rows.ts
/**
 * The SQL texts of the sign-in rows (Supabase exit, wave 2; schema version 2). SQLite only: ?n values, ISO time text, 1 and 0
 * for a flag, and no outer order by. Every time value comes from deps.clock.
 */

export type AuthUserRow = {
  id: string; user_id: string | null; email: string; password_hash: string | null;
  password_set: number; email_confirmed: number; banned: number;
};
const AUTH_USER_COLUMNS = 'id, user_id, email, password_hash, password_set, email_confirmed, banned';
export const AUTH_USER_BY_EMAIL = `select ${AUTH_USER_COLUMNS} from auth_users where email = ?1`;
export const AUTH_USER_BY_ID = `select ${AUTH_USER_COLUMNS} from auth_users where id = ?1`;
export const AUTH_USER_LIST = 'select id, email, email_confirmed, password_set from auth_users';
/** ?1 id, ?2 email, ?3 hash or null, ?4 password_set, ?5 email_confirmed, ?6 now. */
export const AUTH_USER_INSERT = 'insert into auth_users (id, email, password_hash, password_set, email_confirmed, created_at, updated_at) values (?1, ?2, ?3, ?4, ?5, ?6, ?6)';
export const AUTH_USER_BAN = 'update auth_users set banned = ?2, updated_at = ?3 where id = ?1';
/** ?3 is 1 to confirm the new email; 0 keeps the confirm state as it is (Supabase updateEmail without email_confirm). */
export const AUTH_USER_EMAIL = 'update auth_users set email = ?2, email_confirmed = max(email_confirmed, ?3), updated_at = ?4 where id = ?1';
export const AUTH_USER_CONFIRM = 'update auth_users set email_confirmed = 1, updated_at = ?2 where id = ?1 and email_confirmed = 0';
/** A saved password: the hash, the mark of users.invites (PASSWORD_SET_MARK), and a confirmed email. */
export const AUTH_USER_PASSWORD = 'update auth_users set password_hash = ?2, password_set = 1, email_confirmed = 1, updated_at = ?3 where id = ?1';
/** A sign-in with a password proves it is set; ?2 a new hash (an upgrade) or null. */
export const AUTH_USER_SIGNED_IN = 'update auth_users set password_set = 1, password_hash = coalesce(?2, password_hash), updated_at = ?3 where id = ?1';

export type LinkRow = { token_hash: string; auth_id: string; type: 'invite' | 'recovery'; expires_at: string; used_at: string | null };
export const LINK_INSERT = 'insert into auth_links (token_hash, auth_id, type, expires_at, created_at) values (?1, ?2, ?3, ?4, ?5)';
export const LINK_BY_HASH = 'select token_hash, auth_id, type, expires_at, used_at from auth_links where token_hash = ?1';
/** One use, and the newest link only: this ends every open link of the person. */
export const LINKS_END = 'update auth_links set used_at = ?2 where auth_id = ?1 and used_at is null';

export type Amr = 'password' | 'link' | 'oauth';
export type SessionRow = {
  id: string; auth_id: string; client_id: string | null; amr: Amr; refresh_hash: string; prev_hash: string | null;
  rotated_at: string | null; link_until: string | null; expires_at: string; revoked_at: string | null;
};
const SESSION_COLUMNS = 'id, auth_id, client_id, amr, refresh_hash, prev_hash, rotated_at, link_until, expires_at, revoked_at';
/** ?1 id, ?2 auth id, ?3 client id or null, ?4 amr, ?5 refresh hash, ?6 link_until or null, ?7 expires_at, ?8 now. */
export const SESSION_INSERT = 'insert into auth_sessions (id, auth_id, client_id, amr, refresh_hash, link_until, expires_at, last_used_at, created_at) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)';
export const SESSION_BY_ID = `select ${SESSION_COLUMNS} from auth_sessions where id = ?1`;
export const SESSION_BY_REFRESH = `select ${SESSION_COLUMNS} from auth_sessions where refresh_hash = ?1`;
export const SESSION_BY_PREV = `select ${SESSION_COLUMNS} from auth_sessions where prev_hash = ?1`;
/** ?2 the new refresh hash, ?3 now, ?4 the new end. The old hash stays as prev_hash for the reuse window. */
export const SESSION_ROTATE = 'update auth_sessions set prev_hash = refresh_hash, refresh_hash = ?2, rotated_at = ?3, last_used_at = ?3, expires_at = ?4 where id = ?1';
export const SESSION_END = 'update auth_sessions set revoked_at = ?2 where id = ?1 and revoked_at is null';
export const SESSIONS_END_ALL = 'update auth_sessions set revoked_at = ?2 where auth_id = ?1 and revoked_at is null';
export const SESSIONS_END_OTHERS = 'update auth_sessions set revoked_at = ?3 where auth_id = ?1 and id <> ?2 and revoked_at is null';
/** A link session may set a password once: after the save it is a plain session. */
export const SESSION_LINK_DONE = 'update auth_sessions set link_until = null where id = ?1';
```

- [ ] **Step 4: Write the port**

```ts
// server/auth/own/liteAdmin.ts
import type { Clock, Db } from '../../core/ports';
import { AuthAdminError, type AuthAdmin, type AuthUserInfo, type UpdateEmailOptions } from '../admin';
import { randomToken, sha256Hex } from './crypto';
import { hashPassword } from './password';
import {
  AUTH_USER_BAN, AUTH_USER_BY_EMAIL, AUTH_USER_BY_ID, AUTH_USER_EMAIL, AUTH_USER_INSERT, AUTH_USER_LIST, LINK_INSERT, LINKS_END,
  SESSIONS_END_ALL, type AuthUserRow,
} from './rows';

/**
 * The Auth admin port over the sign-in rows of the office object (Supabase exit, wave 2). It keeps the rules of Supabase Auth that
 * the effects rely on (proof.md P1): an invite link for a confirmed email answers 422 email_exists, a new link ends the older open
 * links of the person, and the admin calls send no mail. The links are random (32 bytes), live 1 hour and work once; the table
 * keeps only the sha256 of a token (this closes security fix 8: no token comes from an email and a 6-digit code any more).
 * Each method runs its crypto before its transaction, never inside one.
 */

export const LINK_LIFE_MS = 60 * 60 * 1000;

const info = (row: Pick<AuthUserRow, 'id' | 'email' | 'email_confirmed' | 'password_set'>): AuthUserInfo => ({
  authUserId: row.id, email: row.email, confirmed: row.email_confirmed === 1, passwordSet: row.password_set === 1,
});

const emailExists = () => new AuthAdminError(422, 'email_exists', 'A user with this email address has already been registered.');

function isUniqueError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE');
}

export function liteAuthAdmin(o: { db: Db; clock: Clock }): AuthAdmin {
  return {
    async generateLink(type, email) {
      const address = email.trim().toLowerCase();
      const token = randomToken();
      const hash = await sha256Hex(token);
      const now = o.clock.now();
      return o.db.tx('write', async (q) => {
        const [found] = await q<AuthUserRow>(AUTH_USER_BY_EMAIL, [address]);
        if (found && type === 'invite' && found.email_confirmed === 1) throw emailExists();
        if (!found && type === 'recovery') throw new AuthAdminError(404, 'user_not_found', 'No sign-in row has this email.');
        const authId = found?.id ?? crypto.randomUUID();
        if (!found) await q(AUTH_USER_INSERT, [authId, address, null, 0, 0, now.toISOString()]);
        await q(LINKS_END, [authId, now.toISOString()]);
        await q(LINK_INSERT, [hash, authId, type, new Date(now.getTime() + LINK_LIFE_MS).toISOString(), now.toISOString()]);
        return { authUserId: authId, tokenHash: token };
      });
    },
    async createUser(email, password) {
      const address = email.trim().toLowerCase();
      const hash = await hashPassword(password);
      const authId = crypto.randomUUID();
      await o.db.tx('write', async (q) => {
        if ((await q(AUTH_USER_BY_EMAIL, [address])).length > 0) throw emailExists();
        await q(AUTH_USER_INSERT, [authId, address, hash, 1, 1, o.clock.now().toISOString()]);
      });
      return { authUserId: authId };
    },
    async setBanned(authUserId, banned) {
      const now = o.clock.now().toISOString();
      await o.db.tx('write', async (q) => {
        await q(AUTH_USER_BAN, [authUserId, banned ? 1 : 0, now]);
        // A ban ends every session, browser and agent, so no refresh works after it. An access token lives 15 minutes at most.
        if (banned) await q(SESSIONS_END_ALL, [authUserId, now]);
      });
    },
    async updateEmail(authUserId: string, email: string, u: UpdateEmailOptions = {}) {
      try {
        await o.db.statement('write', AUTH_USER_EMAIL, [authUserId, email.trim().toLowerCase(), u.confirm === true ? 1 : 0, o.clock.now().toISOString()]);
      } catch (error) {
        if (isUniqueError(error)) throw emailExists();
        throw error;
      }
    },
    async listUsers() {
      return (await o.db.statement<AuthUserRow>('read', AUTH_USER_LIST)).map(info);
    },
    async getUser(authUserId) {
      const [row] = await o.db.statement<AuthUserRow>('read', AUTH_USER_BY_ID, [authUserId]);
      return row ? info(row) : null;
    },
  };
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run --project server server/auth/own/liteAdmin.test.ts --no-file-parallelism --testTimeout=60000`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add server/auth/own/rows.ts server/auth/own/liteAdmin.ts server/auth/own/liteAdmin.test.ts
git commit -m "Exit wave 2: liteAuthAdmin gives the Auth admin port over the sign-in rows, with random links of 1 hour and one use"
```

---

# Block B: today's sign-in code on SQLite (Tasks 6 to 10, 2 days)

The texts of this block keep their Postgres constants as they are (the fakes match them by exact text) and add a `_LITE` twin,
picked with `sqlFor` (wave 1 rule, `server/data/CLAUDE.md`). After this block, `LATER_CALLS` holds only `usage.get` and
`usage.retryEffect` (wave 3), and `LATER_KINDS` is empty.

### Task 6: The SQLite forms of the limits, the mail quota and the invitation store

**Files:**
- Modify: `server/data/dialect.ts` (add `statementQuery`)
- Modify: `server/auth/rateLimit.ts:10-21` (`RATE_LITE`, `hitLimit`)
- Modify: `server/mail/quota.ts:59-73` (`reserve`, `release`), `:100-122` (`sendCounted`); add the `_LITE` texts
- Modify: `server/auth/invite.ts:90-148` (the twins, `sqlInviteStore`), `:210` (`release` in `sendInvitation`)
- Create: `server/auth/own/testOffice.ts`
- Test: `server/auth/own/liteTexts.test.ts`

**Interfaces:**
- Consumes: `isLite`, `markLite`, `sqlFor` (`dialect.ts`); `setLiteAuthLink` (Task 4); `liteAuthAdmin` (Task 5).
- Produces: `statementQuery(db: Db, mode: 'read' | 'write'): Query`; `RATE_LITE`; `DAY_COUNT_LITE`, `RESERVE_LITE`,
  `RELEASE_LITE`, `RECORD_SENT_LITE`; `PERSON_LITE`, `PAYLOAD_MERGE_LITE`, `SENT_LITE`, `RENEW_KEY_LITE`, `NEWER_LINK_LITE`,
  `LATER_INVITE_LITE`, `SIGNIN_KINDS`; `signinOffice(o?: { at?: string }): Promise<TestOffice>` with
  `TestOffice = { raw: DatabaseSync; db: LiteDb; deps: LiteFakeDeps; call(actorId, name, input): Promise<RunResult> }` and
  `LiteFakeDeps = Omit<FakeDeps, 'authAdmin'> & { authAdmin: AuthAdmin }`;
  `addSignIn(t: TestOffice, userId: string, o?: { password?: string; confirmed?: boolean }): Promise<string>` (the auth id);
  `linkValueOfMail(html: string, name: 'token_hash' | 'renew'): string`.

- [ ] **Step 1: Write the test office helper**

```ts
// server/auth/own/testOffice.ts
import type { DatabaseSync } from 'node:sqlite';
import { buildSeed } from '../../../src/data/seed';
import type { Deps } from '../../core/ports';
import { createRunCall } from '../../core/runCall';
import type { RunResult } from '../../core/types';
import { liteData } from '../../data/lite/callData';
import type { LiteDb } from '../../data/lite/db';
import { readLiteOffice, setLiteAuthLink } from '../../data/lite/office';
import { freshLite } from '../../data/lite/testDb';
import { liteWriteState } from '../../data/lite/whole';
import { fakeDeps, type FakeDeps } from '../../test/fakes/deps';
import type { AuthAdmin } from '../admin';
import { liteAuthAdmin } from './liteAdmin';
import { hashPassword } from './password';
import { AUTH_USER_INSERT } from './rows';

/**
 * For tests only: the sample office on node:sqlite with the deps of the SQLite path (liteAuthAdmin in place of the Supabase fake),
 * and runCall on liteData, so a call runs as the office object runs it. Mail goes to the fake mail port.
 */
export type LiteFakeDeps = Omit<FakeDeps, 'authAdmin'> & { authAdmin: AuthAdmin };
export type TestOffice = {
  raw: DatabaseSync;
  db: LiteDb;
  deps: LiteFakeDeps;
  call(actorId: string, name: string, input: unknown): Promise<RunResult>;
};

export async function signinOffice(o: { at?: string } = {}): Promise<TestOffice> {
  const at = o.at ?? '2026-10-17T06:00:00Z';
  const { raw, db } = await freshLite();
  await db.tx('write', async (q) => liteWriteState(q, await buildSeed(at.slice(0, 10), async () => undefined)));
  const base = fakeDeps({ db });
  base.clock.set(new Date(at));
  const deps: LiteFakeDeps = { ...base, authAdmin: liteAuthAdmin({ db, clock: base.clock }) };
  const run = createRunCall({ data: liteData });
  return {
    raw, db, deps,
    call: (actorId, name, input) => run(deps as unknown as Deps, { principal: { userId: actorId }, name, input, batch: { storyRefs: new Map(), overviewCalls: 0 } }),
  };
}

/** One value of the button link of a sign-in mail: token_hash (the link token) or renew (the renew key). */
export function linkValueOfMail(html: string, name: 'token_hash' | 'renew'): string {
  const href = /href="([^"]+)"/.exec(html)?.[1];
  if (!href) throw new Error('The mail has no button link.');
  const value = new URL(href.replace(/&amp;/g, '&')).searchParams.get(name);
  if (value === null) throw new Error(`The button link has no ${name}.`);
  return value;
}

/** A sign-in row for a person of the office, linked to that person; with a password, the person has accepted. */
export async function addSignIn(t: TestOffice, userId: string, o: { password?: string; confirmed?: boolean } = {}): Promise<string> {
  const user = (await t.db.tx('read', (q) => readLiteOffice(t.db, q))).lists.users[userId];
  if (!user) throw new Error(`No person ${userId} in the test office.`);
  const authId = crypto.randomUUID();
  const hash = o.password === undefined ? null : await hashPassword(o.password);
  await t.db.tx('write', async (q) => {
    await q(AUTH_USER_INSERT, [authId, user.email.toLowerCase(), hash, hash === null ? 0 : 1, o.confirmed === false ? 0 : 1, t.deps.clock.now().toISOString()]);
    await setLiteAuthLink(q, userId, authId);
  });
  return authId;
}
```

- [ ] **Step 2: Write the failing tests**

```ts
// server/auth/own/liteTexts.test.ts
import { describe, expect, it } from 'vitest';
import { writeOutbox } from '../../core/effects';
import { isLite, statementQuery } from '../../data/dialect';
import { readLiteOffice } from '../../data/lite/office';
import { freshLite } from '../../data/lite/testDb';
import { userIdOfAuth } from '../../data/officeCache';
import { release, reserve, sendCounted } from '../../mail/quota';
import { fakeDeps } from '../../test/fakes/deps';
import { LATER_INVITE_LITE, NEWER_LINK_LITE, sqlInviteStore } from '../invite';
import { hitLimit } from '../rateLimit';
import { addSignIn, signinOffice } from './testOffice';

const NOW = new Date('2026-10-17T06:10:00Z');
const invite = (userId: string, inviteId: string, more: Record<string, unknown> = {}) => ({ kind: 'auth.invite', payload: { userId, inviteId, ...more } });

describe('the SQLite forms of the sign-in texts of today (Supabase exit, wave 2)', () => {
  it('counts a limit in one statement and gives the new count', async () => {
    const { db } = await freshLite();
    const hit = () => db.tx('write', (q) => hitLimit(q, { key: 'k', limit: 2, windowMs: 3_600_000, now: NOW }));
    expect((await hit()).count).toBe(1);
    expect((await hit()).ok).toBe(true);
    expect(await hit()).toEqual({ ok: false, count: 3, retryAfterMs: 50 * 60_000 });
  });

  it('keeps the dialect of the Db in a statement query', async () => {
    const { db } = await freshLite();
    expect(isLite(statementQuery(db, 'write'))).toBe(true);
  });

  it('reserves one place a day for each ref, stops at 98, and gives a place back', async () => {
    const { db } = await freshLite();
    const place = (ref: string) => db.tx('write', (q) => reserve(q, 'signin', ref, { now: NOW, userId: 'usr_002' }));
    for (let i = 0; i < 98; i += 1) expect(await place(`r${i}`)).toBe('ok');
    expect(await place('r0')).toBe('ok');
    expect(await place('r98')).toBe('over');
    await release(statementQuery(db, 'write'), 'r5');
    expect(await place('r98')).toBe('ok');
  });

  it('sends a counted sign-in mail and records its mail id', async () => {
    const { raw, db } = await freshLite();
    const deps = fakeDeps({ db });
    deps.clock.set(NOW);
    const sent = await sendCounted(deps, 'signin', { to: 'p@madar.test', subject: 's', html: 'h', text: 't', tag: 'invite', idempotencyKey: 'invite:inv_1' }, { userId: 'usr_002' });
    expect(sent).toEqual({ status: 'sent', id: 'mail_1' });
    expect(raw.prepare('select utc_day, kind, ref, resend_id from mail_log').all()).toEqual([{ utc_day: '2026-10-17', kind: 'signin', ref: 'invite:inv_1', resend_id: 'mail_1' }]);
  });

  it('keeps the notes, the renew key once and the sent mark in the outbox payload', async () => {
    const { raw, db } = await freshLite();
    const [id] = await db.tx('write', (q) => writeOutbox(q, [invite('usr_002', 'inv_a')]));
    const store = sqlInviteStore({ db, config: fakeDeps().config });
    await store.note('inv_a', { owesInvite: true, tokenHash: 'T', authUserId: 'A', linkType: 'invite' });
    await store.keepRenewKey('inv_a', 'key1', 'renew:h1');
    await store.keepRenewKey('inv_a', 'key1', 'renew:h1');
    await store.markSent('inv_a', NOW, 'mail_1');
    const { payload } = raw.prepare('select payload from outbox where id = ?').get(Number(id)) as { payload: string };
    expect(JSON.parse(payload)).toEqual({ userId: 'usr_002', inviteId: 'inv_a', owesInvite: true, authUserId: 'A', linkType: 'invite', renewKeys: ['renew:h1'], sentAt: NOW.toISOString(), mailId: 'mail_1' });
  });

  it('finds a newer link and a later invitation of the same person, and none of another person', async () => {
    const { db } = await freshLite();
    await db.tx('write', (q) => writeOutbox(q, [invite('usr_002', 'inv_a'), invite('usr_002', 'inv_b', { linkType: 'invite' }), invite('usr_003', 'inv_c', { linkType: 'invite' })]));
    const store = sqlInviteStore({ db, config: fakeDeps().config });
    expect(await store.newerLink('usr_002', 'inv_a')).toBe(true);
    expect(await store.newerLink('usr_002', 'inv_b')).toBe(false);
    expect(await store.laterInvite('usr_002', 'inv_a')).toBe(true);
    expect(await store.laterInvite('usr_003', 'inv_a')).toBe(false);
  });

  it('reads each invitation text through the outbox_signin index', async () => {
    const { raw } = await freshLite();
    for (const text of [NEWER_LINK_LITE, LATER_INVITE_LITE]) {
      const plan = (raw.prepare(`explain query plan ${text}`).all('usr_002', 'inv_a') as { detail: string }[]).map((row) => row.detail).join(' | ');
      expect(plan).toContain('USING INDEX outbox_signin');
      expect(plan).not.toContain('SCAN outbox');
    }
  });

  it('reads the person with the sign-in link, and keeps a new link in one transaction with the payload', async () => {
    const t = await signinOffice();
    const authId = await addSignIn(t, 'usr_002');
    const store = sqlInviteStore(t.deps);
    expect((await store.person('usr_002'))?.authUserId).toBe(authId);
    expect((await store.person('usr_003'))?.authUserId).toBeNull();
    await t.db.tx('write', (q) => writeOutbox(q, [invite('usr_003', 'inv_d')]));
    const link = await t.deps.authAdmin.generateLink('invite', (await store.person('usr_003'))!.user.email);
    await store.keepLink('inv_d', 'usr_003', { type: 'invite', ...link }, true);
    const office = await t.db.tx('read', (q) => readLiteOffice(t.db, q));
    expect(userIdOfAuth(office, link.authUserId)).toBe('usr_003');
  });
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npx vitest run --project server server/auth/own/liteTexts.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL. `statementQuery` is not exported; `hitLimit` sends the Postgres text and the host refuses it with "Give the
caller a SQLite form".

- [ ] **Step 4: Add the statement query and the limit twin**

In `server/data/dialect.ts`, add:

```ts
/**
 * A query that runs each statement in a transaction of its own (Db.statement) and keeps the dialect of the Db, so sqlFor and the
 * stores pick the right text on it (Supabase exit, wave 2). A route that sends single statements uses it.
 */
export function statementQuery(db: Db, mode: 'read' | 'write'): Query {
  const q = (<R,>(text: string, values?: unknown[]) => db.statement<R>(mode, text, values)) as Query;
  return isLite(db) ? markLite(q) : q;
}
```

In `server/auth/rateLimit.ts`, add the twin and pick it:

```ts
/** The SQLite form (Supabase exit, wave 2). */
export const RATE_LITE =
  'insert into rate_limits (key, window_start, count) values (?1, ?2, 1) on conflict (key, window_start) do update set count = rate_limits.count + 1 returning count';
```

and in `hitLimit`: `const [row] = await q<{ count: number | string }>(sqlFor(q, RATE_SQL, RATE_LITE), [o.key, new Date(start).toISOString()]);`
with `import { sqlFor } from '../data/dialect';`.

- [ ] **Step 5: Add the quota twins**

In `server/mail/quota.ts`, add after `RECORD_SENT_SQL`:

```ts
/**
 * The SQLite forms for the sign-in mail (Supabase exit, wave 2). The office object is the one writer, so there is no mail lock, and
 * the day is the UTC day of the clock of the caller. Wave 3 adds the forms of the notice kinds (the first refusal) and of the meter.
 */
export const DAY_COUNT_LITE = `select coalesce(sum(case when ${SENDING} then 1 else 0 end), 0) as n, coalesce(max(ref = ?2), 0) as mine from mail_log where utc_day = ?1`;
export const RESERVE_LITE = 'insert into mail_log (utc_day, kind, user_id, ref) values (?1, ?2, ?3, ?4) on conflict (utc_day, ref) do nothing';
export const RELEASE_LITE = `delete from mail_log where ref = ?1 and resend_id is null and ${SENDING}`;
export const RECORD_SENT_LITE = 'update mail_log set resend_id = ?3 where utc_day = ?1 and ref = ?2';
```

Change `reserve`, `release` and the last statement of `sendCounted`:

```ts
export async function reserve(q: Query, kind: QuotaKind, ref: string, o: DayOption & { userId?: string } = {}): Promise<'ok' | 'over'> {
  if (isLite(q)) {
    const day = utcDay(o.now ?? new Date());
    const [row] = await q<{ n: number; mine: number }>(DAY_COUNT_LITE, [day, ref]);
    if (Number(row?.mine ?? 0) === 1) return 'ok';
    if (Number(row?.n ?? 0) >= QUOTA_LIMITS[kind]) return 'over';
    await q(RESERVE_LITE, [day, kind, o.userId ?? null, ref]);
    return 'ok';
  }
  await q(MAIL_LOCK_SQL, [...MAIL_LOCK_KEY]);
  const [row] = await q<{ ok: boolean }>(RESERVE_SQL, [dayOf(o), kind, o.userId ?? null, ref, QUOTA_LIMITS[kind]]);
  return row?.ok ? 'ok' : 'over';
}

export async function release(q: Query, ref: string): Promise<void> {
  await q(sqlFor(q, RELEASE_SQL, RELEASE_LITE), [ref]);
}
```

```ts
  await deps.db.statement('write', sqlFor(deps.db, RECORD_SENT_SQL, RECORD_SENT_LITE), [utcDay(now), ref, id]);
```

Add `import { isLite, sqlFor } from '../data/dialect';`.

- [ ] **Step 6: Add the invitation twins and pick them in the store**

In `server/auth/invite.ts`, add after `LATER_INVITE_SQL` (line 115):

```ts
/**
 * The SQLite forms (Supabase exit, wave 2). The sign-in link is auth_users.user_id. Each outbox text repeats SIGNIN_KINDS, the exact
 * term of the partial index outbox_signin: with kind = 'auth.invite' alone SQLite scans the whole outbox (checked on node:sqlite).
 * json_patch drops a key with a null value: no payload note sets one.
 */
export const SIGNIN_KINDS = "kind in ('auth.invite', 'auth.email')";
export const PERSON_LITE = 'select u.doc as doc, a.id as auth from users u left join auth_users a on a.user_id = u.id where u.id = ?1';
export const PAYLOAD_MERGE_LITE = `update outbox set payload = json_patch(payload, ?2) where ${SIGNIN_KINDS} and json_extract(payload, '$.inviteId') = ?1`;
export const SENT_LITE = `update outbox set payload = json_patch(json_remove(payload, '$.tokenHash', '$.renewKey'), ?2) where ${SIGNIN_KINDS} and json_extract(payload, '$.inviteId') = ?1`;
export const RENEW_KEY_LITE =
  `update outbox set payload = json_set(payload, '$.renewKey', ?2, '$.renewKeys', json_insert(coalesce(payload -> '$.renewKeys', '[]'), '$[#]', ?3)) ` +
  `where ${SIGNIN_KINDS} and json_extract(payload, '$.inviteId') = ?1 and not exists (select 1 from json_each(payload, '$.renewKeys') where value = ?3)`;
const ROW_OF_INVITE = `(select id from outbox where ${SIGNIN_KINDS} and json_extract(payload, '$.inviteId') = ?2 limit 1)`;
export const NEWER_LINK_LITE =
  `select 1 as found from outbox where ${SIGNIN_KINDS} and json_extract(payload, '$.userId') = ?1 and json_type(payload, '$.linkType') is not null and id > ${ROW_OF_INVITE} limit 1`;
export const LATER_INVITE_LITE =
  `select 1 as found from outbox where ${SIGNIN_KINDS} and kind = 'auth.invite' and json_extract(payload, '$.userId') = ?1 ` +
  `and (done_at is null or json_type(payload, '$.sentAt') is not null) and id > ${ROW_OF_INVITE} limit 1`;
```

Replace `sqlInviteStore` (lines 117 to 148):

```ts
export function sqlInviteStore(deps: Pick<Deps, 'db' | 'config'>): InviteStore {
  const text = (pg: string, lite: string) => sqlFor(deps.db, pg, lite);
  return {
    async person(userId) {
      const [row] = await deps.db.statement<{ doc: unknown; auth: string | null }>('read', text(PERSON_SQL, PERSON_LITE), [userId]);
      if (!row) return undefined;
      return { user: User.parse(row.doc), authUserId: row.auth ?? null };
    },
    async note(inviteId, fields) {
      await deps.db.statement('write', text(PAYLOAD_MERGE_SQL, PAYLOAD_MERGE_LITE), [inviteId, JSON.stringify(fields)]);
    },
    async newerLink(userId, inviteId) {
      return (await deps.db.statement('read', text(NEWER_LINK_SQL, NEWER_LINK_LITE), [userId, inviteId])).length > 0;
    },
    async laterInvite(userId, inviteId) {
      return (await deps.db.statement('read', text(LATER_INVITE_SQL, LATER_INVITE_LITE), [userId, inviteId])).length > 0;
    },
    async keepLink(inviteId, userId, link, relink) {
      await deps.db.tx('write', async (q) => {
        // The office lock orders this write with the saves of runCall, which also write users rows and office_meta (none on SQLite).
        await takeOfficeLock(q, deps.config.lockKey);
        await q(sqlFor(q, PAYLOAD_MERGE_SQL, PAYLOAD_MERGE_LITE), [inviteId, JSON.stringify({ tokenHash: link.tokenHash, authUserId: link.authUserId, linkType: link.type })]);
        if (relink) await (isLite(q) ? setLiteAuthLink(q, userId, link.authUserId) : setAuthUserId(q, userId, link.authUserId));
      });
    },
    async markSent(inviteId, at, mailId) {
      await deps.db.statement('write', text(SENT_SQL, SENT_LITE), [inviteId, JSON.stringify({ sentAt: at.toISOString(), mailId })]);
    },
    async keepRenewKey(inviteId, key, hash) {
      await deps.db.statement('write', text(RENEW_KEY_SQL, RENEW_KEY_LITE), [inviteId, key, hash]);
    },
  };
}
```

In `sendInvitation`, change the `release` call of `skip` (line 210) to
`await release(statementQuery(deps.db, 'write'), mailKey(payload.inviteId));`. Add the imports
`import { isLite, sqlFor, statementQuery } from '../data/dialect';` and `import { setLiteAuthLink } from '../data/lite/office';`.

- [ ] **Step 7: Run the tests to see them pass**

Run: `npx vitest run --project server server/auth/own/liteTexts.test.ts server/auth/invite.test.ts server/auth/rateLimit.test.ts server/mail/quota.test.ts server/workerGraph.test.ts --no-file-parallelism --testTimeout=60000`
Expected: PASS. The Postgres tests of today stay green: their fakes get the same Postgres texts. The graph test stays green:
`server/data/lite/office.ts` is not under `server/auth/own/`.

- [ ] **Step 8: Commit**

```bash
git add server/data/dialect.ts server/auth/rateLimit.ts server/mail/quota.ts server/auth/invite.ts server/auth/own/testOffice.ts server/auth/own/liteTexts.test.ts
git commit -m "Exit wave 2: the SQLite forms of the limits, the sign-in mail quota and the invitation store"
```

### Task 7: The auth effects on SQLite, and the harness on liteAuthAdmin

**Files:**
- Modify: `server/auth/effects.ts:138-149` (`sqlAuthStore.queueNotice`)
- Modify: `server/test/liteHarness.ts:28-30` (`LATER_KINDS`), `:75-158` (the deps of a test office)
- Modify: `server/test/liteHarness.test.ts` (add one test)
- Test: `server/auth/own/effects.lite.test.ts`

**Interfaces:**
- Consumes: `signinOffice`, `addSignIn` (Task 6); `liteAuthAdmin` (Task 5).
- Produces: `LATER_KINDS = new Set(['agents.revokeAll'])` (Task 10 empties it); the test office of `test:lite` has
  `deps.authAdmin = liteAuthAdmin(...)`.

- [ ] **Step 1: Write the failing tests**

```ts
// server/auth/own/effects.lite.test.ts
import { describe, expect, it } from 'vitest';
import { readLiteOffice } from '../../data/lite/office';
import { userIdOfAuth } from '../../data/officeCache';
import { addSignIn, linkValueOfMail, signinOffice } from './testOffice';

const NEW_PERSON = { name: 'New Person', email: 'new.person@madar.test', systemRole: 'member', discipline: 'Architect' };
const tokenOfMail = (html: string) => linkValueOfMail(html, 'token_hash');

describe('the auth effects on SQLite (Supabase exit, wave 2)', () => {
  it('users.create sends the invitation, makes the sign-in row and links the person', async () => {
    const t = await signinOffice();
    const made = await t.call('usr_001', 'users.create', NEW_PERSON);
    expect(made.ok).toBe(true);
    const userId = (made as { output: { id: string } }).output.id;
    expect(t.deps.mail.sent.map((mail) => mail.to)).toEqual(['new.person@madar.test']);
    const token = tokenOfMail(t.deps.mail.sent[0].html);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [row] = t.raw.prepare('select id, user_id, email_confirmed from auth_users').all() as { id: string; user_id: string; email_confirmed: number }[];
    expect(row).toMatchObject({ user_id: userId, email_confirmed: 0 });
    expect(userIdOfAuth(await t.db.tx('read', (q) => readLiteOffice(t.db, q)), row.id)).toBe(userId);
    expect(t.raw.prepare("select count(*) as n from outbox where kind = 'auth.invite' and done_at is not null").get()).toEqual({ n: 1 });
    expect(t.raw.prepare('select kind from mail_log').all()).toEqual([{ kind: 'signin' }]);
    // The sent row keeps no live link token (security fix 8).
    expect(JSON.stringify(t.raw.prepare('select payload from outbox').all())).not.toContain(token);
  });

  it('users.deactivate bans the sign-in row and ends its sessions; users.reactivate lifts the ban', async () => {
    const t = await signinOffice();
    const authId = await addSignIn(t, 'usr_007', { password: 'a good password' });
    t.raw.prepare("insert into auth_sessions (id, auth_id, amr, refresh_hash, expires_at) values ('s1', ?, 'password', 'h1', '2026-11-17T06:00:00.000Z')").run(authId);
    expect((await t.call('usr_001', 'users.deactivate', { id: 'usr_007' })).ok).toBe(true);
    expect(t.raw.prepare('select banned from auth_users where id = ?').get(authId)).toEqual({ banned: 1 });
    expect(t.raw.prepare('select revoked_at from auth_sessions').get()).toEqual({ revoked_at: '2026-10-17T06:00:00.000Z' });
    expect((await t.call('usr_001', 'users.reactivate', { id: 'usr_007' })).ok).toBe(true);
    expect(t.raw.prepare('select banned from auth_users where id = ?').get(authId)).toEqual({ banned: 0 });
  });

  it('an email change before the person accepts moves the sign-in row and sends a new invitation to the new email', async () => {
    const t = await signinOffice();
    const userId = ((await t.call('usr_001', 'users.create', NEW_PERSON)) as { output: { id: string } }).output.id;
    expect((await t.call('usr_001', 'users.update', { id: userId, patch: { email: 'new.email@madar.test' } })).ok).toBe(true);
    expect(t.deps.mail.sent.map((mail) => mail.to)).toEqual(['new.person@madar.test', 'new.email@madar.test']);
    expect(t.raw.prepare('select email, email_confirmed from auth_users').get()).toEqual({ email: 'new.email@madar.test', email_confirmed: 0 });
    expect(t.raw.prepare('select count(*) as n from auth_links where used_at is null').get()).toEqual({ n: 1 });
  });

  it('an email change after the person accepts sends a notice with no link to the old email', async () => {
    const t = await signinOffice();
    await addSignIn(t, 'usr_003', { password: 'a good password' });
    const old = (await t.db.tx('read', (q) => readLiteOffice(t.db, q))).lists.users.usr_003.email;
    expect((await t.call('usr_001', 'users.update', { id: 'usr_003', patch: { email: 'usr003.new@madar.test' } })).ok).toBe(true);
    expect(t.deps.mail.sent.map((mail) => mail.to)).toEqual([old]);
    expect(t.deps.mail.sent[0].html).not.toContain('token_hash');
    expect(t.raw.prepare('select email, email_confirmed from auth_users where user_id = ?').get('usr_003')).toEqual({ email: 'usr003.new@madar.test', email_confirmed: 1 });
  });

  it('a full mail day keeps the invitation in the outbox until the next UTC day and makes no link', async () => {
    const t = await signinOffice();
    for (let i = 0; i < 98; i += 1) t.raw.prepare("insert into mail_log (utc_day, kind, ref) values ('2026-10-17', 'signin', ?)").run(`full-${i}`);
    expect((await t.call('usr_001', 'users.create', NEW_PERSON)).ok).toBe(true);
    expect(t.deps.mail.sent).toHaveLength(0);
    expect(t.raw.prepare('select count(*) as n from auth_links').get()).toEqual({ n: 0 });
    expect(t.raw.prepare("select claimed_until, attempts from outbox where kind = 'auth.invite'").get()).toEqual({ claimed_until: '2026-10-18T00:00:00.000Z', attempts: 0 });
  });

  it('sends no change signal for a sign-in row: the rows are not part of the State', async () => {
    const t = await signinOffice();
    await t.call('usr_001', 'users.create', NEW_PERSON);
    expect(JSON.stringify(t.deps.signal.sent)).not.toContain('auth_');
  });
});
```

Add to `server/test/liteHarness.test.ts`:

```ts
  it('lists no sign-in kind of wave 2 as a kind with no SQLite form', () => {
    expect([...LATER_KINDS].filter((kind) => kind.startsWith('auth.'))).toEqual([]);
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run --project server server/auth/own/effects.lite.test.ts server/test/liteHarness.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL. The email change after acceptance sends no notice: `queueNotice` sends the Postgres `PAYLOAD_MERGE_SQL`, and the
host refuses it; the harness test finds five `auth.` kinds.

- [ ] **Step 3: Pick the twin in the notice queue**

In `server/auth/effects.ts`, change `sqlAuthStore.queueNotice` (line 144):

```ts
        await q(sqlFor(q, PAYLOAD_MERGE_SQL, PAYLOAD_MERGE_LITE), [inviteId, JSON.stringify({ noticeQueued: true })]);
```

and add `PAYLOAD_MERGE_LITE` to the import from `./invite`.

- [ ] **Step 4: Give the test:lite office the sign-in rows**

In `server/test/liteHarness.ts`:

```ts
/** The effect kinds that have no SQLite form yet. agents.revokeAll leaves in Task 10 of wave 2; then the set is empty. */
export const LATER_KINDS: ReadonlySet<string> = new Set(['agents.revokeAll']);
```

Change the deps type and `begin`:

```ts
/** The fakes of a test office, with the Auth admin port over the sign-in rows of that office (Supabase exit, wave 2). */
type LiteDeps = Omit<FakeDeps, 'authAdmin'> & { authAdmin: AuthAdmin };
```

```ts
  #deps?: LiteDeps;
```

```ts
  get deps(): LiteDeps {
    if (!this.#deps) throw new Error('lite mode: the backend is used before its test office opened.');
    return this.#deps;
  }
```

```ts
    this.#db = liteDb(host);
    const base = fakeDeps({ db: this.#db, config: { lockKey: 0, supabaseUrl: 'http://lite-mode' } });
    this.#deps = { ...base, authAdmin: liteAuthAdmin({ db: this.#db, clock: base.clock }) };
```

Add `import type { AuthAdmin } from '../auth/admin';` and `import { liteAuthAdmin } from '../auth/own/liteAdmin';`.

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run --project server server/auth/own/effects.lite.test.ts server/test/liteHarness.test.ts server/auth/effects.test.ts --no-file-parallelism --testTimeout=60000`
Expected: PASS.

- [ ] **Step 6: Run test:lite**

Run: `npm run test:lite`
Expected: 81 files passed; 1,141 passed, 25 skipped. Every warn and error line of the fakes with "Give the caller a SQLite form"
now names only `agents.revokeAll`, `users.invites`, `users.resendInvite`, `agents.list`, `agents.remove`, `usage.get` or
`usage.retryEffect`; the harness fails on any other.

- [ ] **Step 7: Commit**

```bash
git add server/auth/effects.ts server/test/liteHarness.ts server/test/liteHarness.test.ts server/auth/own/effects.lite.test.ts
git commit -m "Exit wave 2: the auth effects run on SQLite with liteAuthAdmin, and test:lite has no auth kind left"
```

### Task 8: The forgot and renew routes on SQLite

**Files:**
- Modify: `server/auth/forgot.ts:65` (add `FORGOT_PERSON_LITE`), `:82-84` (`sendReset`), `:143` (the limit query)
- Modify: `server/auth/renew.ts:61-64` (add `RENEW_ROW_LITE`), `:78` (`usable`), `:81-128` (`renewInvitation`), `:153` (the limit query)
- Test: `server/auth/own/mailRoutes.lite.test.ts`

**Interfaces:**
- Consumes: `PERSON_LITE`, `NEWER_LINK_LITE`, `PAYLOAD_MERGE_LITE` (Task 6); `statementQuery`; `signinOffice`, `addSignIn`.
- Produces: `FORGOT_PERSON_LITE`, `RENEW_ROW_LITE`. The client address rule stays as it is: the route reads
  `x-madar-client-address` on the Worker host and `cf-connecting-ip` on every other host (`clientAddress`, `forgot.ts:76-79`).

- [ ] **Step 1: Write the failing tests**

```ts
// server/auth/own/mailRoutes.lite.test.ts
import { describe, expect, it } from 'vitest';
import { runInHost } from '../../core/after';
import type { Deps } from '../../core/ports';
import { createForgotRoute } from '../forgot';
import { createRenewRoute } from '../renew';
import { addSignIn, linkValueOfMail, signinOffice } from './testOffice';

const post = (path: string, body: unknown, address = '203.0.113.7') =>
  new Request(`http://madar.test/api${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-madar-client-address': address }, body: JSON.stringify(body) });
const tokenOfMail = (html: string) => linkValueOfMail(html, 'token_hash');
const renewOfMail = (html: string) => linkValueOfMail(html, 'renew');

describe('the forgot and renew routes on SQLite (Supabase exit, wave 2)', () => {
  it('sends a reset mail with a recovery link to a person with a sign-in row, and the same answer for an unknown email', async () => {
    const t = await signinOffice();
    await addSignIn(t, 'usr_002', { password: 'a good password' });
    const email = (t.raw.prepare("select email from auth_users").get() as { email: string }).email;
    const route = createForgotRoute({ minMs: 0, host: () => ({ host: 'workers' }) });
    const known = await runInHost({ host: 'workers' }, () => route(post('/auth/forgot', { email }), t.deps as unknown as Deps));
    const unknown = await runInHost({ host: 'workers' }, () => route(post('/auth/forgot', { email: 'nobody@madar.test' }), t.deps as unknown as Deps));
    expect([known.status, await known.json(), unknown.status, await unknown.json()]).toEqual([200, { v: 1, ok: true }, 200, { v: 1, ok: true }]);
    expect(t.deps.mail.sent.map((mail) => mail.to)).toEqual([email]);
    expect(t.deps.mail.sent[0].html).toContain('/reset?token_hash=');
    expect(t.raw.prepare("select type from auth_links where used_at is null").all()).toEqual([{ type: 'recovery' }]);
  });

  it('counts the limits of the address that the Pages Function wrote, and of the email, in rate_limits', async () => {
    const t = await signinOffice();
    await addSignIn(t, 'usr_002', { password: 'a good password' });
    const route = createForgotRoute({ minMs: 0, host: () => ({ host: 'workers' }) });
    const answers: number[] = [];
    for (let i = 0; i < 4; i += 1) answers.push((await runInHost({ host: 'workers' }, () => route(post('/auth/forgot', { email: 'x@madar.test' }), t.deps as unknown as Deps))).status);
    expect(answers).toEqual([200, 200, 200, 429]);
    expect(t.raw.prepare('select count(*) as n from rate_limits').get()).toEqual({ n: 2 });
    expect(JSON.stringify(t.raw.prepare('select key from rate_limits').all())).not.toContain('x@madar.test');
  });

  it('renews an invitation with the key of the mail once, and a second press sends nothing', async () => {
    const t = await signinOffice();
    const userId = ((await t.call('usr_001', 'users.create', { name: 'New Person', email: 'new.person@madar.test', systemRole: 'member', discipline: 'Architect' })) as { output: { id: string } }).output.id;
    const key = renewOfMail(t.deps.mail.sent[0].html);
    const first = tokenOfMail(t.deps.mail.sent[0].html);
    const route = createRenewRoute({ minMs: 0, host: () => ({ host: 'workers' }) });
    await runInHost({ host: 'workers' }, () => route(post('/auth/renew-invite', { key }), t.deps as unknown as Deps));
    await runInHost({ host: 'workers' }, () => route(post('/auth/renew-invite', { key }), t.deps as unknown as Deps));
    expect(t.deps.mail.sent).toHaveLength(2);
    expect(tokenOfMail(t.deps.mail.sent[1].html)).not.toBe(first);
    expect(t.raw.prepare('select count(*) as n from auth_links where used_at is null').get()).toEqual({ n: 1 });
    expect(t.raw.prepare('select user_id from auth_users').get()).toEqual({ user_id: userId });
  });

  it('does nothing for a plain key that a reader of an unsent outbox row finds (security fix 8)', async () => {
    const t = await signinOffice();
    t.raw.prepare("insert into outbox (kind, payload) values ('auth.invite', ?)").run(JSON.stringify({ userId: 'usr_004', inviteId: 'inv_x', renewKey: 'plainkey', renewKeys: [] }));
    const route = createRenewRoute({ minMs: 0, host: () => ({ host: 'workers' }) });
    const answer = await runInHost({ host: 'workers' }, () => route(post('/auth/renew-invite', { key: 'plainkey' }), t.deps as unknown as Deps));
    expect(answer.status).toBe(200);
    expect(t.deps.mail.sent).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run --project server server/auth/own/mailRoutes.lite.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL. The forgot route answers 200, but no mail goes out: `FORGOT_PERSON_SQL` is a Postgres text, and the route logs
the refusal.

- [ ] **Step 3: Add the twins and use them**

In `server/auth/forgot.ts`:

```ts
/** The SQLite form (Supabase exit, wave 2): the sign-in row holds the email, so a person with no sign-in row gets nothing. */
export const FORGOT_PERSON_LITE = 'select u.id as id, u.doc as doc, a.id as auth from auth_users a join users u on u.id = a.user_id where a.email = ?1';
```

In `sendReset`, read with `sqlFor(deps.db, FORGOT_PERSON_SQL, FORGOT_PERSON_LITE)`. In the route, replace line 143 with
`const q: Query = statementQuery(deps.db, 'write');`. Imports: `import { sqlFor, statementQuery } from '../data/dialect';`.

In `server/auth/renew.ts`:

```ts
/** The SQLite form (Supabase exit, wave 2). No order by: renewInvitation picks the newest row in JavaScript (wave 0 rule). */
export const RENEW_ROW_LITE =
  "select cast(id as text) as id, json_extract(payload, '$.userId') as user_id, json_extract(payload, '$.inviteId') as invite_id, " +
  "json_type(payload, '$.sentAt') is not null as sent, json_type(payload, '$.renewedAt') is not null as renewed from outbox " +
  "where kind in ('auth.invite', 'auth.email') and exists (select 1 from json_each(payload, '$.renewKeys') where value = ?1)";

/** The newest row of a key. SQLite gives sent and renewed as 1 or 0, Postgres as true or false. */
function newestOf(rows: KeyRow[]): KeyRow | undefined {
  return rows.reduce<KeyRow | undefined>((best, row) => (!best || Number(row.id) > Number(best.id) ? row : best), undefined);
}

const usable = (row: KeyRow | undefined): row is KeyRow => row !== undefined && Boolean(row.sent) && !row.renewed;
```

Change `KeyRow` to `{ id: string; user_id: string; invite_id: string; sent: boolean | number; renewed: boolean | number }`. In
`renewInvitation`, read with the twins:

```ts
  const row = newestOf(await deps.db.statement<KeyRow>('read', sqlFor(deps.db, RENEW_ROW_SQL, RENEW_ROW_LITE), [hash]));
  if (!usable(row)) return 'none';
  const [person] = await deps.db.statement<{ doc: unknown; auth: string | null }>('read', sqlFor(deps.db, PERSON_SQL, PERSON_LITE), [row.user_id]);
  if (!person || person.auth === null) return 'none';
  const user = User.parse(person.doc);
  if (user.kind !== 'human' || !user.active) return 'none';
  if ((await deps.db.statement('read', sqlFor(deps.db, NEWER_LINK_SQL, NEWER_LINK_LITE), [row.user_id, row.invite_id])).length > 0) return 'none';
```

and inside the transaction:

```ts
      const again = newestOf(await t<KeyRow>(sqlFor(t, RENEW_ROW_SQL, RENEW_ROW_LITE), [hash]));
```

```ts
      await t(sqlFor(t, PAYLOAD_MERGE_SQL, PAYLOAD_MERGE_LITE), [row.invite_id, JSON.stringify({ renewedAt: now.toISOString() })]);
```

Replace line 153 with `const q: Query = statementQuery(deps.db, 'write');`. Imports: `NEWER_LINK_LITE`, `PAYLOAD_MERGE_LITE`,
`PERSON_LITE` from `./invite`, and `sqlFor`, `statementQuery` from `../data/dialect`.

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run --project server server/auth/own/mailRoutes.lite.test.ts server/auth/forgot.test.ts server/auth/renew.test.ts --no-file-parallelism --testTimeout=60000`
Expected: PASS. `renew.test.ts` of today gives `sent` and `renewed` as booleans; `Boolean` keeps them as they are.

- [ ] **Step 5: Commit**

```bash
git add server/auth/forgot.ts server/auth/renew.ts server/auth/own/mailRoutes.lite.test.ts
git commit -m "Exit wave 2: the forgot and renew routes read and write the sign-in rows on SQLite"
```

### Task 9: users.invites and users.resendInvite on SQLite, with the leak tests

**Files:**
- Modify: `server/calls/people.ts:28-32` (the twins), `:51-54` (`usersInvites`)
- Modify: `server/test/liteHarness.ts:28` (`LATER_CALLS`)
- Test: `server/calls/people.lite.test.ts`

**Interfaces:**
- Consumes: `signinOffice`, `addSignIn`; `liteAuthAdmin.listUsers` (Task 5).
- Produces: `INVITE_LINKS_LITE`, `INVITE_SENT_LITE`; `LATER_CALLS` without `users.invites` and `users.resendInvite`.

- [ ] **Step 1: Write the failing tests**

```ts
// server/calls/people.lite.test.ts
import { describe, expect, it } from 'vitest';
import { addSignIn, signinOffice, type TestOffice } from '../auth/own/testOffice';

const NEW_PERSON = { name: 'New Person', email: 'new.person@madar.test', systemRole: 'member', discipline: 'Architect' };
type InviteRow = { userId: string; state: 'active' | 'invited'; sentAt: string | null };

async function invited(t: TestOffice): Promise<string> {
  return ((await t.call('usr_001', 'users.create', NEW_PERSON)) as { output: { id: string } }).output.id;
}
async function stateOf(t: TestOffice, userId: string): Promise<InviteRow | undefined> {
  return ((await t.call('usr_001', 'users.invites', {})) as { output: InviteRow[] }).output.find((row) => row.userId === userId);
}

describe('users.invites and users.resendInvite on SQLite (Supabase exit, wave 2)', () => {
  it('says invited until the person opens the link and saves a password, then active', async () => {
    const t = await signinOffice();
    const userId = await invited(t);
    expect(await stateOf(t, userId)).toEqual({ userId, state: 'invited', sentAt: expect.any(String) });
    t.raw.prepare('update auth_users set email_confirmed = 1 where user_id = ?').run(userId);
    // Opened the link but saved no password: still invited (owner, 2026-10-04).
    expect((await stateOf(t, userId))?.state).toBe('invited');
    t.raw.prepare('update auth_users set password_set = 1 where user_id = ?').run(userId);
    expect((await stateOf(t, userId))?.state).toBe('active');
  });

  it('says invited with no date for a person who never got a sign-in row', async () => {
    const t = await signinOffice();
    expect(await stateOf(t, 'usr_004')).toEqual({ userId: 'usr_004', state: 'invited', sentAt: null });
  });

  it('sends the invitation again: the first link ends and one new link is open', async () => {
    const t = await signinOffice();
    const userId = await invited(t);
    t.deps.clock.advance(60_000);
    expect((await t.call('usr_001', 'users.resendInvite', { id: userId })).ok).toBe(true);
    expect(t.deps.mail.sent).toHaveLength(2);
    expect(t.raw.prepare('select count(*) as n from auth_links where used_at is null').get()).toEqual({ n: 1 });
  });

  it('stops at 5 resends a day for one person', async () => {
    const t = await signinOffice();
    const userId = await invited(t);
    for (let i = 0; i < 5; i += 1) expect((await t.call('usr_001', 'users.resendInvite', { id: userId })).ok).toBe(true);
    expect(await t.call('usr_001', 'users.resendInvite', { id: userId })).toMatchObject({ ok: false, error: { code: 'conflict', details: { reason: 'invite_limit' } } });
  });

  it('gives a member forbidden, and no answer holds a sign-in id', async () => {
    const t = await signinOffice();
    const authId = await addSignIn(t, 'usr_003', { password: 'a good password' });
    const member = await t.call('usr_005', 'users.invites', {});
    expect(member).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    const admin = await t.call('usr_001', 'users.invites', {});
    expect(JSON.stringify(member) + JSON.stringify(admin)).not.toContain(authId);
    expect(await t.call('usr_005', 'users.resendInvite', { id: 'usr_003' })).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run --project server server/calls/people.lite.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL. `users.invites` answers `failed`: `INVITE_LINKS_SQL` casts `auth_user_id::text`, and the host refuses the text.

- [ ] **Step 3: Add the twins and remove the names from LATER_CALLS**

In `server/calls/people.ts`:

```ts
/**
 * The SQLite forms (Supabase exit, wave 2). A person with no sign-in row has no row here, so the call says invited, as for a
 * Postgres row with a null auth_user_id. sentAt is ISO text, so the max of the texts is the newest time.
 */
export const INVITE_LINKS_LITE = 'select user_id as id, id as auth from auth_users where user_id is not null';
export const INVITE_SENT_LITE =
  "select json_extract(payload, '$.userId') as user_id, max(json_extract(payload, '$.sentAt')) as sent_at from outbox " +
  "where kind in ('auth.invite', 'auth.email') and json_type(payload, '$.sentAt') is not null group by 1";
```

```ts
  const { links, sent } = await deps.db.tx('read', async (q) => ({
    links: await q<{ id: string; auth: string | null }>(sqlFor(q, INVITE_LINKS_SQL, INVITE_LINKS_LITE)),
    sent: await q<{ user_id: string; sent_at: Date | string }>(sqlFor(q, INVITE_SENT_SQL, INVITE_SENT_LITE)),
  }));
```

Add `import { sqlFor } from '../data/dialect';`. In `server/test/liteHarness.ts`:

```ts
/** The server calls that have no SQLite form yet: wave 3 gives usage.get and usage.retryEffect theirs, and empties this list. */
export const LATER_CALLS: ReadonlySet<string> = new Set(['usage.get', 'usage.retryEffect']);
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run --project server server/calls/people.lite.test.ts server/calls/people.test.ts server/test/liteHarness.test.ts --no-file-parallelism --testTimeout=60000`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/calls/people.ts server/calls/people.lite.test.ts server/test/liteHarness.ts
git commit -m "Exit wave 2: users.invites and users.resendInvite on SQLite, with the tests that no answer leaks a sign-in id"
```

### Task 10: The agent rows on SQLite, and agents.revokeAll inside the call transaction

**Files:**
- Modify: `server/core/types.ts:37` (`ServerCallCtx.data`), `server/core/runCall.ts:120-122` (pass `data`)
- Modify: `server/calls/agents.ts:35-37` (twins), `:52-56` (`agentsList`), `:110-125` (`createAgentsRemove`)
- Modify: `server/mcp/revokeAll.ts:66-74` (the producers), add `REVOKE_ALL_LITE`, `revokeAllIn`
- Modify: `server/mcp/agentUser.ts:96-157` (twins, `ensureAgentUser`)
- Modify: `server/mcp/approval.ts:34-67` (twins, `recordApproval`)
- Modify: `server/mcp/auth.ts:98-144` (`AGENT_LITE`, `agentPrincipalResolver`)
- Modify: `server/mcp/app.ts:93-103` (`sqlMcpLimit`)
- Create: `server/mcp/oauth/agent.ts` (`liteAgentOf`)
- Modify: `server/test/liteHarness.ts:30` (`LATER_KINDS` empty), `server/test/liteHarness.test.ts`
- Test: `server/mcp/agents.lite.test.ts`

**Interfaces:**
- Consumes: `liteData` (wave 1); `signinOffice`, `addSignIn`; the tables `oauth_clients`, `auth_sessions` (Task 1).
- Produces: `ServerCallCtx.data?: CallData`; `AGENT_LINKS_LITE`, `REVOKE_AGENT_LITE`, `END_AGENT_SESSIONS_LITE`;
  `REVOKE_ALL_LITE`, `revokeAllIn(q, userId)`; `LINK_LITE`, `CLIENT_LITE`, `SAME_APP_LITE`, `LINK_INSERT_LITE`;
  `AUTHORIZATION_LITE`, `APPROVAL_INSERT_LITE`, `REMOVED_LINK_LITE`, `APPROVAL_LITE`;
  `recordApproval(q, { authorizationId, authUserId, ownerId, now? })`; `AGENT_LITE`;
  `agentPrincipalResolver(o: { query; office; ensure; lite?: { now: () => Date } })`;
  `liteAgentOf(deps: Deps, token: AgentToken, office: () => Promise<OfficeSnapshot>): Promise<AgentPrincipal>`;
  `MCP_SEEN_LITE`; `LATER_KINDS` is empty.

- [ ] **Step 1: Write the failing tests**

```ts
// server/mcp/agents.lite.test.ts
import { describe, expect, it } from 'vitest';
import { addSignIn, signinOffice, type TestOffice } from '../auth/own/testOffice';
import type { Deps } from '../core/ports';
import { liteData } from '../data/lite/callData';
import { readLiteOffice } from '../data/lite/office';
import { ensureAgentUser } from './agentUser';
import { sqlMcpLimit } from './app';
import { recordApproval } from './approval';
import { liteAgentOf } from './oauth/agent';

const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';

async function approvedClient(t: TestOffice, ownerId = 'usr_002') {
  const authId = await addSignIn(t, ownerId, { password: 'a good password' });
  const clientId = crypto.randomUUID();
  const now = t.deps.clock.now().toISOString();
  t.raw.prepare('insert into oauth_clients (id, name, redirect_uris, created_at) values (?, ?, ?, ?)').run(clientId, 'Claude', JSON.stringify([CALLBACK]), now);
  t.raw.prepare('insert into agent_approvals (client_id, owner_user_id, approved_at) values (?, ?, ?)').run(clientId, ownerId, now);
  t.raw.prepare("insert into auth_sessions (id, auth_id, client_id, amr, refresh_hash, expires_at, created_at) values (?, ?, ?, 'oauth', ?, '2026-11-17T06:00:00.000Z', ?)").run(`s-${clientId}`, authId, clientId, `h-${clientId}`, now);
  return { authId, clientId, sessionId: `s-${clientId}` };
}

async function linkedAgent(t: TestOffice, ownerId = 'usr_002') {
  const client = await approvedClient(t, ownerId);
  const deps = t.deps as unknown as Deps;
  const made = await ensureAgentUser(deps, { ownerId, clientId: client.clientId, data: liteData(deps) });
  return { ...client, agentId: made.agentUserId };
}

const officeOf = (t: TestOffice) => () => t.db.tx('read', (q) => readLiteOffice(t.db, q));

describe('the agent rows on SQLite (Supabase exit, wave 2)', () => {
  it('links an approved client to a new agent user of the person', async () => {
    const t = await signinOffice();
    const { agentId, clientId } = await linkedAgent(t);
    expect((await officeOf(t)()).lists.users[agentId]).toMatchObject({ kind: 'agent', ownerId: 'usr_002', active: true });
    expect(t.raw.prepare('select owner_user_id, client_name, redirect_host from agent_links where client_id = ?').get(clientId)).toEqual({ owner_user_id: 'usr_002', client_name: 'Claude', redirect_host: 'claude.ai' });
  });

  it('refuses a client that the person did not approve in Madar, and makes no link', async () => {
    const t = await signinOffice();
    const { clientId } = await approvedClient(t);
    t.raw.exec('delete from agent_approvals');
    const deps = t.deps as unknown as Deps;
    await expect(ensureAgentUser(deps, { ownerId: 'usr_002', clientId, data: liteData(deps) })).rejects.toMatchObject({ details: { reason: 'agent_not_approved' } });
    expect(t.raw.prepare('select count(*) as n from agent_links').get()).toEqual({ n: 0 });
  });

  it('agents.list gives the agents of the person with their live clients, and nothing to another person', async () => {
    const t = await signinOffice();
    const { agentId, clientId } = await linkedAgent(t);
    expect(await t.call('usr_002', 'agents.list', {})).toMatchObject({ ok: true, output: [{ agentId, clientIds: [clientId], redirectHost: 'claude.ai', active: true }] });
    const other = await t.call('usr_003', 'agents.list', {});
    expect(other).toMatchObject({ ok: true, output: [] });
    expect(JSON.stringify(other)).not.toContain(clientId);
  });

  it('agents.remove ends the links and the agent sessions, and turns the agent off', async () => {
    const t = await signinOffice();
    const { agentId, sessionId } = await linkedAgent(t);
    expect(await t.call('usr_002', 'agents.remove', { agentId })).toMatchObject({ ok: true, output: { removed: true } });
    expect(t.raw.prepare('select revoked_at from agent_links').get()).toEqual({ revoked_at: '2026-10-17T06:00:00.000Z' });
    expect(t.raw.prepare('select revoked_at from auth_sessions where id = ?').get(sessionId)).toEqual({ revoked_at: '2026-10-17T06:00:00.000Z' });
    expect((await officeOf(t)()).lists.users[agentId].active).toBe(false);
  });

  it('agents.remove of the agent of another person is forbidden and changes nothing', async () => {
    const t = await signinOffice();
    const { agentId } = await linkedAgent(t);
    expect(await t.call('usr_003', 'agents.remove', { agentId })).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(t.raw.prepare('select count(*) as n from agent_links where revoked_at is null').get()).toEqual({ n: 1 });
  });

  it('users.deactivate revokes the agent links and sessions inside its own transaction', async () => {
    const t = await signinOffice();
    const { sessionId } = await linkedAgent(t);
    expect((await t.call('usr_001', 'users.deactivate', { id: 'usr_002' })).ok).toBe(true);
    expect(t.raw.prepare('select revoked_at is not null as gone from agent_links').get()).toEqual({ gone: 1 });
    expect(t.raw.prepare('select revoked_at is not null as gone from auth_sessions where id = ?').get(sessionId)).toEqual({ gone: 1 });
    expect(t.raw.prepare('select count(*) as n from agent_approvals').get()).toEqual({ n: 0 });
    expect(t.raw.prepare("select count(*) as n from outbox where kind = 'agents.revokeAll'").get()).toEqual({ n: 0 });
  });

  it('a refused turn-off revokes nothing', async () => {
    const t = await signinOffice();
    await linkedAgent(t);
    expect((await t.call('usr_005', 'users.deactivate', { id: 'usr_002' })).ok).toBe(false);
    expect(t.raw.prepare('select count(*) as n from agent_links where revoked_at is null').get()).toEqual({ n: 1 });
  });

  it('accepts a live agent session, and refuses a removed link, an ended session and a turned-off person', async () => {
    const t = await signinOffice();
    const { authId, clientId, sessionId, agentId } = await linkedAgent(t);
    const deps = t.deps as unknown as Deps;
    const token = { token: 'x', authUserId: authId, clientId, sessionId };
    expect(await liteAgentOf(deps, token, officeOf(t))).toMatchObject({ principal: { userId: agentId, agent: { clientId } }, ownerId: 'usr_002', linked: false });
    t.raw.prepare('update auth_sessions set revoked_at = ? where id = ?').run('2026-10-17T06:00:00.000Z', sessionId);
    await expect(liteAgentOf(deps, token, officeOf(t))).rejects.toMatchObject({ code: 'unauthenticated' });
    t.raw.prepare('update auth_sessions set revoked_at = null where id = ?').run(sessionId);
    t.raw.prepare('update agent_links set revoked_at = ?').run('2026-10-17T06:00:00.000Z');
    await expect(liteAgentOf(deps, token, officeOf(t))).rejects.toMatchObject({ message: expect.stringContaining('removed') });
  });

  it('links a new approval on the first call, and refuses it for a turned-off person', async () => {
    const t = await signinOffice();
    const { authId, clientId, sessionId } = await approvedClient(t);
    const deps = t.deps as unknown as Deps;
    expect(await liteAgentOf(deps, { token: 'x', authUserId: authId, clientId, sessionId }, officeOf(t))).toMatchObject({ ownerId: 'usr_002', linked: true });
    const second = await approvedClient(t, 'usr_007');
    expect((await t.call('usr_001', 'users.deactivate', { id: 'usr_007' })).ok).toBe(true);
    await expect(liteAgentOf(deps, { token: 'x', authUserId: second.authId, clientId: second.clientId, sessionId: second.sessionId }, officeOf(t))).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('counts the tool calls of a person and notes the last use of the link once a minute', async () => {
    const t = await signinOffice();
    const { clientId } = await linkedAgent(t);
    const deps = t.deps as unknown as Deps;
    const now = new Date('2026-10-17T06:00:30Z');
    expect(await sqlMcpLimit(deps, { ownerId: 'usr_002', clientId, now })).toEqual({ ok: true, count: 1, retryAfterMs: 30_000 });
    expect(t.raw.prepare('select last_used_at from agent_links').get()).toEqual({ last_used_at: '2026-10-17T06:00:30.000Z' });
  });

  it('records the Madar approval only for a pending authorization of the same person', async () => {
    const t = await signinOffice();
    const mine = await addSignIn(t, 'usr_002', { password: 'a good password' });
    const theirs = await addSignIn(t, 'usr_003', { password: 'a good password' });
    t.raw.prepare("insert into oauth_requests (id, client_id, redirect_uri, code_challenge, auth_id, expires_at) values ('req1', 'c1', ?, 'ch', ?, '2026-10-17T06:10:00.000Z')").run(CALLBACK, mine);
    const now = t.deps.clock.now();
    await expect(t.db.tx('write', (q) => recordApproval(q, { authorizationId: 'req1', authUserId: theirs, ownerId: 'usr_003', now }))).rejects.toMatchObject({ details: { reason: 'authorization_ended' } });
    expect(await t.db.tx('write', (q) => recordApproval(q, { authorizationId: 'req1', authUserId: mine, ownerId: 'usr_002', now }))).toEqual({ clientId: 'c1' });
    t.raw.exec("insert into agent_links (client_id, owner_user_id, agent_user_id, client_name, redirect_host, revoked_at) values ('c1', 'usr_002', 'usr_009', 'Claude', 'claude.ai', '2026-10-17T05:00:00.000Z')");
    await expect(t.db.tx('write', (q) => recordApproval(q, { authorizationId: 'req1', authUserId: mine, ownerId: 'usr_002', now }))).rejects.toMatchObject({ details: { reason: 'agent_removed' } });
  });
});
```

Change the test of `server/test/liteHarness.test.ts` from Task 7 to the full rule:

```ts
  it('lists no call and no kind of wave 2 as one with no SQLite form', () => {
    expect([...LATER_CALLS]).toEqual(['usage.get', 'usage.retryEffect']);
    expect([...LATER_KINDS]).toEqual([]);
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run --project server server/mcp/agents.lite.test.ts server/test/liteHarness.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL with "Failed to load url ./oauth/agent", and the harness test finds `agents.revokeAll`.

- [ ] **Step 3: Give a server call the data of its runCall**

In `server/core/types.ts`, add `import type { CallData } from './runCall';` and the field:

```ts
/** data: the CallData of the runCall that runs the call (sqlData or liteData), for a server write that saves (agents.remove). */
export type ServerCallCtx = { deps: Deps; principal: Principal; office: OfficeSnapshot; batch: BatchScope; story?: StoryRef; key?: string; now: Date; data?: CallData };
```

In `server/core/runCall.ts`, line 120 to 122:

```ts
    const result = await entry.call(parsed, {
      deps, principal: req.principal, office, batch: req.batch, now, data, ...(req.story ? { story: req.story } : {}), ...(req.key ? { key: req.key } : {}),
    });
```

- [ ] **Step 4: The twins of agents.ts**

```ts
/** The SQLite forms (Supabase exit, wave 2). No order by: agentsList sorts in JavaScript. The agent sessions end with the links. */
export const AGENT_LINKS_LITE = 'select client_id, agent_user_id, redirect_host, approved_at, last_used_at, revoked_at from agent_links where owner_user_id = ?1';
export const REVOKE_AGENT_LITE = 'update agent_links set revoked_at = ?2 where agent_user_id = ?1 and revoked_at is null';
export const END_AGENT_SESSIONS_LITE =
  'update auth_sessions set revoked_at = ?2 where revoked_at is null and client_id in (select client_id from agent_links where agent_user_id = ?1)';
```

In `agentsList`, read and sort:

```ts
  const rows = agents.length === 0 ? [] : (await ctx.deps.db.tx('read', (q) => q<LinkRow>(sqlFor(q, AGENT_LINKS_SQL, AGENT_LINKS_LITE), [owner.id])))
    .sort((a, b) => time(a.approved_at) - time(b.approved_at) || a.client_id.localeCompare(b.client_id));
```

In `createAgentsRemove`, take the data of the call, and end the sessions on SQLite:

```ts
    const done = await (o.data ? o.data(deps) : ctx.data ?? sqlAgentsData(deps)).tx('write', async (t) => {
```

```ts
      const story = await resolveStory(t.stories, ctx.story, ctx.batch.storyRefs, actorId, now);
      if (isLite(t.q)) {
        await t.q(END_AGENT_SESSIONS_LITE, [agent.id, now.toISOString()]);
        await t.q(REVOKE_AGENT_LITE, [agent.id, now.toISOString()]);
      } else {
        await t.q(REVOKE_AGENT_SQL, [agent.id]);
      }
```

Imports: `import { isLite, sqlFor } from '../data/dialect';`.

- [ ] **Step 5: agents.revokeAll inside the call transaction on SQLite**

In `server/mcp/revokeAll.ts`, add after `REVOKE_ALL_SQL`:

```ts
const STAMP = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
/**
 * The SQLite forms (Supabase exit, wave 2). They run inside the transaction of the call that turns the user off: the agent sessions,
 * the links and the approvals end with its commit, a rollback keeps them, and no outbox row waits for the job.
 */
export const REVOKE_ALL_LITE = [
  `update auth_sessions set revoked_at = ${STAMP} where revoked_at is null and client_id in (select client_id from agent_links where owner_user_id = ?1 or agent_user_id = ?1)`,
  `update agent_links set revoked_at = ${STAMP} where revoked_at is null and (owner_user_id = ?1 or agent_user_id = ?1)`,
  'delete from agent_approvals where owner_user_id = ?1',
] as const;

export async function revokeAllIn(q: Query, userId: string): Promise<void> {
  for (const text of REVOKE_ALL_LITE) await q(text, [userId]);
}
```

Replace the loop at the end (lines 71 to 73):

```ts
for (const name of ['users.deactivate', 'events.undo', 'events.undoStory'] as const) {
  registerOutbox(name, async (output, _saved, q) => {
    const rows = revokeAllRowsOf(name, output);
    if (!isLite(q)) return rows;
    for (const row of rows) await revokeAllIn(q, String(row.payload.userId));
    return [];
  });
}
```

Imports: `import type { Deps, Query } from '../core/ports';` and `import { isLite } from '../data/dialect';`.

- [ ] **Step 6: The twins of agentUser.ts and approval.ts**

In `server/mcp/approval.ts`, add the twins and change `recordApproval`:

```ts
/** The SQLite forms (Supabase exit, wave 2): the pending authorization is a row of oauth_requests, bound to the person who opened it. */
export const AUTHORIZATION_LITE = "select client_id from oauth_requests where id = ?1 and auth_id = ?2 and status = 'pending' and expires_at > ?3";
export const APPROVAL_INSERT_LITE = 'insert into agent_approvals (client_id, owner_user_id, approved_at) values (?1, ?2, ?3) on conflict (client_id, owner_user_id) do nothing';
export const REMOVED_LINK_LITE = 'select 1 as removed from agent_links where client_id = ?1 and owner_user_id = ?2 and revoked_at is not null';
export const APPROVAL_LITE = 'select 1 as approved from agent_approvals where client_id = ?1 and owner_user_id = ?2';

export async function recordApproval(q: Query, o: { authorizationId: string; authUserId: string; ownerId: string; now?: Date }): Promise<{ clientId: string }> {
  const lite = isLite(q);
  const now = (o.now ?? new Date()).toISOString();
  const [row] = lite
    ? await q<{ client_id: string | null }>(AUTHORIZATION_LITE, [o.authorizationId, o.authUserId, now])
    : await q<{ client_id: string | null }>(AUTHORIZATION_SQL, [o.authorizationId, o.authUserId]);
  const clientId = row?.client_id ?? null;
  if (clientId === null) {
    throw invalid('authorizationId', 'This approval request ended. Start the connection again in your AI app.', 'authorization_ended');
  }
  const [removed] = await q(lite ? REMOVED_LINK_LITE : REMOVED_LINK_SQL, [clientId, o.ownerId]);
  if (removed) {
    throw new ApiError('forbidden', 'You removed this AI app in Madar. In the AI app, remove the Madar connection and add it again.', { reason: 'agent_removed' });
  }
  if (lite) await q(APPROVAL_INSERT_LITE, [clientId, o.ownerId, now]);
  else await q(APPROVAL_INSERT_SQL, [clientId, o.ownerId]);
  return { clientId };
}
```

In `server/mcp/agentUser.ts`, add after `LINK_INSERT_SQL`:

```ts
/** The SQLite forms (Supabase exit, wave 2): the client is a row of oauth_clients, its redirect addresses a JSON list. */
export const LINK_LITE = 'select agent_user_id, revoked_at from agent_links where client_id = ?1';
export const CLIENT_LITE = 'select name as client_name, redirect_uris from oauth_clients where id = ?1';
export const SAME_APP_LITE =
  'select l.agent_user_id as agent_user_id, l.approved_at as approved_at, c.redirect_uris as redirect_uris from agent_links l join oauth_clients c on c.id = l.client_id ' +
  'where l.owner_user_id = ?1 and l.client_name = ?2 and l.redirect_host = ?3';
export const LINK_INSERT_LITE =
  'insert into agent_links (client_id, owner_user_id, agent_user_id, client_name, redirect_host, approved_at) values (?1, ?2, ?3, ?4, ?5, ?6) on conflict (client_id) do nothing';

/** The redirect addresses as one text with commas, as Supabase keeps them, for redirectHostOf and redirectSetOf. */
function urisText(value: string, lite: boolean): string {
  return lite ? (JSON.parse(value) as string[]).join(',') : value;
}
```

In `ensureAgentUser`, after the lock: `const lite = isLite(t.q);`, then read with the twins:

```ts
    const [link] = await t.q<{ agent_user_id: string; revoked_at: Date | string | null }>(lite ? LINK_LITE : LINK_SQL, [o.clientId]);
```

```ts
    const [approval] = await t.q(lite ? APPROVAL_LITE : APPROVAL_SQL, [o.clientId, o.ownerId]);
```

```ts
    const [client] = await t.q<{ client_name: string | null; redirect_uris: string }>(lite ? CLIENT_LITE : CLIENT_SQL, [o.clientId]);
    if (!client) throw signInAgain('Madar does not know this AI app. Connect it again in your AI app.');
    const uris = urisText(client.redirect_uris, lite);
    const name = agentNameOf(client.client_name);
    const host = redirectHostOf(uris);
```

```ts
    const addresses = redirectSetOf(uris);
    const found = await t.q<{ agent_user_id: string; redirect_uris: string; approved_at?: string }>(lite ? SAME_APP_LITE : SAME_APP_SQL, [owner.id, name, host]);
    // The newest link first, in JavaScript on SQLite (wave 0 rule); Postgres gives that order already.
    const earlier = lite ? [...found].sort((a, b) => String(b.approved_at).localeCompare(String(a.approved_at))) : found;
    let agentUserId = earlier.filter((row) => redirectSetOf(urisText(row.redirect_uris, lite)) === addresses).map((row) => row.agent_user_id).find((id) => {
```

```ts
    if (lite) await t.q(LINK_INSERT_LITE, [o.clientId, owner.id, agentUserId, name, host, deps.clock.now().toISOString()]);
    else await t.q(LINK_INSERT_SQL, [o.clientId, owner.id, agentUserId, name, host]);
```

Imports: `import { isLite } from '../data/dialect';` and `APPROVAL_LITE` from `./approval`.

- [ ] **Step 7: The agent check and the tool limit on SQLite**

In `server/mcp/auth.ts`, add after `AGENT_SQL`:

```ts
/**
 * The SQLite form (Supabase exit, wave 2). The session is a row of auth_sessions: ok checks the session, its client, the ban and the
 * person of the session; the resolver checks that the person and the agent are on, from the office in memory (no row read).
 */
export const AGENT_LITE = [
  'select l.agent_user_id as agent_user_id, l.owner_user_id as owner_user_id, l.revoked_at as revoked_at,',
  ' case when s.revoked_at is null and s.expires_at > ?3 then s.created_at end as session_at,',
  ' case when s.revoked_at is null and s.expires_at > ?3 and s.client_id = ?2 and a.banned = 0 and a.user_id = l.owner_user_id and l.revoked_at is null then 1 else 0 end as ok',
  ' from (select 1) as one left join auth_sessions s on s.id = ?1 left join auth_users a on a.id = s.auth_id left join agent_links l on l.client_id = ?2',
].join('');
```

Change `agentPrincipalResolver`:

```ts
export function agentPrincipalResolver(o: { query: AgentQuery; office: () => Promise<OfficeSnapshot>; ensure: EnsureAgent; lite?: { now: () => Date } }) {
  const read = async (token: AgentToken): Promise<AgentRow> => {
    const [row] = o.lite
      ? await o.query<AgentRow>(AGENT_LITE, [token.sessionId, token.clientId, o.lite.now().toISOString()])
      : await o.query<AgentRow>(AGENT_SQL, [token.sessionId, token.clientId]);
    if (!row) throw new Error('The agent check gave no row.');
    return { ...row, ok: Boolean(row.ok) };
  };
```

and the live-link branch:

```ts
    if (row.agent_user_id !== null) {
      if (row.revoked_at !== null) throw signInAgain('This agent was removed in Madar. Connect it again in your AI app.');
      // Postgres: agent_session_ok checked that the person and the agent are on. The path of today stays as it is.
      if (row.ok && !o.lite) return principalOf(row, token, false);
      const office = await o.office();
      const owner = office.lists.users[row.owner_user_id ?? ''];
      const agent = office.lists.users[row.agent_user_id ?? ''];
      // SQLite checks it here, on the office in memory, with no row read.
      if (row.ok && owner?.active && agent?.active) return principalOf(row, token, false);
      if (!owner?.active || !agent?.active) throw accountOff();
      throw signInAgain('This connection belongs to another Madar person.');
    }
```

Create `server/mcp/oauth/agent.ts`:

```ts
import type { Deps } from '../../core/ports';
import type { OfficeSnapshot } from '../../core/types';
import { liteData } from '../../data/lite/callData';
import { ensureAgentUser } from '../agentUser';
import { agentPrincipalResolver, type AgentPrincipal, type AgentToken } from '../auth';

/**
 * The agent of a token on the SQLite path (Supabase exit, wave 2): the agent check of auth.ts with AGENT_LITE, and ensureAgentUser on
 * liteData. The MCP host of the office object passes it as McpAppOptions.agentOf (wave 3).
 */
export function liteAgentOf(deps: Deps, token: AgentToken, office: () => Promise<OfficeSnapshot>): Promise<AgentPrincipal> {
  return agentPrincipalResolver({
    query: (text, values) => deps.db.statement('read', text, values),
    office,
    ensure: async (o) => void (await ensureAgentUser(deps, { ...o, data: liteData(deps) })),
    lite: { now: () => deps.clock.now() },
  })(token);
}
```

In `server/mcp/app.ts`, add the twin and the SQLite branch of the limit:

```ts
/** The SQLite form of the last use (Supabase exit, wave 2): ?1 client, ?2 now, ?3 one minute before now. */
export const MCP_SEEN_LITE = 'update agent_links set last_used_at = ?2 where client_id = ?1 and (last_used_at is null or last_used_at < ?3)';

export const sqlMcpLimit: McpLimit = async (deps, o) => {
  const start = Math.floor(o.now.getTime() / MINUTE_MS) * MINUTE_MS;
  let count: number;
  if (isLite(deps.db)) {
    count = await deps.db.tx('write', async (q) => {
      await q(MCP_SEEN_LITE, [o.clientId, o.now.toISOString(), new Date(o.now.getTime() - MINUTE_MS).toISOString()]);
      const [row] = await q<{ count: number }>(RATE_LITE, [`mcp:${o.ownerId}`, new Date(start).toISOString()]);
      return Number(row?.count ?? 0);
    });
  } else {
    const [row] = await deps.db.statement<{ count: number | string }>('write', MCP_LIMIT_SQL, [`mcp:${o.ownerId}`, new Date(start).toISOString(), o.clientId]);
    count = Number(row?.count ?? 0);
  }
  return { ok: count <= TOOL_CALLS_PER_MINUTE, count, retryAfterMs: start + MINUTE_MS - o.now.getTime() };
};
```

Imports: `RATE_LITE` from `../auth/rateLimit` and `isLite` from `../data/dialect`. Empty `LATER_KINDS` in `server/test/liteHarness.ts`:

```ts
/** The effect kinds that have no SQLite form yet: none since wave 2. A new kind with no SQLite form fails test:lite. */
export const LATER_KINDS: ReadonlySet<string> = new Set();
```

- [ ] **Step 8: Run the tests to see them pass**

Run: `npx vitest run --project server server/mcp server/calls/agents.test.ts server/test/liteHarness.test.ts server/workerGraph.test.ts --no-file-parallelism --testTimeout=60000`
Expected: PASS. The Postgres tests of `server/mcp` keep their texts. `server/mcp/oauth/agent.ts` is not in a Deno graph: only
tests and the hosts of wave 3 import it.

- [ ] **Step 9: Run test:lite and the types**

Run: `npm run test:lite` and `npm run typecheck`
Expected: 81 files passed; 1,141 passed, 25 skipped; no line of the fakes with "Give the caller a SQLite form" other than
`usage.get` and `usage.retryEffect`. No type error.

- [ ] **Step 10: Commit**

```bash
git add server/core/types.ts server/core/runCall.ts server/calls/agents.ts server/mcp/revokeAll.ts server/mcp/agentUser.ts server/mcp/approval.ts server/mcp/auth.ts server/mcp/app.ts server/mcp/oauth/agent.ts server/mcp/agents.lite.test.ts server/test/liteHarness.ts server/test/liteHarness.test.ts
git commit -m "Exit wave 2: the agent rows on SQLite, and a turn-off revokes the agents inside its own transaction"
```

---

# Block C: the own sign-in (Tasks 11 to 16, 2 days)

Each operation of this block runs in the office object (wave 3 calls it through `SigninOffice`; until then, tests call it on
node:sqlite and on local workerd). The shape of each one: the crypto first (hash keys, PBKDF2, random tokens), then one write
transaction with only SQL inside, then the token signature after the commit. No await on `crypto.subtle` inside a transaction.

### Task 11: The password sign-in, its limits and the same answer

**Files:**
- Create: `server/auth/own/types.ts`, `server/auth/own/limits.ts`, `server/auth/own/sessions.ts`, `server/auth/own/ops.ts`
- Modify: `server/auth/own/testOffice.ts` (add `signinDepsOf`)
- Test: `server/auth/own/ops.signin.test.ts`

**Interfaces:**
- Consumes: `verifyPassword`, `hashPassword` (Task 2); `signBrowserToken`, `SigningKeys` (Task 3); `AUTH_USER_*`,
  `SESSION_INSERT` (Task 5); `hitLimit`, `hashedKey` (`rateLimit.ts`); `principalOf` (`principal.ts`); `readLiteOffice`.
- Produces: `type SigninDeps = Pick<Deps, 'db' | 'clock' | 'log' | 'config'> & { keys: SigningKeys }`;
  `type TokenAnswer = { access_token: string; token_type: 'bearer'; expires_in: number; refresh_token: string; user: { id: string } }`;
  `class OAuthError(status, code, message)`; the limit numbers; `SESSION_DAYS = 30`; `REFRESH_REUSE_MS = 10_000`;
  `sessionEnded(): ApiError`; `insertSession(q, o): Promise<string>`; `browserAnswer(deps, o): Promise<TokenAnswer>`;
  `countLimits(deps, keys): Promise<void>`; `passwordSignIn(deps, { email, password, address }): Promise<TokenAnswer>`;
  `signinDepsOf(t: TestOffice): Promise<SigninDeps>`.

- [ ] **Step 1: Write the failing tests**

```ts
// server/auth/own/ops.signin.test.ts
import { decodeJwt } from 'jose';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from './crypto';
import { passwordSignIn } from './ops';
import { addSignIn, signinDepsOf, signinOffice } from './testOffice';

const ADDRESS = '203.0.113.7';

async function setup(password = 'a good password') {
  const t = await signinOffice();
  const authId = await addSignIn(t, 'usr_002', { password });
  const email = (t.raw.prepare('select email from auth_users where id = ?').get(authId) as { email: string }).email;
  return { t, authId, email, deps: await signinDepsOf(t) };
}

const errorOf = async (work: Promise<unknown>) => {
  try {
    await work;
  } catch (error) {
    const e = error as { code: string; message: string; details: Record<string, unknown> };
    return { code: e.code, message: e.message, reason: e.details.reason };
  }
  throw new Error('The step did not fail.');
};

describe('the password sign-in of the own stack (server/auth/own/ops.ts)', () => {
  it('gives a browser token of 15 minutes and a refresh token, and keeps only the sha256 of the refresh token', async () => {
    const { t, authId, email, deps } = await setup();
    const answer = await passwordSignIn(deps, { email: email.toUpperCase(), password: 'a good password', address: ADDRESS });
    expect(answer).toMatchObject({ token_type: 'bearer', expires_in: 900, user: { id: authId } });
    const claims = decodeJwt(answer.access_token);
    expect(claims).toMatchObject({ sub: authId, aud: 'authenticated', role: 'authenticated', iss: 'http://127.0.0.1:54321/functions/v1/mcp' });
    expect((claims.exp as number) - (claims.iat as number)).toBe(900);
    expect(t.raw.prepare('select id, auth_id, client_id, amr, refresh_hash, expires_at from auth_sessions').all()).toEqual([
      { id: claims.session_id, auth_id: authId, client_id: null, amr: 'password', refresh_hash: await sha256Hex(answer.refresh_token), expires_at: '2026-11-16T06:00:00.000Z' },
    ]);
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const { email, deps } = await setup();
    const wrong = await errorOf(passwordSignIn(deps, { email, password: 'not it', address: ADDRESS }));
    const unknown = await errorOf(passwordSignIn(deps, { email: 'nobody@madar.test', password: 'not it', address: ADDRESS }));
    expect(wrong).toEqual(unknown);
    expect(wrong).toEqual({ code: 'unauthenticated', message: 'The email or the password is not right.', reason: 'invalid_credentials' });
  });

  it('gives the same answer for a person with no password yet', async () => {
    const t = await signinOffice();
    await addSignIn(t, 'usr_004');
    const email = (t.raw.prepare('select email from auth_users').get() as { email: string }).email;
    expect(await errorOf(passwordSignIn(await signinDepsOf(t), { email, password: 'anything', address: ADDRESS }))).toMatchObject({ reason: 'invalid_credentials' });
  });

  it('marks the password as set on a sign-in, for users.invites', async () => {
    const { t, authId, email, deps } = await setup();
    t.raw.prepare('update auth_users set password_set = 0 where id = ?').run(authId);
    await passwordSignIn(deps, { email, password: 'a good password', address: ADDRESS });
    expect(t.raw.prepare('select password_set from auth_users where id = ?').get(authId)).toEqual({ password_set: 1 });
  });

  it('says account_off for a banned or turned-off person, but only after the right password', async () => {
    const { t, authId, email, deps } = await setup();
    t.raw.prepare('update auth_users set banned = 1 where id = ?').run(authId);
    expect(await errorOf(passwordSignIn(deps, { email, password: 'not it', address: ADDRESS }))).toMatchObject({ reason: 'invalid_credentials' });
    expect(await errorOf(passwordSignIn(deps, { email, password: 'a good password', address: ADDRESS }))).toMatchObject({ reason: 'account_off' });
    t.raw.prepare('update auth_users set banned = 0 where id = ?').run(authId);
    expect((await t.call('usr_001', 'users.deactivate', { id: 'usr_002' })).ok).toBe(true);
    t.raw.prepare('update auth_users set banned = 0 where id = ?').run(authId);
    expect(await errorOf(passwordSignIn(deps, { email, password: 'a good password', address: ADDRESS }))).toMatchObject({ reason: 'account_off' });
    expect(t.raw.prepare('select count(*) as n from auth_sessions').get()).toEqual({ n: 0 });
  });

  it('stops at 10 tries for one email in 15 minutes, and rate_limits holds no email', async () => {
    const { t, email, deps } = await setup();
    for (let i = 0; i < 10; i += 1) await errorOf(passwordSignIn(deps, { email, password: 'not it', address: `198.51.100.${i}` }));
    expect(await errorOf(passwordSignIn(deps, { email, password: 'a good password', address: ADDRESS }))).toMatchObject({ code: 'conflict', reason: 'too_many' });
    expect(JSON.stringify(t.raw.prepare('select key from rate_limits').all())).not.toContain(email);
  });

  it('stops at 30 tries for one network address in 15 minutes', async () => {
    const { deps } = await setup();
    for (let i = 0; i < 30; i += 1) await errorOf(passwordSignIn(deps, { email: `p${i}@madar.test`, password: 'x', address: ADDRESS }));
    expect(await errorOf(passwordSignIn(deps, { email: 'p31@madar.test', password: 'x', address: ADDRESS }))).toMatchObject({ reason: 'too_many' });
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run --project server server/auth/own/ops.signin.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL with "Failed to load url ./ops".

- [ ] **Step 3: Write the shared types, the limits and the sessions**

```ts
// server/auth/own/types.ts
import type { Deps } from '../../core/ports';
import type { SigningKeys } from './keys';

/** The deps of a sign-in step in the office object (Supabase exit, wave 2): the SQLite Db, the clock, the log, and the keys. */
export type SigninDeps = Pick<Deps, 'db' | 'clock' | 'log' | 'config'> & { keys: SigningKeys };

/** The answer of a browser sign-in: the shape of the Supabase token answer, so the screens port stays small. */
export type TokenAnswer = { access_token: string; token_type: 'bearer'; expires_in: number; refresh_token: string; user: { id: string } };

/** An OAuth refusal (RFC 6749, section 5.2). The OAuth routes answer it as { error, error_description } with its status. */
export class OAuthError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = 'OAuthError';
  }
}
```

```ts
// server/auth/own/limits.ts
/**
 * The sign-in limits of the own stack (Supabase exit, wave 2), in rate_limits like the limits of forgot.ts. Each key holds only a
 * sha256 of its email or network address (hashedKey). The address is the one of clientAddress (forgot.ts), which the Worker route
 * reads and passes in.
 */
const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const SIGNIN_WINDOW_MS = 15 * MINUTE_MS;
/** Password sign-ins for one email in 15 minutes: a person who forgot the password tries a few times; a guesser stops at 10. */
export const SIGNIN_PER_EMAIL = 10;
/** For one network address in 15 minutes: the whole office (about 15 people) can sit behind one address. */
export const SIGNIN_PER_ADDRESS = 30;
/** Link opens (Welcome and Reset) for one address in one hour. */
export const VERIFY_PER_ADDRESS = 20;
/** OAuth client registrations for one address in one hour: each one writes rows of the Free day limit. */
export const REGISTER_PER_ADDRESS = 10;
```

```ts
// server/auth/own/sessions.ts
import { ApiError } from '../../../src/api/errors';
import type { Query } from '../../core/ports';
import { ACCESS_TTL_S } from '../ownKeys';
import { hitLimit } from '../rateLimit';
import { signBrowserToken } from './keys';
import { SESSION_INSERT, type Amr } from './rows';
import type { SigninDeps, TokenAnswer } from './types';

/** A session lives 30 days after its last refresh. */
export const SESSION_DAYS = 30;
/** A second use of the old refresh token within 10 s rotates again (refresh_token_reuse_interval = 10 of supabase/config.toml). */
export const REFRESH_REUSE_MS = 10_000;
export const DAY_MS = 24 * 60 * 60 * 1000;

export function sessionEnded(): ApiError {
  return new ApiError('unauthenticated', 'This sign-in ended. Sign in again.', { reason: 'session_ended' });
}

export function tooMany(retryAfterMs: number): ApiError {
  return new ApiError('conflict', 'Too many tries. Wait a few minutes, then try again.', { reason: 'too_many', retryAfterMs });
}

/** Counts one hit of each key in one transaction; the first key over its limit refuses the step. The keys are hashed before. */
export async function countLimits(deps: SigninDeps, keys: { key: string; limit: number; windowMs: number }[]): Promise<void> {
  const now = deps.clock.now();
  const over = await deps.db.tx('write', async (q) => {
    for (const one of keys) {
      const hit = await hitLimit(q, { ...one, now });
      if (!hit.ok) return hit;
    }
    return null;
  });
  if (over) throw tooMany(over.retryAfterMs);
}

/** A new session row, inside the write transaction of a step. The refresh hash comes from before the transaction. */
export async function insertSession(q: Query, o: { authId: string; clientId: string | null; amr: Amr; refreshHash: string; linkUntil: Date | null; now: Date }): Promise<string> {
  const id = crypto.randomUUID();
  await q(SESSION_INSERT, [id, o.authId, o.clientId, o.amr, o.refreshHash, o.linkUntil?.toISOString() ?? null, new Date(o.now.getTime() + SESSION_DAYS * DAY_MS).toISOString(), o.now.toISOString()]);
  return id;
}

/** The token answer of a browser session, signed after the commit. */
export async function browserAnswer(deps: SigninDeps, o: { authId: string; sessionId: string; refresh: string }): Promise<TokenAnswer> {
  const accessToken = await signBrowserToken(deps.keys, { authId: o.authId, sessionId: o.sessionId, now: deps.clock.now() });
  return { access_token: accessToken, token_type: 'bearer', expires_in: ACCESS_TTL_S, refresh_token: o.refresh, user: { id: o.authId } };
}
```

- [ ] **Step 4: Write the password sign-in**

```ts
// server/auth/own/ops.ts
import { ApiError } from '../../../src/api/errors';
import { readLiteOffice } from '../../data/lite/office';
import type { LiteDb } from '../../data/lite/db';
import { principalOf } from '../principal';
import { hashedKey } from '../rateLimit';
import { randomToken, sha256Hex } from './crypto';
import { SIGNIN_PER_ADDRESS, SIGNIN_PER_EMAIL, SIGNIN_WINDOW_MS } from './limits';
import { hashPassword, verifyPassword } from './password';
import { AUTH_USER_BY_EMAIL, AUTH_USER_BY_ID, AUTH_USER_SIGNED_IN, type AuthUserRow } from './rows';
import { browserAnswer, countLimits, insertSession } from './sessions';
import type { SigninDeps, TokenAnswer } from './types';

/**
 * The browser sign-in steps of the own stack (Supabase exit, wave 2). They run in the office object and do no network work.
 * Every step: the crypto first, then one write transaction with SQL only, then the token after the commit.
 */

export function wrongCredentials(): ApiError {
  return new ApiError('unauthenticated', 'The email or the password is not right.', { reason: 'invalid_credentials' });
}

export function accountOff(): ApiError {
  return new ApiError('unauthenticated', 'This account is turned off in Madar.', { reason: 'account_off' });
}

const liteOf = (deps: SigninDeps) => deps.db as LiteDb;

/**
 * POST /api/auth/token { grant_type: 'password' }. A wrong password, an unknown email and a row with no password give one answer,
 * in about the same time (one PBKDF2 each). A ban or a turn-off shows only after the right password.
 */
export async function passwordSignIn(deps: SigninDeps, input: { email: string; password: string; address: string }): Promise<TokenAnswer> {
  const email = input.email.trim().toLowerCase();
  await countLimits(deps, [
    { key: await hashedKey('signin:ip', input.address), limit: SIGNIN_PER_ADDRESS, windowMs: SIGNIN_WINDOW_MS },
    { key: await hashedKey('signin:email', email), limit: SIGNIN_PER_EMAIL, windowMs: SIGNIN_WINDOW_MS },
  ]);
  const [found] = await deps.db.statement<AuthUserRow>('read', AUTH_USER_BY_EMAIL, [email]);
  const check = await verifyPassword(input.password, found?.password_hash ?? null);
  if (!found || !check.ok) throw wrongCredentials();
  const upgraded = check.upgrade ? await hashPassword(input.password) : null;
  const refresh = randomToken();
  const refreshHash = await sha256Hex(refresh);
  const now = deps.clock.now();
  const sessionId = await deps.db.tx('write', async (q) => {
    const [row] = await q<AuthUserRow>(AUTH_USER_BY_ID, [found.id]);
    // A new password or a ban between the check and this transaction: the check is old, so refuse it.
    if (!row || row.password_hash !== found.password_hash) throw wrongCredentials();
    if (row.banned === 1) throw accountOff();
    principalOf(row.id, await readLiteOffice(liteOf(deps), q));
    await q(AUTH_USER_SIGNED_IN, [row.id, upgraded, now.toISOString()]);
    return insertSession(q, { authId: row.id, clientId: null, amr: 'password', refreshHash, linkUntil: null, now });
  });
  return browserAnswer(deps, { authId: found.id, sessionId, refresh });
}
```

Add to `server/auth/own/testOffice.ts`:

```ts
/** The deps of the sign-in steps on the test office, with a new test key. */
export async function signinDepsOf(t: TestOffice): Promise<SigninDeps> {
  return { db: t.db, clock: t.deps.clock, log: t.deps.log, config: t.deps.config, keys: await signingKeysOf(await testPrivateJwk(), t.deps.config.mcpUrl) };
}
```

with the imports `signingKeysOf` from `./keys`, `testPrivateJwk` from `./testKeys` and `type SigninDeps` from `./types`.

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run --project server server/auth/own/ops.signin.test.ts server/workerGraph.test.ts --no-file-parallelism --testTimeout=60000`
Expected: PASS, 7 tests (about 50 PBKDF2 runs: under 10 s).

- [ ] **Step 6: Commit**

```bash
git add server/auth/own/types.ts server/auth/own/limits.ts server/auth/own/sessions.ts server/auth/own/ops.ts server/auth/own/testOffice.ts server/auth/own/ops.signin.test.ts
git commit -m "Exit wave 2: the password sign-in in the office object, with its limits and one answer for every wrong try"
```

### Task 12: Sessions: the refresh with rotation, and the sign-out

**Files:**
- Modify: `server/auth/own/rows.ts` (add `SESSION_END_OWN`, `AGENT_LINK_STATE`)
- Modify: `server/auth/own/sessions.ts` (add `rotateSession`)
- Modify: `server/auth/own/ops.ts` (add `refreshSignIn`, `signOutSessions`)
- Test: `server/auth/own/ops.sessions.test.ts`

**Interfaces:**
- Consumes: the rows of Task 5; `userIdOfAuth`; `principalOf`.
- Produces: `rotateSession(deps, { hash, nextHash, clientId: string | null }): Promise<SessionRow>`;
  `refreshSignIn(deps, { refreshToken }): Promise<TokenAnswer>`;
  `signOutSessions(deps, { authId, sessionId, scope: 'local' | 'others' }): Promise<{ ok: true }>`.

- [ ] **Step 1: Write the failing tests**

```ts
// server/auth/own/ops.sessions.test.ts
import { decodeJwt } from 'jose';
import { describe, expect, it } from 'vitest';
import { passwordSignIn, refreshSignIn, signOutSessions } from './ops';
import { addSignIn, signinDepsOf, signinOffice } from './testOffice';

async function signedIn() {
  const t = await signinOffice();
  const authId = await addSignIn(t, 'usr_002', { password: 'a good password' });
  const email = (t.raw.prepare('select email from auth_users where id = ?').get(authId) as { email: string }).email;
  const deps = await signinDepsOf(t);
  const first = await passwordSignIn(deps, { email, password: 'a good password', address: '203.0.113.7' });
  return { t, authId, email, deps, first, sessionId: String(decodeJwt(first.access_token).session_id) };
}

const reasonOf = (work: Promise<unknown>) => work.then(() => 'passed', (error: { details?: { reason?: string } }) => error.details?.reason ?? 'no reason');

describe('the sessions of the own stack (server/auth/own/sessions.ts)', () => {
  it('rotates the refresh token: the new one works, and the session stays the same', async () => {
    const { deps, first, sessionId } = await signedIn();
    const second = await refreshSignIn(deps, { refreshToken: first.refresh_token });
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect(decodeJwt(second.access_token).session_id).toBe(sessionId);
    expect(await refreshSignIn(deps, { refreshToken: second.refresh_token })).toMatchObject({ token_type: 'bearer' });
  });

  it('a second use of the old refresh token within 10 s rotates again, and signs nobody out', async () => {
    const { t, deps, first } = await signedIn();
    const second = await refreshSignIn(deps, { refreshToken: first.refresh_token });
    t.deps.clock.advance(5_000);
    const again = await refreshSignIn(deps, { refreshToken: first.refresh_token });
    expect(again.refresh_token).not.toBe(second.refresh_token);
    expect(await reasonOf(refreshSignIn(deps, { refreshToken: again.refresh_token }))).toBe('passed');
  });

  it('a use of an old refresh token after 10 s ends the whole session', async () => {
    const { t, deps, first } = await signedIn();
    const second = await refreshSignIn(deps, { refreshToken: first.refresh_token });
    t.deps.clock.advance(11_000);
    expect(await reasonOf(refreshSignIn(deps, { refreshToken: first.refresh_token }))).toBe('session_ended');
    expect(await reasonOf(refreshSignIn(deps, { refreshToken: second.refresh_token }))).toBe('session_ended');
  });

  it('refuses the refresh of a turned-off person, and of a banned one', async () => {
    const { t, authId, deps, first } = await signedIn();
    expect((await t.call('usr_001', 'users.deactivate', { id: 'usr_002' })).ok).toBe(true);
    t.raw.prepare('update auth_sessions set revoked_at = null').run();
    t.raw.prepare('update auth_users set banned = 0 where id = ?').run(authId);
    expect(await reasonOf(refreshSignIn(deps, { refreshToken: first.refresh_token }))).toBe('account_off');
    t.raw.prepare('update auth_users set banned = 1 where id = ?').run(authId);
    expect(await reasonOf(refreshSignIn(deps, { refreshToken: first.refresh_token }))).toBe('session_ended');
  });

  it('refuses an unknown token, an ended session and the refresh token of an agent session', async () => {
    const { t, authId, deps } = await signedIn();
    expect(await reasonOf(refreshSignIn(deps, { refreshToken: 'nothing' }))).toBe('session_ended');
    const { sha256Hex } = await import('./crypto');
    t.raw.prepare("insert into auth_sessions (id, auth_id, client_id, amr, refresh_hash, expires_at) values ('s-agent', ?, 'c1', 'oauth', ?, '2026-11-17T06:00:00.000Z')").run(authId, await sha256Hex('agent-refresh'));
    expect(await reasonOf(refreshSignIn(deps, { refreshToken: 'agent-refresh' }))).toBe('session_ended');
  });

  it('keeps a session 30 days after its last refresh', async () => {
    const { t, deps, first, sessionId } = await signedIn();
    t.deps.clock.advance(29 * 24 * 60 * 60 * 1000);
    const later = await refreshSignIn(deps, { refreshToken: first.refresh_token });
    expect(t.raw.prepare('select expires_at from auth_sessions where id = ?').get(sessionId)).toEqual({ expires_at: '2026-12-15T06:00:00.000Z' });
    t.deps.clock.advance(31 * 24 * 60 * 60 * 1000);
    expect(await reasonOf(refreshSignIn(deps, { refreshToken: later.refresh_token }))).toBe('session_ended');
  });

  it('signs out this device only, or every other device and agent', async () => {
    const { t, authId, email, deps, first, sessionId } = await signedIn();
    const phone = await passwordSignIn(deps, { email, password: 'a good password', address: '203.0.113.8' });
    t.raw.prepare("insert into auth_sessions (id, auth_id, client_id, amr, refresh_hash, expires_at) values ('s-agent', ?, 'c1', 'oauth', 'h', '2026-11-17T06:00:00.000Z')").run(authId);
    await signOutSessions(deps, { authId, sessionId, scope: 'others' });
    expect(await reasonOf(refreshSignIn(deps, { refreshToken: phone.refresh_token }))).toBe('session_ended');
    expect(t.raw.prepare("select revoked_at is not null as gone from auth_sessions where id = 's-agent'").get()).toEqual({ gone: 1 });
    const next = await refreshSignIn(deps, { refreshToken: first.refresh_token });
    await signOutSessions(deps, { authId, sessionId, scope: 'local' });
    expect(await reasonOf(refreshSignIn(deps, { refreshToken: next.refresh_token }))).toBe('session_ended');
  });

  it('never ends the session of another person', async () => {
    const { t, deps, first } = await signedIn();
    const other = await addSignIn(t, 'usr_003', { password: 'another password' });
    const sessionOfFirst = String(decodeJwt(first.access_token).session_id);
    await signOutSessions(deps, { authId: other, sessionId: sessionOfFirst, scope: 'local' });
    expect(await reasonOf(refreshSignIn(deps, { refreshToken: first.refresh_token }))).toBe('passed');
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run --project server server/auth/own/ops.sessions.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL with "refreshSignIn is not a function".

- [ ] **Step 3: Add the rows texts and the rotation**

In `server/auth/own/rows.ts`, add:

```ts
/** The sign-out of one device: only a session of the same person ends. */
export const SESSION_END_OWN = 'update auth_sessions set revoked_at = ?3 where id = ?1 and auth_id = ?2 and revoked_at is null';
/** Whether the agent link of a client is removed (a refresh of an agent session needs a live link). */
export const AGENT_LINK_STATE = 'select revoked_at from agent_links where client_id = ?1';
```

In `server/auth/own/sessions.ts`, add:

```ts
type Rotation = { kind: 'ok'; row: SessionRow } | { kind: 'ended' };

/**
 * One refresh with rotation (OAuth 2.1, section 4.3.1). The presented hash is the current refresh hash of a live session, or its
 * previous one within REFRESH_REUSE_MS (two tabs, or a lost answer): both rotate. The previous one after the window ends the whole
 * session, in a transaction that commits (a throw would roll the end back). clientId null is a browser session; a refresh of a
 * turned-off person throws account_off, and of a banned person, an agent whose link is removed or a turned-off owner, session_ended.
 */
export async function rotateSession(deps: SigninDeps, o: { hash: string; nextHash: string; clientId: string | null }): Promise<SessionRow> {
  const now = deps.clock.now();
  const out = await deps.db.tx('write', async (q): Promise<Rotation> => {
    let [row] = await q<SessionRow>(SESSION_BY_REFRESH, [o.hash]);
    if (!row) {
      const [old] = await q<SessionRow>(SESSION_BY_PREV, [o.hash]);
      if (!old) return { kind: 'ended' };
      const inWindow = old.rotated_at !== null && now.getTime() - Date.parse(old.rotated_at) <= REFRESH_REUSE_MS;
      if (!inWindow) {
        await q(SESSION_END, [old.id, now.toISOString()]);
        return { kind: 'ended' };
      }
      row = old;
    }
    if (row.revoked_at !== null || row.expires_at <= now.toISOString() || (row.client_id ?? null) !== o.clientId) return { kind: 'ended' };
    const [user] = await q<AuthUserRow>(AUTH_USER_BY_ID, [row.auth_id]);
    if (!user || user.banned === 1) return { kind: 'ended' };
    const office = await readLiteOffice(deps.db as LiteDb, q);
    if (o.clientId === null) {
      principalOf(row.auth_id, office);
    } else {
      const ownerId = userIdOfAuth(office, row.auth_id);
      const [link] = await q<{ revoked_at: string | null }>(AGENT_LINK_STATE, [o.clientId]);
      if (ownerId === undefined || office.lists.users[ownerId]?.active !== true || (link !== undefined && link.revoked_at !== null)) return { kind: 'ended' };
    }
    await q(SESSION_ROTATE, [row.id, o.nextHash, now.toISOString(), new Date(now.getTime() + SESSION_DAYS * DAY_MS).toISOString()]);
    return { kind: 'ok', row };
  });
  if (out.kind !== 'ok') throw sessionEnded();
  return out.row;
}
```

with the imports `readLiteOffice`, `type LiteDb`, `userIdOfAuth`, `principalOf`, and the rows texts `AGENT_LINK_STATE`,
`AUTH_USER_BY_ID`, `SESSION_BY_PREV`, `SESSION_BY_REFRESH`, `SESSION_END`, `SESSION_ROTATE`, `type AuthUserRow`,
`type SessionRow`.

- [ ] **Step 4: Add the two steps**

In `server/auth/own/ops.ts`:

```ts
/** POST /api/auth/token { grant_type: 'refresh_token' }: a browser session only (an agent refreshes at /mcp/oauth/token). */
export async function refreshSignIn(deps: SigninDeps, input: { refreshToken: string }): Promise<TokenAnswer> {
  const hash = await sha256Hex(input.refreshToken);
  const next = randomToken();
  const nextHash = await sha256Hex(next);
  const row = await rotateSession(deps, { hash, nextHash, clientId: null });
  return browserAnswer(deps, { authId: row.auth_id, sessionId: row.id, refresh: next });
}

/**
 * POST /api/auth/logout. local: this session. others: every other session of the person, agents too, as Supabase signOut
 * { scope: 'others' } did (Welcome and Reset call it after a new password).
 */
export async function signOutSessions(deps: SigninDeps, input: { authId: string; sessionId: string; scope: 'local' | 'others' }): Promise<{ ok: true }> {
  const now = deps.clock.now().toISOString();
  await deps.db.tx('write', (q) => input.scope === 'local'
    ? q(SESSION_END_OWN, [input.sessionId, input.authId, now])
    : q(SESSIONS_END_OTHERS, [input.authId, input.sessionId, now]));
  return { ok: true };
}
```

with `rotateSession` from `./sessions` and `SESSION_END_OWN`, `SESSIONS_END_OTHERS` from `./rows`.

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run --project server server/auth/own/ops.sessions.test.ts server/auth/own/ops.signin.test.ts --no-file-parallelism --testTimeout=60000`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/auth/own/rows.ts server/auth/own/sessions.ts server/auth/own/ops.ts server/auth/own/ops.sessions.test.ts
git commit -m "Exit wave 2: refresh tokens rotate with a 10 second reuse window, and the sign-out ends this device or the others"
```

### Task 13: Links and passwords: the Welcome and Reset steps, and the password change

**Files:**
- Modify: `server/auth/own/ops.ts` (add `verifySignInLink`, `setSignInPassword`)
- Test: `server/auth/own/ops.links.test.ts`

**Interfaces:**
- Consumes: `LINK_BY_HASH`, `LINKS_END`, `AUTH_USER_CONFIRM`, `AUTH_USER_PASSWORD`, `SESSION_BY_ID`, `SESSION_LINK_DONE` (Task 5);
  `LINK_LIFE_MS` (Task 5); `VERIFY_PER_ADDRESS`, `HOUR_MS` (Task 11); `PASSWORD_MIN`.
- Produces: `linkEnded(): ApiError`; `verifySignInLink(deps, { token, type, address }): Promise<TokenAnswer>`;
  `setSignInPassword(deps, { authId, sessionId, password, current? }): Promise<{ ok: true }>`. The refusal reasons the port maps:
  `link_ended`, `invalid_credentials`, `current_password_required`, `weak`, `same`, `session_ended`.

- [ ] **Step 1: Write the failing tests**

```ts
// server/auth/own/ops.links.test.ts
import { decodeJwt } from 'jose';
import { describe, expect, it } from 'vitest';
import { passwordSignIn, setSignInPassword, verifySignInLink } from './ops';
import { addSignIn, linkValueOfMail, signinDepsOf, signinOffice, type TestOffice } from './testOffice';

const ADDRESS = '203.0.113.7';
const NEW_PERSON = { name: 'New Person', email: 'new.person@madar.test', systemRole: 'member', discipline: 'Architect' };
const reasonOf = (work: Promise<unknown>) => work.then(() => 'passed', (error: { details?: { reason?: string } }) => error.details?.reason ?? 'no reason');

async function invitedPerson(t: TestOffice) {
  const userId = ((await t.call('usr_001', 'users.create', NEW_PERSON)) as { output: { id: string } }).output.id;
  return { userId, token: linkValueOfMail(t.deps.mail.sent.at(-1)!.html, 'token_hash') };
}

const sessionOf = (answer: { access_token: string }) => String(decodeJwt(answer.access_token).session_id);

describe('the Welcome and Reset steps of the own stack (server/auth/own/ops.ts)', () => {
  it('opens a link session once, confirms the email, and ends the other open links', async () => {
    const t = await signinOffice();
    const { userId, token } = await invitedPerson(t);
    const deps = await signinDepsOf(t);
    const answer = await verifySignInLink(deps, { token, type: 'invite', address: ADDRESS });
    expect(answer.token_type).toBe('bearer');
    expect(t.raw.prepare('select email_confirmed, user_id from auth_users').get()).toEqual({ email_confirmed: 1, user_id: userId });
    expect(t.raw.prepare('select amr, link_until from auth_sessions').get()).toEqual({ amr: 'link', link_until: '2026-10-17T07:00:00.000Z' });
    expect(t.raw.prepare('select count(*) as n from auth_links where used_at is null').get()).toEqual({ n: 0 });
  });

  it('refuses a used link, a link older than 1 hour, a link of the other type and a replaced link', async () => {
    const t = await signinOffice();
    const deps = await signinDepsOf(t);
    const { userId, token } = await invitedPerson(t);
    expect(await reasonOf(verifySignInLink(deps, { token, type: 'recovery', address: ADDRESS }))).toBe('link_ended');
    await verifySignInLink(deps, { token, type: 'invite', address: ADDRESS });
    expect(await reasonOf(verifySignInLink(deps, { token, type: 'invite', address: ADDRESS }))).toBe('link_ended');
    expect((await t.call('usr_001', 'users.resendInvite', { id: userId })).ok).toBe(true);
    const replaced = linkValueOfMail(t.deps.mail.sent.at(-1)!.html, 'token_hash');
    expect((await t.call('usr_001', 'users.resendInvite', { id: userId })).ok).toBe(true);
    expect(await reasonOf(verifySignInLink(deps, { token: replaced, type: 'recovery', address: ADDRESS }))).toBe('link_ended');
    const newest = linkValueOfMail(t.deps.mail.sent.at(-1)!.html, 'token_hash');
    t.deps.clock.advance(60 * 60 * 1000 + 1);
    expect(await reasonOf(verifySignInLink(deps, { token: newest, type: 'recovery', address: ADDRESS }))).toBe('link_ended');
    expect(t.raw.prepare('select count(*) as n from auth_sessions').get()).toEqual({ n: 1 });
  });

  it('refuses the link of a turned-off person, and keeps the link for later', async () => {
    const t = await signinOffice();
    const deps = await signinDepsOf(t);
    const { userId, token } = await invitedPerson(t);
    expect((await t.call('usr_001', 'users.deactivate', { id: userId })).ok).toBe(true);
    expect(await reasonOf(verifySignInLink(deps, { token, type: 'invite', address: ADDRESS }))).toBe('link_ended');
    expect(t.raw.prepare('select count(*) as n from auth_sessions').get()).toEqual({ n: 0 });
  });

  it('lets a link session set the first password once with no current password, and users.invites then says active', async () => {
    const t = await signinOffice();
    const deps = await signinDepsOf(t);
    const { userId, token } = await invitedPerson(t);
    const answer = await verifySignInLink(deps, { token, type: 'invite', address: ADDRESS });
    const authId = String(decodeJwt(answer.access_token).sub);
    expect(await setSignInPassword(deps, { authId, sessionId: sessionOf(answer), password: 'my new password' })).toEqual({ ok: true });
    const invites = (await t.call('usr_001', 'users.invites', {})) as { output: { userId: string; state: string }[] };
    expect(invites.output.find((row) => row.userId === userId)?.state).toBe('active');
    expect(await reasonOf(setSignInPassword(deps, { authId, sessionId: sessionOf(answer), password: 'another new one' }))).toBe('current_password_required');
    expect(await passwordSignIn(deps, { email: NEW_PERSON.email, password: 'my new password', address: ADDRESS })).toMatchObject({ token_type: 'bearer' });
  });

  it('runs the reset flow: the forgot mail, the link, a new password; the old password stops', async () => {
    const t = await signinOffice();
    const deps = await signinDepsOf(t);
    const authId = await addSignIn(t, 'usr_002', { password: 'the old password' });
    const email = (t.raw.prepare('select email from auth_users where id = ?').get(authId) as { email: string }).email;
    const link = await t.deps.authAdmin.generateLink('recovery', email);
    const answer = await verifySignInLink(deps, { token: link.tokenHash, type: 'recovery', address: ADDRESS });
    await setSignInPassword(deps, { authId, sessionId: sessionOf(answer), password: 'the new password' });
    expect(await reasonOf(passwordSignIn(deps, { email, password: 'the old password', address: ADDRESS }))).toBe('invalid_credentials');
    expect(await reasonOf(passwordSignIn(deps, { email, password: 'the new password', address: ADDRESS }))).toBe('passed');
  });

  it('needs the right current password in a normal session, refuses a short one and the same one', async () => {
    const t = await signinOffice();
    const deps = await signinDepsOf(t);
    const authId = await addSignIn(t, 'usr_002', { password: 'the old password' });
    const email = (t.raw.prepare('select email from auth_users where id = ?').get(authId) as { email: string }).email;
    const session = sessionOf(await passwordSignIn(deps, { email, password: 'the old password', address: ADDRESS }));
    expect(await reasonOf(setSignInPassword(deps, { authId, sessionId: session, password: 'the new password', current: 'wrong' }))).toBe('invalid_credentials');
    expect(await reasonOf(setSignInPassword(deps, { authId, sessionId: session, password: 'short', current: 'the old password' }))).toBe('weak');
    expect(await reasonOf(setSignInPassword(deps, { authId, sessionId: session, password: 'the old password', current: 'the old password' }))).toBe('same');
    expect(await setSignInPassword(deps, { authId, sessionId: session, password: 'the new password', current: 'the old password' })).toEqual({ ok: true });
  });

  it('refuses a session of another person and an ended session', async () => {
    const t = await signinOffice();
    const deps = await signinDepsOf(t);
    const mine = await addSignIn(t, 'usr_002', { password: 'the old password' });
    const theirs = await addSignIn(t, 'usr_003', { password: 'their password' });
    const email = (t.raw.prepare('select email from auth_users where id = ?').get(mine) as { email: string }).email;
    const session = sessionOf(await passwordSignIn(deps, { email, password: 'the old password', address: ADDRESS }));
    expect(await reasonOf(setSignInPassword(deps, { authId: theirs, sessionId: session, password: 'x'.repeat(12), current: 'their password' }))).toBe('session_ended');
    t.raw.prepare('update auth_sessions set revoked_at = ?').run('2026-10-17T06:00:00.000Z');
    expect(await reasonOf(setSignInPassword(deps, { authId: mine, sessionId: session, password: 'x'.repeat(12), current: 'the old password' }))).toBe('session_ended');
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run --project server server/auth/own/ops.links.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL with "verifySignInLink is not a function".

- [ ] **Step 3: Write the two steps**

Add to `server/auth/own/ops.ts`:

```ts
export function linkEnded(): ApiError {
  return new ApiError('unauthenticated', 'This link ended. Ask for a new one.', { reason: 'link_ended' });
}

/**
 * POST /api/auth/verify { token_hash, type } (the Welcome and Reset buttons). A link works once, for 1 hour, for its own type,
 * and only while it is the newest link of the person. It confirms the email, ends every open link of the person, and opens a
 * link session that may set a password for 1 hour with no current password (as the otp session of Supabase did). A link of a
 * turned-off or banned person ends nothing and opens nothing.
 */
export async function verifySignInLink(deps: SigninDeps, input: { token: string; type: 'invite' | 'recovery'; address: string }): Promise<TokenAnswer> {
  await countLimits(deps, [{ key: await hashedKey('verify:ip', input.address), limit: VERIFY_PER_ADDRESS, windowMs: HOUR_MS }]);
  const hash = await sha256Hex(input.token);
  const refresh = randomToken();
  const refreshHash = await sha256Hex(refresh);
  const now = deps.clock.now();
  const opened = await deps.db.tx('write', async (q) => {
    const [link] = await q<LinkRow>(LINK_BY_HASH, [hash]);
    if (!link || link.type !== input.type || link.used_at !== null || link.expires_at <= now.toISOString()) throw linkEnded();
    const [user] = await q<AuthUserRow>(AUTH_USER_BY_ID, [link.auth_id]);
    if (!user || user.banned === 1) throw linkEnded();
    try {
      principalOf(user.id, await readLiteOffice(liteOf(deps), q));
    } catch {
      throw linkEnded();
    }
    await q(LINKS_END, [user.id, now.toISOString()]);
    await q(AUTH_USER_CONFIRM, [user.id, now.toISOString()]);
    const sessionId = await insertSession(q, { authId: user.id, clientId: null, amr: 'link', refreshHash, linkUntil: new Date(now.getTime() + LINK_LIFE_MS), now });
    return { authId: user.id, sessionId };
  });
  return browserAnswer(deps, { ...opened, refresh });
}

/**
 * POST /api/auth/password { password, current? }. A link session sets a password once with no current password; every other
 * session needs the right current password (the Z1 rule "require current password" of Supabase). An agent token never gets
 * here: the route refuses it (403 agent_token). The password needs 8 characters and must not be the current one.
 */
export async function setSignInPassword(deps: SigninDeps, input: { authId: string; sessionId: string; password: string; current?: string }): Promise<{ ok: true }> {
  if (input.password.length < PASSWORD_MIN) throw new ApiError('invalid_input', 'Use at least 8 characters.', { reason: 'weak', field: 'password' });
  const now = deps.clock.now();
  const [session] = await deps.db.statement<SessionRow>('read', SESSION_BY_ID, [input.sessionId]);
  const [user] = await deps.db.statement<AuthUserRow>('read', AUTH_USER_BY_ID, [input.authId]);
  if (!session || !user || session.auth_id !== user.id || session.client_id !== null || session.revoked_at !== null || user.banned === 1) throw sessionEnded();
  const byLink = session.amr === 'link' && session.link_until !== null && session.link_until > now.toISOString();
  if (!byLink) {
    if (input.current === undefined) throw new ApiError('unauthenticated', 'Type your current password.', { reason: 'current_password_required' });
    if (!(await verifyPassword(input.current, user.password_hash)).ok) throw wrongCredentials();
  }
  if (user.password_hash !== null && (await verifyPassword(input.password, user.password_hash)).ok) {
    throw new ApiError('invalid_input', 'Choose a password that is not your current one.', { reason: 'same', field: 'password' });
  }
  const hash = await hashPassword(input.password);
  await deps.db.tx('write', async (q) => {
    const [again] = await q<AuthUserRow>(AUTH_USER_BY_ID, [user.id]);
    if (!again || again.password_hash !== user.password_hash) throw sessionEnded();
    await q(AUTH_USER_PASSWORD, [user.id, hash, now.toISOString()]);
    await q(SESSION_LINK_DONE, [session.id]);
  });
  return { ok: true };
}
```

Imports to add: `LINK_LIFE_MS` from `./liteAdmin`; `HOUR_MS`, `VERIFY_PER_ADDRESS` from `./limits`; `PASSWORD_MIN` from
`./password`; `AUTH_USER_CONFIRM`, `AUTH_USER_PASSWORD`, `LINK_BY_HASH`, `LINKS_END`, `SESSION_BY_ID`, `SESSION_LINK_DONE`,
`type LinkRow`, `type SessionRow` from `./rows`; `sessionEnded` from `./sessions`.

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run --project server server/auth/own --no-file-parallelism --testTimeout=60000`
Expected: PASS (every file of `server/auth/own`).

- [ ] **Step 5: Commit**

```bash
git add server/auth/own/ops.ts server/auth/own/ops.links.test.ts
git commit -m "Exit wave 2: the Welcome and Reset links open a link session once, and a password change needs the current password"
```

### Task 14: The copied Supabase password (OWNER DECISION 4)

> **This is the one task that depends on owner decision 4 of the spec** ("Copy the bcrypt hashes, or a new password for each
> person"). The plan takes the recommended choice, the copy, so nobody sets a new password at the switch. If the owner says
> "a new password for each person", skip this task: no bcryptjs, no `bcrypt.ts`, no `import.ts` hash column. The import of wave 4
> then writes each sign-in row with `password_hash` null and `password_set` 0, so People shows each person as Invited, and the
> Admin sends each person a link with "Send the invitation again" at the switch (a confirmed email gets a recovery link, Task 5).
> Task 16 then keeps only its PBKDF2 test.

**Files:**
- Modify: `package.json`, `package-lock.json` (`bcryptjs` 3.0.3)
- Create: `server/auth/own/bcrypt.ts`, `server/auth/own/import.ts`
- Modify: `server/auth/own/password.ts` (`verifyPassword`: the bcrypt branch)
- Test: `server/auth/own/bcrypt.test.ts`, `server/it/signinExport.it.test.ts`

**Interfaces:**
- Consumes: `readLiteOffice`, `writeOfficeSnapshot`, `liteDbOf` (wave 1 and Task 4).
- Produces: `isBcryptHash(stored: string): boolean`; `verifyBcrypt(password: string, hash: string): boolean`;
  `SIGNIN_EXPORT_SQL` (Postgres, for the export of wave 4); `type SigninExportRow = { id: string; email: string;
  password_hash: string | null; email_confirmed: boolean; banned: boolean; password_set: boolean; user_id: string | null }`;
  `importSigninRows(q: Query, rows: readonly SigninExportRow[], now: Date): Promise<number>`.
- For wave 4 (the export): the columns of `auth.users` are `id`, `email`, `encrypted_password` (bcrypt cost 10, `$2a$10$...`),
  `email_confirmed_at`, `banned_until`, `raw_user_meta_data->>'madar_password_set'` and `deleted_at`, joined to
  `users.auth_user_id`. The export runs `SIGNIN_EXPORT_SQL` with the database address of the nightly backup (`BACKUP_DB_URL`
  in `secrets/production.env` and in the GitHub secrets; the backup role already dumps `auth.users`). The rows travel only
  inside the export file, which wave 4 encrypts to the owner's age key like the backups. No file of the repository holds a hash
  or the address.

- [ ] **Step 1: Install bcryptjs**

The worktree has a linked `node_modules`. Remove only the link, then install (sandbox off: it reads the npm registry):

```bash
rm node_modules
npm install --save-exact bcryptjs@3.0.3
```

Expected: `package.json` gets `"bcryptjs": "3.0.3"` in `dependencies`, and `node_modules` is a full folder.

- [ ] **Step 2: Write the failing tests**

```ts
// server/auth/own/bcrypt.test.ts
import bcrypt from 'bcryptjs';
import { describe, expect, it } from 'vitest';
import { readLiteOffice } from '../../data/lite/office';
import { userIdOfAuth } from '../../data/officeCache';
import { isBcryptHash, verifyBcrypt } from './bcrypt';
import { importSigninRows, SIGNIN_EXPORT_SQL, type SigninExportRow } from './import';
import { passwordSignIn } from './ops';
import { verifyPassword } from './password';
import { signinDepsOf, signinOffice } from './testOffice';

const AUTH_ID = '11111111-1111-4111-8111-111111111111';
const GONE_ID = '22222222-2222-4222-8222-222222222222';
const COPIED = bcrypt.hashSync('a copied password', 10);
const row = (more: Partial<SigninExportRow> = {}): SigninExportRow => ({
  id: AUTH_ID, email: 'Copied@Madar.test', password_hash: COPIED, email_confirmed: true, banned: false, password_set: true, user_id: 'usr_002', ...more,
});

describe('the copied Supabase password (owner decision 4)', () => {
  it('knows the bcrypt form, the $2a$ of Supabase too, and checks it', () => {
    expect(isBcryptHash(COPIED)).toBe(true);
    // The hash of the wave 0 probe, as Supabase Auth makes it (scripts/proof/do-socket/public-inputs.json).
    expect(isBcryptHash('$2a$10$QyXrSV0ETPiKCL3760g9quRekv0QTzq.mEQMDpYVsBVKRWmu3o5p2')).toBe(true);
    expect(isBcryptHash('pbkdf2-sha256$100000$a$b')).toBe(false);
    expect(verifyBcrypt('a copied password', COPIED)).toBe(true);
    expect(verifyBcrypt('another one', COPIED)).toBe(false);
  });

  it('asks for a PBKDF2 hash in place of a bcrypt hash after the right password', async () => {
    expect(await verifyPassword('a copied password', COPIED)).toEqual({ ok: true, upgrade: true });
    expect(await verifyPassword('another one', COPIED)).toEqual({ ok: false, upgrade: false });
  });

  it('signs in with a copied bcrypt hash once and then holds a PBKDF2 hash', async () => {
    const t = await signinOffice();
    await t.db.tx('write', (q) => importSigninRows(q, [row()], t.deps.clock.now()));
    const deps = await signinDepsOf(t);
    const input = { email: 'copied@madar.test', password: 'a copied password', address: '203.0.113.7' };
    expect(await passwordSignIn(deps, input)).toMatchObject({ user: { id: AUTH_ID } });
    const { password_hash } = t.raw.prepare('select password_hash from auth_users where id = ?').get(AUTH_ID) as { password_hash: string };
    expect(password_hash).toMatch(/^pbkdf2-sha256\$100000\$/);
    expect(await passwordSignIn(deps, input)).toMatchObject({ user: { id: AUTH_ID } });
  });

  it('keeps the link, the ban and the marks of the export, and drops a link to a person who is not in the office', async () => {
    const t = await signinOffice();
    const gone = row({ id: GONE_ID, email: 'gone@madar.test', user_id: 'usr_404', banned: true, password_set: false, email_confirmed: false, password_hash: null });
    expect(await t.db.tx('write', (q) => importSigninRows(q, [gone, row()], t.deps.clock.now()))).toBe(2);
    expect(t.raw.prepare('select id, user_id, email, password_hash is null as no_hash, banned, password_set, email_confirmed from auth_users order by id').all()).toEqual([
      { id: AUTH_ID, user_id: 'usr_002', email: 'copied@madar.test', no_hash: 0, banned: 0, password_set: 1, email_confirmed: 1 },
      { id: GONE_ID, user_id: null, email: 'gone@madar.test', no_hash: 1, banned: 1, password_set: 0, email_confirmed: 0 },
    ]);
    expect(userIdOfAuth(await t.db.tx('read', (q) => readLiteOffice(t.db, q)), AUTH_ID)).toBe('usr_002');
  });

  it('names in the export text each field of SigninExportRow, from auth.users, with no sort', () => {
    const names = [...SIGNIN_EXPORT_SQL.matchAll(/ as (\w+)/g)].map((match) => match[1]).sort();
    expect(names).toEqual(['banned', 'email', 'email_confirmed', 'id', 'password_hash', 'password_set', 'user_id']);
    expect(SIGNIN_EXPORT_SQL).toContain('from auth.users a');
    expect(SIGNIN_EXPORT_SQL).not.toContain('order by');
  });
});
```

```ts
// server/it/signinExport.it.test.ts
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { authAdminPort } from '../auth/admin';
import { verifyBcrypt } from '../auth/own/bcrypt';
import { SIGNIN_EXPORT_SQL, type SigninExportRow } from '../auth/own/import';
import { localStack } from './authStack';
import { LOCAL_DB_URL } from './migrate';

/** Owner decision 4: the export reads the bcrypt hash that Supabase Auth made, and the own check accepts it. Local stack only. */
describe('the export of the sign-in rows from Supabase Auth', () => {
  it('gives the bcrypt hash of Auth with its marks, and verifyBcrypt accepts it', async () => {
    const stack = localStack();
    const admin = authAdminPort({ supabaseUrl: stack.apiUrl, secretKey: stack.secretKey });
    const email = `export-${Date.now()}@madar.test`;
    const { authUserId } = await admin.createUser(email, 'a copied password');
    const client = new pg.Client({ connectionString: process.env.MADAR_LOCAL_DB_URL ?? LOCAL_DB_URL });
    await client.connect();
    try {
      const mine = (await client.query<SigninExportRow>(SIGNIN_EXPORT_SQL)).rows.find((one) => one.id === authUserId);
      expect(mine).toMatchObject({ email, email_confirmed: true, banned: false, password_set: true, user_id: null });
      expect(mine?.password_hash).toMatch(/^\$2a\$10\$/);
      expect(verifyBcrypt('a copied password', String(mine?.password_hash))).toBe(true);
    } finally {
      await client.query('delete from auth.users where id = $1', [authUserId]);
      await client.end();
    }
  });
});
```

- [ ] **Step 3: Run the unit tests to see them fail**

Run: `npx vitest run --project server server/auth/own/bcrypt.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL with "Failed to load url ./bcrypt".

- [ ] **Step 4: Write the bcrypt check, the branch, and the import**

```ts
// server/auth/own/bcrypt.ts
import bcrypt from 'bcryptjs';

/**
 * The copied password of Supabase Auth (owner decision 4; spec section 4): the switch copies the bcrypt hashes (cost 10), so
 * nobody sets a new password. The first sign-in checks the bcrypt hash once (77 to 95 ms of CPU in the office object, wave 0) and
 * stores a PBKDF2 hash in its place (verifyPassword gives upgrade: true). bcryptjs imports the module "crypto", so the Worker
 * config needs nodejs_compat (it has it), and no Supabase entry may load this file (server/workerGraph.test.ts).
 * Until a person signs in once, a wrong password costs about 90 ms against 35 ms for an unknown email: a small sign that the email
 * has a copied row. It ends with the first sign-in of that person.
 */

const BCRYPT = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

export function isBcryptHash(stored: string): boolean {
  return BCRYPT.test(stored);
}

export function verifyBcrypt(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}
```

In `server/auth/own/password.ts`, add `import { isBcryptHash, verifyBcrypt } from './bcrypt';` and put this first in
`verifyPassword`:

```ts
  if (stored !== null && isBcryptHash(stored)) {
    const ok = verifyBcrypt(password, stored);
    return { ok, upgrade: ok };
  }
```

```ts
// server/auth/own/import.ts
import type { Query } from '../../core/ports';
import { liteDbOf } from '../../data/lite/db';
import { readLiteOffice, writeOfficeSnapshot } from '../../data/lite/office';

/**
 * The sign-in rows of the switch (owner decision 4; spec section 4, step 4). The export of wave 4 runs SIGNIN_EXPORT_SQL on the
 * Supabase database with the address of the nightly backup (BACKUP_DB_URL); the import of wave 4 calls importSigninRows inside the
 * office object. Each id stays the id of auth.users, so a Supabase token and an own token name the same person. The rows travel
 * only inside the encrypted export file.
 */
export const SIGNIN_EXPORT_SQL = [
  "select a.id::text as id, lower(a.email) as email, nullif(a.encrypted_password, '') as password_hash,",
  ' a.email_confirmed_at is not null as email_confirmed, coalesce(a.banned_until > now(), false) as banned,',
  " coalesce((a.raw_user_meta_data->>'madar_password_set')::boolean, false) as password_set, u.id as user_id",
  ' from auth.users a left join users u on u.auth_user_id = a.id where a.deleted_at is null and a.email is not null',
].join('');

export type SigninExportRow = {
  id: string; email: string; password_hash: string | null; email_confirmed: boolean; banned: boolean; password_set: boolean; user_id: string | null;
};

export const SIGNIN_IMPORT_LITE =
  'insert into auth_users (id, user_id, email, password_hash, password_set, email_confirmed, banned, created_at, updated_at) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)';

/**
 * Writes the rows, in id order, then one office version and one snapshot with the new links (the rule of lite/office.ts). A link to
 * a person who is not in the office stays out: principalOf would refuse it anyway. Run it in one write transaction.
 */
export async function importSigninRows(q: Query, rows: readonly SigninExportRow[], now: Date): Promise<number> {
  const office = await readLiteOffice(liteDbOf(q), q);
  for (const row of [...rows].sort((a, b) => a.id.localeCompare(b.id))) {
    const userId = row.user_id !== null && office.lists.users[row.user_id] ? row.user_id : null;
    await q(SIGNIN_IMPORT_LITE, [row.id, userId, row.email.trim().toLowerCase(), row.password_hash, row.password_set ? 1 : 0, row.email_confirmed ? 1 : 0, row.banned ? 1 : 0, now.toISOString()]);
  }
  const [meta] = await q<{ version: number }>('update office_meta set version = version + 1 where id = 1 returning version');
  await writeOfficeSnapshot(q, office.lists, Number(meta.version));
  return rows.length;
}
```

- [ ] **Step 5: Run the unit tests to see them pass**

Run: `npx vitest run --project server server/auth/own --no-file-parallelism --testTimeout=60000`
Expected: PASS. The integration test runs in the merge gate (`test:it`, Docker), Task 22.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json server/auth/own/bcrypt.ts server/auth/own/import.ts server/auth/own/password.ts server/auth/own/bcrypt.test.ts server/it/signinExport.it.test.ts
git commit -m "Exit wave 2 (owner decision 4): a copied bcrypt hash works once and becomes a PBKDF2 hash; the export columns and the import"
```

### Task 15: SigninOffice and the HTTP routes of the own sign-in

**Files:**
- Create: `server/auth/own/office.ts`, `server/auth/own/routes.ts`
- Test: `server/auth/own/routes.test.ts`

**Interfaces:**
- Consumes: the steps of Tasks 11 to 13; `clientAddress` (`forgot.ts`); `verifyBrowserToken`, `TokenChecker`; `errorResponse`,
  `runErrorOf`; `readBody`; `RouteDef`.
- Produces: `type OpResult<T>`; `runSigninOp(deps, name, input)`; `interface SigninOffice { run(name, input) }`;
  `localSigninOffice(deps: SigninDeps): SigninOffice`; `SIGNIN_STEPS` (the step map that Tasks 17 to 19 extend);
  `answer(result, status?)`, `jsonOf(request)`; `ownAuthRoutes(office, { jwks, checkToken? }): RouteDef[]` with
  `POST /auth/token`, `POST /auth/verify`, `POST /auth/password`, `POST /auth/logout`, `GET /auth/jwks`.
- For wave 3: the host builds `apiApp(deps, { routes: [...ROUTES, ...ownAuthRoutes(office, { jwks })] })`, where `office`
  calls the object method for one batch with the body `{ signin: name, input }`, and the object answers
  `await runSigninOp(objectDeps, name, input)` (an `OpResult`, which a structured clone carries: no class, no function).

- [ ] **Step 1: Write the failing tests**

```ts
// server/auth/own/routes.test.ts
import { describe, expect, it } from 'vitest';
import { runInHost } from '../../core/after';
import type { Deps } from '../../core/ports';
import { apiApp } from '../../http/app';
import { ROUTES } from '../../http/routes';
import { ownIssuer, ownKeySet, ownPublicJwks } from '../ownKeys';
import { browserTokenChecker } from '../verify';
import { signAgentToken, signingKeysOf } from './keys';
import { localSigninOffice, runSigninOp } from './office';
import { ownAuthRoutes } from './routes';
import { testPrivateJwk } from './testKeys';
import { addSignIn, signinOffice } from './testOffice';

async function setup() {
  // The real time: the route checks each token with jose against the time of the machine.
  const t = await signinOffice({ at: new Date().toISOString() });
  const authId = await addSignIn(t, 'usr_002', { password: 'a good password' });
  const email = (t.raw.prepare('select email from auth_users where id = ?').get(authId) as { email: string }).email;
  const jwk = await testPrivateJwk();
  const keys = await signingKeysOf(jwk, t.deps.config.mcpUrl);
  const deps = { db: t.db, clock: t.deps.clock, log: t.deps.log, config: t.deps.config, keys };
  const checkToken = browserTokenChecker({ issuer: ownIssuer(t.deps.config.mcpUrl), jwks: ownKeySet(jwk) });
  const app = apiApp(t.deps as unknown as Deps, { routes: [...ROUTES, ...ownAuthRoutes(localSigninOffice(deps), { jwks: ownPublicJwks(jwk), checkToken })] });
  const send = (path: string, o: { body?: unknown; token?: string; address?: string; method?: string } = {}) => runInHost({ host: 'workers' }, async () => {
    const response = await app.request(path, {
      method: o.method ?? 'POST',
      headers: {
        'content-type': 'application/json', 'x-madar-client-address': o.address ?? '203.0.113.7', 'cf-connecting-ip': `198.51.100.${Math.floor(Math.random() * 200)}`,
        ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
      },
      ...(o.body === undefined ? {} : { body: JSON.stringify(o.body) }),
    });
    return { status: response.status, headers: response.headers, body: (await response.json()) as Record<string, any> };
  });
  return { t, authId, email, keys, deps, send };
}

describe('the HTTP routes of the own sign-in (server/auth/own/routes.ts)', () => {
  it('signs in, refreshes, and gives one answer for a wrong password and an unknown email', async () => {
    const { authId, email, send } = await setup();
    const first = await send('/auth/token', { body: { grant_type: 'password', email, password: 'a good password' } });
    expect(first).toMatchObject({ status: 200, body: { token_type: 'bearer', expires_in: 900, user: { id: authId } } });
    expect(first.headers.get('cache-control')).toBe('no-store');
    expect((await send('/auth/token', { body: { grant_type: 'refresh_token', refresh_token: first.body.refresh_token } })).status).toBe(200);
    const wrong = await send('/auth/token', { body: { grant_type: 'password', email, password: 'not it' } });
    const unknown = await send('/auth/token', { body: { grant_type: 'password', email: 'nobody@madar.test', password: 'not it' } });
    expect([wrong.status, wrong.body]).toEqual([unknown.status, unknown.body]);
    expect(wrong).toMatchObject({ status: 401, body: { v: 1, error: { code: 'unauthenticated', details: { reason: 'invalid_credentials' } } } });
  });

  it('answers 429 with Retry-After over the limit of one email', async () => {
    const { email, send } = await setup();
    for (let i = 0; i < 10; i += 1) await send('/auth/token', { body: { grant_type: 'password', email, password: 'not it' }, address: `192.0.2.${i}` });
    const over = await send('/auth/token', { body: { grant_type: 'password', email, password: 'a good password' } });
    expect(over.status).toBe(429);
    expect(Number(over.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('counts the address that the Pages Function wrote on the Worker host, never cf-connecting-ip', async () => {
    const { send } = await setup();
    for (let i = 0; i < 30; i += 1) await send('/auth/token', { body: { grant_type: 'password', email: `p${i}@madar.test`, password: 'x' }, address: '192.0.2.50' });
    expect((await send('/auth/token', { body: { grant_type: 'password', email: 'p99@madar.test', password: 'x' }, address: '192.0.2.50' })).status).toBe(429);
    expect((await send('/auth/token', { body: { grant_type: 'password', email: 'p99@madar.test', password: 'x' }, address: '192.0.2.51' })).status).toBe(401);
  });

  it('opens a link once, and refuses a used link and a wrong type', async () => {
    const { t, email, send } = await setup();
    const link = await t.deps.authAdmin.generateLink('recovery', email);
    expect((await send('/auth/verify', { body: { token_hash: link.tokenHash, type: 'recovery' } })).status).toBe(200);
    expect(await send('/auth/verify', { body: { token_hash: link.tokenHash, type: 'recovery' } })).toMatchObject({ status: 401, body: { error: { details: { reason: 'link_ended' } } } });
    expect((await send('/auth/verify', { body: { token_hash: link.tokenHash, type: 'magiclink' } })).status).toBe(400);
  });

  it('sets a password with a browser token, and refuses an agent token and no token', async () => {
    const { authId, email, keys, send } = await setup();
    const signedIn = await send('/auth/token', { body: { grant_type: 'password', email, password: 'a good password' } });
    const agent = await signAgentToken(keys, { authId, sessionId: 's-agent', clientId: 'c-1', now: new Date() });
    expect(await send('/auth/password', { token: agent, body: { password: 'an agent password', current: 'a good password' } })).toMatchObject({ status: 403, body: { error: { details: { reason: 'agent_token' } } } });
    expect((await send('/auth/password', { body: { password: 'x'.repeat(12) } })).status).toBe(401);
    expect(await send('/auth/password', { token: signedIn.body.access_token, body: { password: 'a new password', current: 'a good password' } })).toMatchObject({ status: 200, body: { ok: true } });
  });

  it('signs out this device: its refresh token stops', async () => {
    const { email, send } = await setup();
    const signedIn = await send('/auth/token', { body: { grant_type: 'password', email, password: 'a good password' } });
    expect((await send('/auth/logout', { token: signedIn.body.access_token, body: { scope: 'local' } })).status).toBe(200);
    expect((await send('/auth/token', { body: { grant_type: 'refresh_token', refresh_token: signedIn.body.refresh_token } })).status).toBe(401);
  });

  it('serves the public key set with no private part', async () => {
    const { send } = await setup();
    const jwks = await send('/auth/jwks', { method: 'GET' });
    expect(jwks.status).toBe(200);
    expect(JSON.stringify(jwks.body)).not.toContain('"d"');
  });

  it('gives not_found for an unknown step, and the hidden failed for a plain error, with a log line', async () => {
    const { deps } = await setup();
    expect(await runSigninOp(deps, 'auth.nothing' as never, {} as never)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    const broken = { ...deps, db: { ...deps.db, statement: () => Promise.reject(new Error('disk gone')), tx: () => Promise.reject(new Error('disk gone')) } };
    expect(await runSigninOp(broken as typeof deps, 'auth.refresh', { refreshToken: 'x' })).toMatchObject({ ok: false, error: { code: 'failed' } });
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run --project server server/auth/own/routes.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL with "Failed to load url ./office".

- [ ] **Step 3: Write the office port**

```ts
// server/auth/own/office.ts
import { ApiError } from '../../../src/api/errors';
import { runErrorOf } from '../../http/errors';
import { passwordSignIn, refreshSignIn, setSignInPassword, signOutSessions, verifySignInLink } from './ops';
import { OAuthError, type SigninDeps } from './types';

/**
 * The sign-in steps of the office object (Supabase exit, wave 2) and the port that the Worker routes call. Each answer is plain data
 * (a structured clone carries it over the object method of wave 3): a value, a Madar refusal, or an OAuth refusal.
 */

export const SIGNIN_STEPS = {
  'auth.password': passwordSignIn,
  'auth.refresh': refreshSignIn,
  'auth.verify': verifySignInLink,
  'auth.setPassword': setSignInPassword,
  'auth.logout': signOutSessions,
} as const;

export type SigninSteps = typeof SIGNIN_STEPS;
export type SigninOpName = keyof SigninSteps;
export type OpInput<N extends SigninOpName> = Parameters<SigninSteps[N]>[1];
export type OpOutput<N extends SigninOpName> = Awaited<ReturnType<SigninSteps[N]>>;
export type OAuthFailure = { status: number; error: string; error_description: string };
export type OpResult<T> = { ok: true; value: T } | { ok: false; error: ReturnType<typeof runErrorOf> } | { ok: false; oauth: OAuthFailure };

export async function runSigninOp<N extends SigninOpName>(deps: SigninDeps, name: N, input: OpInput<N>): Promise<OpResult<OpOutput<N>>> {
  const step = (SIGNIN_STEPS as Record<string, ((deps: SigninDeps, input: unknown) => Promise<unknown>) | undefined>)[name];
  if (!step) return { ok: false, error: runErrorOf(new ApiError('not_found', 'This sign-in step does not exist.')) };
  try {
    return { ok: true, value: (await step(deps, input)) as OpOutput<N> };
  } catch (error) {
    if (error instanceof OAuthError) return { ok: false, oauth: { status: error.status, error: error.code, error_description: error.message } };
    if (!(error instanceof ApiError)) deps.log.error('A sign-in step failed.', { name, error: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: runErrorOf(error) };
  }
}

/** The way of the Worker routes to the steps. Wave 3 gives one that calls the office object; tests and local runs use this one. */
export interface SigninOffice {
  run<N extends SigninOpName>(name: N, input: OpInput<N>): Promise<OpResult<OpOutput<N>>>;
}

export function localSigninOffice(deps: SigninDeps): SigninOffice {
  return { run: (name, input) => runSigninOp(deps, name, input) };
}
```

- [ ] **Step 4: Write the routes**

```ts
// server/auth/own/routes.ts
import type { JSONWebKeySet } from 'jose';
import { ApiError, invalid } from '../../../src/api/errors';
import { errorResponse, runErrorOf } from '../../http/errors';
import { readBody } from '../../http/limits';
import type { RouteDef } from '../../http/routes';
import { clientAddress } from '../forgot';
import { verifyBrowserToken, type TokenChecker } from '../verify';
import type { OpResult, SigninOffice } from './office';

/**
 * The HTTP routes of the own sign-in in the api app (Supabase exit, wave 2), at /api/auth/*. The Worker does the HTTP part only:
 * the body, the client address (clientAddress: x-madar-client-address on the Worker host) and the browser token check; the step
 * runs in the office object through SigninOffice. The hosts pass these routes in (AppOptions.routes): no Supabase entry loads them.
 */

export type OwnRouteOptions = { jwks: JSONWebKeySet; checkToken?: TokenChecker };
const NO_STORE = { 'Cache-Control': 'no-store' };

export function answer<T>(result: OpResult<T>, status = 200): Response {
  if (result.ok) return Response.json(result.value, { status, headers: NO_STORE });
  if ('oauth' in result) return Response.json({ error: result.oauth.error, error_description: result.oauth.error_description }, { status: result.oauth.status, headers: NO_STORE });
  return errorResponse(result.error, NO_STORE);
}

export async function jsonOf(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = JSON.parse(await readBody(request)) as unknown;
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** A route for a signed-in person: the browser token check first (an agent token gets 403 agent_token), then the work. */
export function signedIn(check: TokenChecker, work: (request: Request, who: { authId: string; sessionId: string }) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    try {
      const { authUserId, sessionId } = await check(request.headers.get('Authorization'));
      if (sessionId === undefined) throw new ApiError('unauthenticated', 'Sign in to continue.', { reason: 'session_ended' });
      return await work(request, { authId: authUserId, sessionId });
    } catch (error) {
      return errorResponse(runErrorOf(error), NO_STORE);
    }
  };
}

export function ownAuthRoutes(office: SigninOffice, o: OwnRouteOptions): RouteDef[] {
  const check = o.checkToken ?? verifyBrowserToken;
  return [
    {
      method: 'POST', path: '/auth/token', handler: async (request) => {
        const body = await jsonOf(request);
        if (body.grant_type === 'password') return answer(await office.run('auth.password', { email: text(body.email), password: text(body.password), address: clientAddress(request) }));
        if (body.grant_type === 'refresh_token') return answer(await office.run('auth.refresh', { refreshToken: text(body.refresh_token) }));
        return errorResponse(runErrorOf(invalid('grant_type', 'Send grant_type password or refresh_token.')), NO_STORE);
      },
    },
    {
      method: 'POST', path: '/auth/verify', handler: async (request) => {
        const body = await jsonOf(request);
        const type = body.type === 'invite' || body.type === 'recovery' ? body.type : undefined;
        if (type === undefined || text(body.token_hash) === '') return errorResponse(runErrorOf(invalid('token_hash', 'Open the link of your email again.', 'link_ended')), NO_STORE);
        return answer(await office.run('auth.verify', { token: text(body.token_hash), type, address: clientAddress(request) }));
      },
    },
    {
      method: 'POST', path: '/auth/password', handler: signedIn(check, async (request, who) => {
        const body = await jsonOf(request);
        return answer(await office.run('auth.setPassword', { ...who, password: text(body.password), ...(typeof body.current === 'string' ? { current: body.current } : {}) }));
      }),
    },
    {
      method: 'POST', path: '/auth/logout', handler: signedIn(check, async (request, who) => {
        const body = await jsonOf(request);
        return answer(await office.run('auth.logout', { ...who, scope: body.scope === 'others' ? 'others' : 'local' }));
      }),
    },
    { method: 'GET', path: '/auth/jwks', handler: async () => Response.json(o.jwks, { headers: { 'Cache-Control': 'public, max-age=600' } }) },
  ];
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run --project server server/auth/own/routes.test.ts server/workerGraph.test.ts server/http --no-file-parallelism --testTimeout=60000`
Expected: PASS. `server/http/app.ts` and `routes.ts` do not change; the graph test stays green.

- [ ] **Step 6: Commit**

```bash
git add server/auth/own/office.ts server/auth/own/routes.ts server/auth/own/routes.test.ts
git commit -m "Exit wave 2: the HTTP routes of the own sign-in call the office object through SigninOffice, and refuse agent tokens"
```

### Task 16: The own sign-in on local workerd (test:office)

**Files:**
- Modify: `server/office/test/pinOffice.ts:26-35` (`PinOfficeApi`), `:144` (`FETCH_METHODS`); add the methods `signin`,
  `importSignins`, `peek`
- Modify: `server/office/test/harness.ts:17-29` (`officeByFetch`)
- Test: `server/office/signin.wd.test.ts`

**Interfaces:**
- Consumes: `runSigninOp` (Task 15); `signingKeysOf` (Task 3); `importSigninRows` (Task 14); `hashPassword` (Task 2).
- Produces: `PinOfficeApi.signin(name: string, input: unknown, privateJwk: string, now: string): Promise<unknown>`,
  `importSignins(rows: SigninExportRow[], now: string): Promise<number>`, `peek(text: string): Promise<SqlRow[]>` (a select only).

- [ ] **Step 1: Write the failing test**

```ts
// server/office/signin.wd.test.ts
import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSeed } from '../../src/data/seed';
import { hashPassword } from '../auth/own/password';
import { testPrivateJwk } from '../auth/own/testKeys';
import { startOffice } from './test/harness';

const NOW = '2026-10-17T06:00:00Z';
const SIGN_IN = { email: 'copied@madar.test', password: 'a copied password', address: '203.0.113.7' };
const row = (id: string, hash: string) => ({ id, email: SIGN_IN.email, password_hash: hash, email_confirmed: true, banned: false, password_set: true, user_id: 'usr_002' });

describe('the own sign-in in the office object on local workerd (Supabase exit, wave 2)', () => {
  let office: Awaited<ReturnType<typeof startOffice>>;
  let jwk: string;
  beforeAll(async () => {
    office = await startOffice();
    jwk = await testPrivateJwk();
  }, 120_000);
  afterAll(async () => {
    await office?.server.close();
  });

  it('signs in with a PBKDF2 hash of 100,000 rounds and signs an ES256 token inside the object', async () => {
    const o = office.office('signin-pbkdf2');
    await o.writeState(await buildSeed('2026-10-17', async () => undefined));
    await o.importSignins([row('11111111-1111-4111-8111-111111111111', await hashPassword(SIGN_IN.password))], NOW);
    expect(await o.signin('auth.password', SIGN_IN, jwk, NOW)).toMatchObject({ ok: true, value: { token_type: 'bearer', expires_in: 900 } });
    expect(await o.signin('auth.password', { ...SIGN_IN, password: 'wrong' }, jwk, NOW)).toMatchObject({ ok: false, error: { details: { reason: 'invalid_credentials' } } });
  });

  // Owner decision 4 (Task 14): leave this test out when the owner chooses a new password for each person.
  it('checks a copied bcrypt hash with nodejs_compat once, then holds a PBKDF2 hash', async () => {
    const o = office.office('signin-bcrypt');
    await o.writeState(await buildSeed('2026-10-17', async () => undefined));
    await o.importSignins([row('22222222-2222-4222-8222-222222222222', bcrypt.hashSync(SIGN_IN.password, 10))], NOW);
    expect(await o.signin('auth.password', SIGN_IN, jwk, NOW)).toMatchObject({ ok: true });
    const [stored] = (await o.peek("select password_hash from auth_users where id = '22222222-2222-4222-8222-222222222222'")) as { password_hash: string }[];
    expect(stored.password_hash).toMatch(/^pbkdf2-sha256\$100000\$/);
    expect(await o.signin('auth.password', SIGN_IN, jwk, '2026-10-17T06:00:05Z')).toMatchObject({ ok: true });
  });

  it('refuses a statement other than a select in peek', async () => {
    await expect(office.office('signin-pbkdf2').peek('delete from auth_users')).rejects.toThrow('peek runs a select only.');
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run (sandbox off): `npm run test:office -- server/office/signin.wd.test.ts`
Expected: FAIL with "o.importSignins is not a function".

- [ ] **Step 3: Add the three methods to the test office object**

In `server/office/test/pinOffice.ts`, add to `PinOfficeApi`:

```ts
  signin(name: string, input: unknown, privateJwk: string, now: string): Promise<unknown>;
  importSignins(rows: SigninExportRow[], now: string): Promise<number>;
  peek(text: string): Promise<SqlRow[]>;
```

Add to the class `PinOffice`:

```ts
  /** One own sign-in step on the SQLite of this object, with real crypto (PBKDF2, bcryptjs, ES256) on workerd (wave 2). */
  async signin(name: string, input: unknown, privateJwk: string, now: string): Promise<unknown> {
    const { db, deps } = await this.#ready();
    deps.clock.set(new Date(now));
    const keys = await signingKeysOf(privateJwk, deps.config.mcpUrl);
    return runSigninOp({ db, clock: deps.clock, log: deps.log, config: deps.config, keys }, name as SigninOpName, input as never);
  }

  async importSignins(rows: SigninExportRow[], now: string): Promise<number> {
    const { db } = await this.#ready();
    return db.tx('write', (q) => importSigninRows(q, rows, new Date(now)));
  }

  /** A select for a test to read a row back. Any other statement throws. */
  async peek(text: string): Promise<SqlRow[]> {
    if (!/^\s*select\b/i.test(text)) throw new Error('peek runs a select only.');
    const { host } = await this.#ready();
    return host.exec(text, []).rows;
  }
```

Imports: `runSigninOp`, `type SigninOpName` from `../../auth/own/office`; `signingKeysOf` from `../../auth/own/keys`;
`importSigninRows`, `type SigninExportRow` from `../../auth/own/import`; `type SqlRow` from `../../data/lite/host`. Add
`'signin', 'importSignins', 'peek'` to `FETCH_METHODS`. In `server/office/test/harness.ts`, add the same three names to
`officeByFetch`: `signin: send('signin'), importSignins: send('importSignins'), peek: send('peek'),`.

- [ ] **Step 4: Run test:office to see it pass**

Run (sandbox off): `npm run test:office`
Expected: PASS, 3 files, 11 tests (the 8 of wave 1 and these 3). wrangler bundles bcryptjs and its import of `crypto` with
`nodejs_compat` (the test Worker config has it).

- [ ] **Step 5: Commit**

```bash
git add server/office/test/pinOffice.ts server/office/test/harness.ts server/office/signin.wd.test.ts
git commit -m "Exit wave 2: the own sign-in runs on local workerd with PBKDF2 at 100,000 rounds, bcryptjs and ES256"
```

---

# Block D: agents, the screens, and the gate (Tasks 17 to 22, 1.5 days)

The OAuth server of this block replaces the Supabase OAuth server for the own stack. The Madar approval is inside it: the consent
route gives a code only after the person recorded the approval with a browser token (`POST /api/agents/approve`), and every own
route refuses an agent token, so the gap of proof.md G1 and G4 (an agent token that approves its own client, or changes the
password) does not exist on the own stack. Registration is Dynamic Client Registration (RFC 7591), as Supabase gives it today.

### Task 17: OAuth: the documents, the registration and the authorize step

**Files:**
- Create: `server/mcp/oauth/metadata.ts`, `server/mcp/oauth/redirects.ts`, `server/mcp/oauth/rows.ts`, `server/mcp/oauth/ops.ts`,
  `server/mcp/oauth/routes.ts`, `server/mcp/oauth/testApp.ts`, `server/http/pagesWellKnown.ts`
- Modify: `server/auth/own/office.ts` (`SIGNIN_STEPS`: `oauth.register`, `oauth.authorize`)
- Modify: `server/auth/own/testOffice.ts` (`signinOffice` takes `config`)
- Modify: `server/mcp/app.ts:78-91` (`McpAppOptions.oauth`), `:270-272` (mount it)
- Test: `server/mcp/oauth/register.test.ts`, `server/http/pagesWellKnown.test.ts`

**Interfaces:**
- Consumes: `safeRedirect` (`src/features/oauth/knownHosts.ts`, no imports of its own); `countLimits`, `OAuthError`,
  `REGISTER_PER_ADDRESS`, `HOUR_MS`; `answer`, `jsonOf` (Task 15); `proxyMcp` (`server/http/pagesMcpProxy.ts:32`).
- Produces: `authServerMetadata(mcpUrl)`, `WELL_KNOWN`; `registrable(uri)`, `redirectAllowed(registered, uri)`,
  `withQuery(base, values)`; the rows texts `CLIENT_INSERT`, `CLIENT_BY_ID`, `REQUEST_*`, `GRANTS_LITE`, `GRANT_REVOKE`;
  `REQUEST_LIFE_MS = 600_000`, `CODE_LIFE_MS = 60_000`; `registerClient`, `startAuthorization`;
  `mountOAuth(app: Hono, office: SigninOffice, o: { mcpUrl: string; jwks: JSONWebKeySet }): void`;
  `McpAppOptions.oauth?: (app: Hono) => void`; `oauthApp(o?)` (the test app); `proxyWellKnown(request, fetcher, env, o)` and
  `WELL_KNOWN_FORWARDS` (for the Pages Function of wave 5).

- [ ] **Step 1: Let the test office take a config, and write the test app**

In `server/auth/own/testOffice.ts`, change the signature and the deps line of `signinOffice`:

```ts
export async function signinOffice(o: { at?: string; config?: Partial<Config> } = {}): Promise<TestOffice> {
```

```ts
  const base = fakeDeps({ db, ...(o.config ? { config: o.config } : {}) });
```

with `import type { Config, Deps } from '../../core/ports';`.

```ts
// server/mcp/oauth/testApp.ts
import { Hono } from 'hono';
import { localSigninOffice } from '../../auth/own/office';
import { signingKeysOf } from '../../auth/own/keys';
import { testPrivateJwk } from '../../auth/own/testKeys';
import { signinOffice } from '../../auth/own/testOffice';
import type { SigninDeps } from '../../auth/own/types';
import { ownIssuer, ownKeySet, ownPublicJwks } from '../../auth/ownKeys';
import type { Deps } from '../../core/ports';
import { createRunCall } from '../../core/runCall';
import { liteData } from '../../data/lite/callData';
import { readLiteOffice } from '../../data/lite/office';
import { mcpApp } from '../app';
import { agentTokenChecker } from '../auth';
import { liteAgentOf } from './agent';
import { mountOAuth } from './routes';

export const TEST_MCP_URL = 'https://madar.test/mcp';

/**
 * For tests only: the MCP app of the own stack on node:sqlite, as the office object host of wave 3 builds it: the own issuer, the
 * own agent token check, the agent check on SQLite, runCall on liteData, and the OAuth routes. root serves it at /mcp.
 */
export async function oauthApp(o: { at?: string } = {}) {
  const t = await signinOffice({ at: o.at ?? new Date().toISOString(), config: { mcpUrl: TEST_MCP_URL, appUrl: 'https://madar.test', allowedOrigins: ['https://madar.test'] } });
  const jwk = await testPrivateJwk();
  const keys = await signingKeysOf(jwk, TEST_MCP_URL);
  const deps: SigninDeps = { db: t.db, clock: t.deps.clock, log: t.deps.log, config: t.deps.config, keys };
  const office = localSigninOffice(deps);
  const run = createRunCall({ data: liteData });
  const mcp = mcpApp(t.deps as unknown as Deps, {
    issuer: ownIssuer(TEST_MCP_URL),
    checkToken: agentTokenChecker({ issuer: ownIssuer(TEST_MCP_URL), audience: TEST_MCP_URL, jwks: ownKeySet(jwk) }),
    agentOf: liteAgentOf,
    runCall: run,
    readOffice: () => t.db.tx('read', (q) => readLiteOffice(t.db, q)),
    stateKey: new Uint8Array(32),
    oauth: (app) => mountOAuth(app, office, { mcpUrl: TEST_MCP_URL, jwks: ownPublicJwks(jwk) }),
  });
  const root = new Hono();
  root.route('/mcp', mcp);
  return { t, jwk, keys, deps, office, root };
}
```

- [ ] **Step 2: Write the failing tests**

```ts
// server/mcp/oauth/register.test.ts
import { describe, expect, it } from 'vitest';
import { oauthApp, TEST_MCP_URL } from './testApp';

const CALLBACK = 'http://127.0.0.1:33418/callback';
const json = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7' }, body: JSON.stringify(body) });

async function registered(root: Awaited<ReturnType<typeof oauthApp>>['root'], redirect = CALLBACK) {
  const response = await root.request('/mcp/oauth/register', json({ client_name: 'Claude Code', redirect_uris: [redirect], token_endpoint_auth_method: 'none' }));
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}

const authorizeUrl = (clientId: string, more: Record<string, string> = {}) => `/mcp/oauth/authorize?${new URLSearchParams({
  response_type: 'code', client_id: clientId, redirect_uri: CALLBACK, code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', code_challenge_method: 'S256', state: 's-1', resource: TEST_MCP_URL, ...more,
})}`;

describe('the OAuth documents, the registration and the authorize step (server/mcp/oauth)', () => {
  it('serves the authorization server document at both discovery paths under /mcp, with the own issuer', async () => {
    const { root } = await oauthApp();
    for (const path of ['/mcp/.well-known/oauth-authorization-server', '/mcp/.well-known/openid-configuration']) {
      const body = (await (await root.request(path)).json()) as Record<string, unknown>;
      expect(body).toMatchObject({
        issuer: TEST_MCP_URL, authorization_endpoint: `${TEST_MCP_URL}/oauth/authorize`, token_endpoint: `${TEST_MCP_URL}/oauth/token`,
        registration_endpoint: `${TEST_MCP_URL}/oauth/register`, jwks_uri: `${TEST_MCP_URL}/oauth/jwks`, code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['ES256'],
      });
      expect(body).not.toHaveProperty('client_id_metadata_document_supported');
    }
    const resource = (await (await root.request('/mcp/oauth-protected-resource')).json()) as { authorization_servers: string[] };
    expect(resource.authorization_servers).toEqual([TEST_MCP_URL]);
  });

  it('registers a public client with safe return addresses', async () => {
    const { root, t } = await oauthApp();
    const made = await registered(root);
    expect(made).toMatchObject({ status: 201, body: { client_name: 'Claude Code', redirect_uris: [CALLBACK], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'] } });
    expect(t.raw.prepare('select name, redirect_uris from oauth_clients where id = ?').get(made.body.client_id)).toEqual({ name: 'Claude Code', redirect_uris: JSON.stringify([CALLBACK]) });
  });

  it('refuses a script address, a confidential client and the eleventh registration of one address in an hour', async () => {
    const { root } = await oauthApp();
    expect(await registered(root, 'javascript://claude.ai/%0aalert(1)')).toMatchObject({ status: 400, body: { error: 'invalid_redirect_uri' } });
    const secret = await root.request('/mcp/oauth/register', json({ redirect_uris: [CALLBACK], token_endpoint_auth_method: 'client_secret_basic' }));
    expect([secret.status, ((await secret.json()) as { error: string }).error]).toEqual([400, 'invalid_client_metadata']);
    for (let i = 0; i < 8; i += 1) await registered(root);
    expect((await registered(root)).status).toBe(429);
  });

  it('sends the person to the consent screen, and keeps the challenge for 10 minutes', async () => {
    const { root, t } = await oauthApp();
    const { body } = await registered(root);
    const response = await root.request(authorizeUrl(body.client_id));
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location')!);
    expect(`${location.origin}${location.pathname}`).toBe('https://madar.test/oauth/consent');
    const id = location.searchParams.get('authorization_id')!;
    const row = t.raw.prepare('select client_id, redirect_uri, state, code_challenge, status, auth_id, expires_at from oauth_requests where id = ?').get(id) as Record<string, unknown>;
    expect(row).toMatchObject({ client_id: body.client_id, redirect_uri: CALLBACK, state: 's-1', status: 'pending', auth_id: null });
    expect(Date.parse(String(row.expires_at)) - t.deps.clock.now().getTime()).toBe(600_000);
  });

  it('accepts a loopback return address on another port, as RFC 8252 says', async () => {
    const { root } = await oauthApp();
    const { body } = await registered(root);
    expect((await root.request(authorizeUrl(body.client_id, { redirect_uri: 'http://127.0.0.1:51000/callback' }))).status).toBe(302);
  });

  it('never sends an error to an unknown client or address, and sends the other errors back to the client', async () => {
    const { root } = await oauthApp();
    const { body } = await registered(root);
    expect((await root.request(authorizeUrl('nobody'))).status).toBe(400);
    expect((await root.request(authorizeUrl(body.client_id, { redirect_uri: 'https://evil.example/cb' }))).status).toBe(400);
    const plain = await root.request(authorizeUrl(body.client_id, { code_challenge_method: 'plain' }));
    expect(new URL(plain.headers.get('location')!).searchParams.get('error')).toBe('invalid_request');
    const other = await root.request(authorizeUrl(body.client_id, { resource: 'https://other.example/mcp' }));
    expect(Object.fromEntries(new URL(other.headers.get('location')!).searchParams)).toEqual({ error: 'invalid_target', state: 's-1' });
  });
});
```

```ts
// server/http/pagesWellKnown.test.ts
import { describe, expect, it } from 'vitest';
import { proxyWellKnown } from './pagesWellKnown';

const SETTING = { test: 'workers', production: 'supabase' } as const;
const binding = { fetch: async (request: Request) => new Response(new URL(request.url).pathname) };

describe('the forwarder of the OAuth discovery paths (server/http/pagesWellKnown.ts, for the Pages Function of wave 5)', () => {
  it('sends the two discovery paths of the MCP issuer to the Worker as /mcp/.well-known/<name>', async () => {
    for (const [from, to] of [['oauth-authorization-server', 'oauth-authorization-server'], ['openid-configuration', 'openid-configuration']]) {
      const answer = await proxyWellKnown(new Request(`https://preview.madar-46r.pages.dev/.well-known/${from}/mcp`), fetch, { MADAR_SERVER_TEST: binding }, { setting: SETTING });
      expect(await answer.text()).toBe(`/mcp/.well-known/${to}`);
    }
  });

  it('answers 404 for another path, another method and another host', async () => {
    const env = { MADAR_SERVER_TEST: binding };
    expect((await proxyWellKnown(new Request('https://preview.madar-46r.pages.dev/.well-known/oauth-authorization-server'), fetch, env, { setting: SETTING })).status).toBe(404);
    expect((await proxyWellKnown(new Request('https://preview.madar-46r.pages.dev/.well-known/oauth-authorization-server/mcp', { method: 'POST' }), fetch, env, { setting: SETTING })).status).toBe(404);
    expect((await proxyWellKnown(new Request('https://stranger.example/.well-known/oauth-authorization-server/mcp'), fetch, env, { setting: SETTING })).status).toBe(404);
  });
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npx vitest run --project server server/mcp/oauth/register.test.ts server/http/pagesWellKnown.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL with "Failed to load url ./routes" and "./pagesWellKnown".

- [ ] **Step 4: Write the documents, the address rules and the rows texts**

```ts
// server/mcp/oauth/metadata.ts
import { ownIssuer } from '../../auth/ownKeys';

/**
 * The authorization server document of the own OAuth server (RFC 8414; Supabase exit, wave 2). The issuer is MCP_URL, so an MCP
 * client finds the document at /.well-known/oauth-authorization-server/mcp (the Pages Function of wave 5), else at
 * /mcp/.well-known/openid-configuration under the /mcp forwarder of today (MCP draft, authorization server discovery). The same
 * document serves both paths: it has the fields that the SDK checks for an OpenID document. No client ID metadata document: that
 * is a fetch, and the office object does no network work.
 */
export const WELL_KNOWN = ['/.well-known/oauth-authorization-server', '/.well-known/openid-configuration'] as const;

export function authServerMetadata(mcpUrl: string) {
  const issuer = ownIssuer(mcpUrl);
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    jwks_uri: `${issuer}/oauth/jwks`,
    scopes_supported: ['madar'],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['ES256'],
  };
}
```

```ts
// server/mcp/oauth/redirects.ts
import { safeRedirect } from '../../../src/features/oauth/knownHosts';

/** The return addresses of the own OAuth server (Supabase exit, wave 2). */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** A return address a client may register: the rule of the consent screen (https, loopback http, an app scheme; no script scheme). */
export function registrable(uri: string): boolean {
  return uri.length <= 2000 && safeRedirect(uri);
}

/** The address of an authorize request is a registered one: exactly, or on loopback with any port (RFC 8252, section 7.3). */
export function redirectAllowed(registered: readonly string[], uri: string): boolean {
  if (registered.includes(uri)) return true;
  let asked: URL;
  try {
    asked = new URL(uri);
  } catch {
    return false;
  }
  if (!LOOPBACK.has(asked.hostname)) return false;
  return registered.some((one) => {
    try {
      const known = new URL(one);
      return known.protocol === asked.protocol && known.hostname === asked.hostname && known.pathname === asked.pathname && known.search === asked.search;
    } catch {
      return false;
    }
  });
}

/** The address with these query values set; a null or absent value stays out. */
export function withQuery(base: string, values: Record<string, string | null | undefined>): string {
  const url = new URL(base);
  for (const [name, value] of Object.entries(values)) if (value !== null && value !== undefined) url.searchParams.set(name, value);
  return url.toString();
}
```

```ts
// server/mcp/oauth/rows.ts
/** The SQL texts of the OAuth rows (Supabase exit, wave 2; schema version 2). SQLite only. */
export type ClientRow = { id: string; name: string | null; redirect_uris: string };
export const CLIENT_INSERT = 'insert into oauth_clients (id, name, redirect_uris, created_at) values (?1, ?2, ?3, ?4)';
export const CLIENT_BY_ID = 'select id, name, redirect_uris from oauth_clients where id = ?1';

export type RequestRow = {
  id: string; client_id: string; redirect_uri: string; state: string | null; code_challenge: string; auth_id: string | null;
  status: 'pending' | 'approved' | 'denied' | 'used'; code_hash: string | null; code_until: string | null; expires_at: string;
};
const REQUEST_COLUMNS = 'id, client_id, redirect_uri, state, code_challenge, auth_id, status, code_hash, code_until, expires_at';
export const REQUEST_INSERT = 'insert into oauth_requests (id, client_id, redirect_uri, state, code_challenge, scope, resource, expires_at, created_at) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)';
export const REQUEST_BY_ID = `select ${REQUEST_COLUMNS} from oauth_requests where id = ?1`;
export const REQUEST_BY_CODE = `select ${REQUEST_COLUMNS} from oauth_requests where code_hash = ?1`;
/** The first person who opens a request owns it; a request of another person reads as ended. */
export const REQUEST_BIND = 'update oauth_requests set auth_id = ?2 where id = ?1 and auth_id is null';
export const REQUEST_APPROVE = "update oauth_requests set status = 'approved', code_hash = ?2, code_until = ?3 where id = ?1 and status = 'pending'";
export const REQUEST_DENY = "update oauth_requests set status = 'denied' where id = ?1 and status = 'pending'";
export const REQUEST_USED = "update oauth_requests set status = 'used' where id = ?1 and status = 'approved'";
/** The AI apps with a live agent session of the person (Settings, Agents), and the end of one of them. */
export const GRANTS_LITE =
  'select s.client_id as client_id, c.name as client_name, min(s.created_at) as granted_at from auth_sessions s join oauth_clients c on c.id = s.client_id ' +
  'where s.auth_id = ?1 and s.client_id is not null and s.revoked_at is null and s.expires_at > ?2 group by s.client_id, c.name';
export const GRANT_REVOKE = 'update auth_sessions set revoked_at = ?3 where auth_id = ?1 and client_id = ?2 and revoked_at is null';
```

- [ ] **Step 5: Write the two steps, the routes and the option**

```ts
// server/mcp/oauth/ops.ts
import { z } from 'zod';
import { randomToken } from '../../auth/own/crypto';
import { HOUR_MS, REGISTER_PER_ADDRESS } from '../../auth/own/limits';
import { countLimits } from '../../auth/own/sessions';
import { OAuthError, type SigninDeps } from '../../auth/own/types';
import { ownIssuer } from '../../auth/ownKeys';
import { hashedKey } from '../../auth/rateLimit';
import { redirectAllowed, registrable, withQuery } from './redirects';
import { CLIENT_BY_ID, CLIENT_INSERT, REQUEST_INSERT, type ClientRow } from './rows';

/**
 * The OAuth 2.1 steps of the own sign-in for agents (Supabase exit, wave 2). They run in the office object, like the browser steps:
 * crypto first, then SQL only inside a transaction. Tasks 18 and 19 add the consent, the grants and the token steps.
 */

/** An authorize request waits 10 minutes for the person. */
export const REQUEST_LIFE_MS = 10 * 60_000;
/** A code works once, for 60 seconds. */
export const CODE_LIFE_MS = 60_000;

const RegisterBody = z.object({
  client_name: z.string().trim().max(200).optional(),
  redirect_uris: z.array(z.string().min(1)).min(1).max(10),
  token_endpoint_auth_method: z.string().optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
});

export type RegisteredClient = {
  client_id: string; client_id_issued_at: number; client_name?: string; redirect_uris: string[];
  grant_types: string[]; response_types: string[]; token_endpoint_auth_method: 'none';
};

/** POST /mcp/oauth/register (RFC 7591): a public client (PKCE, no secret) with safe return addresses. */
export async function registerClient(deps: SigninDeps, input: { body: unknown; address: string }): Promise<RegisteredClient> {
  await countLimits(deps, [{ key: await hashedKey('register:ip', input.address), limit: REGISTER_PER_ADDRESS, windowMs: HOUR_MS }]);
  const parsed = RegisterBody.safeParse(input.body);
  if (!parsed.success) throw new OAuthError(400, 'invalid_client_metadata', 'The client metadata is not valid.');
  const body = parsed.data;
  if (body.token_endpoint_auth_method !== undefined && body.token_endpoint_auth_method !== 'none') {
    throw new OAuthError(400, 'invalid_client_metadata', 'Madar takes public clients only: token_endpoint_auth_method none.');
  }
  if (!body.redirect_uris.every(registrable)) throw new OAuthError(400, 'invalid_redirect_uri', 'A return address is not safe.');
  const id = crypto.randomUUID();
  const now = deps.clock.now();
  await deps.db.tx('write', (q) => q(CLIENT_INSERT, [id, body.client_name ?? null, JSON.stringify(body.redirect_uris), now.toISOString()]));
  return {
    client_id: id, client_id_issued_at: Math.floor(now.getTime() / 1000), ...(body.client_name ? { client_name: body.client_name } : {}),
    redirect_uris: body.redirect_uris, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none',
  };
}

const AuthorizeQuery = z.object({
  response_type: z.literal('code'),
  code_challenge: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
  code_challenge_method: z.literal('S256'),
  state: z.string().max(2000).optional(),
  scope: z.string().max(500).optional(),
  resource: z.string().max(2000).optional(),
});

/**
 * GET /mcp/oauth/authorize: the request waits in oauth_requests, and the person goes to the Madar consent screen. Until the client
 * and its return address hold, no error goes to the address (RFC 6749, section 4.1.2.1). The resource must be MCP_URL (RFC 8707).
 */
export async function startAuthorization(deps: SigninDeps, input: { query: Record<string, string> }): Promise<{ redirect: string }> {
  const { client_id: clientId, redirect_uri: redirectUri, state } = input.query;
  const [client] = clientId ? await deps.db.statement<ClientRow>('read', CLIENT_BY_ID, [clientId]) : [];
  if (!client || !redirectUri || !redirectAllowed(JSON.parse(client.redirect_uris) as string[], redirectUri)) {
    throw new OAuthError(400, 'invalid_request', 'Madar does not know this AI app or its return address. Connect it again in the AI app.');
  }
  const parsed = AuthorizeQuery.safeParse(input.query);
  if (!parsed.success) {
    return { redirect: withQuery(redirectUri, { error: 'invalid_request', error_description: 'Madar needs response_type code and a PKCE S256 challenge.', state }) };
  }
  if (parsed.data.resource !== undefined && ownIssuer(parsed.data.resource) !== ownIssuer(deps.config.mcpUrl)) {
    return { redirect: withQuery(redirectUri, { error: 'invalid_target', state }) };
  }
  const id = randomToken(16);
  const now = deps.clock.now();
  await deps.db.tx('write', (q) => q(REQUEST_INSERT, [
    id, client.id, redirectUri, parsed.data.state ?? null, parsed.data.code_challenge, parsed.data.scope ?? null, parsed.data.resource ?? null,
    new Date(now.getTime() + REQUEST_LIFE_MS).toISOString(), now.toISOString(),
  ]));
  return { redirect: `${deps.config.appUrl.replace(/\/+$/, '')}/oauth/consent?authorization_id=${encodeURIComponent(id)}` };
}
```

```ts
// server/mcp/oauth/routes.ts
import type { Hono } from 'hono';
import type { JSONWebKeySet } from 'jose';
import { clientAddress } from '../../auth/forgot';
import type { SigninOffice } from '../../auth/own/office';
import { answer, jsonOf } from '../../auth/own/routes';
import { readBody } from '../../http/limits';
import { authServerMetadata, WELL_KNOWN } from './metadata';

/**
 * The OAuth routes of the own sign-in in the MCP app, under /mcp (Supabase exit, wave 2). The host of the office object passes
 * mountOAuth as McpAppOptions.oauth; no Supabase entry has them. The steps run in the office object through SigninOffice.
 */

const OPEN = { 'Access-Control-Allow-Origin': '*' };

export async function formOf(request: Request): Promise<Record<string, string>> {
  try {
    return Object.fromEntries(new URLSearchParams(await readBody(request)));
  } catch {
    return {};
  }
}

export function mountOAuth(app: Hono, office: SigninOffice, o: { mcpUrl: string; jwks: JSONWebKeySet }): void {
  const metadata = authServerMetadata(o.mcpUrl);
  for (const path of WELL_KNOWN) app.get(path, () => Response.json(metadata, { headers: { ...OPEN, 'Cache-Control': 'public, max-age=3600' } }));
  app.get('/oauth/jwks', () => Response.json(o.jwks, { headers: { ...OPEN, 'Cache-Control': 'public, max-age=600' } }));
  app.post('/oauth/register', async (c) => answer(await office.run('oauth.register', { body: await jsonOf(c.req.raw), address: clientAddress(c.req.raw) }), 201));
  app.get('/oauth/authorize', async (c) => {
    const result = await office.run('oauth.authorize', { query: Object.fromEntries(new URL(c.req.url).searchParams) });
    return result.ok ? new Response(null, { status: 302, headers: { Location: result.value.redirect, 'Cache-Control': 'no-store' } }) : answer(result);
  });
}
```

In `server/auth/own/office.ts`, add the two steps to `SIGNIN_STEPS`:

```ts
  'oauth.register': registerClient,
  'oauth.authorize': startAuthorization,
```

with `import { registerClient, startAuthorization } from '../../mcp/oauth/ops';`.

In `server/mcp/app.ts`, add to `McpAppOptions`:

```ts
  /** The OAuth routes of the own sign-in (Supabase exit, wave 2): the host of the office object passes mountOAuth. No Supabase entry has them. */
  oauth?: (app: Hono) => void;
```

and mount it after the `app.use('*', ...)` block, before `app.get(METADATA_PATH, ...)`: `o.oauth?.(app);`.

```ts
// server/http/pagesWellKnown.ts
import type { PagesEnv } from './pagesForward';
import { proxyMcp, type McpProxyOptions } from './pagesMcpProxy';

/**
 * The discovery paths of the own OAuth server (Supabase exit, wave 2). An MCP client tries /.well-known/oauth-authorization-server/mcp
 * first. Wave 5 adds the one-line Pages Function functions/.well-known/[[path]].ts that calls proxyWellKnown, with the switch of the
 * test copy (a new Pages Function runs on production too, so this wave adds none). Only these two paths pass, as
 * /mcp/.well-known/<name>, through the /mcp forwarder and its host list; everything else is 404.
 */
export const WELL_KNOWN_FORWARDS: Readonly<Record<string, string>> = {
  '/.well-known/oauth-authorization-server/mcp': '/mcp/.well-known/oauth-authorization-server',
  '/.well-known/openid-configuration/mcp': '/mcp/.well-known/openid-configuration',
};

export async function proxyWellKnown(request: Request, fetcher: typeof fetch = fetch, env: PagesEnv = {}, o: McpProxyOptions = {}): Promise<Response> {
  const url = new URL(request.url);
  const target = WELL_KNOWN_FORWARDS[url.pathname];
  if (target === undefined || request.method !== 'GET') return new Response('Not found.', { status: 404 });
  return proxyMcp(new Request(new URL(target, url.origin), { method: 'GET', headers: request.headers }), fetcher, env, o);
}
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `npx vitest run --project server server/mcp/oauth server/http/pagesWellKnown.test.ts server/mcp/app.test.ts server/workerGraph.test.ts --no-file-parallelism --testTimeout=60000`
Expected: PASS. With no `oauth` option, the MCP app of today has no new route (app.test.ts stays green).

- [ ] **Step 7: Commit**

```bash
git add server/mcp/oauth server/mcp/app.ts server/auth/own/office.ts server/auth/own/testOffice.ts server/http/pagesWellKnown.ts server/http/pagesWellKnown.test.ts
git commit -m "Exit wave 2: the own OAuth server documents, registers public clients and sends the person to the consent screen"
```

### Task 18: OAuth: the consent with the Madar approval inside, the grants, and the leak tests

**Files:**
- Modify: `server/mcp/oauth/ops.ts` (add `authorizationDetails`, `approveClient`, `answerConsent`, `listGrants`, `revokeGrant`)
- Modify: `server/auth/own/office.ts` (`SIGNIN_STEPS`), `server/auth/own/routes.ts` (the consent routes, `ownApiRoutes`)
- Test: `server/mcp/oauth/consent.test.ts`

**Interfaces:**
- Consumes: `recordApproval`, `APPROVAL_LITE`, `REMOVED_LINK_LITE`, `withApproveRoute`, `APPROVE_PATH` (`approval.ts`, Task 10);
  `principalOf`; `readLiteOffice`; the rows of Task 17; `notApproved` (`agentUser.ts`).
- Produces: `type DetailsAnswer = { redirect_url: string } | { authorization_id: string; client: { id: string; name: string }; redirect_uri: string }`;
  `type GrantRow = { client_id: string; client_name: string; granted_at: string }`; the steps `oauth.details`, `oauth.approve`,
  `oauth.consent`, `oauth.grants`, `oauth.revoke`; the api routes `GET /oauth/authorizations/:id`,
  `POST /oauth/authorizations/:id/consent`, `POST /agents/approve` (own), `POST /oauth/grants`, `POST /oauth/grants/revoke`;
  `ownApiRoutes(office, o): RouteDef[]` = the routes of today with the own approve route in place of `APPROVE_ROUTE`, plus the
  own routes. Wave 3's host passes `ownApiRoutes(...)` as `AppOptions.routes`.

- [ ] **Step 1: Write the failing tests**

```ts
// server/mcp/oauth/consent.test.ts
import { describe, expect, it } from 'vitest';
import { addSignIn } from '../../auth/own/testOffice';
import { browserTokenChecker } from '../../auth/verify';
import { ownIssuer, ownKeySet, ownPublicJwks } from '../../auth/ownKeys';
import { signAgentToken, signBrowserToken } from '../../auth/own/keys';
import { ownApiRoutes } from '../../auth/own/routes';
import type { Deps } from '../../core/ports';
import { apiApp } from '../../http/app';
import { oauthApp, TEST_MCP_URL } from './testApp';

const CALLBACK = 'http://127.0.0.1:33418/callback';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

async function world() {
  const w = await oauthApp();
  const api = apiApp(w.t.deps as unknown as Deps, {
    routes: ownApiRoutes(w.office, { jwks: ownPublicJwks(w.jwk), checkToken: browserTokenChecker({ issuer: ownIssuer(TEST_MCP_URL), jwks: ownKeySet(w.jwk) }) }),
  });
  const person = async (userId: string) => {
    const authId = await addSignIn(w.t, userId, { password: 'a good password' });
    const sessionId = crypto.randomUUID();
    w.t.raw.prepare("insert into auth_sessions (id, auth_id, amr, refresh_hash, expires_at) values (?, ?, 'password', ?, '2026-12-01T00:00:00.000Z')").run(sessionId, authId, `h-${sessionId}`);
    return { authId, token: await signBrowserToken(w.keys, { authId, sessionId, now: new Date() }) };
  };
  const call = async (path: string, token: string, o: { method?: string; body?: unknown } = {}) => {
    const response = await api.request(path, { method: o.method ?? 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(o.body === undefined ? {} : { body: JSON.stringify(o.body) }) });
    return { status: response.status, text: await response.clone().text(), body: (await response.json()) as Record<string, any> };
  };
  const request = async () => {
    const made = (await (await w.root.request('/mcp/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Secret App Name', redirect_uris: [CALLBACK] }) })).json()) as { client_id: string };
    const location = (await w.root.request(`/mcp/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: made.client_id, redirect_uri: CALLBACK, code_challenge: CHALLENGE, code_challenge_method: 'S256', state: 's-1' })}`)).headers.get('location')!;
    return { clientId: made.client_id, id: new URL(location).searchParams.get('authorization_id')! };
  };
  return { w, person, call, request };
}

describe('the consent with the Madar approval inside (server/mcp/oauth/ops.ts)', () => {
  it('shows the request to the person, needs the Madar approval first, then gives a code with the state', async () => {
    const { person, call, request } = await world();
    const hala = await person('usr_002');
    const { clientId, id } = await request();
    expect(await call(`/oauth/authorizations/${id}`, hala.token, { method: 'GET' })).toMatchObject({ status: 200, body: { authorization_id: id, client: { id: clientId, name: 'Secret App Name' }, redirect_uri: CALLBACK } });
    expect(await call(`/oauth/authorizations/${id}/consent`, hala.token, { body: { action: 'approve' } })).toMatchObject({ status: 403, body: { error: { details: { reason: 'agent_not_approved' } } } });
    expect(await call('/agents/approve', hala.token, { body: { authorizationId: id } })).toMatchObject({ status: 200, body: { approved: true } });
    const done = await call(`/oauth/authorizations/${id}/consent`, hala.token, { body: { action: 'approve' } });
    const back = new URL(done.body.redirect_url);
    expect(`${back.origin}${back.pathname}`).toBe(CALLBACK);
    expect(back.searchParams.get('state')).toBe('s-1');
    expect(back.searchParams.get('code')).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('gives a known client of the same person its redirect at once', async () => {
    const { w, person, call } = await world();
    const hala = await person('usr_002');
    const first = await (async () => {
      const made = (await (await w.root.request('/mcp/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: [CALLBACK] }) })).json()) as { client_id: string };
      return made.client_id;
    })();
    const ask = async () => new URL((await w.root.request(`/mcp/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: first, redirect_uri: CALLBACK, code_challenge: CHALLENGE, code_challenge_method: 'S256' })}`)).headers.get('location')!).searchParams.get('authorization_id')!;
    const one = await ask();
    await call(`/oauth/authorizations/${one}`, hala.token, { method: 'GET' });
    await call('/agents/approve', hala.token, { body: { authorizationId: one } });
    await call(`/oauth/authorizations/${one}/consent`, hala.token, { body: { action: 'approve' } });
    const two = await ask();
    expect((await call(`/oauth/authorizations/${two}`, hala.token, { method: 'GET' })).body.redirect_url).toMatch(/^http:\/\/127\.0\.0\.1:33418\/callback\?code=/);
  });

  it('denies with access_denied and the state, and records no approval', async () => {
    const { w, person, call, request } = await world();
    const hala = await person('usr_002');
    const { id } = await request();
    await call(`/oauth/authorizations/${id}`, hala.token, { method: 'GET' });
    const denied = await call(`/oauth/authorizations/${id}/consent`, hala.token, { body: { action: 'deny' } });
    expect(Object.fromEntries(new URL(denied.body.redirect_url).searchParams)).toEqual({ error: 'access_denied', state: 's-1' });
    expect(w.t.raw.prepare('select count(*) as n from agent_approvals').get()).toEqual({ n: 0 });
  });

  it('gives another person the answer of an unknown request, with no client name, on every path', async () => {
    const { person, call, request } = await world();
    const hala = await person('usr_002');
    const omar = await person('usr_003');
    const { id } = await request();
    await call(`/oauth/authorizations/${id}`, hala.token, { method: 'GET' });
    const theirs = await call(`/oauth/authorizations/${id}`, omar.token, { method: 'GET' });
    const unknown = await call('/oauth/authorizations/nothing-here', omar.token, { method: 'GET' });
    expect([theirs.status, theirs.body]).toEqual([unknown.status, unknown.body]);
    expect(theirs).toMatchObject({ status: 404, body: { error: { details: { reason: 'authorization_ended' } } } });
    const consent = await call(`/oauth/authorizations/${id}/consent`, omar.token, { body: { action: 'approve' } });
    const approve = await call('/agents/approve', omar.token, { body: { authorizationId: id } });
    expect(consent.status).toBe(404);
    expect(approve).toMatchObject({ status: 400, body: { error: { details: { reason: 'authorization_ended' } } } });
    for (const answer of [theirs, unknown, consent, approve]) expect(answer.text).not.toContain('Secret App Name');
  });

  it('refuses an agent token on every consent path', async () => {
    const { w, person, call, request } = await world();
    const hala = await person('usr_002');
    const { id } = await request();
    const agent = await signAgentToken(w.keys, { authId: hala.authId, sessionId: 's-a', clientId: 'c-a', now: new Date() });
    for (const [path, method] of [[`/oauth/authorizations/${id}`, 'GET'], [`/oauth/authorizations/${id}/consent`, 'POST'], ['/agents/approve', 'POST'], ['/oauth/grants', 'POST'], ['/oauth/grants/revoke', 'POST']] as const) {
      expect(await call(path, agent, { method, body: method === 'POST' ? { action: 'approve', authorizationId: id, client_id: 'c-a' } : undefined })).toMatchObject({ status: 403, body: { error: { details: { reason: 'agent_token' } } } });
    }
  });

  it('ends a request after 10 minutes', async () => {
    const { w, person, call, request } = await world();
    const hala = await person('usr_002');
    const { id } = await request();
    w.t.raw.prepare("update oauth_requests set expires_at = '2000-01-01T00:00:00.000Z' where id = ?").run(id);
    expect((await call(`/oauth/authorizations/${id}`, hala.token, { method: 'GET' })).status).toBe(404);
  });

  it('lists only the AI apps of the person, and a revoke of the app of another person changes nothing', async () => {
    const { w, person, call } = await world();
    const hala = await person('usr_002');
    const omar = await person('usr_003');
    w.t.raw.exec(`insert into oauth_clients (id, name, redirect_uris) values ('c-h', 'Hala App', '[]'), ('c-o', 'Omar App', '[]')`);
    w.t.raw.prepare("insert into auth_sessions (id, auth_id, client_id, amr, refresh_hash, expires_at) values ('s-h', ?, 'c-h', 'oauth', 'hh', '2099-01-01T00:00:00.000Z'), ('s-o', ?, 'c-o', 'oauth', 'ho', '2099-01-01T00:00:00.000Z')").run(hala.authId, omar.authId);
    expect(await call('/oauth/grants', hala.token)).toMatchObject({ status: 200, body: [{ client_id: 'c-h', client_name: 'Hala App' }] });
    expect((await call('/oauth/grants', hala.token)).text).not.toContain('Omar App');
    expect(await call('/oauth/grants/revoke', hala.token, { body: { client_id: 'c-o' } })).toMatchObject({ status: 200, body: { ok: true } });
    expect(w.t.raw.prepare("select revoked_at from auth_sessions where id = 's-o'").get()).toEqual({ revoked_at: null });
    await call('/oauth/grants/revoke', hala.token, { body: { client_id: 'c-h' } });
    expect((await call('/oauth/grants', hala.token)).body).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run --project server server/mcp/oauth/consent.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL with "ownApiRoutes is not exported".

- [ ] **Step 3: Write the consent steps**

Add to `server/mcp/oauth/ops.ts`:

```ts
export type DetailsAnswer = { redirect_url: string } | { authorization_id: string; client: { id: string; name: string }; redirect_uri: string };
export type GrantRow = { client_id: string; client_name: string; granted_at: string };

function ended(): ApiError {
  return new ApiError('not_found', 'This approval request ended. Start the connection again in your AI app.', { reason: 'authorization_ended' });
}

const open = (request: RequestRow | undefined, authId: string, now: Date): request is RequestRow =>
  request !== undefined && request.status === 'pending' && request.expires_at > now.toISOString() && (request.auth_id === null || request.auth_id === authId);

/**
 * GET /api/oauth/authorizations/:id (the consent screen). The first person who opens a request owns it; for anyone else it reads as
 * an unknown request, with no client name. A client that this person approved before, whose link Madar did not remove, gets its
 * code at once (as Supabase gave the redirect of a known client, proof.md G3).
 */
export async function authorizationDetails(deps: SigninDeps, input: { authId: string; id: string }): Promise<DetailsAnswer> {
  const code = randomToken();
  const codeHash = await sha256Hex(code);
  const now = deps.clock.now();
  return deps.db.tx('write', async (q) => {
    const [request] = await q<RequestRow>(REQUEST_BY_ID, [input.id]);
    if (!open(request, input.authId, now)) throw ended();
    const ownerId = principalOf(input.authId, await readLiteOffice(deps.db as LiteDb, q)).userId;
    if (request.auth_id === null) await q(REQUEST_BIND, [request.id, input.authId]);
    const [approved] = await q(APPROVAL_LITE, [request.client_id, ownerId]);
    const [removed] = await q(REMOVED_LINK_LITE, [request.client_id, ownerId]);
    if (approved && !removed) {
      await q(REQUEST_APPROVE, [request.id, codeHash, new Date(now.getTime() + CODE_LIFE_MS).toISOString()]);
      return { redirect_url: withQuery(request.redirect_uri, { code, state: request.state }) };
    }
    const [client] = await q<ClientRow>(CLIENT_BY_ID, [request.client_id]);
    return { authorization_id: request.id, client: { id: request.client_id, name: client?.name?.trim() ?? '' }, redirect_uri: request.redirect_uri };
  });
}

/** POST /api/agents/approve on the own stack: the Madar approval (recordApproval, approval.ts) of a request of this person. */
export async function approveClient(deps: SigninDeps, input: { authId: string; id: string }): Promise<{ approved: true }> {
  const now = deps.clock.now();
  await deps.db.tx('write', async (q) => {
    const ownerId = principalOf(input.authId, await readLiteOffice(deps.db as LiteDb, q)).userId;
    await recordApproval(q, { authorizationId: input.id, authUserId: input.authId, ownerId, now });
  });
  return { approved: true };
}

/** POST /api/oauth/authorizations/:id/consent. Approve gives a code only after the Madar approval; deny records nothing. */
export async function answerConsent(deps: SigninDeps, input: { authId: string; id: string; action: 'approve' | 'deny' }): Promise<{ redirect_url: string }> {
  const code = randomToken();
  const codeHash = await sha256Hex(code);
  const now = deps.clock.now();
  return deps.db.tx('write', async (q) => {
    const [request] = await q<RequestRow>(REQUEST_BY_ID, [input.id]);
    if (!open(request, input.authId, now) || request.auth_id !== input.authId) throw ended();
    if (input.action === 'deny') {
      await q(REQUEST_DENY, [request.id]);
      return { redirect_url: withQuery(request.redirect_uri, { error: 'access_denied', state: request.state }) };
    }
    const ownerId = principalOf(input.authId, await readLiteOffice(deps.db as LiteDb, q)).userId;
    if ((await q(APPROVAL_LITE, [request.client_id, ownerId])).length === 0) throw notApproved();
    await q(REQUEST_APPROVE, [request.id, codeHash, new Date(now.getTime() + CODE_LIFE_MS).toISOString()]);
    return { redirect_url: withQuery(request.redirect_uri, { code, state: request.state }) };
  });
}

/** POST /api/oauth/grants (Settings, Agents): the AI apps with a live agent session of this person. */
export async function listGrants(deps: SigninDeps, input: { authId: string }): Promise<GrantRow[]> {
  const rows = await deps.db.statement<GrantRow>('read', GRANTS_LITE, [input.authId, deps.clock.now().toISOString()]);
  return [...rows].sort((a, b) => a.granted_at.localeCompare(b.granted_at) || a.client_id.localeCompare(b.client_id));
}

/** POST /api/oauth/grants/revoke: ends the agent sessions of one AI app of this person. An app with none is done already. */
export async function revokeGrant(deps: SigninDeps, input: { authId: string; clientId: string }): Promise<{ ok: true }> {
  await deps.db.tx('write', (q) => q(GRANT_REVOKE, [input.authId, input.clientId, deps.clock.now().toISOString()]));
  return { ok: true };
}
```

Imports to add: `ApiError` from `../../../src/api/errors`; `sha256Hex` from `../../auth/own/crypto`; `principalOf` from
`../../auth/principal`; `type LiteDb` from `../../data/lite/db`; `readLiteOffice` from `../../data/lite/office`; `notApproved`
from `../agentUser`; `APPROVAL_LITE`, `recordApproval`, `REMOVED_LINK_LITE` from `../approval`; the rows texts
`CLIENT_BY_ID`, `GRANT_REVOKE`, `GRANTS_LITE`, `REQUEST_APPROVE`, `REQUEST_BIND`, `REQUEST_BY_ID`, `REQUEST_DENY`,
`type RequestRow`.

- [ ] **Step 4: Add the steps and the routes**

In `server/auth/own/office.ts`, add to `SIGNIN_STEPS`:

```ts
  'oauth.details': authorizationDetails,
  'oauth.approve': approveClient,
  'oauth.consent': answerConsent,
  'oauth.grants': listGrants,
  'oauth.revoke': revokeGrant,
```

In `server/auth/own/routes.ts`, add the id reader, the routes at the end of the list of `ownAuthRoutes`, and `ownApiRoutes`:

```ts
const idOf = (request: Request): string => decodeURIComponent(/\/oauth\/authorizations\/([^/]+)/.exec(new URL(request.url).pathname)?.[1] ?? '');
```

```ts
    {
      method: 'GET', path: '/oauth/authorizations/:id', handler: signedIn(check, async (request, who) => answer(await office.run('oauth.details', { authId: who.authId, id: idOf(request) }))),
    },
    {
      method: 'POST', path: '/oauth/authorizations/:id/consent', handler: signedIn(check, async (request, who) => {
        const body = await jsonOf(request);
        return answer(await office.run('oauth.consent', { authId: who.authId, id: idOf(request), action: body.action === 'approve' ? 'approve' : 'deny' }));
      }),
    },
    {
      method: 'POST', path: APPROVE_PATH, handler: signedIn(check, async (request, who) => {
        const body = await jsonOf(request);
        return answer(await office.run('oauth.approve', { authId: who.authId, id: text(body.authorizationId) }));
      }),
    },
    { method: 'POST', path: '/oauth/grants', handler: signedIn(check, async (_request, who) => answer(await office.run('oauth.grants', { authId: who.authId }))) },
    {
      method: 'POST', path: '/oauth/grants/revoke', handler: signedIn(check, async (request, who) => {
        const body = await jsonOf(request);
        return answer(await office.run('oauth.revoke', { authId: who.authId, clientId: text(body.client_id) }));
      }),
    },
```

```ts
/** The routes of the api app of the own stack: the routes of today, with the own approve route in place of the Supabase one. */
export function ownApiRoutes(office: SigninOffice, o: OwnRouteOptions): RouteDef[] {
  const own = ownAuthRoutes(office, o);
  const approve = own.find((route) => route.path === APPROVE_PATH)!;
  return [...withApproveRoute(ROUTES, approve), ...own.filter((route) => route !== approve)];
}
```

Imports: `APPROVE_PATH`, `withApproveRoute` from `../../mcp/approval`; `ROUTES` from `../../http/routes`.

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run --project server server/mcp/oauth server/auth/own server/mcp/approval.test.ts --no-file-parallelism --testTimeout=60000`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/mcp/oauth/ops.ts server/mcp/oauth/consent.test.ts server/auth/own/office.ts server/auth/own/routes.ts
git commit -m "Exit wave 2: the consent gives a code only after the Madar approval, and no other person reads a request or a grant"
```

### Task 19: OAuth: the token step, and the whole flow of an MCP client library

**Files:**
- Modify: `package.json`, `package-lock.json` (`@modelcontextprotocol/sdk` 1.32.0 in `devDependencies`)
- Modify: `server/mcp/oauth/ops.ts` (add `exchangeToken`), `server/mcp/oauth/routes.ts` (add `POST /oauth/token`),
  `server/auth/own/office.ts` (`oauth.token`)
- Test: `server/mcp/oauth/sdk.test.ts`

**Interfaces:**
- Consumes: `rotateSession`, `insertSession`, `sessionEnded` (Tasks 11, 12); `signAgentToken`; `pkceChallengeOf`, `equalText`;
  `REQUEST_BY_CODE`, `REQUEST_USED`; `oauthApp` (Task 17).
- Produces: `type AgentTokenAnswer = { access_token: string; token_type: 'Bearer'; expires_in: number; refresh_token: string; scope: string }`;
  `exchangeToken(deps, { form }): Promise<AgentTokenAnswer>`; `POST /mcp/oauth/token` (form body, RFC 6749 section 4.1.3 and 6).

- [ ] **Step 1: Add the SDK as a test package**

```bash
npm install --save-dev --save-exact @modelcontextprotocol/sdk@1.32.0
```

Expected: `package.json` gets `"@modelcontextprotocol/sdk": "1.32.0"` in `devDependencies`; the lock keeps the same version
that `@modelcontextprotocol/conformance` 0.1.16 already pulls in.

- [ ] **Step 2: Write the failing test**

```ts
// server/mcp/oauth/sdk.test.ts
import {
  discoverAuthorizationServerMetadata, exchangeAuthorization, refreshAuthorization, registerClient, startAuthorization,
} from '@modelcontextprotocol/sdk/client/auth.js';
import { describe, expect, it } from 'vitest';
import { addSignIn } from '../../auth/own/testOffice';
import { oauthApp, TEST_MCP_URL } from './testApp';

const CALLBACK = 'http://127.0.0.1:33418/callback';

async function mcpPost(root: Awaited<ReturnType<typeof oauthApp>>['root'], token: string) {
  const response = await root.request('/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  const text = await response.text();
  const json = text.startsWith('event:') ? text.split('\n').find((line) => line.startsWith('data: '))!.slice(6) : text;
  return { status: response.status, body: (json ? JSON.parse(json) : {}) as Record<string, any> };
}

describe('an MCP client library against the own OAuth server (@modelcontextprotocol/sdk 1.32.0)', () => {
  it('discovers, registers, gets a code through the Madar approval, exchanges it with PKCE, calls Madar, and refreshes', async () => {
    const w = await oauthApp();
    const fetchFn = (url: string | URL, init?: RequestInit) => w.root.fetch(new Request(url, init));
    const metadata = await discoverAuthorizationServerMetadata(TEST_MCP_URL, { fetchFn });
    expect(metadata?.issuer).toBe(TEST_MCP_URL);
    const client = await registerClient(TEST_MCP_URL, { metadata, clientMetadata: { client_name: 'Claude Code', redirect_uris: [CALLBACK], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }, fetchFn });
    const { authorizationUrl, codeVerifier } = await startAuthorization(TEST_MCP_URL, { metadata, clientInformation: client, redirectUrl: CALLBACK, state: 's-1', resource: new URL(TEST_MCP_URL) });
    const consent = new URL((await fetchFn(authorizationUrl, { redirect: 'manual' })).headers.get('location')!);
    const id = consent.searchParams.get('authorization_id')!;

    // The person on the consent screen: the steps that the api routes run (Task 18).
    const authId = await addSignIn(w.t, 'usr_002', { password: 'a good password' });
    expect(await w.office.run('oauth.details', { authId, id })).toMatchObject({ ok: true });
    expect(await w.office.run('oauth.approve', { authId, id })).toMatchObject({ ok: true });
    const answered = await w.office.run('oauth.consent', { authId, id, action: 'approve' });
    if (!answered.ok) throw new Error('The consent failed.');
    const code = new URL(answered.value.redirect_url).searchParams.get('code')!;

    const tokens = await exchangeAuthorization(TEST_MCP_URL, { metadata, clientInformation: client, authorizationCode: code, codeVerifier, redirectUri: CALLBACK, resource: new URL(TEST_MCP_URL), fetchFn });
    expect(tokens).toMatchObject({ token_type: 'Bearer', expires_in: 900 });
    const first = await mcpPost(w.root, tokens.access_token);
    expect(first.status).toBe(200);
    expect(first.body.result.tools).toHaveLength(41);
    expect(w.t.raw.prepare('select owner_user_id from agent_links').get()).toEqual({ owner_user_id: 'usr_002' });

    const again = await refreshAuthorization(TEST_MCP_URL, { metadata, clientInformation: client, refreshToken: tokens.refresh_token!, resource: new URL(TEST_MCP_URL), fetchFn });
    expect(again.refresh_token).not.toBe(tokens.refresh_token);
    expect((await mcpPost(w.root, again.access_token)).status).toBe(200);
    await expect(exchangeAuthorization(TEST_MCP_URL, { metadata, clientInformation: client, authorizationCode: code, codeVerifier, redirectUri: CALLBACK, resource: new URL(TEST_MCP_URL), fetchFn })).rejects.toThrow();
  });

  it('refuses a wrong PKCE verifier, another client and an old code', async () => {
    const w = await oauthApp();
    const register = async () => (await (await w.root.request('/mcp/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: [CALLBACK] }) })).json()) as { client_id: string };
    const mine = await register();
    const other = await register();
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const location = (await w.root.request(`/mcp/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: mine.client_id, redirect_uri: CALLBACK, code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', code_challenge_method: 'S256' })}`)).headers.get('location')!;
    const id = new URL(location).searchParams.get('authorization_id')!;
    const authId = await addSignIn(w.t, 'usr_002', { password: 'a good password' });
    await w.office.run('oauth.details', { authId, id });
    await w.office.run('oauth.approve', { authId, id });
    const answered = await w.office.run('oauth.consent', { authId, id, action: 'approve' });
    if (!answered.ok) throw new Error('The consent failed.');
    const code = new URL(answered.value.redirect_url).searchParams.get('code')!;
    const token = (form: Record<string, string>) => w.root.request('/mcp/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: CALLBACK, ...form }).toString() });
    expect((await (await token({ client_id: mine.client_id, code_verifier: 'x'.repeat(43) })).json())).toMatchObject({ error: 'invalid_grant' });
    expect((await token({ client_id: other.client_id, code_verifier: verifier })).status).toBe(400);
    w.t.deps.clock.advance(61_000);
    expect((await (await token({ client_id: mine.client_id, code_verifier: verifier })).json())).toMatchObject({ error: 'invalid_grant' });
    expect((await (await w.root.request('/mcp/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=password' })).json())).toMatchObject({ error: 'unsupported_grant_type' });
  });
});
```

- [ ] **Step 3: Run the test to see it fail**

Run: `npx vitest run --project server server/mcp/oauth/sdk.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL: `exchangeAuthorization` gets 404 from `/mcp/oauth/token`.

- [ ] **Step 4: Write the token step and its route**

Add to `server/mcp/oauth/ops.ts`:

```ts
export type AgentTokenAnswer = { access_token: string; token_type: 'Bearer'; expires_in: number; refresh_token: string; scope: string };

const invalidGrant = () => new OAuthError(400, 'invalid_grant', 'The code or the refresh token is not valid. Connect Madar again in the AI app.');

async function agentAnswer(deps: SigninDeps, o: { authId: string; sessionId: string; clientId: string; refresh: string }): Promise<AgentTokenAnswer> {
  const accessToken = await signAgentToken(deps.keys, { authId: o.authId, sessionId: o.sessionId, clientId: o.clientId, now: deps.clock.now() });
  return { access_token: accessToken, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: o.refresh, scope: 'madar' };
}

/**
 * POST /mcp/oauth/token (form body). authorization_code: the code of an approved request works once and for 60 s, for its own client
 * and return address, with the PKCE verifier of its challenge, and opens an agent session. refresh_token: the rotation of
 * sessions.ts with the client of the session. The first MCP call then links the agent (ensureAgentUser, on the Madar approval).
 */
export async function exchangeToken(deps: SigninDeps, input: { form: Record<string, string> }): Promise<AgentTokenAnswer> {
  const f = input.form;
  if (f.resource !== undefined && ownIssuer(f.resource) !== ownIssuer(deps.config.mcpUrl)) throw new OAuthError(400, 'invalid_target', 'This token is for Madar\'s MCP address only.');
  const refresh = randomToken();
  const refreshHash = await sha256Hex(refresh);
  if (f.grant_type === 'refresh_token') {
    if (!f.refresh_token || !f.client_id) throw new OAuthError(400, 'invalid_request', 'Send refresh_token and client_id.');
    try {
      const row = await rotateSession(deps, { hash: await sha256Hex(f.refresh_token), nextHash: refreshHash, clientId: f.client_id });
      return agentAnswer(deps, { authId: row.auth_id, sessionId: row.id, clientId: f.client_id, refresh });
    } catch (error) {
      if (error instanceof ApiError) throw invalidGrant();
      throw error;
    }
  }
  if (f.grant_type !== 'authorization_code') throw new OAuthError(400, 'unsupported_grant_type', 'Madar takes authorization_code and refresh_token.');
  if (!f.code || !f.code_verifier || !f.client_id || !f.redirect_uri) throw new OAuthError(400, 'invalid_request', 'Send code, code_verifier, client_id and redirect_uri.');
  const codeHash = await sha256Hex(f.code);
  const challenge = await pkceChallengeOf(f.code_verifier);
  const now = deps.clock.now();
  const opened = await deps.db.tx('write', async (q) => {
    const [request] = await q<RequestRow>(REQUEST_BY_CODE, [codeHash]);
    if (!request || request.status !== 'approved' || request.auth_id === null || request.code_until === null || request.code_until <= now.toISOString()) return null;
    if (request.client_id !== f.client_id || request.redirect_uri !== f.redirect_uri || !equalText(challenge, request.code_challenge)) return null;
    const [user] = await q<AuthUserRow>(AUTH_USER_BY_ID, [request.auth_id]);
    if (!user || user.banned === 1) return null;
    const office = await readLiteOffice(deps.db as LiteDb, q);
    const ownerId = userIdOfAuth(office, request.auth_id);
    if (ownerId === undefined || office.lists.users[ownerId]?.active !== true) return null;
    await q(REQUEST_USED, [request.id]);
    const sessionId = await insertSession(q, { authId: request.auth_id, clientId: request.client_id, amr: 'oauth', refreshHash, linkUntil: null, now });
    return { authId: request.auth_id, clientId: request.client_id, sessionId };
  });
  if (!opened) throw invalidGrant();
  return agentAnswer(deps, { ...opened, refresh });
}
```

Imports to add: `equalText`, `pkceChallengeOf` from `../../auth/own/crypto`; `signAgentToken` from `../../auth/own/keys`;
`AUTH_USER_BY_ID`, `type AuthUserRow` from `../../auth/own/rows`; `insertSession`, `rotateSession` from `../../auth/own/sessions`;
`ACCESS_TTL_S` from `../../auth/ownKeys`; `userIdOfAuth` from `../../data/officeCache`; `REQUEST_BY_CODE`, `REQUEST_USED` from
`./rows`.

In `server/mcp/oauth/routes.ts`, add to `mountOAuth`:

```ts
  app.post('/oauth/token', async (c) => answer(await office.run('oauth.token', { form: await formOf(c.req.raw) })));
```

In `server/auth/own/office.ts`, add `'oauth.token': exchangeToken,` to `SIGNIN_STEPS`.

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run --project server server/mcp/oauth server/mcp/app.test.ts server/workerGraph.test.ts --no-file-parallelism --testTimeout=60000`
Expected: PASS. The first test is the proof that a real MCP client library finds the own server through the third discovery
path, gets a token through the Madar approval, and calls Madar on the SQLite path.

- [ ] **Step 6: Run test:mcp (Docker) to see the Supabase path of today stay green**

Take the lock and reset the local stack first (`server/mcp/CLAUDE.md`):

```bash
npm run build:server
scripts/dev/docker-lock.sh run exit-signin -- sh -c 'npx supabase db reset && npm run test:mcp'
```

Expected: the MCP tests pass, and the conformance runner gives the baseline of today (5 of 32, no failure outside
`conformance-baseline.yml`). Then run `npx supabase db reset` again, as the guide says, before any `test:it`.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json server/mcp/oauth/ops.ts server/mcp/oauth/routes.ts server/mcp/oauth/sdk.test.ts server/auth/own/office.ts
git commit -m "Exit wave 2: the token step of the own OAuth server, and an MCP client library connects and calls Madar through it"
```

### Task 20: The screens: the Madar sign-in port

Today the screens sign in only through supabase-js: `src/app/remote/supabase.ts` (the client), `src/app/remote/auth.ts` (the
port), `src/app/remote/bootstrap.ts` (`refreshSession`, the Realtime client), `src/app/remote/channel.ts` (Realtime, wave 3),
and `src/features/oauth/oauthPort.tsx` (the Auth OAuth routes over plain HTTP). This task adds the second port; Task 21 picks one
at build time. No screen file that renders changes: `WelcomeScreen`, `ResetScreen`, `SignInScreen`, `PasswordSection` and
`ConsentScreen` keep their code, because both ports give the same `AuthPort` and `OAuthPort`.

**Files:**
- Create: `src/app/remote/authMail.ts`, `src/app/remote/madarAuth.ts`
- Modify: `src/app/auth.ts:8-40` (`AuthPort.refresh?`), `src/app/remote/auth.ts:136-159` (use `authMail.ts`)
- Test: `src/app/remote/madarAuth.test.ts`

**Interfaces:**
- Consumes: the routes of Task 15 (`/auth/token`, `/auth/verify`, `/auth/password`, `/auth/logout`) and of today
  (`/auth/forgot`, `/auth/renew-invite`); `AuthFailure`, `markLeaving`, `clearLeaving`, `leftOnPurpose`; `regionUrl`.
- Produces: `AuthPort.refresh?(): Promise<void>`; `requestResetAt(send, url, email)`, `renewInviteAt(send, url, key)`;
  `SESSION_KEY = 'madar.session'`; `createMadarAuth(o: { apiUrl: string; fetch?; storage?; locks?; now?; events? }): Promise<AuthPort>`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/app/remote/madarAuth.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthFailure } from '../../features/auth/authFailure';
import type { AuthStatus } from '../auth';
import { createMadarAuth, SESSION_KEY } from './madarAuth';

/** A listener that also reads the change; AuthPort types it with the status alone, as personChangeSource casts it. */
const withChange = (fn: (status: AuthStatus, change?: string) => void) => fn as (status: AuthStatus) => void;

type Call = { path: string; body: Record<string, unknown>; token: string | null };

function fakeServer() {
  const calls: Call[] = [];
  let n = 0;
  const tokens = (userId = 'auth-1') => ({ access_token: `access-${++n}`, refresh_token: `refresh-${n}`, expires_in: 900, token_type: 'bearer', user: { id: userId } });
  const routes: Record<string, (body: Record<string, unknown>) => Response> = {
    '/api/auth/token': (body) => body.grant_type === 'refresh_token' && body.refresh_token === 'refused'
      ? Response.json({ v: 1, error: { code: 'unauthenticated', message: 'This sign-in ended. Sign in again.', details: { reason: 'session_ended' } } }, { status: 401 })
      : body.password === 'wrong'
        ? Response.json({ v: 1, error: { code: 'unauthenticated', message: 'no', details: { reason: 'invalid_credentials' } } }, { status: 401 })
        : Response.json(tokens(String(body.email ?? 'x').startsWith('other') ? 'auth-2' : 'auth-1')),
    '/api/auth/verify': (body) => body.token_hash === 'used'
      ? Response.json({ v: 1, error: { code: 'unauthenticated', message: 'This link ended. Ask for a new one.', details: { reason: 'link_ended' } } }, { status: 401 })
      : Response.json(tokens()),
    '/api/auth/password': (body) => body.current === 'wrong'
      ? Response.json({ v: 1, error: { code: 'unauthenticated', message: 'no', details: { reason: 'invalid_credentials' } } }, { status: 401 })
      : Response.json({ ok: true }),
    '/api/auth/logout': () => Response.json({ ok: true }),
  };
  const fetch = async (input: string, init?: RequestInit) => {
    const path = new URL(input, 'https://madar.test').pathname;
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    calls.push({ path, body, token: new Headers(init?.headers).get('Authorization') });
    return routes[path]?.(body) ?? new Response('not found', { status: 404 });
  };
  return { calls, fetch };
}

function fakeLocks() {
  let chain: Promise<unknown> = Promise.resolve();
  return {
    request<T>(_name: string, work: () => Promise<T>): Promise<T> {
      const run = chain.then(work);
      chain = run.then(() => undefined, () => undefined);
      return run;
    },
  };
}

const events = new EventTarget();
let clock = 1_000_000;
const make = (server: ReturnType<typeof fakeServer>, locks = fakeLocks()) =>
  createMadarAuth({ apiUrl: '/api', fetch: server.fetch, storage: window.localStorage, locks, now: () => clock, events: events as unknown as Window });

beforeEach(() => {
  window.localStorage.clear();
  clock = 1_000_000;
});

describe('the Madar sign-in port of the screens (src/app/remote/madarAuth.ts)', () => {
  it('signs in, keeps the session for every tab of the browser, and gives the token', async () => {
    const server = fakeServer();
    const auth = await make(server);
    await auth.signIn('hala@madar.test', 'a good password');
    expect(auth.status()).toBe('signed_in');
    expect(auth.userId?.()).toBe('auth-1');
    expect(await auth.accessToken()).toBe('access-1');
    expect(JSON.parse(window.localStorage.getItem(SESSION_KEY)!)).toMatchObject({ accessToken: 'access-1', refreshToken: 'refresh-1', userId: 'auth-1' });
    expect(server.calls[0]).toMatchObject({ path: '/api/auth/token', body: { grant_type: 'password', email: 'hala@madar.test', password: 'a good password' } });
  });

  it('turns each refusal into a reason that the screens can say', async () => {
    const auth = await make(fakeServer());
    await expect(auth.signIn('hala@madar.test', 'wrong')).rejects.toMatchObject({ reason: 'wrong_credentials' });
    const limited = await createMadarAuth({ apiUrl: '/api', fetch: async () => new Response('{}', { status: 429 }), storage: window.localStorage, locks: fakeLocks(), now: () => clock, events: events as unknown as Window });
    await expect(limited.signIn('a@madar.test', 'x')).rejects.toMatchObject({ reason: 'too_many' });
    const offline = await createMadarAuth({ apiUrl: '/api', fetch: async () => { throw new TypeError('Failed to fetch'); }, storage: window.localStorage, locks: fakeLocks(), now: () => clock, events: events as unknown as Window });
    await expect(offline.signIn('a@madar.test', 'x')).rejects.toBeInstanceOf(AuthFailure);
    await expect(offline.signIn('a@madar.test', 'x')).rejects.toMatchObject({ reason: 'offline' });
  });

  it('two tabs refresh under one lock, and the second tab uses the token of the first', async () => {
    const server = fakeServer();
    const locks = fakeLocks();
    const tabA = await make(server, locks);
    await tabA.signIn('hala@madar.test', 'a good password');
    const tabB = await make(server, locks);
    clock += 850_000;
    const [a, b] = await Promise.all([tabA.accessToken(), tabB.accessToken()]);
    expect(a).toBe('access-2');
    expect(b).toBe('access-2');
    expect(server.calls.filter((call) => call.body.grant_type === 'refresh_token')).toHaveLength(1);
  });

  it('ends the session in this browser when the server refuses the refresh', async () => {
    const server = fakeServer();
    const auth = await make(server);
    await auth.signIn('hala@madar.test', 'a good password');
    window.localStorage.setItem(SESSION_KEY, JSON.stringify({ ...JSON.parse(window.localStorage.getItem(SESSION_KEY)!), refreshToken: 'refused' }));
    const seen: string[] = [];
    auth.subscribe((status) => void seen.push(status));
    clock += 900_000;
    expect(await auth.accessToken()).toBeNull();
    expect([auth.status(), seen, window.localStorage.getItem(SESSION_KEY)]).toEqual(['signed_out', ['signed_out'], null]);
  });

  it('opens a link session for Welcome and Reset, and says link_ended for a used link', async () => {
    const auth = await make(fakeServer());
    await auth.verifyLink('fresh', 'invite');
    expect(auth.status()).toBe('signed_in');
    await expect(auth.verifyLink('used', 'recovery')).rejects.toMatchObject({ reason: 'link_ended' });
  });

  it('sets a password with the token of the session, and maps a wrong current password', async () => {
    const server = fakeServer();
    const auth = await make(server);
    await auth.signIn('hala@madar.test', 'a good password');
    await auth.setPassword('a new password');
    expect(server.calls.at(-1)).toMatchObject({ path: '/api/auth/password', body: { password: 'a new password' }, token: 'Bearer access-1' });
    await expect(auth.changePassword('wrong', 'another one')).rejects.toMatchObject({ reason: 'wrong_credentials' });
  });

  it('signs out this device with the mark of a sign-out on purpose, and signs out the others with the token', async () => {
    const server = fakeServer();
    const auth = await make(server);
    await auth.signIn('hala@madar.test', 'a good password');
    await auth.signOut({ scope: 'others' });
    expect(server.calls.at(-1)).toMatchObject({ path: '/api/auth/logout', body: { scope: 'others' }, token: 'Bearer access-1' });
    expect(auth.status()).toBe('signed_in');
    const changes: (string | undefined)[] = [];
    auth.subscribe(withChange((_status, change) => void changes.push(change)));
    await auth.signOut();
    expect([auth.status(), changes, window.localStorage.getItem(SESSION_KEY)]).toEqual(['signed_out', ['left'], null]);
  });

  it('follows a sign-in of another person in another tab', async () => {
    const server = fakeServer();
    const auth = await make(server);
    await auth.signIn('hala@madar.test', 'a good password');
    const changes: (string | undefined)[] = [];
    auth.subscribe(withChange((_status, change) => void changes.push(change)));
    window.localStorage.setItem(SESSION_KEY, JSON.stringify({ accessToken: 'x', refreshToken: 'y', expiresAt: clock + 900_000, userId: 'auth-2' }));
    events.dispatchEvent(Object.assign(new Event('storage'), { key: SESSION_KEY }));
    expect(changes).toEqual(['person']);
    expect(auth.userId?.()).toBe('auth-2');
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run --project unit src/app/remote/madarAuth.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL with "Failed to load url ./madarAuth".

- [ ] **Step 3: Share the two mail requests, and give the port an optional refresh**

In `src/app/auth.ts`, add to `AuthPort` after `accessToken`:

```ts
  /** A refresh now (a 401 with a token that has not ended). The Madar port has it; the Supabase port refreshes through supabase-js. */
  refresh?(): Promise<void>;
```

```ts
// src/app/remote/authMail.ts
import { AuthFailure } from '../../features/auth/authFailure';

/** The two mail requests of the sign-in screens, the same for the Supabase port and the Madar port (server/auth/forgot.ts, renew.ts). */
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const postJson = async (send: Fetch, url: string, body: unknown): Promise<Response> => {
  try {
    return await send(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch (error) {
    throw new AuthFailure('offline', error instanceof Error ? error.message : 'The request did not reach Madar.');
  }
};

export async function requestResetAt(send: Fetch, url: string, email: string): Promise<void> {
  const response = await postJson(send, url, { email });
  if (response.status === 429) {
    // The limit of one email (server/auth/forgot.ts) has its own words: reset mails already went to it.
    const body = (await response.json().catch(() => null)) as { error?: { details?: { reason?: unknown } } } | null;
    throw new AuthFailure(body?.error?.details?.reason === 'too_many_resets_email' ? 'too_many_resets' : 'too_many');
  }
  if (!response.ok) throw new AuthFailure('failed', `The reset request failed with ${response.status}.`);
}

export async function renewInviteAt(send: Fetch, url: string, key: string): Promise<void> {
  const response = await postJson(send, url, { key });
  if (response.status === 429) throw new AuthFailure('too_many');
  if (!response.ok) throw new AuthFailure('failed', `The request for a new invitation link failed with ${response.status}.`);
}
```

In `src/app/remote/auth.ts`, replace the bodies of `requestReset` and `renewInvite` (lines 136 to 159):

```ts
    requestReset: (email) => requestResetAt(send, forgotUrl, email),
    renewInvite: (key) => renewInviteAt(send, renewUrl, key),
```

with `import { renewInviteAt, requestResetAt } from './authMail';`.

- [ ] **Step 4: Write the Madar port**

```ts
// src/app/remote/madarAuth.ts
import { regionUrl } from '../../api/remote/region';
import { AuthFailure, type AuthFailureReason } from '../../features/auth/authFailure';
import { clearLeaving, leftOnPurpose, markLeaving, type SessionChange, type SessionListener } from '../../features/auth/sessionEnd';
import type { AuthPort, AuthStatus } from '../auth';
import { renewInviteAt, requestResetAt } from './authMail';

/**
 * The sign-in port of the real screens over the own sign-in of Madar (Supabase exit, wave 2), the twin of the Supabase port of
 * auth.ts. The build picks one (authMode.ts, VITE_MADAR_AUTH); both copies keep the Supabase port until the switch.
 * - The session (the tokens and the person) lives in localStorage under madar.session: every tab of the browser shares it, and a
 *   storage event tells the other tabs of a sign-in, a refresh or a sign-out.
 * - A refresh runs under one Web Lock for the whole browser (navigator.locks) and reads the stored session again inside it: a tab
 *   that waited uses the tokens of the tab that refreshed, so two tabs never send one refresh token (the server keeps a 10 s
 *   reuse window for a lost answer too).
 * - A token is refreshed 60 s before its end, when a call asks for it. A refused refresh ends the session in this browser.
 */

export const SESSION_KEY = 'madar.session';
const EARLY_MS = 60_000;

type Kept = { accessToken: string; refreshToken: string; expiresAt: number; userId: string };
type Locks = { request<T>(name: string, work: () => Promise<T>): Promise<T> };
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const REASONS: Readonly<Record<string, AuthFailureReason>> = {
  invalid_credentials: 'wrong_credentials', current_password_required: 'wrong_credentials', account_off: 'account_off',
  link_ended: 'link_ended', weak: 'weak', same: 'same', too_many: 'too_many',
};

export async function createMadarAuth(o: {
  apiUrl: string; fetch?: Fetch; storage?: Storage; locks?: Locks; now?: () => number; events?: Pick<Window, 'addEventListener'>;
}): Promise<AuthPort> {
  const send: Fetch = o.fetch ?? ((input, init) => fetch(input, init));
  const storage = o.storage ?? window.localStorage;
  const locks: Locks = o.locks ?? (navigator as Navigator & { locks?: Locks }).locks ?? { request: (_name, work) => work() };
  const now = o.now ?? (() => Date.now());
  const base = o.apiUrl.replace(/\/+$/, '');
  const url = (path: string) => regionUrl(`${base}${path}`);
  const listeners = new Set<SessionListener>();

  const read = (): Kept | null => {
    try {
      const text = storage.getItem(SESSION_KEY);
      return text ? (JSON.parse(text) as Kept) : null;
    } catch {
      return null;
    }
  };
  const write = (kept: Kept | null) => {
    try {
      if (kept) storage.setItem(SESSION_KEY, JSON.stringify(kept));
      else storage.removeItem(SESSION_KEY);
    } catch {
      // Blocked storage: the session lives in this tab only.
    }
  };

  let status: AuthStatus = read() ? 'signed_in' : 'signed_out';
  let userId: string | null = read()?.userId ?? null;
  const tell = (next: AuthStatus, change?: SessionChange) => {
    status = next;
    for (const listener of [...listeners]) listener(next, change);
  };
  const follow = (kept: Kept | null, change?: SessionChange) => {
    const next: AuthStatus = kept ? 'signed_in' : 'signed_out';
    const otherPerson = kept !== null && userId !== null && kept.userId !== userId;
    if (kept) userId = kept.userId;
    if (otherPerson) tell(next, 'person');
    else if (next !== status) tell(next, change ?? (next === 'signed_out' && leftOnPurpose() ? 'left' : undefined));
  };
  (o.events ?? window).addEventListener('storage', (event: Event) => {
    const key = (event as StorageEvent).key;
    if (key === SESSION_KEY || key === null) follow(read());
  });

  async function post(path: string, body: unknown, token?: string): Promise<Response> {
    try {
      return await send(url(path), { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    } catch (error) {
      throw new AuthFailure('offline', error instanceof Error ? error.message : 'The request did not reach Madar.');
    }
  }

  async function failure(response: Response): Promise<AuthFailure> {
    if (response.status === 429) return new AuthFailure('too_many');
    const body = (await response.json().catch(() => null)) as { error?: { message?: string; details?: { reason?: unknown } } } | null;
    const reason = typeof body?.error?.details?.reason === 'string' ? REASONS[body.error.details.reason] : undefined;
    return new AuthFailure(reason ?? 'failed', body?.error?.message ?? `Madar answered ${response.status}.`);
  }

  async function keep(response: Response): Promise<Kept> {
    if (!response.ok) throw await failure(response);
    const body = (await response.json()) as { access_token: string; refresh_token: string; expires_in: number; user: { id: string } };
    const kept: Kept = { accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt: now() + body.expires_in * 1000, userId: body.user.id };
    write(kept);
    return kept;
  }

  function refresh(): Promise<Kept | null> {
    return locks.request(SESSION_KEY, async () => {
      const kept = read();
      if (!kept) return null;
      // Another tab refreshed while this one waited for the lock.
      if (kept.expiresAt - now() > EARLY_MS) return kept;
      const response = await post('/auth/token', { grant_type: 'refresh_token', refresh_token: kept.refreshToken });
      if (response.ok) return keep(response);
      if (response.status === 400 || response.status === 401 || response.status === 403) {
        write(null);
        follow(null);
        return null;
      }
      throw await failure(response);
    });
  }

  async function accessToken(): Promise<string | null> {
    const kept = read();
    if (!kept) return null;
    if (kept.expiresAt - now() > EARLY_MS) return kept.accessToken;
    return (await refresh())?.accessToken ?? null;
  }

  async function withToken(path: string, body: unknown): Promise<void> {
    const token = await accessToken();
    if (!token) throw new AuthFailure('failed', 'No session.');
    const response = await post(path, body, token);
    if (!response.ok) throw await failure(response);
  }

  return {
    status: () => status,
    userId: () => (status === 'signed_in' ? userId : null),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async signIn(email, password) {
      clearLeaving();
      follow(await keep(await post('/auth/token', { grant_type: 'password', email, password })));
    },
    async signOut(options) {
      if (options?.scope === 'others') {
        await withToken('/auth/logout', { scope: 'others' });
        return;
      }
      // This device only. The mark first, so the other tabs read this sign-out as one on purpose.
      markLeaving();
      const token = await accessToken().catch(() => null);
      if (token) await post('/auth/logout', { scope: 'local' }, token).catch(() => undefined);
      write(null);
      follow(null, 'left');
    },
    accessToken,
    async refresh() {
      await refresh();
    },
    async verifyLink(tokenHash, type) {
      clearLeaving();
      follow(await keep(await post('/auth/verify', { token_hash: tokenHash, type })));
    },
    setPassword: (password) => withToken('/auth/password', { password }),
    changePassword: (current, next) => withToken('/auth/password', { password: next, current }),
    requestReset: (email) => requestResetAt(send, url('/auth/forgot'), email),
    renewInvite: (key) => renewInviteAt(send, url('/auth/renew-invite'), key),
  };
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run --project unit src/app/remote/madarAuth.test.ts src/app/remote/auth.test.ts --no-file-parallelism --testTimeout=60000`
Expected: PASS. The tests of the Supabase port stay green: its two mail requests send the same requests as before.

- [ ] **Step 6: Commit**

```bash
git add src/app/auth.ts src/app/remote/authMail.ts src/app/remote/madarAuth.ts src/app/remote/auth.ts src/app/remote/madarAuth.test.ts
git commit -m "Exit wave 2: the Madar sign-in port of the screens, with one refresh for all tabs under a Web Lock"
```

### Task 21: The screens: the OAuth port, and the choice at build time

**Files:**
- Create: `src/app/remote/authMode.ts`
- Modify: `src/env.d.ts` (`VITE_MADAR_AUTH`), `src/app/remote/bootstrap.ts:20-39` (`RemoteConfig`, `remoteConfig`),
  `:140-178` (`bootstrapRemote`)
- Modify: `src/features/oauth/oauthPort.tsx:56-137` (shared helpers, `madarOAuthPort`), `:161-169` (`remotePort`)
- Test: `src/app/remote/authMode.test.ts`, `src/features/oauth/madarOAuthPort.test.ts`

**Interfaces:**
- Consumes: `createMadarAuth` (Task 20); the consent and grants routes (Task 18).
- Produces: `type AuthMode = 'supabase' | 'madar'`; `authModeOf(env: { VITE_MADAR_AUTH?: string }): AuthMode`;
  `RemoteConfig.auth: AuthMode`; `quietChangeSource(): ChangeSource`; `madarOAuthPort(o: { apiUrl; accessToken; fetch? }): OAuthPort`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/app/remote/authMode.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { authModeOf } from './authMode';
import { bootstrapRemote, remoteConfig } from './bootstrap';
import { SESSION_KEY } from './madarAuth';

describe('the sign-in of the remote build (src/app/remote/authMode.ts)', () => {
  it('is supabase unless the build says madar, and refuses another value', () => {
    expect(authModeOf({})).toBe('supabase');
    expect(authModeOf({ VITE_MADAR_AUTH: 'madar' })).toBe('madar');
    expect(() => authModeOf({ VITE_MADAR_AUTH: 'auth0' })).toThrow('VITE_MADAR_AUTH must be supabase or madar');
  });

  it('keeps the Supabase port on both copies until the switch: no copy sets VITE_MADAR_AUTH', () => {
    for (const copy of ['test', 'production']) expect(readFileSync(`config/remote.${copy}.env`, 'utf8')).not.toContain('VITE_MADAR_AUTH');
  });

  it('needs the page api and no Supabase value for the madar build', () => {
    expect(remoteConfig({ VITE_MADAR_AUTH: 'madar', VITE_API_URL: '/api/' })).toEqual({ supabaseUrl: '', publishableKey: '', apiUrl: '/api', build: '0', auth: 'madar' });
    expect(() => remoteConfig({ VITE_MADAR_AUTH: 'madar' })).toThrow('VITE_API_URL');
    expect(remoteConfig({ VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' }).auth).toBe('supabase');
  });

  it('builds the Madar port and no Supabase client for the madar build', async () => {
    window.localStorage.clear();
    const runtime = await bootstrapRemote({ config: remoteConfig({ VITE_MADAR_AUTH: 'madar', VITE_API_URL: '/api' }), fetch: async () => Response.json({ access_token: 'a', refresh_token: 'r', expires_in: 900, user: { id: 'auth-1' } }) });
    await runtime.auth.signIn('hala@madar.test', 'a good password');
    expect(JSON.parse(window.localStorage.getItem(SESSION_KEY)!).userId).toBe('auth-1');
    expect(runtime.changes.status()).toBe('closed');
  });
});
```

```ts
// src/features/oauth/madarOAuthPort.test.ts
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/errors';
import { madarOAuthPort, OAuthFailure } from './oauthPort';

function port(answers: Record<string, Response>, calls: { path: string; method: string; body: unknown }[] = []) {
  return madarOAuthPort({
    apiUrl: '/api',
    accessToken: async () => 'browser-token',
    fetch: async (input, init) => {
      const path = new URL(input, 'https://madar.test').pathname;
      calls.push({ path, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return answers[`${init?.method ?? 'GET'} ${path}`]?.clone() ?? new Response('{}', { status: 404 });
    },
  });
}

describe('the OAuth port over the own OAuth server (madarOAuthPort)', () => {
  it('gives the request to ask about, or the redirect of a known client', async () => {
    const ask = port({ 'GET /api/oauth/authorizations/req1': Response.json({ authorization_id: 'req1', client: { id: 'c1', name: ' Claude ' }, redirect_uri: 'https://claude.ai/cb' }) });
    expect(await ask.details('req1')).toEqual({ kind: 'ask', request: { authorizationId: 'req1', clientId: 'c1', clientName: 'Claude', redirectUri: 'https://claude.ai/cb' } });
    const done = port({ 'GET /api/oauth/authorizations/req2': Response.json({ redirect_url: 'https://claude.ai/cb?code=x' }) });
    expect(await done.details('req2')).toEqual({ kind: 'done', redirectUrl: 'https://claude.ai/cb?code=x' });
  });

  it('records the approval, then approves or denies, in the order of the consent screen', async () => {
    const calls: { path: string; method: string; body: unknown }[] = [];
    const p = port({
      'POST /api/agents/approve': Response.json({ approved: true }),
      'POST /api/oauth/authorizations/req1/consent': Response.json({ redirect_url: 'https://claude.ai/cb?code=x&state=s' }),
    }, calls);
    await p.recordApproval('req1');
    expect(await p.approve('req1')).toBe('https://claude.ai/cb?code=x&state=s');
    expect(calls.map((call) => [call.method, call.path, call.body])).toEqual([
      ['POST', '/api/agents/approve', { authorizationId: 'req1' }],
      ['POST', '/api/oauth/authorizations/req1/consent', { action: 'approve' }],
    ]);
  });

  it('keeps the words of the screen: agent_removed as a Madar refusal, an ended request as 404', async () => {
    const removed = port({ 'POST /api/agents/approve': Response.json({ v: 1, error: { code: 'forbidden', message: 'You removed this AI app in Madar.', details: { reason: 'agent_removed' } } }, { status: 403 }) });
    await expect(removed.recordApproval('req1')).rejects.toMatchObject({ code: 'forbidden', details: { reason: 'agent_removed' } });
    await expect(removed.recordApproval('req1')).rejects.toBeInstanceOf(ApiError);
    const ended = port({ 'GET /api/oauth/authorizations/gone': Response.json({ v: 1, error: { code: 'not_found', message: 'This approval request ended.', details: { reason: 'authorization_ended' } } }, { status: 404 }) });
    await expect(ended.details('gone')).rejects.toBeInstanceOf(OAuthFailure);
    await expect(ended.details('gone')).rejects.toMatchObject({ status: 404 });
  });

  it('lists the grants and revokes one with the client id', async () => {
    const calls: { path: string; method: string; body: unknown }[] = [];
    const p = port({
      'POST /api/oauth/grants': Response.json([{ client_id: 'c1', client_name: 'Claude', granted_at: '2026-10-17T06:00:00.000Z' }]),
      'POST /api/oauth/grants/revoke': Response.json({ ok: true }),
    }, calls);
    expect(await p.listGrants()).toEqual([{ clientId: 'c1', clientName: 'Claude', grantedAt: '2026-10-17T06:00:00.000Z' }]);
    await p.revokeGrant('c1');
    expect(calls.at(-1)).toEqual({ path: '/api/oauth/grants/revoke', method: 'POST', body: { client_id: 'c1' } });
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run --project unit src/app/remote/authMode.test.ts src/features/oauth/madarOAuthPort.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL with "Failed to load url ./authMode" and "madarOAuthPort is not exported".

- [ ] **Step 3: The choice**

```ts
// src/app/remote/authMode.ts
/**
 * The sign-in of the remote build (Supabase exit, wave 2): VITE_MADAR_AUTH of config/remote.<env>.env. Unset is supabase, and both
 * copies keep it until the switch: wave 5 sets madar for the test copy, wave 6 for production. madar needs VITE_API_URL (the
 * page's own /api of the Worker).
 */
export type AuthMode = 'supabase' | 'madar';

export function authModeOf(env: { VITE_MADAR_AUTH?: string }): AuthMode {
  const value = env.VITE_MADAR_AUTH?.trim() || 'supabase';
  if (value !== 'supabase' && value !== 'madar') throw new Error(`VITE_MADAR_AUTH must be supabase or madar, not "${value}".`);
  return value;
}
```

In `src/env.d.ts`, add to `ImportMetaEnv`:

```ts
  /** The sign-in of the remote build (src/app/remote/authMode.ts): supabase (unset) or madar. */
  readonly VITE_MADAR_AUTH?: string;
```

In `src/app/remote/bootstrap.ts`, change `RemoteConfig` and `remoteConfig`:

```ts
export type RemoteConfig = { supabaseUrl: string; publishableKey: string; apiUrl: string; build: string; auth: AuthMode };

export function remoteConfig(env: Record<string, string | boolean | undefined>): RemoteConfig {
  const text = (name: string) => {
    const value = env[name];
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
  };
  const auth = authModeOf({ VITE_MADAR_AUTH: text('VITE_MADAR_AUTH') });
  const build = text('VITE_MADAR_BUILD') ?? '0';
  if (auth === 'madar') {
    const apiUrl = text('VITE_API_URL');
    if (apiUrl === undefined) throw new Error('The remote build with VITE_MADAR_AUTH=madar needs VITE_API_URL (the page api of the Worker).');
    return { supabaseUrl: '', publishableKey: '', apiUrl: apiUrl.replace(/\/+$/, ''), build, auth };
  }
  const missing = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'].filter((name) => text(name) === undefined);
  if (missing.length > 0) throw new Error(`The remote build needs ${missing.join(', ')} (config/remote.<env>.env).`);
  const supabaseUrl = text('VITE_SUPABASE_URL')!.replace(/\/+$/, '');
  return {
    supabaseUrl,
    publishableKey: text('VITE_SUPABASE_PUBLISHABLE_KEY')!,
    apiUrl: (text('VITE_API_URL') ?? `${supabaseUrl}/functions/v1/api`).replace(/\/+$/, ''),
    build,
    auth,
  };
}

/** No live updates yet on the own stack: wave 3 puts the socket of the office object here (liveSocket.ts). */
export function quietChangeSource(): ChangeSource {
  return { subscribe: () => () => undefined, status: () => 'closed' };
}
```

In `bootstrapRemote`, add `VITE_MADAR_AUTH: import.meta.env.VITE_MADAR_AUTH,` to the env list, and replace the client, the port,
the refresh, the header and the change source:

```ts
  const supabase = config.auth === 'supabase' ? (o.supabase ?? createSupabase({ url: config.supabaseUrl, publishableKey: config.publishableKey })) : undefined;
  const auth = o.auth ?? (supabase
    ? await createSupabaseAuth(supabase, { apiUrl: config.apiUrl, fetch: o.fetch })
    : await createMadarAuth({ apiUrl: config.apiUrl, ...(o.fetch ? { fetch: o.fetch } : {}) }));
```

```ts
    refresh: async () => {
      // A 401 with a token that has not ended yet: ask for a new one, then read it as usual.
      if (supabase) await supabase.auth.refreshSession().catch(() => undefined);
      else await auth.refresh?.().catch(() => undefined);
      return auth.accessToken();
    },
```

```ts
    // The Supabase gateway names the project by its public key; the page api of the own stack needs none.
    headers: config.publishableKey ? { apikey: config.publishableKey } : {},
```

```ts
    open: (me) => (supabase ? supabaseChangeSource(supabase, me) : quietChangeSource()),
```

Imports: `authModeOf`, `type AuthMode` from `./authMode`; `createMadarAuth` from `./madarAuth`; `type ChangeSource` from
`../signals`.

- [ ] **Step 4: The OAuth port over the own routes**

In `src/features/oauth/oauthPort.tsx`, move `redirectOf` out of `httpOAuthPort` to module level, move the body of its
`recordApproval` into `recordApprovalAt`, and add `madarOAuthPort` after `httpOAuthPort`:

```ts
const redirectOf = (data: unknown): string => {
  const url = (data as { redirect_url?: unknown } | null)?.redirect_url;
  if (typeof url !== 'string' || url === '') throw new OAuthFailure(500, undefined, 'Madar gave no redirect address.');
  return url;
};

/** POST /agents/approve with the person's browser token. A refusal is a Madar refusal (ApiError), so the screen sees agent_removed. */
async function recordApprovalAt(send: Fetch, approveUrl: string, token: string, authorizationId: string): Promise<void> {
  const response = await send(approveUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ authorizationId }),
  });
  if (response.ok) return;
  const error = ((await json(response)).error ?? {}) as { code?: string; message?: string; details?: Record<string, unknown> };
  const code = API_CODES.includes(error.code as ApiErrorCode) ? (error.code as ApiErrorCode) : 'failed';
  throw new ApiError(code, error.message ?? 'Something went wrong. Try again.', error.details ?? {});
}
```

In `httpOAuthPort`: `recordApproval: async (authorizationId) => recordApprovalAt(send, approveUrl, await token(), authorizationId),`.

```ts
/**
 * The OAuth steps over the own OAuth server of Madar (Supabase exit, wave 2), at the page's own /api. The order of the consent
 * screen stays: details, recordApproval, approve; the server gives a code only after the approval. A refusal of a step other
 * than the approval is an OAuthFailure with its status, so an ended request (404) shows the words of authorization_ended.
 */
export function madarOAuthPort(o: { apiUrl: string; accessToken: () => Promise<string | null>; fetch?: Fetch }): OAuthPort {
  const send: Fetch = o.fetch ?? ((input, init) => fetch(input, init));
  const base = o.apiUrl.replace(/\/+$/, '');
  const at = (path: string) => regionUrl(`${base}${path}`);
  const token = async () => {
    const value = await o.accessToken();
    if (!value) throw new ApiError('unauthenticated', 'Sign in to continue.');
    return value;
  };
  async function call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    const response = await send(at(path), {
      method,
      headers: { Authorization: `Bearer ${await token()}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await json(response);
    if (!response.ok) {
      const error = (data.error ?? {}) as { code?: string; message?: string; details?: { reason?: unknown } };
      throw new OAuthFailure(response.status, typeof error.details?.reason === 'string' ? error.details.reason : error.code, error.message ?? `Madar answered ${response.status}.`);
    }
    return data;
  }
  const consent = (id: string, action: 'approve' | 'deny') => call('POST', `/oauth/authorizations/${encodeURIComponent(id)}/consent`, { action }).then(redirectOf);
  return {
    async details(authorizationId) {
      const data = (await call('GET', `/oauth/authorizations/${encodeURIComponent(authorizationId)}`)) as Record<string, unknown>;
      if (typeof data.redirect_url === 'string') return { kind: 'done', redirectUrl: data.redirect_url };
      const client = (data.client ?? {}) as { id?: unknown; name?: unknown };
      return {
        kind: 'ask',
        request: {
          authorizationId: String(data.authorization_id ?? authorizationId), clientId: String(client.id ?? ''),
          clientName: typeof client.name === 'string' ? client.name.trim() : '', redirectUri: String(data.redirect_uri ?? ''),
        },
      };
    },
    recordApproval: async (authorizationId) => recordApprovalAt(send, at('/agents/approve'), await token(), authorizationId),
    approve: (authorizationId) => consent(authorizationId, 'approve'),
    deny: (authorizationId) => consent(authorizationId, 'deny'),
    async listGrants() {
      const data = await call('POST', '/oauth/grants', {});
      return (Array.isArray(data) ? data : []).map((row: { client_id?: unknown; client_name?: unknown; granted_at?: unknown }) => ({
        clientId: String(row.client_id ?? ''), clientName: typeof row.client_name === 'string' ? row.client_name : '', grantedAt: typeof row.granted_at === 'string' ? row.granted_at : null,
      })).filter((grant) => grant.clientId !== '');
    },
    async revokeGrant(clientId) {
      await call('POST', '/oauth/grants/revoke', { client_id: clientId });
    },
  };
}
```

Change `remotePort`:

```ts
function remotePort(accessToken: () => Promise<string | null>): OAuthPort {
  const env = import.meta.env as Record<string, unknown>;
  if (authModeOf({ VITE_MADAR_AUTH: text(env.VITE_MADAR_AUTH) }) === 'madar') {
    const apiUrl = text(env.VITE_API_URL);
    return apiUrl ? madarOAuthPort({ apiUrl, accessToken }) : NO_OAUTH;
  }
  const supabaseUrl = text(env.VITE_SUPABASE_URL);
  const publishableKey = text(env.VITE_SUPABASE_PUBLISHABLE_KEY);
  if (!supabaseUrl || !publishableKey) return NO_OAUTH;
  const apiUrl = text(env.VITE_API_URL) ?? `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/api`;
  return httpOAuthPort({ supabaseUrl, publishableKey, apiUrl, accessToken });
}
```

with `import { authModeOf } from '../../app/remote/authMode';`.

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run --project unit src/app/remote src/features/oauth src/features/auth src/features/settings --no-file-parallelism --testTimeout=60000`
Expected: PASS. The screens of today run on the Supabase port in their tests, unchanged. A test of today that compares the whole
object of `remoteConfig` gets one more field: add `auth: 'supabase'` to its expected value.

- [ ] **Step 6: Run the two builds**

Run: `npm run build` (the prototype carries no remote file: `check-bundles` passes) and, sandbox off, `npm run build:remote -- test`.
Expected: both pass. The test build has no `VITE_MADAR_AUTH`, so it is the Supabase build of today.

- [ ] **Step 7: Commit**

```bash
git add src/env.d.ts src/app/remote/authMode.ts src/app/remote/authMode.test.ts src/app/remote/bootstrap.ts src/features/oauth/oauthPort.tsx src/features/oauth/madarOAuthPort.test.ts
git commit -m "Exit wave 2: the screens pick the Supabase or the Madar sign-in at build time, and both copies keep Supabase"
```

### Task 22: The cleanup of old sign-in rows, the guides, the records and the merge gate

**Files:**
- Create: `server/auth/own/cleanup.ts`; Test: `server/auth/own/cleanup.test.ts`
- Modify: `server/auth/CLAUDE.md`, `server/mcp/CLAUDE.md`, `server/data/CLAUDE.md`, `src/CLAUDE.md`
- Modify: `docs/superpowers/real-build/proof.md` (append one section), `TASKS.md`

**Interfaces:**
- Produces: `SIGNIN_CLEANUP_LITE`, `cleanupSignin(q: Query, now: Date): Promise<void>` (the Cron of wave 3 runs it once a day).

- [ ] **Step 1: Write the failing cleanup test**

```ts
// server/auth/own/cleanup.test.ts
import { describe, expect, it } from 'vitest';
import { freshLite } from '../../data/lite/testDb';
import { cleanupSignin } from './cleanup';

describe('the cleanup of old sign-in rows (server/auth/own/cleanup.ts)', () => {
  it('deletes the links, requests and sessions that ended more than a day ago, and keeps the rest', async () => {
    const { raw, db } = await freshLite();
    raw.exec(`insert into auth_links (token_hash, auth_id, type, expires_at) values ('old', 'a', 'invite', '2026-10-15T00:00:00.000Z'), ('new', 'a', 'invite', '2026-10-17T07:00:00.000Z')`);
    raw.exec(`insert into oauth_requests (id, client_id, redirect_uri, code_challenge, expires_at) values ('old', 'c', 'x', 'y', '2026-10-15T00:00:00.000Z'), ('new', 'c', 'x', 'y', '2026-10-17T06:10:00.000Z')`);
    raw.exec(`insert into auth_sessions (id, auth_id, amr, refresh_hash, expires_at, revoked_at) values
      ('ended', 'a', 'password', 'h1', '2026-10-15T00:00:00.000Z', null), ('revoked', 'a', 'password', 'h2', '2026-11-15T00:00:00.000Z', '2026-10-15T00:00:00.000Z'),
      ('just-revoked', 'a', 'password', 'h3', '2026-11-15T00:00:00.000Z', '2026-10-17T05:00:00.000Z'), ('live', 'a', 'password', 'h4', '2026-11-15T00:00:00.000Z', null)`);
    await db.tx('write', (q) => cleanupSignin(q, new Date('2026-10-17T06:00:00Z')));
    expect(raw.prepare('select token_hash from auth_links').all()).toEqual([{ token_hash: 'new' }]);
    expect(raw.prepare('select id from oauth_requests').all()).toEqual([{ id: 'new' }]);
    expect(raw.prepare('select id from auth_sessions order by id').all()).toEqual([{ id: 'just-revoked' }, { id: 'live' }]);
  });
});
```

Run: `npx vitest run --project server server/auth/own/cleanup.test.ts --no-file-parallelism --testTimeout=60000`
Expected: FAIL with "Failed to load url ./cleanup".

- [ ] **Step 2: Write the cleanup**

```ts
// server/auth/own/cleanup.ts
import type { Query } from '../../core/ports';

/**
 * The old sign-in rows (Supabase exit, wave 2): links, OAuth requests and sessions that ended more than a day ago. The Cron of
 * wave 3 runs it once a day on the office object. Each delete is a row written of the Free day limit (wave 0), and these tables
 * stay small (some hundred rows), so a scan reads little. A deleted session only makes an old refresh token unknown: it ends anyway.
 */
export const SIGNIN_CLEANUP_LITE = [
  'delete from auth_links where expires_at < ?1',
  'delete from oauth_requests where expires_at < ?1',
  'delete from auth_sessions where expires_at < ?1 or (revoked_at is not null and revoked_at < ?1)',
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

export async function cleanupSignin(q: Query, now: Date): Promise<void> {
  const before = new Date(now.getTime() - DAY_MS).toISOString();
  for (const text of SIGNIN_CLEANUP_LITE) await q(text, [before]);
}
```

Run the test again. Expected: PASS. Commit:

```bash
git add server/auth/own/cleanup.ts server/auth/own/cleanup.test.ts
git commit -m "Exit wave 2: the cleanup of sign-in rows that ended more than a day ago, for the Cron of wave 3"
```

- [ ] **Step 3: Write the guides**

Add this section at the end of `server/auth/CLAUDE.md`:

```markdown
## The own sign-in (Supabase exit, wave 2)
- Files: `own/` (the office object side: passwords, keys, rows, sessions, steps, routes, the import) and `ownKeys.ts` (the
  Worker side: the public key and the issuer). No Supabase entry loads `own/`: bcryptjs imports the bare module `crypto`, which
  Deno may not load (`server/workerGraph.test.ts`). The hosts pass the routes in (`ownApiRoutes`, `mountOAuth`).
- Rows: `auth_users` (the id of `auth.users` for an imported person), `auth_links`, `auth_sessions`, `oauth_clients`,
  `oauth_requests` (SQLite schema version 2). The sign-in link is `auth_users.user_id`; the office snapshot carries the links, so
  `principalOf` stays as it is. `setLiteAuthLink` is the one write of a link.
- Passwords: PBKDF2 SHA-256, 100,000 rounds, never more (deployed Workers refuse more; local workerd does not show it). A copied
  bcrypt hash (owner decision 4) works once, then the row holds PBKDF2. The hash work runs in the office object between two
  transactions, never in the Worker (10 ms of CPU on Free).
- Tokens: ES256, 900 s, issuer = MCP_URL, the secret `MADAR_AUTH_PRIVATE_JWK` (a P-256 private JWK with a kid). The public key
  set is `GET /api/auth/jwks` and `GET /mcp/oauth/jwks`. With the secret set, `verifyBrowserToken` and `agentTokenCheckerOf` use
  the own key; no copy has it before wave 5.
- Sessions: refresh tokens rotate; a second use within 10 s rotates again, a later one ends the session. 30 days after the last
  refresh. Sign-out others ends agents too. The API checks no session for a browser token (15 minutes at most, as today).
- Links: 32 random bytes, sha256 in the table, 1 hour, one use; a new link ends the open links of the person. A link opens a link
  session that may set a password once with no current password. An agent token never sets a password (403 `agent_token`).
- Limits (`own/limits.ts`): 10 sign-ins for one email and 30 for one address in 15 minutes, 20 link opens and 10 OAuth
  registrations for one address in an hour. The address is `clientAddress` (`forgot.ts`).
- `liteAuthAdmin` is the Auth admin port over these rows, so `invite.ts`, `effects.ts`, `forgot.ts`, `renew.ts` and
  `users.invites` keep their logic; each text of theirs has a `_LITE` twin.
- Steps run through `SigninOffice` (`own/office.ts`); wave 3 connects it to the object method for one batch.
```

Add this section at the end of `server/mcp/CLAUDE.md`:

```markdown
## The own OAuth server (Supabase exit, wave 2)
- `oauth/`: the documents (issuer = MCP_URL; the same document at `/mcp/.well-known/oauth-authorization-server` and
  `/mcp/.well-known/openid-configuration`), Dynamic Client Registration of public clients (PKCE S256, no secret), authorize (to
  `/oauth/consent?authorization_id=`), the consent with the Madar approval inside, the token step (code once, 60 s; refresh
  rotation), the grants of Settings, Agents.
- The approval: the consent gives a code only after `POST /api/agents/approve` with a browser token. Every own route refuses an
  agent token, so the open risk of Z7 (an agent token with the full rights of its person at Auth) does not exist on the own stack.
- A request belongs to the first person who opens it; for anyone else it reads as unknown, with no client name.
- No Client ID Metadata Document: it is a fetch, and the office object does no network work.
- MCP clients try `/.well-known/oauth-authorization-server/mcp` first. Wave 5 adds the Pages Function
  (`server/http/pagesWellKnown.ts`); until then a client finds `/mcp/.well-known/openid-configuration`.
- On SQLite, `agents.revokeAll` runs inside the transaction of the turn-off (no outbox row), and `agents.remove` ends the agent
  sessions with the links. `liteAgentOf` (`oauth/agent.ts`) is the agent check of the office object.
- No tool, `TOOL_DOCS` line or `INSTRUCTIONS` rule changed in wave 2: an agent never reads the connect flow; its AI app runs it.
- `server/mcp/oauth/sdk.test.ts` runs the whole flow with `@modelcontextprotocol/sdk` 1.32.0 on node:sqlite.
```

In `server/data/CLAUDE.md`, section "The SQLite path", add these lines:

```markdown
- Schema version 2 (wave 2): the sign-in rows (`auth_users`, `auth_links`, `auth_sessions`, `oauth_clients`, `oauth_requests`)
  and the partial index `outbox_signin`. An invitation text must repeat its exact term `kind in ('auth.invite', 'auth.email')`:
  `kind = 'auth.invite'` alone scans the outbox. Wave 3 takes version 3.
- The snapshot body is `{ lists, links }`: the sign-in links ride with the office lists, so a cold wake still reads 2 rows.
  `writeOfficeSnapshot` reads the links from `auth_users` (one statement, only on an office write).
- `statementQuery(db, mode)` (`dialect.ts`) keeps the dialect on a query of single statements (the forgot and renew routes).
- `LATER_CALLS` holds `usage.get` and `usage.retryEffect` (wave 3); `LATER_KINDS` is empty.
```

In `src/CLAUDE.md`, add one line where the guide names the two builds:

```markdown
- The sign-in of the remote build (`src/app/remote/authMode.ts`): `VITE_MADAR_AUTH` unset is the Supabase port of today;
  `madar` is the Madar port (`madarAuth.ts`, `madarOAuthPort`) for the own stack. No copy sets it before wave 5.
```

- [ ] **Step 4: Run the merge gate, once, in this order**

```bash
git fetch origin && git rebase origin/main      # if wave 3 or Track R merged first: the Merge notes below
npm run typecheck
npm test
npm run build
npm run build:server
grep -l 'pbkdf2-sha256' supabase/functions/_build/*.js dist-server/worker.js || echo 'no own sign-in in the bundles'
npm run build:remote -- test                    # sandbox off
npm run test:lite
npm run test:office                             # sandbox off
scripts/dev/docker-lock.sh acquire exit-signin
npx supabase db reset
npm run test:db
npm run test:it
npx supabase db reset && npm run test:mcp && npx supabase db reset
scripts/dev/docker-lock.sh release exit-signin
```

Expected: no type error; `npm test` green (about 4,954 of wave 1 plus about 150 new); both builds and the server bundles pass,
and the grep prints only "no own sign-in in the bundles"; `test:lite` 81 files, 1,141 passed, 25 skipped, and no fake log line
names a call or kind outside `usage.get` and `usage.retryEffect`; `test:office` 3 files, 11 tests; `test:db` 1,141 passed,
25 skipped (Postgres does not change); `test:it` 34 files with `server/it/signinExport.it.test.ts`; `test:mcp` green with the
conformance baseline of today. No run again unless one fails; after a fix, run only the failed command again.

- [ ] **Step 5: The prototype smoke, in a delegated helper**

`src/` changed, so the prototype smoke runs once at the merge. Brief one Playwright helper (Agent tool, model haiku, as the
memory of this project says): "In `~/dev/madar-rb/exit-signin`, run `npx playwright test` (it builds `dist/` first, about 8
minutes). Report the pass count and any failed test with its error text. Do not change a file." Expected: 87 of 87.

No screenshots in this wave: no screen file that renders changes (the ports change, the screens do not), and the prototype has no
sign-in. The first screenshots of the Madar port (EN and AR, light and dark, 390 px) come at the merge of waves 2 and 3 on a local
`wrangler dev` (Merge notes, item 13).

- [ ] **Step 6: Write the records**

Append to `docs/superpowers/real-build/proof.md` a section headed `### Wave 2 of the Supabase exit: sign-in and agents`, with the
UTC day of the gate run in brackets after it (as the wave 1 sections do), and with: the facts of "Facts checked for this wave" of this plan, each with its source; the counts that each gate command
of Step 4 printed, one line each; the note that the deploy-suite sign-in specs run at the merge of waves 2 and 3; and the open
items below. In `TASKS.md`, tick the two lines "Wave 2: `users.invites`, ..." and "Wave 2: the effect kinds ...", and add these
lines under the exit section:

```markdown
- [ ] Wave 3: connect `SigninOffice` to the object method for one batch (body `{ signin, input }`), pass `ownApiRoutes` and
  `mountOAuth` in the hosts, `liteAgentOf` in the object, `liteAuthAdmin` as `deps.authAdmin` of the object, and run
  `cleanupSignin` once a day (exit wave 2 plan, Merge notes)
- [ ] The merge of waves 2 and 3: the deploy-suite sign-in specs on a local `wrangler dev` with `VITE_MADAR_AUTH=madar`, and the
  screenshots of sign-in, forgot, welcome, reset and consent on the Madar port (EN and AR, light and dark, 390 px)
- [ ] Wave 4: the export runs `SIGNIN_EXPORT_SQL` with `BACKUP_DB_URL`; the import calls `importSigninRows`; the restore check
  copies `SIGNIN_TABLES`; `scripts/deploy/secrets.ts` names `MADAR_AUTH_PRIVATE_JWK` (a script makes the key and writes it
  straight to the Worker secret)
- [ ] Wave 5: `functions/.well-known/[[path]].ts` (one line, `proxyWellKnown`) and `VITE_MADAR_AUTH=madar` for the test copy
- [ ] Later, only if an AI app needs it: Client ID Metadata Documents (a fetch in the Worker, not in the object)
```

- [ ] **Step 7: Commit**

```bash
git add server/auth/CLAUDE.md server/mcp/CLAUDE.md server/data/CLAUDE.md src/CLAUDE.md docs/superpowers/real-build/proof.md TASKS.md
git commit -m "Exit wave 2: the guides and records of the own sign-in, and the merge gate"
```

---

## Spec coverage

| Requirement (exit plan A.2 wave 2, the spec, this brief) | Task |
|---|---|
| Passwords: PBKDF2 SHA-256 at 100,000 rounds, the Workers maximum | 2 (the pin), 16 (on workerd) |
| A bcrypt check (cost 10) of an imported hash once, then a PBKDF2 hash in its place; bcryptjs needs nodejs_compat | 14 (owner decision 4), 16 |
| Where the hash work runs, with the CPU numbers of wave 0 | Global Constraints; 11 (between two transactions in the object); 14 (the comment of `bcrypt.ts`) |
| Tokens: ES256, 15 minutes, a new issuer; the private key a Worker secret (named); the public key set a route | 3; 15 (`/api/auth/jwks`); 17 (`/mcp/oauth/jwks`) |
| The refresh flow, and the sign-out of other devices (Welcome and Reset) | 12; 20 (one refresh for all tabs) |
| Invitation and reset links: random, 1 hour, one use; this closes security fix 8 | 5; 13 |
| Sign-in limits in `rate_limits`; the forgot route and its client address rule | 6 (`RATE_LITE`); 8 (forgot on SQLite, the address of the Pages Function); 11; 15 (the address test) |
| The screens' sign-in port: every supabase-js use under `src/` found; Supabase and Madar forms, chosen at build time | 20 (the list of uses, the Madar port); 21 (the choice; both copies stay Supabase) |
| OAuth 2.1 for agents with the Madar approval inside; `agent_links` and `agent_approvals` on SQLite | 10; 17; 18; 19 |
| The MCP conformance runner still passes | 19 (Step 6), 22 (the gate) |
| `users.invites`, `users.resendInvite`, `agents.list`, `agents.remove` on SQLite | 9; 10 |
| The `auth.*` effects as writes of the sign-in rows plus Worker mail | 5 (`liteAuthAdmin`); 6; 7 |
| `agents.revokeAll` as a write inside the call transaction | 10 |
| The sign-in link of `server/data/officeCache.ts` on SQLite | 4 |
| `LATER_CALLS` and `LATER_KINDS` hold no wave 2 name | 7; 9; 10 (the test) |
| The columns of `auth.users` for the import of wave 4, and how the export reads them (no secret in a file) | 14 (`SIGNIN_EXPORT_SQL`, the it test, the Interfaces note) |
| Leak tests on every read path of the sign-in rows (root rule of 2026-10-06) | 4 (no auth id in the lists); 9; 10; 15 (agent token); 18 (consent, approval, grants) |
| Every feature change updates the MCP side | No call, tool, `TOOL_DOCS` line or `INSTRUCTIONS` rule changes (Global Constraints); the token check, the OAuth routes, the agent check (3, 10, 17 to 19) and `server/mcp/CLAUDE.md` (22) are the MCP side |
| No await on the network, a timer or `crypto.subtle` inside an office object transaction | Each step of 5, 11 to 13, 17 to 19: the crypto before the transaction |
| Spec section 4: each person signs in again once with the same password | 14 |
| Spec section 4: old invitation and reset links stop; each AI agent connects again once | The links are not exported (14); the new issuer (3, 17) makes each agent connect again at the switch (wave 6) |
| Exit plan gate: the sign-in specs of the deploy suite on a local `wrangler dev` | Moved to the merge of waves 2 and 3 (Merge notes, item 13): before wave 3 no Worker serves the office object |
| `live.ticket` and the socket | Wave 3 (the interface of this brief) |

## Merge notes

Wave 2 (`rb/exit-signin`) and wave 3 (`rb/exit-live`) are built side by side from main after wave 1. Track R (`rb/read-cost`) may
merge at any time. The branch that merges second does each item below in its rebase.

1. **`server/data/lite/schema.ts` and `schema.test.ts`.** Ruling of the main session (17 October 2026). It replaces the first
   form of this item. The end form after both merges is item 1 of the Merge notes of the wave 3 plan: `LITE_SCHEMA_VERSION = 3`;
   `SERVER_SQL` and `SERVER_INDEXES` hold the tables and indexes of both waves; `LITE_STEPS = { 3: [USAGE_DAY_SQL] }`. The sign-in
   tables get no step, because no office object exists outside the tests before wave 5. If wave 3 merges first, wave 2 adds its
   tables to version 3 and keeps the number 3. Then run `server/data/lite/schema.test.ts`, copy the new sha256 from the diff into
   `PINNED_SHA256`, and update the table list of the test "keeps the server tables of Postgres". Track R takes the next number with
   a step of its own. From wave 5 on, each new version needs its step.
2. **`server/test/liteHarness.ts` and `liteHarness.test.ts`.** Wave 2 leaves `LATER_CALLS = ['usage.get', 'usage.retryEffect']`
   and `LATER_KINDS` empty, and builds the test office with `liteAuthAdmin`. Wave 3 removes the two `usage.*` names. After both:
   both sets are empty, the harness test says `expect([...LATER_CALLS]).toEqual([])`, and the deps keep `liteAuthAdmin` plus any
   port that wave 3 adds.
3. **`server/mail/quota.ts`.** Wave 2 adds `DAY_COUNT_LITE`, `RESERVE_LITE`, `RELEASE_LITE`, `RECORD_SENT_LITE` and the SQLite
   branches of `reserve`, `release` and the last statement of `sendCounted`, because the sign-in mail needs them. Wave 3 owns the
   forms of `markFirstRefusal` and `sentToday` and the notice producers. If wave 3 also wrote a SQLite `reserve`, keep the one that
   merged first, then run `server/auth/own/liteTexts.test.ts`, `server/auth/own/effects.lite.test.ts` and the quota tests of
   wave 3.
4. **`server/core/types.ts` and `server/core/runCall.ts`.** Wave 2 adds `ServerCallCtx.data` (one field) and passes `data` in
   `runServerCall` (one line). Keep it next to the runCall changes of wave 3.
5. **`server/office/test/pinOffice.ts` and `harness.ts`.** Wave 2 adds `signin`, `importSignins` and `peek`. Keep every method of
   both waves in `PinOfficeApi`, in `FETCH_METHODS` and in `officeByFetch`.
6. **`server/mcp/app.ts` and `server/mcp/auth.ts`.** Wave 2 adds `MCP_SEEN_LITE` and the SQLite branch of `sqlMcpLimit`, the
   `oauth` option, `authIssuerOf(supabaseUrl, mcpUrl)`, `AGENT_LITE` and the `lite` option of `agentPrincipalResolver`. The MCP
   host of wave 3 passes `issuer: ownIssuer(mcpUrl)`, `checkToken` (the own agent check, through `agentTokenCheckerOf` with the
   secret set), `agentOf: liteAgentOf` (it runs in the office object), `runCall` of the object, and
   `oauth: (app) => mountOAuth(app, office, { mcpUrl, jwks: ownPublicJwks(secret) })`.
7. **`src/app/remote/bootstrap.ts`.** Wave 2 adds the auth mode and `quietChangeSource()` for the Madar build. Wave 3 puts its
   live socket (`liveSocket.ts`) in place of `quietChangeSource()` for the Madar build and keeps `supabaseChangeSource` for the
   Supabase build. `live.ticket` reads the token from `auth.accessToken()`, which both ports give.
8. **`server/entries/worker.ts` and `wrangler.server.toml`.** Wave 2 does not touch them. Wave 3 builds the object side of
   `SigninOffice`: the object method for one batch takes the body `{ signin: name, input }` and answers
   `await runSigninOp({ db, clock, log, config, keys }, name, input)` with `keys = await signingKeysOf(env.MADAR_AUTH_PRIVATE_JWK,
   config.mcpUrl)`; the Worker passes `ownApiRoutes(objectSigninOffice, { jwks: ownPublicJwks(env.MADAR_AUTH_PRIVATE_JWK) })` as
   `AppOptions.routes`; the object deps take `authAdmin: liteAuthAdmin({ db, clock })`; the Cron runs `cleanupSignin` once a day.
   The effects of the object keep the rule "no network work": the coarse effect methods of wave 3 run the database steps of
   `invite.ts` and `effects.ts` in the object (through `liteAuthAdmin`) and only `deps.mail.send` in the Worker.
9. **`package.json` and `package-lock.json`.** Wave 2 adds `bcryptjs` 3.0.3 and the devDependency `@modelcontextprotocol/sdk`
   1.32.0. After a rebase over new packages of wave 3, run `npm install` (sandbox off) in a worktree with its own `node_modules`.
10. **`server/workerGraph.test.ts`.** Wave 2 adds a `describe` for the three Deno entries. If wave 3 adds the `Office` class to
    `server/entries/worker.ts`, the Worker entry loads `server/auth/own/` (bcryptjs, with `nodejs_compat`): that is allowed. The
    rule stays for the three Deno entries only.
11. **`TASKS.md`, `proof.md`, the guides.** Each wave appends its own sections and lines; keep both.
12. **Track R.** It changes `sqlSource.ts` and adds a schema version (item 1). No other file of wave 2 overlaps it.
13. **The first end-to-end run of the own sign-in.** At the merge of waves 2 and 3 (whichever is second), the merge lead runs the
    sign-in specs of the deploy suite (`account.spec.ts`, `signin.spec.ts`, `agents.spec.ts`) on a local `wrangler dev` with a
    remote build of `VITE_MADAR_AUTH=madar`, and a delegated Playwright helper takes the screenshots of sign-in, forgot, welcome,
    reset and consent on the Madar port (EN and AR, light and dark, 390 px). Wave 2 cannot run them alone: before wave 3, no Worker
    serves the office object.
14. **Wave 4 and wave 5.** Wave 4 reads `SIGNIN_EXPORT_SQL` with `BACKUP_DB_URL`, calls `importSigninRows` after the records, and
    copies `SIGNIN_TABLES` in the restore check. Wave 5 adds `functions/.well-known/[[path]].ts` (`export const onRequest =
    ({ request, env }) => proxyWellKnown(request, fetch, env);`) and `VITE_MADAR_AUTH=madar` in `config/remote.test.env`.

## Owner actions

1. **Decision 4 of the spec, before Task 14 (Block C, about day 4):** copy the bcrypt hashes (recommended: nobody sets a new
   password at the switch), or a new password for each person. If the answer is "a new password", skip Task 14 and the bcrypt test
   of Task 16; at the switch, the Admin sends each person a link with "Send the invitation again".
2. **Start Docker Desktop** for Task 19 Step 6 (`test:mcp`) and for the merge gate (`test:db`, `test:it`, `test:mcp`).
3. Nothing else in this wave: no secret (the key `MADAR_AUTH_PRIVATE_JWK` comes in wave 5, from a script that writes it straight
   to the Worker secret), no payment, no deploy, and no change on either copy.
