# Madar real build: implementation plan

**Date:** 2026-10-03
**Status:** Plan, revision 2. Two critics reviewed revision 1; the Review log at the end gives the answer to each finding. No code changed. Parallel agents execute the plan in git worktrees. A merge lead merges the tracks one by one, in the order of section 6.4.
**Design:** spec 2, `docs/superpowers/specs/2026-10-03-madar-real-build-design.md`. Spec 1, `docs/superpowers/specs/2026-09-30-madar-prototype-design.md`, describes the product.
**Research:** `docs/superpowers/real-build/access-map.md` (AM), `client-map.md` (CM), `test-map.md` (TM), `platform-facts.md` (PF), `accounts.md`.
**Owner decisions (final):** TypeScript server; screens on Cloudflare Pages (free); server on Supabase Edge Functions in Frankfurt (free), portable to Node on Railway; Supabase free for Postgres, Auth (email and password, Admin invitations) and Realtime; Cloudflare R2 for files; Resend for email; MCP 2026-07-28 for AI agents in version 1; the office starts empty; no Vercel.

## 0. How to read this plan

- Section 2 lists each change to spec 2 and its reason. Everything else follows spec 2.
- Sections 3 to 5 give the design that the tasks build: layout, data layer, features.
- Section 6 gives the tracks, the tasks, the file ownership and the merge order. An agent reads its track, then the sections that its tasks name.
- Section 7 is the test strategy. Section 8 is the owner checklist. Section 9 is the risk list. Section 10 lists the owner decisions. Section 11 is the Review log.
- Labels: **[Docker]** means the task needs a local Supabase stack (Docker on the Mac or in CI). **[Accounts]** means the task needs the owner's real accounts. Those tasks run in track Z. Z0a runs as soon as the accounts exist, and the C3 merge waits for it. The other Z tasks run last.

## 1. Summary

The real build keeps the 112 rule handlers in `src/api` and runs 108 of them on a server, plus 9 new server calls. The server loads the records that a call needs from Postgres into a `State`, runs the same handler, and writes back only what changed, in one transaction under one office lock. One Hono app holds the server. It runs on Supabase Edge Functions (Deno) in Frankfurt and on Node (Railway) from the same source, through one bundle step. The screens keep `api.call()`. A new `RemoteApi` sends the calls of one moment in one batch request, and Realtime change signals tell each screen which lists to load again. The fake API, the prototype artifact and the 1,640 tests keep working: the build flag `VITE_MADAR_API` chooses the fake or the remote API, and the fake build is the default.

The work splits into 18 tracks and 61 tasks. One short serial track (T0) puts in every shared seam first: dependencies, the call split, the shared execute step, the new call contracts and wire forms, the server ports, the route and call registries, and a stub with its final signature for every file that one track writes and another track imports. After T0, most tracks run in parallel and own their files alone. The critical path is T0, B (schema), C (core), D (db-mode tests). A cloud proof with small probe scripts (Z0a) must pass before C3 merges. The deploy phase (Z) needs the owner's accounts and runs last.

## 2. Changes to spec 2

| # | Spec 2 says | This plan does | Reason |
|---|---|---|---|
| 1 | "The 108 calls" (5.2, 12) | The server runs **108** calls: the 112 of the map minus the explicit list `SERVER_EXCLUDED` (`session.previewAs`, `session.setSimulateErrors`, `session.resetSampleData`, `files.get`). It adds **9** server calls (section 4.11). Total 117. `session.get` keeps its `prototypeOnly` flag, and the server ignores that flag. | `session.get` carries `prototypeOnly`, but every screen needs it (AM 2, CM R-2, TM 8.4). The flag also skips the simulated failure and lets an agent with no person switch away (`client.ts:37`, `:50`), so it stays. `files.get` returns a `Blob`, which JSON cannot carry; the remote screens use `files.link`. The 9 new calls carry the work that `State` cannot hold: story IDs, file links, invitations, agents, usage. |
| 2 | "Columns follow the zod fields" (6) | Each entity table keeps the whole zod record in one `doc jsonb` column. The key columns that loaders filter on are **generated** from `doc`. A few server-only columns sit beside it (section 4.1). | The record must come back exactly as it went in: absent stays absent, `null` stays `null`, stamps keep `+03:00`, numbers stay numbers (TM R9). A column per field needs a mapper for 24 tables, and each mapper is a place for drift. With `doc`, the zod check is one parse, and the key columns cannot drift from the record. |
| 3 | A `reactions` table and a `file versions` table (6) | Reactions stay in the comment's `doc`. File versions stay in the file's `doc`. | Only `reactions.toggle` and its Undo change reactions (AM 7.6). The file key check uses a JSON path query (AM 7.2). No handler reads either list apart from its parent. |
| 4 | No `counters` table (6) | A `counters` table, read and written inside the office lock. | `nextId` and the event `seq` need gap-free numbers. Postgres sequences leave gaps after a rollback (AM 7.7, TM R7). |
| 5 | "All Edge Functions run in Frankfurt" (4) | Kept for all three functions. The screens call `api` with `?forceFunctionRegion=eu-central-1`, and `pg_cron` calls `jobs` with `x-region: eu-central-1`. The platform starts `mcp` in the region nearest to the agent, so `mcp` forwards every request once to Frankfurt before any token check or database work (`MCP_FORWARD_REGION=eu-central-1`, the default). An agent request runs outside Frankfurt only when the owner says yes (section 10, decision 7). | An MCP client cannot add the `x-region` header, and a query parameter would change the OAuth resource URL (PF 1.3, 6.10). Without the hop, a US agent holds the office lock for 1.5 to 2.5 s (about 90 ms for each of 15 to 25 round trips), and client data is processed outside Frankfurt. |
| 6 | "OAuth 2.1 ... checks that each token was issued for Madar" (12) | A Custom Access Token Hook sets `aud` to the MCP URL for agent tokens. The hook reads that URL from the table `platform_config`, so each project gets its own value. The `mcp` function requires `client_id` and that `aud`. The `api` function refuses any token with `client_id`. | Supabase agent tokens carry `aud: "authenticated"`, the same value as a browser token (PF 6.8). |
| 7 | "the server returns `input_required`" (12) | `input_required` only when the agent declared `elicitation`. Otherwise a tool result with `isError: true` that tells the agent to send the call again with `reason` (or `dateReason`). | MCP forbids an `elicitation/create` request to a client that did not declare it (PF 7.4). |
| 8 | "Supabase sign-in mail ... goes through Resend" (10) | Madar sends invitation and reset mail itself, through the Resend HTTP API, in the person's language (`generate_link`). The Admin chooses that language in the person form (A8, U3). Supabase SMTP is set to Resend only as a fallback. | Spec 10 wants each email in the person's language; Supabase has one template for all people (CM 7.2). Edge Functions block port 587 (PF 1.1). |
| 9 | "no more than 90 notice emails a day" (10) | The day is the **UTC** day (03:00 Riyadh), as Resend counts it. Notices and summaries stop at 90. Sign-in mail and the one Admin warning still go, up to a hard stop at 98. | Sign-in mail uses the same Resend quota of 100 a day (PF 0.1 row 7, 10.1). |
| 10 | Free-plan limits (15) | Add **egress: 5 GB a month**. The server counts the bytes it reads from Postgres as an estimate, and the Admin gets the 80% warning like the other limits. The office cache loads only the changed rows (4.7). | The egress quota is tighter than the database size (AM 1.4, AM 9). A full cache reload on each write alone could use 1.6 to 4.1 GB a month. |
| 11 | "The same timer keeps the free Supabase project awake" (11) | Kept, but not trusted alone. The nightly backup also reads the database. Z1 watches for the pause warning email. | The docs do not say that `pg_cron` counts as activity (PF 5.4). |
| 12 | Restore test "once a month" (13) | The nightly backup encrypts to the owner's offline `age` key. The monthly restore check runs on the Mac with `scripts/restore-check.ts`, into a Postgres container. A scheduled workflow opens a reminder issue. The one restore into the second Supabase project happens at Z5. | A fully automatic check needs the private key in GitHub, which defeats the offline key (PF 11.3). The second Supabase project is also the test copy (TM 7, note on suite 15). |
| 13 | A change signal names "the project and the kinds" (9) | The signal carries `id`, `channel`, `seq`, `projects: string[]`, `office: boolean`, `kinds`, `people`. Each channel has its own counter: `office_meta.office_seq` for `office`, and one `person_seq` row for each `person:<userId>`. Personal changes (read marks, notices, own preferences) go only on person channels. | One call can touch two projects (a story Undo). Read marks of one person must not reload the whole office (CM 3.1). One global counter makes every screen see a gap after another person's read mark. |
| 14 | "no policy for the browser roles" (6) | True for every Madar table: `anon` and `authenticated` have no policy and no grant. Realtime needs read policies on `realtime.messages` for the `office` and `person:<id>` topics. The Data API (PostgREST and GraphQL) is off in both projects. | Private channels check RLS on `realtime.messages` (PF 4.2, CM R-16). Supabase grants EXECUTE on new functions in `public` to `anon` and `authenticated`, and the Data API serves them. |
| 15 | One file "up to 250 MB" (8) | `MAX_FILE_BYTES` becomes 250 MB in the shared contract, so the fake build and the real build agree. | The contract says 25 MB today (CM R-11). Spec 2 is the owner's number. |
| 16 | (not in spec 2) | The remote build uses path links (`createBrowserRouter`) and `base: '/'`. The fake build keeps hash links and `base: './'`. | Email links and the OAuth consent redirect carry a query string on a real path (CM 7.4). A relative base breaks every nested path. |
| 17 | (not in spec 2) | Each write in a batch carries a new idempotency key. Only the Retry button sends a key again. The server keeps the answer 24 hours, with a digest of the call name and input. | A lost answer plus a Retry would post twice (CM 2.6). A key that comes back with another input must not return an old answer. |
| 18 | `session.get` loses its prototype fields (3) | The output keeps `previewUsers`, `persistent`, `simulateErrors`. The server returns `[]`, `true`, `false`. | The fake build still needs these fields. No contract break. |
| 19 | Step 1 test deploy "on Railway" (17) | Z0a proves the Node build on Railway if the owner adds a card there. Otherwise Z0a proves it with the same Docker image on the Mac against the test project. | Railway needs a card (PF 12.1). The proof is about portability, and the image proves that. |
| 20 | "Each call is an MCP tool" (12) | The MCP server shows a fixed allowlist of 36 tools (5.6). The other calls stay on the deny list. | VS Code allows at most 128 tools in one request across all servers. Each tool definition uses model context. Many calls are screen work that an agent cannot use (uploads, read marks, counts). |
| 21 | "The database copy and the file copy go to the same second place" (13) | The database copy goes to release assets in the private repository `madar-backups`. The file copy goes to a Backblaze B2 `crypt` remote. B2 keeps replaced files in `old/` for 7 days. The B2 size is a usage meter. | A dump is one small file, and releases keep 30 copies for free. Files change one by one, and `rclone sync` to an S3 form of storage copies only the changes. |
| 22 | Notice emails tell what happened (10) | Notice and summary emails carry no client data. They say what happened in general words (for example "A task is assigned to you") and give a link. | Resend keeps email data and content in the US (PF 10.3). Spec 2, section 2 keeps client data in Frankfurt. Section 10, decision 8 lets the owner choose details instead. |
| 23 | "The proof runs first" (17, step 1) | Z0a uses small probe scripts with no app code and runs as soon as the accounts exist. The C3 merge waits for it. Z0b (agent, CPU, MCP time, egress) runs after G merges. | Most proof items need code from late waves. The items that can change the design (pooler lock, token hook, Realtime rollback, R2 headers) need only probes. |
| 24 | (not in spec 2) | The server connects as the role `madar_server`, which owns nothing. Migrations and the test harness use `postgres`. | The owner of a table skips RLS, keeps TRUNCATE on `events`, and can turn off the events trigger. So a server bug could change the History, which spec 1 (17.8) and spec 2 (5.6) forbid. |

## 2b. Owner changes after revision 2 (2026-10-03). These win over every other line of this plan

1. **Files start on Supabase Storage, not R2.** The owner did not turn on R2 (it needs a card). Track F builds a `FilesPort` with two adapters behind one interface, chosen by `MADAR_FILE_STORE=supabase|r2`:
   - `server/files/supabaseStorage.ts` (the default): a private bucket `madar-files`; signed upload links (Storage API `object/upload/sign`), staging key then `object/copy` to the final key, signed download links with the `download` file name, the same 10-minute life. It is tested on the local Supabase stack, which includes Storage.
   - `server/files/r2.ts`: the R2 adapter of section 5.2, tested against MinIO, ready for the switch.
   - The size limit comes from the active adapter: **50 MB per file and 1 GB in total on Supabase Storage free**, 250 MB per file on R2. `MAX_FILE_BYTES` in the shared contract stays the absolute ceiling (250 MB). The server refuses a bigger file with `file_too_large` and the limit in `details`. `session.get` returns `limits.maxFileBytes`, so the screens check before the upload and name the limit in plain words.
   - The storage meter (track M) uses 1 GB as the limit while the adapter is `supabase`. The 80% email tells the Admin that the next step is the move to R2 (the owner turns on R2) or removing old versions.
   - `scripts/storage/move-to-r2.ts` copies every object from Supabase Storage to R2 with the same keys: a full copy, then a second pass for the objects that changed during the first. It is tested from the local Storage to MinIO. The move is then one setting (`MADAR_FILE_STORE=r2` plus the R2 secrets).
   - Every R2 step of Z0a and Z (bucket, CORS, card) waits until the owner turns on R2. Z0a checks the files on Supabase Storage instead.
2. **No Railway, no Node image.** The fallback host is **Cloudflare Workers, paid plan ($5 a month)**, used only if Supabase Edge Functions stop working for Madar. Track E4 becomes "Workers entry": `server/entries/worker.ts` (mounts `/api`, `/mcp`, `/jobs` like `node.ts` did), `wrangler.server.toml` (`compatibility_flags = ["nodejs_compat"]`, for local runs only), and `server/it/worker.it.test.ts`: the same batch smoke on `supabase functions serve` and on `wrangler dev` on the Mac against the local stack. Delete `node.ts` and the `Dockerfile` from the plan; the server bundle target `dist-server/node.js` becomes `dist-server/worker.js`. Decision 3 of section 10 becomes: prove the Workers path locally with Wrangler, at no cost.
3. **Section 10 defaults are accepted** (1, 4, 5, 6, 7, 8, 9). Decision 2 reads as point 1 above. Decision 3 reads as point 2 above.
4. **The build does not wait for the team review.** The owner said "go ahead with the build". Docker is installed and running. The secrets that may go into GitHub follow the default (only the test-project secrets and the backup connection).
5. **Accounts that exist now** (`docs/superpowers/real-build/accounts.md`): Supabase `madar` (`oprkvdjudjxxhvodkzgs`) and `madar-test` (`qdgwpnesxppnqsaabqzd`), both in `eu-central-1`; Cloudflare account `d76d34779c63849f5acdf3d6af3751cd` (R2 off); Resend (no domain yet, so it sends only to the account owner's address); GitHub `byosamah/madar` (private). Secrets are in `~/dev/madar/.env.local`: `SUPABASE_ACCESS_TOKEN`, `MADAR_DB_PASSWORD`, `MADAR_TEST_DB_PASSWORD`, `RESEND_API_KEY`. The Supabase CLI on this Mac is logged in to another account (Halulu): every Madar command loads `SUPABASE_ACCESS_TOKEN` from `.env.local` first. Never print a secret.
6. **One local Supabase stack at a time.** The Mac has 16 GB of memory and 16 GB of free disk. Every task that needs Docker takes the lock `scripts/dev/docker-lock.sh` (T0 writes it: a `mkdir` lock at `/tmp/madar-docker.lock` with the holder and the time, a wait with a 30-minute limit, and a release on exit), runs `supabase db reset` from its own worktree, does its Docker work, and releases the lock. Never run two stacks.

7. **Signed file links check the view right explicitly** (automated security review, 2026-10-03). The product rule lets every active person see every project (spec 1, section 2), so the fake `files.link` in `serverFakes.ts` matches `files.get` and `files.list`. The real `files.link`, `files.uploadStart` and every call that returns a signed link (track F2) must still call `assertCan(ctx, 'project.view', { projectRole: roleIn(ctx, file.projectId) })` before it signs, in `prepare` too, so no link is ever made for a person who may not see the file (an inactive person, a token of an agent whose person was turned off). F2 adds a test for each refusal. T0 (or its repair) may add the same check to the fake for symmetry.

## 3. Target repository layout

```
madar/
  src/                         the screens and the shared rules (fake build and remote build)
    api/
      calls.ts                 calls = { ...map, ...serverFakes }                   (T0)
      sharedCalls.ts           the 108 calls that the server runs; SERVER_EXCLUDED  (T0)
      execute.ts               authority check + run + output check, shared by fake API and server (T0)
      contract/server.ts       contracts of the 9 server calls                     (T0)
      handlers/serverFakes.ts  fake versions of the 9 server calls for the prototype (T0)
      remote/                  wire.ts (T0); RemoteApi: batch, stories, keys, errors (R1); upload and feedback adapters (F3)
    app/
      mode.ts                  REMOTE and PROTOTYPE flags                          (T0)
      remote/                  bootstrap, Supabase client, channel, auth port       (T0 stubs, R2, U)
      signals.ts readMap.ts    targeted reload after a change signal               (R2)
    features/auth/             sign-in, welcome, forgot, reset, session expiry     (U)
    features/oauth/            agent consent screen                                (G)
    features/settings/NotificationsSection.tsx  in-app and email switches         (T0 moves, N2)
    i18n/real/*.json           new words, one file pair per track                  (T0 loader)
  server/                      the portable server (Deno and Node), TypeScript
    env.ts                     env() for both hosts                                (T0)
    core/                      ports, runCall, actor, story, idempotency, lock, effects (T0 ports and stubs, C3)
    data/                      tables, sql, rows, save, whole, office cache, loaders (B, C1, C2)
    calls/                     index.ts registry (T0); the 9 server calls          (C3, F, P, G, M)
    http/                      Hono app, routes.ts registry (T0), batch route, CORS, errors (E)
    auth/                      token check, invitations, Auth admin, rate limits   (P)
    files/                     R2 signing and object checks                        (F)
    signal/                    Realtime sender                                     (N1)
    mail/                      Resend sender, templates, quota, notice selection  (N2)
    jobs/                      the 15-minute job                                   (N3)
    usage/                     meters and 80% warnings                             (M)
    mcp/                       MCP 2026-07-28 server                               (G)
    entries/                   deno-api.ts, deno-mcp.ts, deno-jobs.ts, node.ts     (E)
    test/                      db-mode harness and fakes                           (T0 fakes, D)
    it/                        integration tests on the local stack                (each track)
  supabase/
    config.toml                local and remote settings                           (T0)
    migrations/                numbered SQL; platform parts in *_platform_*.sql    (B, N1, N3, G)
    functions/api|mcp|jobs/    index.ts + deno.json: thin wrappers over the bundle (E)
    functions/_build/          bundles made by `npm run build:server` (git ignores it) (E)
  scripts/                     build-remote, check-bundles (T0); first-admin (P); seed-test-office (X); restore-check, deploy/* (O); proof/* (Z0a)
  tests/e2e/                   today's Playwright files, prototype                 (unchanged)
  tests/e2e-deploy/            the browser checks on the test deployment           (X)
  .github/workflows/           ci, e2e-deploy, deploy, db-backup, files-backup, restore-reminder (O)
  config/headers.template      security headers and CSP; pages.sh writes dist/_headers from it (O)
  config/remote.test.env       public VITE_ values of the test deployment          (O)
  config/remote.production.env public VITE_ values of production                   (O)
  secrets/                     test.env, production.env: deploy secrets (git ignores the folder; Vite never reads it)
  vite.server.config.ts        the server bundle (Deno and Node)                   (E)
  Dockerfile                   the Node image for Railway                          (E)
```

There is no `public/` folder. Vite copies `public/` into every build, so a `_headers` file there would put the Supabase host into the prototype build.

**Rules that keep the fake API alive:**

1. `npm run build` stays the prototype build: hash links, `base: './'`, fake API, sample office. `npm run build:remote -- <test|production>` makes the real screens with the mode `remote-test` or `remote-production`.
2. `src/api` stays free of server code. The server imports `src/api`; `src/api` never imports `server/` or `src/app/`.
3. Every contract change in `src/api` is additive or keeps both forms (optional fields, a `blob` form and an `uploadId` form). The fake API implements every new call.
4. The 1,640 tests keep passing at every merge. Their count only grows. Only these named assertions change, each in the task that causes it: the 25 MB test in `files.test.ts` (T0.3, TM 8.3); the exact call list and the read-only name rule in `calls.test.ts` (T0.3); the call count in `actions.test.tsx` lines 63 to 66 (R1). No agent weakens any other assertion to make a red test pass.
5. `scripts/check-bundles.ts` (T0.1) fails the build when `dist/` of the remote build contains `buildSeed` or an `index.html` with a relative `./assets/` path, or when `dist/` of the prototype build contains `supabase` or a `_headers` file. It prints what it searched, so a search with no match is visible (CM 8).
6. **The build flag.** `vite.config.ts` defines `import.meta.env.VITE_MADAR_API` from `process.env.VITE_MADAR_API`, with the default `'fake'`, so the value is fixed at build time and the prototype bundle drops the remote chunk. `scripts/build-remote.ts` exports the values of `config/remote.<env>.env` before it starts Vite. `vite.config.ts` never calls `loadEnv` with an empty prefix. Secrets live in `.env.local` (no `VITE_` names) and in `secrets/<env>.env`, which Vite never reads.

**How the server runs the shared code on Deno.** The handlers use extensionless relative imports, which Deno does not resolve. So `npm run build:server` bundles each entry with Vite (Rolldown is already in the project) into one ESM file: `supabase/functions/_build/{api,mcp,jobs}.js` and `dist-server/node.js`. The Deno bundles keep `pg` and `node:*` external; each function's `deno.json` maps `pg` to `npm:pg@8.23.1`. Task E1 proves this first, before the other server tracks depend on it.

## 4. Data layer

### 4.1 Storage form

Every entity table has the same shape:

```sql
create table tasks (
  id          text primary key,
  ord         bigserial not null,                 -- insertion order: loads use ORDER BY ord (TM R8)
  doc         jsonb not null,                     -- the zod record, exactly
  project_id  text generated always as (doc->>'projectId') stored,
  owner_id    text generated always as (doc->>'ownerId') stored,
  status      text generated always as (doc->>'status') stored,
  due_date    text generated always as (doc->>'dueDate') stored,
  search_text text,                               -- server column, written by the save step
  constraint tasks_id check (doc->>'id' = id)
);
```

- `doc` is the source of truth. The loader returns `doc` as the record. The save step writes `doc` and the server columns.
- Generated columns cannot disagree with `doc`. A handler change that renames a field fails the zod check test (4.4) at once.
- `ord` keeps the `Object.values()` order of the prototype. An upsert keeps the `ord` of an existing row. A row that comes back after a delete (Undo) gets a new `ord`, as the prototype puts it last.
- Two keyed collections have no `id` in the record: `members` (key `projectId:userId`) and `chat_reads` (key `conversationId:userId`). Their check is `id = doc->>'projectId' || ':' || doc->>'userId'` (and the same with `conversationId`).
- Foreign keys: only `project_id` of the project child tables (`members`, `stages`, `deadlines`, `tasks`, `updates`, `files`, `tracker`, `payments`, `conversations`) refers to `projects(id)`, `deferrable initially deferred`. Other references stay unchecked on purpose: the prototype keeps comments and files after a task delete, and events and notices point at deleted records. The save step ends with `set constraints all immediate` (TM R11). **B1 checks** that Postgres accepts a foreign key on a stored generated column; if not, drop these keys, because the shadow run (7.2) is the real guard.
- Migrations never write `public.` in table names, so the test harness can apply them into one schema for each test worker (TM 5). The platform parts (Realtime policies, `pg_cron`, the token hook) go in files named `*_platform_*.sql`, which the harness skips.

**Roles and access** (B1, checked by B3):

- `madar_server` is a login role that owns nothing. The server connects as `madar_server.<ref>` through the transaction pooler. It has `select, insert, update, delete` on the Madar tables and their sequences, only `select, insert` on `events`, `execute` on `realtime.send`, and `usage` plus `execute` on the schema `madar_private`.
- RLS is on for every table. The only policy on each Madar table is `create policy server_all on <t> for all to madar_server using (true) with check (true)`. `anon` and `authenticated` have no policy and no grant on the Madar tables.
- The migration creates `madar_server` with `nologin`. `scripts/deploy/secrets.ts` sets `login` and the password from `secrets/<env>.env`, so no password goes into git. The local stack and CI use a fixed test password that the harness sets.
- Server-only SQL functions live in the schema `madar_private`, which the Data API does not expose: `current_madar_user_id()` (for the Realtime policies, execute granted to `authenticated`) and `agent_session_ok(session_id uuid, client_id uuid)` (a `security definer` function that reads `auth.sessions` for the MCP token check).
- `alter default privileges in schema public revoke execute on functions from public, anon, authenticated`.
- Migrations, the test harness setup and the backup keep `postgres`. The server never uses it.
- The Data API (PostgREST and GraphQL) is off in both projects (Z1). The screens use only Auth, Realtime and the `api` function.

### 4.2 Tables

| Table | State collection | Generated key columns | Server columns | Indexes (AM 5) |
|---|---|---|---|---|
| `users` | `users` | `kind`, `owner_id`, `active` (boolean), `email` (lower) | `auth_user_id uuid unique`, `chg` | `auth_user_id`, `chg` |
| `clients`, `teams`, `stage_templates`, `task_templates` | same names | none | `chg` | `chg` |
| `feedback` | `feedback` | none | none | none |
| `settings` | `settings` (one row, `id = 'office'`) | none | `chg` | none |
| `projects` | `projects` | `status`, `client_id`, `leader_id`, `code` | `search_text`, `chg` | `status`, `chg` |
| `members` | `members` | `project_id`, `user_id` | `chg` | `project_id`, `user_id`, `chg` |
| `stages`, `deadlines` | same | `project_id` | `chg` | `project_id`, `chg` |
| `conversations` | `conversations` | `project_id`, `kind` | `chg` | `project_id`, `chg` |
| `tasks` | `tasks` | `project_id`, `owner_id`, `status`, `due_date`, `stage_id` | `search_text` | `project_id`, `owner_id`, GIN on `doc->'helperIds'` |
| `updates` | `updates` | `project_id`, `created_at` | none | `(project_id, created_at desc)` |
| `comments` | `comments` | `target_type`, `target_id`, `created_at` | `project_id` (from the target, AM 5) | `(target_type, target_id, created_at)`, `project_id` |
| `files` | `files` | `project_id`, `task_id`, `stage_id` | `search_text` | `project_id`, `task_id`, GIN `jsonb_path_ops` on `doc->'versions'` |
| `tracker` | `tracker` | `project_id`, `reply_task_id`, `open` (boolean) | none | `project_id`, partial on open waits |
| `payments` | `payments` | `project_id` | none | `project_id` |
| `notifications` | `notifications` | `user_id`, `read`, `created_at`, `correlation_id`, `target_type`, `target_id`, `dedupe_key` | none | `(user_id, read, created_at desc)`, `correlation_id`, `(target_type, target_id)`, unique `dedupe_key` where not null |
| `messages` | `messages` | `conversation_id`, `created_at` | none | `(conversation_id, created_at)` |
| `chat_reads` | `chatReads` | `conversation_id`, `user_id` | none | `user_id` |
| `events` | `events` | `seq` (int), `project_id`, `target_type`, `target_id`, `correlation_id`, `verb`, `undoes`, `created_at` | none | `(target_type, target_id, seq)`, `correlation_id`, `(project_id, seq desc)`, `undoes` |
| `counters` | `counters` | (columns `prefix text pk`, `n int`) | | |

`chg bigint not null default 0` is on the 11 office tables only. The save step sets it (4.7).

**Server-only tables** (not in `State`):

| Table | Holds | Used by |
|---|---|---|
| `office_meta` | one row: `version` (the newest office change number), `office_seq` (the counter of the `office` channel) | office cache (C2), signals (C1) |
| `office_deletes` | `tbl`, `id`, `chg`: the office rows that a save deleted | office cache (C2) |
| `person_seq` | `user_id` primary key, `seq`: the counter of each `person:<id>` channel | signals (C1) |
| `platform_config` | `key`, `value`: `mcp_url` for each project, written by `secrets.ts`; `select` granted to `supabase_auth_admin` | token hook (G1) |
| `stories` | `id`, `actor_id`, `created_at` | story IDs (4.9) |
| `idempotency` | `key`, `actor_id`, `name`, `digest` (sha256 of the name and the canonical input), `result jsonb`, `created_at` | batch writes (4.10) |
| `outbox` | `id`, `kind`, `payload jsonb`, `attempts`, `claimed_until`, `done_at`, `error`, `created_at` | effects after commit (4.12) |
| `upload_intents` | `id`, `actor_id`, `project_id`, `staging_key`, `key`, `thumb_key`, `size`, `mime_type`, `expires_at`, `used_at` | files (5.2) |
| `agent_links` | `client_id` primary key, `owner_user_id`, `agent_user_id`, `client_name`, `redirect_host`, `approved_at`, `last_used_at`, `revoked_at` | MCP (5.6) |
| `mail_log` | `id`, `utc_day`, `kind`, `user_id`, `ref`, `resend_id`, `created_at`; unique `(utc_day, ref)` | email quota (5.4) |
| `mail_outbox` | test deployment only: the mail that would go out | X, N2 |
| `usage_month` | `month`, `calls`, `bytes_read` | meters (5.8) |
| `usage_warnings` | `month`, `metric`, `sent_at` | meters (5.8) |
| `rate_limits` | `key`, `window_start`, `count` | forgot password, invitations, MCP (5.1, 5.6) |
| `job_runs` | `key` (for example `summary:2026-10-04`, or `heartbeat`), `done_at` | jobs (5.5), usage (5.8) |

The first migration also inserts the `settings` row (`emptyState` values), the `office_meta` row, and nothing else. The office starts empty.

### 4.3 The events table only grows

- A trigger `before update or delete on events` raises an error. `revoke update, delete, truncate on events from public, anon, authenticated, service_role, madar_server`. `madar_server` has only `select` and `insert`. It owns nothing, so it cannot turn off the trigger, truncate the table, alter a table, or set `session_replication_role`. Only `postgres` keeps `truncate`, for the test harness (TM 5.5). B3 checks each of these as `madar_server`.
- The undo event names the event it undoes: a new optional field `undoes` on the `Event` contract (T0). `undoEvent` sets it (A1).
- The save step never writes `undoneBy`. The loader fills it: for each loaded event, `select id, undoes from events where undoes = any($1)`. The save step accepts a changed `undoneBy` on an existing event only when the same save inserts the undo event that names it; any other change to an existing event is a bug and fails the call.

### 4.4 The schema check against zod

`server/data/schema.test.ts` (B2, [Docker]) proves four things:

1. **Field names.** For each table in `server/data/tables.ts`, every generated column reads a field that exists in the zod schema of that collection (`schema.shape`).
2. **Round trip.** `writeState(buildSeed(today))` into an empty schema, then `loadWhole()`, deep-equals the seed, events included (with `undoneBy` filled from undo events). This covers absent versus `null`, stamps and numbers.
3. **Every row parses.** Each loaded record passes its zod schema (`User.parse`, `Task.parse`, and so on).
4. **No stray table.** The tables in the schema equal the tables in `tables.ts` plus the server-only list. A new zod collection without a table fails here.

### 4.5 Load, run, save: `runCall`

```ts
// server/core/types.ts (T0)
export type Principal = { userId: string; agent?: { clientId: string } };      // a Madar user id; for an agent, the agent's user id
export type StoryRef = { id: string } | { ref: string };                        // ref: a browser placeholder (CM 2.4)
export type RunRequest = { principal: Principal; name: string; input: unknown; story?: StoryRef; key?: string; batch: BatchScope };
export type RunError = { code: ApiErrorCode; message: string; details?: Record<string, unknown> };
export type RunResult =
  | { ok: true; output: unknown; storyId?: string; changed: boolean; signals?: ChangeSignal[] }
  | { ok: false; error: RunError };
export type ChangeSignal = {
  v: 1; id: string; channel: 'office' | `person:${string}`; seq: number;
  projects: string[]; office: boolean; kinds: Kind[]; people: string[]; storyId: string; actorId: string;
};
export type Kind = Exclude<keyof State, 'version' | 'seededOn' | 'session' | 'counters'> | 'projectTouched' | 'preferences';
export type BatchScope = { storyRefs: Map<string, string>; office?: OfficeSnapshot; overviewCalls: number };

// server/core/runCall.ts (T0 stub, C3)
export function runCall(deps: Deps, req: RunRequest): Promise<RunResult>;
```

`RunResult.signals` holds only the signals that the actor's own screen receives: the office signal, and the actor's person signal when the actor is in `people`.

The steps of `runCall`:

1. Find the call in `serverCallMap` (C3). An unknown name gives `not_found`. A call in `SERVER_EXCLUDED` is not in the map.
2. Parse the input with the call's wire schema (`def.wire?.input ?? def.input`). A failure gives `invalid_input` with the same `details` as `client.ts` today.
3. **Server call** (one of the 9 in 4.11): run its async function with a `ServerCallCtx` and return. These calls do their own permission checks with `can()` on the office snapshot.
4. **Read call** (`readOnly`): on the read pool, `begin isolation level repeatable read, read only`, then `set local statement_timeout = '10s'`. The loader reads a consistent snapshot, so a read never sees half a story. No lock.
5. **Write call**:
   1. **Before the transaction:** run the call's `preflight` hook if it has one (`files.upload`, `feedback.send`). A preflight does all the network work (R2 `HEAD`, copy, delete) with a 3 s timeout on each request, and reads with single statements on the read pool. It never holds the lock.
   2. On the write pool: `begin`, `set local lock_timeout = '5s'`, `set local statement_timeout = '10s'`, then `pg_advisory_xact_lock(config.lockKey)`. A lock timeout gives `failed` with `details.reason: 'busy'`.
   3. If `req.key` is set and `idempotency` has the key for this actor: when the stored `digest` equals the digest of this name and input, return the stored result; otherwise give `conflict` with `details.reason: 'key_reused'`.
   4. Resolve the story (4.9).
   5. Run the call's `prepare` hook if it has one (`files.upload`, `feedback.send`, `projects.delete`). A prepare hook runs SQL only, for example `update upload_intents set used_at = now() where id = $1 and used_at is null returning *`.
   6. Load the counters and the call's records with its loader (4.6). The loader gives the call its own deep copy of the office lists.
   7. Keep `before = structuredClone(state)`.
   8. Run `executeParsed()` from `src/api/execute.ts` (T0), the same code that the fake API runs: authority check, `run`, output check. On the server, `prototypeOnly` has no effect, because `actor.ts` already refused an agent with no active person.
   9. `save(q, before, state)` writes the difference (4.8) and returns the kinds, the projects, the people and the signal numbers.
   10. Write the outbox rows of the call (4.12), the idempotency row, and the signals (`deps.signal.send` inside the transaction).
   11. Commit. Any error rolls back, so a failed call writes nothing. The office cache is not touched, because it holds only rows that it read (4.7).
   12. Log how long the call held the lock, with the call name and `SB_REGION`. Above 500 ms the log line is a warning.
6. After the commit, `processOutbox(deps, ids)` claims and runs the effects of this call once, best effort (4.12). The 15-minute job retries the rest.
7. Map an `ApiError` to `{ ok: false, error }`. Any other error gives `failed` and goes to the log with the call name.

**The actor.** `server/core/actor.ts` (C3) reads the principal's `users` row from the office snapshot. A missing or inactive person gives `unauthenticated` with `details.reason: 'account_off'`. For an agent, the owner must be an active human, as in `client.ts` today. The check runs on every call (CM R-19).

**Ports.** All side effects go through ports, so tests use fakes (TM R4):

```ts
// server/core/ports.ts (T0)
export type Query = <R = Record<string, unknown>>(text: string, values?: unknown[]) => Promise<R[]>;
export interface Db {
  tx<T>(mode: 'read' | 'write', work: (q: Query) => Promise<T>): Promise<T>; // refuses a nested call (AsyncLocalStorage)
  savepoint<T>(q: Query, work: (q: Query) => Promise<T>): Promise<T>;        // only where code asks for it explicitly
  statement<R = Record<string, unknown>>(mode: 'read' | 'write', text: string, values?: unknown[]): Promise<R[]>; // one statement, no open transaction
}
export interface Clock { now(): Date }
export interface FilesPort {
  presignPut(key: string, o: { mimeType: string }): Promise<{ url: string; headers: { 'Content-Type': string }; expiresAt: string }>;
  presignGet(key: string, o: { disposition: 'inline' | 'attachment'; filename: string; mimeType: string }): Promise<{ url: string; expiresAt: string }>;
  head(key: string, o?: { timeoutMs?: number }): Promise<{ size: number; mimeType: string } | null>;
  copy(from: string, to: string): Promise<void>;
  remove(keys: string[]): Promise<void>;
}
export type Mail = { to: string; subject: string; html: string; text: string; tag: string; idempotencyKey: string };
export interface MailPort { send(mail: Mail): Promise<{ id: string }> }
export interface SignalPort { send(q: Query, signals: ChangeSignal[]): Promise<void> }
export interface AuthAdminPort {
  generateLink(type: 'invite' | 'recovery', email: string): Promise<{ authUserId: string; tokenHash: string }>;
  createUser(email: string, password: string): Promise<{ authUserId: string }>;
  setBanned(authUserId: string, banned: boolean): Promise<void>;
  updateEmail(authUserId: string, email: string): Promise<void>;
}
export interface MeterPort { addBytes(n: number): void; countRequest(db: Db): Promise<void> } // no-op default (T0); M fills it
export type Deps = { db: Db; clock: Clock; files: FilesPort; mail: MailPort; signal: SignalPort; authAdmin: AuthAdminPort; meter: MeterPort; config: Config; log: Logger };
```

`Config` holds `lockKey` (from the environment; in tests from the worker's schema, TM R6), `appUrl`, `apiUrl`, `mcpUrl`, `supabaseUrl`, `mailFrom`, `minClientBuild`, `allowedOrigins`, `region` (`SB_REGION`), `forwardRegion`, `limits`. `server/core/deps.ts` (E2) builds the real `Deps` from `env()`. `server/test/fakes/*.ts` (T0) give the fakes.

**Connections** (C1, `server/data/sql.ts`): each isolate has two `pg` pools, one for writes and one for reads, each with `max: 1` and `connectionTimeoutMillis: 5000`. So a read never waits behind a write that waits for the lock. `DATABASE_URL` has no `sslmode`. `pgDb` passes `ssl: { ca: <Supabase root CA from Database settings>, rejectUnauthorized: true }` on Deno and on Node. Supavisor drops session settings and startup options, so every timeout is a `set local` inside the transaction. The test harness for the `db` project (D1) wraps the same `pgDb` with savepoints inside one rollback transaction per test; the `server` and `it` suites run on the production `pgDb` with real commits.

### 4.6 Loaders

`server/data/loaders/index.ts` (C2) exports `LOADER_OF: Record<ServerCallName, LoaderSpec>`. A unit test fails when a call has no entry. Each loader returns a full `State` object: a deep copy (`structuredClone`) of the office lists from the cache, plus the scoped rows, plus empty objects for the rest. A loader never puts a cached object into a `State`. Each loader reports the bytes it read through `deps.meter.addBytes`.

| Loader | Calls | Reads (from AM 5) |
|---|---|---|
| `office` | people, clients, settings, teams, templates, `deadlines.list`, `session.get` | Office lists and the project index from the cache. |
| `feedback` | `feedback.*` | Office, plus all feedback rows. |
| `project` | `projects.get` and project, member, stage, deadline writes; `tasks.create`, `tasks.createFromTemplate`, `tasks.list {projectId}`; `files.list`, `files.upload`; `payments.*`; `tracker.list`, `tracker.log`, `tracker.delete`, `tracker.export`; `updates.list` | Office, all tasks of P, the newest N posts and newest N feed events of P (N = 2 for the project view, `limit` for `updates.list`), the comments of those posts, the targets of those events by id; the tracker and files of P only for tracker, file and stage calls; payments of P only for payment calls; `tracker.export` adds all tracker events of P. |
| `task` | `tasks.get` and every task write; `tracker.close`, `tracker.update`, `tracker.assignReply` | Project of T, plus all events with target T, all comments on T, all files of T, and for a status change the tracker entry of a reply task and its files. |
| `content` | `comments.*`, `reactions.toggle`, `updates.create`, `updates.update`, `updates.delete` | The comment or post by id, its target, its project core, the comments of the target, files by id. |
| `story` | `events.undo`, `events.undoStory` | The event or all events of the story, the later events of each target, the project of each target, each row that `before` names, the notices of the story, the undo events that point at the loaded events, and the reference rows of section 4.13 (A1). |
| `inbox` | `notifications.*` | Office, the unread notices of U, the newest read ones up to `limit`, the target of each notice, the delete event of each gone target; the notices by `ids`. |
| `chat` | `chats.*`, `files.share` | Office, the read marks of U, for each visible conversation the newest message and the messages after U's mark, the task threads of U (A5 limit), `chats.messages` with its page. |
| `overview` | `projects.list`, `dashboard.get`, `tasks.list` without `projectId`, `search.query`, `events.list` | Office, the tasks of the projects in scope (trimmed rows for reads, AM 9), for `projects.list` the newest 2 posts and feed events of each project (one lateral join), the open tracker entries for the dashboard, the text matches for search (`search_text`), the newest `limit` events that match the filter. |
| `projectDelete` | `projects.delete` | Every row of P, the comments and notices that point at P's tasks, posts and chat (A2), the chat with its messages and marks. |
| `jobs` | the 15-minute job (not a call) | Open tasks with a due day in active projects, paused projects with a restart day, the reviewers, the notices with the dedupe keys the run can write (A3). |

**Counts.** Loaders that show lists put counts in a new optional `State.counts` map (`comments:<targetId>`, `files:<taskId>`), and the helpers read it first (A4). This keeps `tasks.list` and `projects.list` fast and correct without loading every comment.

**Safety net.** A loader that leaves out a record gives a wrong answer without an error. The db-mode shadow run (7.2) runs every API test call twice, in memory on the whole office and on the database with the scoped loader, and fails on any difference. AM 6 lists 18 known places; each one is a test case in C2.

### 4.7 The office cache

- `server/data/officeCache.ts` (C2) keeps users (with `auth_user_id`), teams, settings, clients, stage templates, task templates, projects, members, stages, deadlines and conversations in module memory, with the `office_meta.version` it read. It deep-freezes its objects, so a write into a cached object throws.
- The cache holds only rows that it read from the database, so it holds only committed data. A call's own change reaches the cache on a later request, through the version.
- Each request reads `office_meta` (one small row). A read reads it inside its snapshot; a write reads it after the lock.
- The save step raises `office_meta.version` by 1 when it changes a row of an office table. It sets `chg` of each changed office row to the new version, and writes each deleted office row into `office_deletes (tbl, id, chg)`. `projectTouched` (only `updatedAt` changed) raises the version too, because the project index holds `updatedAt`.
- On a new version, the cache loads only the office rows with `chg` above its version, plus the new rows of `office_deletes`. For `projectTouched` that is one project row. A full load runs only on a cold start, or when the cache version is older than the oldest kept `office_deletes` row (the job keeps 7 days).
- Each call gets its own deep copy of the lists (about 118 KB in year 1 and 314 KB in year 3; a few ms of CPU).
- One batch reads the office once (`BatchScope.office`), not once for each entry (CM 4.1). `runCall` drops `BatchScope.office` after any entry that raised `office_meta.version`, so a later entry sees the earlier write.
- C3 test: a call that adds a member and then throws leaves the cache unchanged, and a second call on the same isolate does not see the member. Z0b measures the egress for each write.

### 4.8 The diff writer

`server/data/save.ts` (C1):

```ts
export type SaveResult = { changed: boolean; kinds: Set<Kind>; projects: Set<string>; office: boolean; people: Set<string>; bytesWritten: number; signals: ChangeSignal[] };
export function diffState(before: State, after: State): Diff;          // pure, unit-tested without a database
export function writeDiff(q: Query, diff: Diff): Promise<SaveResult>;
export function save(q: Query, before: State, after: State): Promise<SaveResult>;
```

- For each collection, compare by key with `JSON.stringify` of the record. New key: insert. Changed: update `doc`. Missing in `after`: delete. One statement for each table and each kind of change (`insert ... select from jsonb_array_elements($1) ... on conflict (id) do update`, `delete ... where id = any($1)`), in the key order of `after`, so `ord` follows the prototype order.
- `events`: inserts only, as 4.3 says.
- `counters`: upsert the changed prefixes.
- `session`, `version`, `seededOn`, `counts`: never written.
- Server columns: `comments.project_id` from the target (task or post, looked up in `after` or by a query), `search_text` from the shared `normalize()` in `src/lib`, `chg` and `office_deletes` for office tables (4.7).
- Kinds: the changed collections, with two narrow kinds (CM 3.1): `projectTouched` when the only project change is `updatedAt`, `preferences` when the only user change is `preferences`. `people`: the owners of changed notifications, chat reads and own preferences.
- Signals: a change whose only kinds are `chatReads`, `notifications` or `preferences` is personal and goes only on person channels. Any other change gets one office signal: the save raises `office_meta.office_seq` and uses the new value. For each person in `people`, the save raises that person's `person_seq` row and makes one person signal. All signals of one save share one `id` (a random value), so a screen that receives a change twice applies it once.
- It ends with `set constraints all immediate`.

### 4.9 Story IDs from the server

- `story.start {}` returns `{ storyId }`: `sty_` plus 22 random base32 characters (fits the 80-character `correlationId`). The server inserts it into `stories` with the actor.
- A write call with `story: { id }` is accepted only when the story exists, belongs to the same actor, and is younger than 24 hours. Otherwise `forbidden` with `details.reason: 'story_not_yours'` (spec 2, 5.5).
- A write call with no story gets a new one in the same transaction. The result returns `storyId`.
- A write call with `story: { ref }` (a browser placeholder `cor_ui_...`): the first call with that ref in the batch mints a story, and `BatchScope.storyRefs` maps the ref for the rest of the batch. The browser keeps the map across batches for 24 hours (R1).
- `events.undoStory { correlationId }` keeps its rules in `can()`. The story check above is about the meta of a write, not about which story an Undo may name.
- The job deletes stories older than 7 days. Old events keep their `correlationId`.

### 4.10 The batch endpoint

`POST /api/batch?forceFunctionRegion=eu-central-1` (E3). Wire form as CM 2.2:

```ts
// src/api/remote/wire.ts (T0): shared by RemoteApi and the server
export type WireCall = { i: number; name: string; input: unknown; story?: StoryRef; key?: string };
export type WireRequest = { v: 1; calls: WireCall[] };
export type WireEntry =
  | { i: number; ok: true; output: unknown; storyId?: string; changed?: boolean; signals?: ChangeSignal[] }
  | { i: number; ok: false; error: RunError };
export type WireResponse = { v: 1; serverTime: string; results: WireEntry[] };
export const MAX_BATCH = 12;
export const OVERVIEW_CALLS = ['projects.list', 'dashboard.get', 'tasks.list', 'search.query', 'events.list'] as const; // tasks.list only without projectId
```

- R1 adds `forceFunctionRegion=eu-central-1` to every request URL, `/api/auth/forgot` included. The `api` function logs `SB_REGION` at a cold start, and Z0a checks that the value is `eu-central-1`.
- One sign-in check for the batch; one `runCall` for each entry, in the order sent. Each write is its own transaction (TM 9). A read after a write in the same batch sees the write.
- One refused entry does not refuse the others.
- At most one overview call in one request, because the 2 s CPU limit applies to the whole request. The batcher (R1) puts each overview call in its own request. The server refuses a second overview call in one batch with 413 and `details.reason: 'too_many_overviews'`.
- HTTP answers: 200 with entries; 401 with no valid token; 403 `account_off`; 409 `client_outdated` when `X-Madar-Build` is older than `MIN_CLIENT_BUILD`; 413 for more than 12 entries, for a body over 256 KB, or for a second overview call; 429 with `Retry-After` from the rate limit.
- After the last entry, the route calls `deps.meter.countRequest(deps.db)`: one statement of its own, never inside the transaction of a call. The usage meter counts one call for each batch (5.8).
- Idempotency: `RemoteApi` makes a new key for each `call()` of a write. `useAction` keeps the key of a failed attempt and sends it again only from its Retry button (`meta.key`). A write entry with `key` stores its result and the digest of its name and input in `idempotency`, in the same transaction. A repeat of the key by the same actor with the same digest returns the stored result and runs nothing. A repeat with another digest gives `conflict` with `details.reason: 'key_reused'`. The job deletes keys older than 24 hours.

### 4.11 The 9 server calls

Contracts in `src/api/contract/server.ts` (T0). Fake versions in `src/api/handlers/serverFakes.ts` (T0), so the prototype screens use the same calls. T0 also writes a stub for each server call file that throws `ApiError('failed')` until its owner track replaces it.

| Call | Kind | Input | Output | Owner track |
|---|---|---|---|---|
| `story.start` | write | `{}` | `{ storyId }` | C3 |
| `files.uploadStart` | write | `{ projectId, name, size, mimeType, stageId?, taskId?, thumb?: { size, mimeType } }` | `{ uploadId, put: { url, headers, expiresAt }, thumbPut? }` | F |
| `files.link` | read | `{ id, letter?, variant: 'full' \| 'thumb', disposition: 'inline' \| 'attachment' }` | `{ url, expiresAt, name, mimeType, size }` | F |
| `feedback.uploadStart` | write | `{ screenshots: { size, mimeType }[] }` (at most 3, 10 MB each) | `{ uploads: { uploadId, put }[] }` | F |
| `users.invites` | read, Admin and Management | `{}` | `{ userId, state: 'invited' \| 'active', sentAt }[]` | P |
| `users.resendInvite` | write, Admin and Management | `{ id }` | `{ sentAt }` | P |
| `agents.list` | read | `{}` | `{ agentId, clientIds, name, redirectHost, approvedAt, lastUsedAt, active }[]` | G |
| `agents.remove` | write | `{ agentId }` | `{ removed: true }` | G |
| `usage.get` | read, Admin | `{}` | `{ month, calls, database, files, backupCopy, emails, egress, failedEffects: { kind, error, attempts, createdAt }[], jobsLastRun: string \| null }`; each meter `{ used, limit }` | M |

`files.get` stays in the fake map with its `blob` output, and `SERVER_EXCLUDED` keeps it off the server and off the MCP list. In fake mode, `useFileUrl` keeps calling `files.get` and revokes its `blob:` URL as today (`src/app/files.ts:27`).

### 4.12 Effects after the commit (outbox)

Handlers stay synchronous and pure. Work outside the database goes through the `outbox` table:

- C3 owns `server/core/effects.ts`: `EFFECTS_OF: Partial<Record<ServerCallName, (output, saved: SaveResult, q: Query) => Promise<OutboxRow[]>>>` and `processOutbox(deps, ids)`, which dispatches each row to a handler that another track registers through `registerEffect(kind, handler)`.
- Kinds and owners: `auth.invite` (P), `auth.ban`, `auth.unban`, `auth.email` (P), `agents.revokeAll` (G), `mail.notice` (N2), `r2.delete` (F).
- The outbox rows are written in the call's transaction, so a rollback leaves no effect.
- **Claim before work.** `processOutbox` and the job first claim a row with one statement: `update outbox set claimed_until = now() + interval '2 minutes', attempts = attempts + 1 where id = $1 and done_at is null and (claimed_until is null or claimed_until < now()) returning *`. No row means another worker has it. The job retries only rows older than 2 minutes, up to 5 attempts.
- `auth.invite` keeps the `hashed_token` of its first `generate_link` in the payload and uses it again on a retry, so the first email never carries a dead link.
- A failed effect keeps `attempts` and `error`. `usage.get` returns the failed effects as `failedEffects`, and the usage panel shows them to the Admin with one Retry (M1).

### 4.13 Handler changes (track A)

| Change | File | From |
|---|---|---|
| A1. `isUsedElsewhere` uses an explicit reference map per target type. The undo event gets `undoes`. | `src/api/events.ts`, `src/api/references.ts` (new) | AM 7.1, 7.8 |
| A2. `projects.delete` deletes comments and notices by the ids of P's tasks, posts and chat, not by absence. `after` asks `blobKeysInUse(keys)` (a new optional `PrepareCtx` member) before it removes data. | `src/api/handlers/projects.ts`, `src/api/registry.ts` | AM 7.2 |
| A3. `notify` takes an optional `dedupeUsed(key)` lookup. Without it, the scan of today runs. | `src/api/notify.ts` | AM 7.3 |
| A4. `countComments` and the file count read `state.counts` first. | `src/api/views.ts`, `src/api/store.ts` (optional `counts`) | AM 7.4 |
| A5. `chats.messages` takes `before?` and `limit?` (default 200, newest first, returned oldest first). `chats.list` keeps the newest 100 task threads. | `src/api/handlers/chats.ts`, `src/api/chatState.ts` | AM 7.5 |
| A6. One API test for each of the 8 calls that have none. | `src/api/handlers/*.test.ts` (new files) | TM 2.2 |
| A7. `notifications.updateSettings` accepts `email` switches and `morningSummary`. A missing `morningSummary` means on. | `src/api/handlers/notifications.ts` | spec 2, 10 |
| A8. `users.create` takes an optional `language`. The default is the language of the Admin who creates the person. | `src/api/handlers/people.ts` | spec 2, 10 |

The fake API runs the same changed handlers, so the 1,640 tests prove that the prototype behaviour stays the same.

## 5. Features

### 5.1 Sign-in and people

**Flow.** Email and password with Supabase Auth. Open sign-up is off. Madar sends the invitation and reset mail itself (change 8).

| Piece | Interface | File | Track |
|---|---|---|---|
| Token check | `verifyBrowserToken(header): Promise<{ authUserId: string }>` with `jose` against the JWKS, issuer `${SUPABASE_URL}/auth/v1`, `aud: 'authenticated'`; refuses a token with `client_id` | `server/auth/verify.ts` | P (T0 stub) |
| Person lookup | `principalOf(authUserId, office)`: the `users` row by `auth_user_id`; none gives 401 | `server/auth/principal.ts` | P |
| Auth admin | `AuthAdminPort` over the GoTrue admin REST API with the secret key (`/auth/v1/admin/generate_link`, `/admin/users`) | `server/auth/admin.ts` | P (T0 stub) |
| Invitation | effect `auth.invite`: `generateLink('invite')`, store `auth_user_id`, send the invite mail in the person's language (A8) with a link to `${APP_URL}/welcome?token_hash=...&type=invite` | `server/auth/invite.ts` | P |
| Resend | `users.resendInvite`: a new link (`invite`, or `recovery` when the Auth user exists), 5 a day for each person | `server/calls/people.ts` | P (T0 stub) |
| Forgot | `POST /api/auth/forgot { email }` (`?forceFunctionRegion=eu-central-1`): the same answer for every address; 3 an hour for each email, 10 an hour for each IP; `generateLink('recovery')` and a reset mail. `server/http/routes.ts` (T0) mounts it. | `server/auth/forgot.ts` | P (T0 stub) |
| Turn off | effect `auth.ban` after `users.deactivate` (ban plus `agents.revokeAll`); `auth.unban` after `users.reactivate`; `auth.email` after an email change | `server/auth/effects.ts` | P |
| First Admin | `npx tsx scripts/first-admin.ts --env test|production --email <e> --name <n> --language <en|ar> --gender <female|male>`: asks for the password without echo, creates the Auth user and the `users` row `usr_001` (Admin), sets `counters.usr = 1`, writes the `user.created` event. It refuses when an Admin exists. | `scripts/first-admin.ts` | P |
| Screens | Sign in, Welcome (a button, so a mail scanner does not use the token), Forgot, Reset, Signed out reasons, Session expiry sheet, Link no longer valid (CM 7.1) | `src/features/auth/*.tsx`, `src/app/remote/auth.ts` (the `AuthPort` for Supabase) | U |
| Gate | `AuthGate` layout route around the shell and the meeting view; remote mode only. It mounts `SessionExpiredSheet` once, so the sheet also shows in the meeting view and keeps its drafts. | `src/app/routes.tsx`, `src/features/auth/AuthGate.tsx` | U |
| Sign out | Person menu row: `signOut()`, remove the channels, `queryClient.clear()`, `keepDraftsOf('')`, go to `/sign-in?reason=signed_out` | `src/app/PersonMenu.tsx` | U |
| Settings, Password | current and new password; `signInWithPassword` to check the current one, then `updateUser` | `src/features/settings/PasswordSection.tsx` | U |
| People | "Invited" badge from `users.invites`, "Send the invitation again", toast "Invitation sent to <name>"; a Language choice in the person form | `src/features/settings/admin/PeopleSection.tsx`, `PersonFormSheet.tsx` | U |
| Prototype controls | Preview as, Simulate errors, Reset sample data, the Prototype section, the agent form in `PersonFormSheet`: behind `PROTOTYPE`; the storage banner becomes a "No connection" banner in remote mode (CM 6), from `runtime.changes.status()` | the files in CM 6 | U |

**Acceptance tests** (suites 3 and 4 of TM 7):

- `server/auth/verify.test.ts`: a good token passes; a token with the wrong issuer, an expired token, a token with `client_id` fail.
- `server/it/auth.it.test.ts` [Docker]: sign-in with email and password; open sign-up is refused; no token gives 401; a turned-off person's valid token gives 403 `account_off` on the next call; the role comes from `users`, not from the token; the forgot route rate limit; `first-admin.ts` run twice makes one Admin.
- `server/it/invites.it.test.ts` [Docker]: the Admin invites; the mail arrives in Mailpit (local stack) or `mail_outbox`; the link sets a password; the person signs in; a Member cannot invite; a second invitation to the same email is refused; an old link fails; an Arabic person gets the invitation and the reset mail in Arabic; a retried `auth.invite` effect sends the same link.
- `src/features/auth/*.test.tsx` (jsdom, fake `AuthPort`): each screen in English, and in Arabic with `dir="rtl"`; the calm checks of section 6.1, rule 8; the sign-in error is one sentence for a wrong email and a wrong password; the session sheet keeps the screen and its drafts, in the shell and in the meeting view.

### 5.2 Files on R2

**Flow** (CM 5):

1. `files.uploadStart` checks rights and size, writes an `upload_intents` row, and returns a signed `PUT` for the staging key `up/<intentId>` (10 minutes). Only `Content-Type` is signed, so the browser sends one header that the CORS rule allows.
2. The browser sends the file to R2 with `XMLHttpRequest`.
3. `files.upload { uploadId, ... }`. The **preflight** (before the lock, section 4.5, step 5.1) reads the intent, runs `HEAD` on the staging key with a 3 s timeout, checks the size (at most 250 MB) and the type against the intent, copies the object to its final key with R2 `CopyObject`, and deletes the staging key. A second `PUT` with the same signed URL then changes nothing that a file version uses. Over the limit, the preflight writes an `r2.delete` outbox row in its own short transaction and refuses.
4. The **prepare** hook (inside the lock, SQL only) runs `update upload_intents set used_at = now() where id = $1 and used_at is null returning *`. No row gives `conflict`. It passes `{ blobKey, size, mimeType, thumbKey }` to the shared handler as `prepared`.

**Downloads.** `files.link` signs a `GET` with `response-content-disposition` in the form `attachment; filename="<ASCII fallback>"; filename*=UTF-8''<percent-encoded name>` (RFC 6266 and RFC 5987), or the same with `inline`. The types `text/html`, `image/svg+xml`, `application/xhtml+xml` and every XML type get `attachment` only, so an uploaded page cannot run a script on the R2 origin.

| Piece | Interface | File | Track |
|---|---|---|---|
| R2 client | `r2FilesPort(env): FilesPort` with `aws4fetch`, EU endpoint `https://<account>.eu.r2.cloudflarestorage.com/<bucket>` | `server/files/r2.ts` | F (T0 stub) |
| Keys | `objectKey(projectId, fileId, n)`: only `[a-z0-9/-]`; thumbs end in `/thumb`; staging keys `up/<intentId>` | `server/files/keys.ts` | F |
| Calls | `files.uploadStart`, `files.link`, `feedback.uploadStart`; the server hooks: `preflight` and `prepare` for `files.upload` and `feedback.send`, `prepare` for `projects.delete` | `server/calls/files.ts`, `server/calls/feedback.ts` | F (T0 stubs) |
| Contract | `files.upload` input: `blob` (fake) or `uploadId` (wire), exactly one; `wire.input` is the `uploadId` form; `FileVersion.thumbKey?`; `feedback.send` `screenshots` or `uploadIds`; `feedback.screenshot` wire output `{ url, expiresAt }` | `src/api/handlers/files.ts`, `src/api/handlers/feedback.ts`, their tests | T0.3 |
| Delete | effect `r2.delete` for keys that `blobKeysInUse` does not hold, after the commit | `server/files/effects.ts` | F |
| Pictures | `makeThumb(file): Promise<Blob \| null>` (960 px WebP; null when the browser cannot read the image) | `src/app/thumbs.ts` | F |
| Adapters | `uploadAdapter({ makeThumb })` and `feedbackAdapter()`: `RemoteApi` turns `files.upload { blob, ... }` and `feedback.send { screenshots }` into the three steps. `makeThumb` comes in as a parameter, so `src/api` does not import `src/app`. | `src/api/remote/{upload,feedback}.ts` | F (T0 stubs) |
| Screens | remote mode: `useFileUrl(fileId, letter, variant)` calls `files.link`, `staleTime` 8 minutes, a new link on image error; fake mode: `files.get` with the revoke step of today. Three lines pass `'thumb'`. `downloadFile` uses `disposition: 'attachment'`, with the fetch fallback only when Z0a shows that R2 ignores `response-content-disposition` | `src/app/files.ts`, `FilesTab.tsx:33`, `ProjectCard.tsx:15`, `DrawingsStrip.tsx:14` | F |
| Storage meter | the sum of `size` of every file version and screenshot, from SQL; part of `usage.get` | `server/usage/meters.ts` | M |
| Unfinished uploads | the job deletes intents older than 1 hour with `used_at` null, with their staging and final objects | `server/jobs/steps/uploads.ts` | N3 |

`FilesTab`, `Attachments` and `NewProjectSheet` keep their calls. Never put a signed link into a message body (CM 5.5).

**R2 CORS rule** (Z2): `AllowedOrigins` the Pages hosts and `http://127.0.0.1:5173`; `AllowedMethods` `PUT`, `GET`; `AllowedHeaders` `Content-Type`; `MaxAgeSeconds` 7200.

**Acceptance tests** (suite 8): `server/files/r2.test.ts` (signature form, key rules, the RFC 6266 form for an Arabic name, `attachment` for HTML and SVG); `server/it/files.it.test.ts` [Docker, MinIO]: a signed PUT works for 10 minutes and then fails; a PUT with another `Content-Type` fails; `files.upload` with a 251 MB object is refused and the object is gone; a second PUT after `files.upload` leaves the confirmed version unchanged; a file with an Arabic name uploads and downloads with its name; `files.link` refuses a person outside the project; a project delete removes the data only after the commit, and keeps a key that another project uses; with a fake `FilesPort` that waits 10 s in `head`, a parallel `tasks.create` still succeeds. Z0a adds one smoke on a real EU bucket from a browser, with an Arabic file name [Accounts].

### 5.3 Realtime change signals and the client reload

**Server** (N1): `realtimeSignalPort: SignalPort` runs, inside the save transaction, one `select realtime.send($payload, 'changed', $topic, true)` for each signal of the save: the office signal on `office`, and one person signal on each `person:<userId>`. A rollback sends nothing (PF 4.1).

**Policies** (N1, `20261004000200_platform_realtime.sql`): select policies on `realtime.messages` for topic `office` (any active member, through `madar_private.current_madar_user_id()`) and topic `'person:' || madar_private.current_madar_user_id()`; no insert policy. Realtime "Allow public access" is off (Z1).

**Client** (R2):

```ts
// src/app/signals.ts
export type ChangeSource = { subscribe(listener: (signals: ChangeSignal[]) => void): () => void; status(): 'open' | 'closed' };
export function affects(queryKey: readonly unknown[], data: unknown, merged: MergedSignal, me: string): boolean; // CM 3.3
export function connectChanges(queryClient: QueryClient, source: ChangeSource, me: () => string): () => void;
// src/app/readMap.ts
export const READS: Record<string, { scope: 'office' | 'project' | 'person' | 'none'; kinds: Kind[]; projectOf?(input: unknown, data: unknown): string | undefined }>;
// src/app/remote/channel.ts
export function supabaseChangeSource(supabase: SupabaseClient, me: string): ChangeSource;
```

- Own writes: `RemoteApi` applies the signals from the answer at once. The client drops any later signal with an `id` it already applied.
- Other writes: merge for 1 second (at most 2), one invalidation pass, one batch.
- Gaps: the client keeps the last `seq` of each channel by itself (`office`, and its own `person:<id>`). A gap on the office channel reloads all active `['api']` queries; a gap on the person channel reloads only the person reads (Inbox, chats, counts, session).
- Hidden tab: mark only; reload the marked active queries on `visibilitychange`.
- Missed signals: reload all active `['api']` queries on reconnect and after 60 seconds hidden. No timer.
- `setAuth()` before a private channel subscribes and after each token refresh (CM 7.3).
- Fake mode: the store subscription sends one "match all" signal, so the prototype and its tests behave as today. The fake `ChangeSource.status()` is always `'open'`.

**Acceptance tests** (suite 7): `src/app/readMap.test.ts` runs each read call over several inputs with a recording `Proxy` and fails when `READS` misses a kind (CM R-6); `src/app/signals.test.ts` (fake channel): a signal for project A does not reload a list of project B; an office `seq` gap reloads all; a read mark by person B makes no reload on the screen of person A; the same change on two channels applies once; a hidden tab reloads on visible; `server/it/realtime.it.test.ts` [Docker]: one message for each channel after a commit, none after a rollback or a read, a signed-out client and a turned-off person cannot join, a person cannot join another person's channel.

### 5.4 Email with Resend

| Piece | Interface | File | Track |
|---|---|---|---|
| Sender | `resendMailPort(env): MailPort` (HTTP API, `Idempotency-Key`); `outboxMailPort` writes to `mail_outbox` when `MAIL_DRIVER=outbox` (test deployment) | `server/mail/resend.ts`, `server/mail/outboxDriver.ts` | N2 (T0 stubs) |
| Quota | `reserve(q, kind, ref): Promise<'ok' \| 'over'>` on `mail_log` by UTC day, as one statement under `pg_advisory_xact_lock` with a mail key, in a short transaction of its own; `notice` and `summary` stop at 90; `signin` and `warning` stop at 98; the first refused notice of the day sends one warning to each Admin | `server/mail/quota.ts` | N2 |
| Selection | effect `mail.notice`: for each notification row that the save inserted, mail when the person is an active human and `preferences.email[trigger]` is on (default on for `task_assigned`, `review_requested`, `mention`; off for the rest) | `server/mail/notices.ts` | N2 |
| Templates | `renderMail(kind, lang, data, g: { actor?: Gender; reader?: Gender }): { subject, html, text }` for `invite`, `reset`, `notice` (one per trigger), `summary`, `limitWarning`, `quotaWarning`; Arabic with `dir="rtl"` and the `_female` forms through `actorContext()` (`src/lib/grammar.ts`); the words come from `src/i18n` files where they exist, plus `src/i18n/real/mail.{en,ar}.json`. Notice and summary mails carry no client data: no task title, project name or comment text, only general words, a count and a link (change 22). | `server/mail/templates/*.ts` | N2 |
| Morning summary | `buildSummary(q, user, today)`: the count of tasks due today and of reviews that wait; nothing to say means no mail | `server/mail/summary.ts` | N2 |
| Settings | Settings, Notifications shows one row for each trigger with two small switches (In app, Email), plus one Morning summary row. A missing `morningSummary` reads as on. Email switches show in remote mode only. | `src/features/settings/NotificationsSection.tsx` | N2 (T0 moves the section) |

The sending domain is a subdomain (for example `notices.<domain>`), region `eu-west-1` (PF 10.3).

**Acceptance tests** (suite 9): template snapshots in both languages, with a female actor and a female reader in Arabic; no template output contains the task title or project name of its data; default switches; notice 91 of the UTC day stays in the app and makes one Admin warning; two parallel `reserve()` calls at 89 give one `ok` and one `over`; the counter resets at 03:00 Riyadh; an invitation still goes after 90 notices; `NotificationsSection.test.tsx` in English and in Arabic with `dir="rtl"`: one row for each trigger, two switches each, the Morning summary on when the field is missing; `server/it/email.it.test.ts` [Docker]: the effect sends once even when it runs twice (claim and idempotency key).

### 5.5 Timed work with pg_cron

- `20261004000300_platform_cron.sql` (N3): `cron.schedule('madar-jobs', '*/15 * * * *', ...)` with `net.http_post` to `<project_url>/functions/v1/jobs/run`, headers `x-region: eu-central-1` and `x-madar-jobs-secret` (PF 5.2). The migration reads the Vault secrets `project_url` and `jobs_secret` by name only. `scripts/deploy/secrets.ts` writes their values with `vault.create_secret` or `vault.update_secret` from `secrets/<env>.env`. A CI check (O1) fails when a migration has `create_secret(` with a literal value.
- `server/jobs/app.ts` (N3): `POST /jobs/run` (the function path `/functions/v1/jobs/run`), constant-time secret check, then `runJob(deps, at)`. `server/entries/node.ts` mounts the same app at `/jobs`.
- `runJob` steps, each in its own transaction and each safe to run twice:
  0. Heartbeat: upsert `job_runs` row `heartbeat` with `done_at = now()`.
  1. Triggers: the office lock, the `jobs` loader, `runScheduledTriggers(state, at)` with `dedupeUsed` (A3), save, outbox, signal.
  2. Morning summary: when Riyadh time is 07:30 or later on a working day (Sunday to Thursday) and `job_runs` has no `summary:<date>`, mail each active person whose `morningSummary` is on or missing. Then write the `job_runs` row.
  3. Outbox retry: rows with `done_at` null, fewer than 5 attempts, older than 2 minutes, with the claim of 4.12.
  4. Cleanup: stories older than 7 days, idempotency keys older than 24 hours, upload intents older than 1 hour (and their R2 objects), `office_deletes` rows older than 7 days, `rate_limits` windows older than 1 day.
  5. Usage: `checkLimits(deps)` from M.
- `usage.get` returns `jobsLastRun`, and the usage panel shows an error when the last run is older than 30 minutes.
- The browser scheduler (`bootstrap.ts:46-53`) stays in the fake build only.

**Acceptance tests** (suite 10): `server/jobs/*.test.ts` [Docker]: the `notify.test.ts` and `notifyAudit.test.ts` cases of `runScheduledTriggers` through the database; a second run in the same window sends nothing new; the summary goes once, at 07:30 Riyadh, Sunday to Thursday only, also to a person with no `morningSummary` field; `server/it/cron.it.test.ts` [Docker]: the schedule exists, it calls `/functions/v1/jobs/run` with the secret, `net._http_response` shows status 200, and the `heartbeat` row moves.

### 5.6 AI agents: the MCP server (2026-07-28)

Built on `@modelcontextprotocol/server` 2.3.0 (PF 7.6), which implements the transport, `server/discover`, headers, `resultType`, caching hints and MRTR. `createMcpHandler` gets `legacy: 'stateless'` explicitly, so a client that does not yet speak 2026-07-28 still works, and gets the `isError` reason path.

**The tool allowlist** (36 tools, change 20). `server/mcp/tools.ts` holds `MCP_ALLOW` and `MCP_DENY`. A test fails when a call of `sharedCalls` or of the server contracts is in neither list.

- Reads (15): `madar.readFirst`, `projects.list`, `projects.get`, `tasks.list`, `tasks.get`, `comments.list`, `updates.list`, `tracker.list`, `payments.list`, `deadlines.list`, `files.list`, `users.list`, `dashboard.get`, `search.query`, `events.list`.
- Writes (21): `story.start`, `tasks.create`, `tasks.update`, `tasks.move`, `tasks.complete`, `tasks.approve`, `tasks.sendBack`, `comments.create`, `updates.create`, `tracker.log`, `tracker.update`, `tracker.close`, `payments.create`, `payments.update`, `payments.markReceived`, `deadlines.create`, `deadlines.update`, `projects.update`, `projects.setStatus`, `events.undo`, `events.undoStory`.
- Deny: every other call, for example `session.get`, `notifications.*`, `chats.unreadCount`, the read marks, `files.uploadStart`, `files.upload`, `feedback.*`, `usage.get`, `users.invites`, `agents.*`, and every Admin call.

| Piece | Interface | File | Track |
|---|---|---|---|
| Tool list | `mcpTools(): ToolDef[]` from `sharedCalls` plus the T0 server contracts, filtered by `MCP_ALLOW` (it does not import `serverCallMap`); fixed order (`madar.readFirst`, `story.start`, then by name); `inputSchema` from `z.toJSONSchema(wire input, { io: 'input' })`; `annotations.readOnlyHint` from `readOnly`, `destructiveHint` for deletes | `server/mcp/tools.ts` | G |
| Written instructions | `TOOL_DOCS: Record<string, { title: string; description: string }>`; `INSTRUCTIONS` for `server/discover` and `madar.readFirst`: spec 1, section 17, rules 1 to 5, how stories and Undo work, how reasons work, and that uploads are done in the Madar screens | `server/mcp/docs.ts` | G |
| Reasons | `reasonFor(error: ApiError): { field: 'reason' \| 'dateReason'; question: string } \| null` for `stage_back_reason` and `date_reason_needed`; with `elicitation`, `inputRequired` plus a signed `requestState` (HMAC, 10 minutes, bound to the user and an argument digest); without it, `isError: true` and the instruction to call again with the field | `server/mcp/reasons.ts` | G |
| Tool run | each tool calls `runCall` with the agent principal and the `storyId` argument; the result has `structuredContent: { output, storyId }` and the same JSON as text; an `ApiError` gives `isError: true` with code and message | `server/mcp/run.ts` | G |
| Token check | no token, or a bad one: 401 with `WWW-Authenticate: Bearer resource_metadata="<MCP_URL>/oauth-protected-resource"`; `jose` check with `aud = MCP_URL`, issuer, `client_id` required; then one SQL through `madar_private.agent_session_ok()`: the Auth session (`session_id` claim) still exists, the `agent_links` row is not revoked, the owner is active | `server/mcp/auth.ts` | G |
| Metadata | `GET /mcp/oauth-protected-resource` (RFC 9728): `resource`, `authorization_servers`, `bearer_methods_supported` | `server/mcp/metadata.ts` | G |
| Agent user | `ensureAgentUser(q, owner, client)`: on the first call of a new approval, under the office lock, find the agent user of (owner, client name, redirect host). If it exists, add the new `client_id` to it with a new `agent_links` row. If not, create a `users` row (`kind: 'agent'`, `ownerId`, the client name, email `<agentId>@agents.madar.invalid`) and the `agent_links` row, and write the `user.created` event with the person as actor. A reconnect of the same app reuses the same agent user. | `server/mcp/agentUser.ts` | G |
| Other checks | `Origin` present and not allowed: 403; 60 tool calls a minute for each person, over all of that person's agents (`rate_limits`) | `server/mcp/app.ts` | G (T0 stub) |
| Token hook | `public.madar_access_token_hook(event)`: sets `aud` to `platform_config.mcp_url` when the token has `client_id`. The migration holds no URL. | `20261004000400_platform_auth_hook.sql` | G |
| Consent | route `/oauth/consent?authorization_id=`: sign-in first if needed (keeps the id); shows the agent name, the host of its redirect URI (from `getAuthorizationDetails`), and what it may do (acts with your rights, its changes show its name and yours, remove it in Settings, Agents); a plain warning when the host is not loopback and not on the list of known AI apps in `src/features/oauth/knownHosts.ts`; Approve or Deny (PF 6.3) | `src/features/oauth/ConsentScreen.tsx` | G |
| Settings, Agents | `listGrants()` joined with `agents.list`; Remove calls `agents.remove` (revokes every link of that agent, turns the agent user off, writes an event) and then `revokeGrant({ clientId })` for each client | `src/features/settings/AgentsSection.tsx`, `server/calls/agents.ts` | G |
| Region hop | when `SB_REGION` differs from `MCP_FORWARD_REGION` (default `eu-central-1`), forward the request once, unread, to the same function with `forceFunctionRegion`, before the token check. The usage meter counts the extra invocation. The `aud` check uses `MCP_URL`, not the request URL. | `server/mcp/forward.ts` | G |

`config.toml`: `[auth.oauth_server] enabled = true`, `authorization_url_path = "/oauth/consent"`, `allow_dynamic_registration = true`; `[functions.mcp] verify_jwt = false` (T0 writes these; G1 checks the exact table names). Z1 checks the rate limit of Supabase Auth for client registration.

**Acceptance tests** (suite 12):

- `server/mcp/*.test.ts` (in-process `fetch`): `server/discover` answers versions, capabilities, `serverInfo`, instructions; `tools/list` has 36 tools in a fixed order, `ttlMs`, `cacheScope: "private"`; each `inputSchema` compiles with Ajv 2020 and accepts the recorded sample input of its call (`server/mcp/samples.json`); a tool with no sample fails the test; a stage move back returns `input_required` to a client with `elicitation` and `isError` to one without; a retry with the answer succeeds; a forged `requestState` fails; a 2026-07-28 request whose `MCP-Protocol-Version` header differs from `_meta` gets 400 with `-32020`; a request with no header gets the legacy answer; one 2025-11-25 client case passes; GET gets 405; no session is needed between requests; every 401 has a `WWW-Authenticate` header (the test asserts the header is present, not only that no error happened); the 61st tool call in a minute from two agents of one person gets 429; a request in a non-Frankfurt region is forwarded once.
- `server/it/mcp.it.test.ts` [Docker]: full OAuth 2.1 with PKCE against the local Auth server (DCR, consent approval through the Auth API, code exchange); a second registration of the same app by the same person reuses the agent user; a browser token gets 401 on `mcp`; an agent token gets 403 on `api`; `agents.remove` stops the next call at once; the History shows the agent and its person; the person can undo the agent's change.
- The official runner `@modelcontextprotocol/conformance` against `supabase functions serve mcp` in the `integration` job. If it does not cover 2026-07-28 yet, the in-process suite above covers the 27 points of PF 7.2, one test each.

### 5.7 Nightly encrypted backup and the restore test

| Piece | What it does | File | Track |
|---|---|---|---|
| Database backup | 02:07 Riyadh (`timezone: 'Asia/Riyadh'`); `supabase db dump` roles, schema, data (session pooler, IPv4, as `postgres`); `tar` plus `age -r <public key>`; upload as a release asset to the private repository `madar-backups`; delete releases older than 30 days; a manifest with row counts for each table | `.github/workflows/db-backup.yml`, `scripts/backup/manifest.sql` | O |
| Files backup | weekly, Friday 03:07 Riyadh; `rclone sync` from R2 (read-only key) to a Backblaze B2 `crypt` remote, with `--backup-dir old/<date>`; delete `old/` folders older than 7 days; write the B2 size to `usage_month` for the meter | `.github/workflows/files-backup.yml` | O |
| Staleness alert | the db workflow fails and GitHub mails the owner when the newest release is older than 26 hours | same | O |
| Restore check | `npx tsx scripts/restore-check.ts --file <latest.age>`: decrypts with the offline key, starts a Postgres container, restores, compares row counts with the manifest, checks that `UPDATE` on `events` still fails for `madar_server`, runs `dashboard.get` through `runCall` on the restored data, and checks 5 random R2 keys in the B2 copy | `scripts/restore-check.ts` | O |
| Reminder | a monthly workflow opens an issue "Run the restore check" | `.github/workflows/restore-reminder.yml` | O |
| Second project | Z5 restores one copy into `madar-test` by hand, runs `secrets.ts test` again (Vault secrets, `platform_config.mcp_url`, the `madar_server` password), checks the Realtime policy and the token hook, then runs the seed script again | runbook `docs/superpowers/real-build/runbook.md` (Z5 writes it) | Z |

**Acceptance tests** (suite 14): `scripts/restore-check.test.ts` [Docker] makes a dump of a seeded local database with a test `age` key, runs the check, and expects pass; a damaged dump fails.

### 5.8 Usage meters and the 80% Admin email

- `server/usage/meter.ts` (M): the real `MeterPort`. `countRequest(db)` runs once for each HTTP request (a batch is one), as one statement after the batch; `addBytes` adds the bytes that the loaders read.
- `server/usage/meters.ts` (M): `readMeters(q, config)` gives calls this month (limit 500,000), database size (`pg_database_size`, limit 500 MB), file storage (sum of sizes, limit 10 GB), backup copy on B2 (limit 10 GB), emails today (limit 100) and this month (limit 3,000), egress estimate (limit 5 GB).
- `server/usage/warn.ts` (M): `checkLimits(deps)` sends one email to each Admin when a meter passes 80%, once per meter and month (`usage_warnings`). Each email names one next step for that meter (section 10, decision 2 for storage). The job runs it.
- `src/features/settings/admin/UsageSection.tsx` (M): one line "All within the free plan" when every meter is under 80% and no effect failed. A meter over 80% opens as one bar with its one next step. A failed effect shows as one line with one Retry. A job that has not run for 30 minutes shows as one error line.

**Acceptance tests** (suite 13): one warning at 80%, not one for each request; a new month resets; the Admin sees the meters and a Member gets `forbidden` on `usage.get`; `UsageSection.test.tsx` in English and in Arabic with `dir="rtl"`: the one calm line when all is well, one open meter at 85% with its next step, a failed effect with Retry, the old-job error line.

### 5.9 Deploy scripts

| Script | What it does | Track |
|---|---|---|
| `scripts/deploy/db.sh <test\|production>` | `supabase link --project-ref <ref>` with `SUPABASE_ACCESS_TOKEN` (never the Halulu sign-in), then `supabase db push` | O |
| `scripts/deploy/config.sh <env>` | `supabase config push` (Auth, OAuth server, hooks, function settings) | O |
| `scripts/deploy/secrets.ts <env>` | reads `secrets/<env>.env` (git ignores the folder); runs `supabase secrets set` for the names in PF 0.4 and refuses names that start with `SUPABASE_`; writes the Vault secrets `project_url` and `jobs_secret`; writes `platform_config.mcp_url`; sets `login` and the password of `madar_server` | O |
| `scripts/deploy/functions.sh <env>` | `npm run build:server`, then `supabase functions deploy api mcp jobs --project-ref <ref> --use-api` | O |
| `scripts/deploy/pages.sh <env>` | `npm run build:remote -- <env>`, then writes `dist/_headers` from `config/headers.template` with the hosts of that environment, then `wrangler pages deploy dist --project-name madar --branch <main\|preview>` | O |
| `.github/workflows/deploy.yml` | manual, test only: runs db, functions, pages for `madar-test`, with repository secrets named `TEST_*` | O |
| Production deploy | from the Mac only, by `scripts/deploy/all.sh production`, which asks for the typed word `production` (section 10, decision 9) | O |
| `config/headers.template` | `nosniff`, `no-referrer`, `DENY` frames, and the CSP of PF 9.3 with these additions: `style-src 'self' 'unsafe-inline'` (vaul adds a `<style>` element); `img-src 'self' data: blob: https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com` (feedback screenshots); `frame-src https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com` (the PDF preview); `connect-src` with the Supabase host, its `wss:` form, and the R2 EU host; long cache for `/assets/*` | O |

### 5.10 The Node entry for Railway

- `server/entries/node.ts` (E): one Hono app that mounts `/api` (with `server/http/routes.ts`), `/mcp` (`server/mcp/app.ts`) and `/jobs` (`server/jobs/app.ts`), all three from the start, through the T0 stubs; `serve({ fetch, port: Number(PORT ?? 3000), hostname: '0.0.0.0' })`.
- `Dockerfile` (E): PF 12.2, `CMD ["node", "dist-server/node.js"]`.
- On Node the MCP metadata uses `MCP_URL` and `SUPABASE_URL` from the environment (no automatic URLs).
- **Acceptance:** `server/it/node.it.test.ts` [Docker] starts `dist-server/node.js` against the local stack and runs the same batch smoke and MCP `server/discover` as on Deno.

## 6. Tracks and tasks

### 6.1 Rules for parallel work

1. Each track works on a branch `rb/<track>` in its own worktree. A task edits only the files it lists. "Owns" means no other track edits that file until the owner merges. A task that must edit a file outside its list stops and reports.
2. **Shared files that only T0 edits:** `package.json`, `package-lock.json`, `tsconfig*.json`, `vite.config.ts`, `supabase/config.toml`, `.gitignore`, `src/i18n/index.ts`, and the existing keys of `src/i18n/en.json` and `src/i18n/ar.json`. A later track that needs a change there writes it as a "merge lead patch" in its final report, and the merge lead applies it at merge time.
3. **Words:** each track writes new words only in `src/i18n/real/<track>.en.json` and `<track>.ar.json`. T0 makes the loader that merges them, and the loader fails on a duplicate key. `i18n.test.ts`, `arabic.test.ts` and `keys.test.ts` run on the merged trees: the same keys in both languages, the placeholders, the female forms, Arabic script, and no em dash.
4. **Migrations:** B owns every app migration (`20261004000100` to `20261004000199`). Platform migrations: N1 `...0200`, N3 `...0300`, G `...0400`. Nobody edits a merged migration; a fix is a new file in the owner's range. No migration holds a secret or an environment URL.
5. **Cross-track imports** go through the ports of `server/core/ports.ts`, through the registries `server/calls/index.ts` and `server/http/routes.ts`, or through a stub file that T0 creates with the final signature. The owning track replaces the stub body. The stub list is in T0.4.
6. **Merge gate.** Every merge: rebase on `main`, `npm run typecheck` (`tsc -p tsconfig.json && tsc -p tsconfig.server.json`), `npm test` (`vitest run --project unit --project server`: the 1,640 tests and the new unit tests, once each), `npm run build`. From the R2 merge on, also `npm run build:remote -- test`. From the D merge on, also `npm run test:db` and `npm run test:it`. At each merge of a screen track (U, R1, R2, F, N2, M, G), the merge lead also runs the prototype Playwright smoke in a delegated agent. No merge with a red check.
7. Commit messages and code comments follow the house style (no em dash, no Co-Authored-By line for Claude).
8. **Calm screen checks.** Each new screen or Settings section (U1, U3, G4, N2.2, M1) has jsdom tests in English and in Arabic with `dir="rtl"`. Each test checks the calm redesign rules (2026-10-01 spec, section 1.1): one title, at most one main button, at most one colored highlight, and no physical left or right styles (only start and end). X2 covers each of these screens at 390, 820 and 1440 px, in both languages and both themes.

### 6.2 The tracks

| Track | Name | Tasks | Owns (main files) | Needs | Docker | Accounts |
|---|---|---|---|---|---|---|
| T0 | Seams | 4 | shared files, `src/api/{sharedCalls,execute}.ts`, `src/api/contract/server.ts`, `src/api/handlers/serverFakes.ts`, the contract parts of `handlers/{files,feedback}.ts`, `src/api/remote/wire.ts`, `src/app/mode.ts`, `src/app/runtime.tsx` (type only), `NotificationsSection.tsx` (move), `server/env.ts`, `server/core/{ports,types}.ts`, the registries, `server/test/fakes/*`, `scripts/{build-remote,check-bundles}.ts`, every stub | none | no | no |
| A | Handler readiness | 8 | `src/api/events.ts`, `references.ts`, `notify.ts`, `views.ts`, `chatState.ts`, handlers except files and feedback | T0 | no | no |
| B | Schema | 3 | `supabase/migrations/2026100400010*`, `server/data/tables.ts`, `server/data/schema.test.ts`, `server/it/guards.it.test.ts`, `server/it/migrate.ts` | T0 | yes | no |
| C | Core | 3 | `server/data/{sql,rows,save,whole,officeCache}.ts`, `server/data/loaders/*`, `server/core/{runCall,actor,story,idempotency,lock,effects,serverCallMap}.ts`, `server/calls/story.ts` | T0, A, B; Z0a for the C3 merge | yes | no |
| D | Db-mode tests | 2 | `server/test/{dbApi,db,global-setup,invariants,shadow,db-mode.skip}.ts`, `src/test/factories.ts` | C | yes | no |
| E | HTTP and entries | 4 | `server/http/*` (not `routes.ts`), `server/core/deps.ts`, `server/entries/*`, `supabase/functions/*`, `vite.server.config.ts`, `Dockerfile` | T0 | yes (E1, E4) | no |
| P | People and sign-in, server | 3 | `server/auth/*`, `server/calls/people.ts`, `scripts/first-admin.ts` | C3, E3 | yes | no |
| U | Sign-in screens and prototype controls | 3 | `src/features/auth/*`, `src/app/remote/auth.ts`, `src/app/routes.tsx`, `PersonMenu.tsx`, `SettingsScreen.tsx`, `PasswordSection.tsx`, `PeopleSection.tsx`, `PersonFormSheet.tsx`, `StorageBanner.tsx`, `PreviewAs.tsx`, `AppShell.tsx` | T0 | no | no |
| R | Remote client | 2 | R1: `src/api/remote/*` except `wire.ts`, `upload.ts`, `feedback.ts`; `src/api/client.ts` (run); `src/app/actions.ts`, `actions.test.tsx`. R2: `src/app/runtime.tsx` (body), `src/app/signals.ts`, `src/app/readMap.ts`, `src/app/remote/{bootstrap,channel}.ts`, `src/main.tsx`, `src/features/projects/cardMenu.ts` | T0 | no | no |
| F | Files | 3 | `server/files/*`, `server/calls/{files,feedback}.ts`, `src/api/remote/{upload,feedback}.ts`, `src/app/{files,thumbs}.ts`, three picture lines, `Attachments.tsx` | C3, R1 | yes | Z0a smoke |
| N1 | Realtime | 2 | `server/signal/*`, `...0200_platform_realtime.sql`, `scripts/proof/realtime-rollback.ts` | T0 (N1.0), C3 (N1.1) | yes | no |
| N2 | Email | 2 | `server/mail/*`, `NotificationsSection.tsx` (body) | C3 | yes | no |
| M | Usage meters | 1 | `server/usage/*`, `server/calls/usage.ts`, `UsageSection.tsx` | C3, N2 | yes | no |
| N3 | Jobs | 2 | `server/jobs/*`, `...0300_platform_cron.sql` | C3, N2, M, F | yes | no |
| G | Agents (MCP) | 4 | `server/mcp/*`, `server/calls/agents.ts`, `...0400_platform_auth_hook.sql`, `src/features/oauth/*`, `AgentsSection.tsx`, `scripts/record-samples.ts` | T0 (G1, G2), C3 and P (G3, G4) | yes | no |
| O | Ops | 3 | `.github/workflows/*`, `scripts/ci/*`, `scripts/deploy/*`, `scripts/backup/*`, `scripts/restore-check.ts`, `config/*` | T0 (O1), all (O3) | yes (O2) | no |
| X | Browser checks on the test deployment | 2 | `tests/e2e-deploy/*`, `playwright.deploy.config.ts`, `scripts/seed-test-office.ts` | D, U, R2 | no | runs in Z |
| Z | Deploy phase | 10 | `docs/superpowers/real-build/runbook.md`, `docs/superpowers/real-build/proof.md`, `scripts/proof/*` (except the N1 spike) | accounts; all | no | yes |

Total: 61 tasks.

### 6.3 The tasks

Each task: files, tests, done when, needs. "API tests" means the 476 tests through `testApi()`.

#### Track T0: Seams (serial, first)

**T0.1 Dependencies, scripts and test projects.**
- Files: `package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.server.json` (new), `vite.config.ts`, `.gitignore` (add `dist-server/`, `supabase/functions/_build/`, `secrets/`; `.env.*` is already there), `scripts/build-remote.ts` (new), `scripts/check-bundles.ts` (new).
- Adds, with exact versions from PF 0.3: `hono`, `@hono/node-server`, `pg`, `jose`, `aws4fetch`, `@modelcontextprotocol/server`, `@supabase/supabase-js`; dev: `@types/pg`, `ajv`, `supabase` (CLI 2.119.0), `wrangler`, `tsx`, `@modelcontextprotocol/conformance`. No other library.
- Scripts: `test` = `vitest run --project unit --project server`; `typecheck` = `tsc -p tsconfig.json && tsc -p tsconfig.server.json`; `build` unchanged; `build:remote` = `tsx scripts/build-remote.ts` (`check-rtl.ts`, both type checks, `vite build --mode remote-<env>` with the values of `config/remote.<env>.env`, then `check-bundles.ts remote`); `dev:remote`, `build:server`, `start:server`, `test:server`, `test:db`, `test:it`, `test:mcp`, `check:bundles`.
- `vite.config.ts`: `define` for `import.meta.env.VITE_MADAR_API` from `process.env.VITE_MADAR_API ?? 'fake'`; `base: mode.startsWith('remote') ? '/' : './'`; no `loadEnv` with an empty prefix.
- Vitest projects: `unit` (today's config, jsdom), `server` (Node, `server/**/*.test.ts` without `it/`), `db` (Node, `MADAR_DB=1`, `src/api/**/*.test.ts`, setup from D), `it` (Node, `server/it/**/*.it.test.ts`).
- Tests: `scripts/check-bundles.test.ts` (a remote `index.html` with `./assets/` fails; a prototype `dist/` with `_headers` fails; the search prints its terms).
- Done when: `npm test` runs the 1,640 tests once each and they pass; `npm run typecheck` checks `server/` too and passes; `npm run build` passes and `check-bundles` passes on its output.

**T0.2 Shared call split and execute step.**
- Files: `src/api/calls.ts`, `src/api/sharedCalls.ts` (new), `src/api/execute.ts` (new), `src/api/client.ts`, `src/api/registry.ts` (add `wire?: { input?: ZodType; output?: ZodType }`, the hook types `preflight` and `prepare` for the server, and the optional `blobKeysInUse` member of `PrepareCtx`), `src/api/client.test.ts`, `src/api/calls.test.ts`.
- `sharedCalls.ts` exports `SERVER_EXCLUDED = ['session.previewAs', 'session.setSimulateErrors', 'session.resetSampleData', 'files.get']` and `sharedCalls` = the map minus that list. `session.get` keeps `prototypeOnly: true`.
- `execute.ts` exports `resolveAuthority(state, actorId, def)` and `executeParsed(def, name, parsed, state, ctxBase, prepared)`. `createApi` uses them. `Api` gains `run()` with `CallResult` (CM 2.1); the fake `run()` returns its story ID and `changed` from the event count of the story. `Meta` gains an optional `key`.
- Tests: `calls.test.ts` still lists 112 names in the map; a new test checks that `sharedCalls` has 108 names and none of `SERVER_EXCLUDED`; with `failureRate: () => 1`, `session.get` still answers; `client.test.ts` covers `run()`.
- Done when: all tests pass.

**T0.3 Contract additions and wire forms.**
- Files: `src/api/contract/entities.ts`, `src/api/contract/server.ts` (new), `src/api/handlers/serverFakes.ts` (new), `src/api/errors.ts`, `src/api/contract/entities.test.ts`, `src/api/calls.test.ts`, `src/api/handlers/files.ts`, `src/api/handlers/feedback.ts`, `src/api/handlers/files.test.ts`, `src/api/handlers/feedback.test.ts`, the existing keys `files.tooBig` in `src/i18n/en.json` and `ar.json`, `src/i18n/real/core.{en,ar}.json` (new), `src/app/errors.test.ts`.
- Entities: `Event.undoes?: EventId`; `Preferences.email?: record(Trigger, boolean)`, `Preferences.morningSummary?: boolean` (a missing value means on); `FileVersion.thumbKey?: string`; `MAX_FILE_BYTES = 250 MB`; `ApiErrorCode` gains `'unauthenticated'`.
- Wire forms: `files.upload` input `blob` or `uploadId`, exactly one, `wire.input` the `uploadId` form; `feedback.send` `screenshots` or `uploadIds`; `feedback.screenshot` wire output `{ url, expiresAt }`. The fake `prepare` keeps the `blob` path, so the screens and tests of today work unchanged.
- The 9 server call contracts of 4.11 with fake versions (the fake `files.link` returns one cached `blob:` URL for each blob key; `usage.get` returns zeros, no failed effects and `jobsLastRun: null`; `agents.list` returns the agent rows of the person). `calls.ts` adds `serverFakes` to the fake map; `sharedCalls.ts` does not.
- Words: `files.tooBig` says 250 MB in both languages. `core.{en,ar}.json` holds the text for `errors.unauthenticated` and for each server reason: `account_off`, `client_outdated`, `busy`, `story_not_yours`, `key_reused`, `too_many_overviews`.
- Tests: `entities.test.ts` parses old records without the new fields; `serverFakes.test.ts` covers each fake; `calls.test.ts` lists 121 names in the fake map and counts `files.link`, `users.invites`, `agents.list` and `usage.get` as reads by an explicit list; the 25 MB test in `files.test.ts` checks a declared size over 250 MB (TM 8.3); `errors.test.ts` checks that each `ApiErrorCode` and each server reason has a text in both languages.
- Done when: all tests pass.

**T0.4 Server skeleton, ports, fakes, registries and stubs.**
- Files: `server/env.ts`, `server/core/ports.ts`, `server/core/types.ts`, `src/api/remote/wire.ts`, `server/test/fakes/{db-none,files,mail,signal,authAdmin,clock,meter}.ts`, `src/app/mode.ts`, `src/app/remote/supabase.ts` (client factory with the CM 7.2 settings), `src/app/auth.ts` (`AuthPort` type and the always-signed-in fake), `src/app/runtime.tsx` (type only: `Runtime = { store?; api; auth?; changes?; mode? }`; the fake runtime fills `auth` with the always-signed-in fake and `changes` with a source whose `status()` is `'open'`), `src/features/settings/SettingsScreen.tsx` (moves the Notifications section, lines 113 to 123, into `NotificationsSection.tsx` and mounts the stubs), `src/features/settings/NotificationsSection.tsx` (new, today's in-app switches), `src/features/settings/admin/AdminScreen.tsx` (mounts `UsageSection` when `REMOTE`), `src/i18n/index.ts`, `src/i18n/keys.test.ts`, `src/i18n/i18n.test.ts`, `src/i18n/arabic.test.ts`, `supabase/config.toml`.
- Registries: `server/calls/index.ts` (the 9 server calls by name) and `server/http/routes.ts` (the extra HTTP routes: `POST /api/auth/forgot`).
- Stubs with final signatures (the body throws `ApiError('failed')` or renders `null`): `server/data/sql.ts` (`pgDb`), `server/core/runCall.ts`, `server/files/r2.ts`, `server/mail/resend.ts`, `server/mail/outboxDriver.ts`, `server/auth/{verify,admin,forgot}.ts`, `server/signal/realtime.ts`, `server/mcp/app.ts`, `server/jobs/app.ts`, `server/usage/meter.ts`, `server/calls/{story,files,feedback,people,agents,usage}.ts`, `src/api/remote/upload.ts` and `feedback.ts` (`uploadAdapter({ makeThumb })`, `feedbackAdapter()`), `src/features/oauth/ConsentScreen.tsx`, `src/features/settings/{AgentsSection,PasswordSection}.tsx`, `src/features/settings/admin/UsageSection.tsx`.
- `src/i18n/index.ts` merges `src/i18n/real/*.{en,ar}.json`, exports the merged trees, and throws on a duplicate key. The three i18n tests read the merged trees.
- `supabase/config.toml`: `supabase init` output plus the settings of PF 1.6, 3.5, 6.1 (`verify_jwt = false` for three functions, sign-up off, OAuth server on with `/oauth/consent`, DCR on, the token hook entry, site URL `http://127.0.0.1:5173`).
- Tests: `server/core/types.test.ts` (type-level checks compile); the stubs render `null`; a duplicate key in two `real/*.json` files fails the loader; `NotificationsSection` shows the same switches as before.
- Done when: all tests pass; `supabase start` reads the config without error [Docker, checked once by the T0 agent if Docker exists; otherwise by B1].

#### Track A: Handler readiness

- **A1 Reference map and undo link.** Files: `src/api/references.ts` (new), `src/api/events.ts`, `src/api/events.test.ts`, `src/api/references.test.ts`. `REFERENCES: Record<EventTarget, { collection; path }[]>` lists every field that can hold each target id (AM 7.1, including `messages.fileIds` outside the project). `isUsedElsewhere` uses it. `undoEvent` writes `undoes`. Tests: for each target type, a record that points at it blocks the Undo; a test runs the old scan and the new map over the sample office and every id, and expects the same answers. Done when: all tests pass. Needs T0.
- **A2 Project delete by ids.** Files: `src/api/handlers/projects.ts`, `src/api/handlers/projectsAudit.test.ts` (add cases). Needs A1. Tests: a delete of project A leaves the comments and notices of project B; `after` keeps a data key that `blobKeysInUse` reports. Done when: all tests pass.
- **A3 Dedupe lookup.** Files: `src/api/notify.ts`, `src/api/notify.test.ts`. `notify(…, { dedupeUsed })`. Tests: the same notices with and without the lookup. Done when: all tests pass.
- **A4 Counts.** Files: `src/api/views.ts`, `src/api/store.ts` (optional `counts`), `src/api/views.test.ts` (new). Tests: with `counts` the numbers match a full scan; without `counts` behaviour is unchanged. Done when: all tests pass.
- **A5 Chat pages.** Files: `src/api/handlers/chats.ts`, `src/api/chatState.ts`, `src/api/handlers/chats.test.ts`. Tests: `limit` and `before` page through 450 messages; default 200; the Inbox screen tests still pass. Done when: all tests pass.
- **A6 Tests for 8 calls.** Files: `src/api/handlers/coverage8.test.ts` (new). One test each for `updates.delete`, `projects.clearHealthOverride`, `members.update`, `deadlines.update`, `deadlines.delete`, `users.list`, `users.get`, `clients.list`. Done when: the 8 tests pass.
- **A7 Email switches in settings.** Files: `src/api/handlers/notifications.ts`, `src/api/handlers/notifications.test.ts`. Tests: defaults (`task_assigned`, `review_requested`, `mention` on); a missing `morningSummary` reads as on; the switches save; an agent cannot change them. Done when: all tests pass.
- **A8 Language for a new person.** Files: `src/api/handlers/people.ts`, `src/api/handlers/people.test.ts`. `users.create` takes `language?`. Tests: the default is the Admin's language; an explicit `ar` is kept in `preferences.language`. Done when: all tests pass.
- **A9 Unread counts (added 2026-10-04 from the C2 review; runs in wave 3 after C3, with its loader half).** Cause: `chats.list` and `chats.unreadCount` load every message after the read mark, so a chat with no mark loads its whole history. The Admin sees every project chat; with AM 8 (36,000 messages in year 1) one call can read several MB, which spends the 5 GB monthly egress in days and risks the 2 s CPU limit. Files (A part): `src/api/store.ts` (`unreadCountKey(conversationId, userId)` = `unread:<conversationId>:<userId>` in `State.counts`), `src/api/chatState.ts` `unreadIn()` and `src/api/handlers/chats.ts` `taskUnread()` (read `state.counts[unreadCountKey]` first, else today's scan), `chats.ts` `writeReadMark` (set the count of the marked chat or thread to 0). Tests (A part): with counts, the numbers equal a full scan; without counts, nothing changes; `chats.markRead` gives 0 for the marked chat. Files (loader part): `server/data/loaders/chat.ts` and a filtered count in `Source` (memory and SQL): for `chats.list`, `chats.unreadCount` and `chats.markRead`, one grouped SQL count per chat (messages after the mark, the author is not the person or one of their agents, `actingForId` is not the person), and the same for task threads (after the mark and after the person's own last comment). The loader keeps only the newest message for the preview. Other writes keep the rows. Done when: these tests pass, the C2 same-answer tests still pass, and a loader test proves that a chat of 5,000 messages with no mark loads at most the newest message.
- Track done when: all tests pass and the fake build behaves the same (`tests/e2e` smoke by the merge lead, delegated).

#### Track B: Schema [Docker]

- **B1 Migrations.** Files: `supabase/migrations/20261004000100_core.sql`, `...0101_server_tables.sql`, `...0102_guards.sql`, `...0103_roles.sql`. Tables, generated columns, `chg` columns, indexes and server tables of 4.1 and 4.2; the role `madar_server` (no login), its grants and the `server_all` policies; the schema `madar_private` and its two functions; the default privileges on `public`; RLS on and browser grants revoked; the events trigger; the `settings` and `office_meta` rows. Tests: `supabase db reset` applies them on an empty stack. Checks the foreign key on generated columns (4.1). Done when: the reset passes and the foreign key question has a written answer in the migration comment. Needs T0.
- **B2 Table registry and the zod check.** Files: `server/data/tables.ts`, `server/data/schema.test.ts`. `TABLES: { collection: keyof State; table: string; key: (rec) => string; serverColumns?: Record<string, (rec, state) => unknown>; office: boolean }[]`. The test of 4.4. It needs `writeState` and `loadWhole` from C1, so B2 first writes a 30-line local writer in the test file, and C1 later moves the test onto the real functions. Done when: the four checks pass on the sample office.
- **B3 Guards.** Files: `server/it/guards.it.test.ts`. Every migration applies to an empty database; every table has RLS on, and its only policy is for `madar_server`; the publishable key and a signed-in token get nothing from `/rest/v1/` and `/graphql/v1` (on the local stack with the Data API off by `config.toml`); `UPDATE`, `DELETE` and `TRUNCATE` on `events` fail for every role except `postgres`; `madar_server` cannot alter a table, cannot turn off a trigger, and cannot set `session_replication_role`; `anon` and `authenticated` cannot execute a function in `public`. Done when: every check passes (suite 11).

#### Track C: Core [Docker] (serial inside the track; the critical path)

- **C1 Diff writer and whole read and write.** Files: `server/data/sql.ts` (replaces the stub: `pgDb({ writeUrl, readUrl, ca }, { callerClient? })`, two pools of `max: 1`, `connectionTimeoutMillis: 5000`, nested `tx` refused through `AsyncLocalStorage`, `savepoint` only on request, `set local` timeouts; `callerClient` only for the D1 harness), `server/data/rows.ts`, `server/data/save.ts`, `server/data/whole.ts` (`writeState(q, state)`, `loadWhole(q, { withEvents })`), `server/data/save.test.ts` (pure `diffState` cases: insert, update, delete, order, events insert only, `undoneBy` rule, kinds, `projectTouched`, `preferences`, office `chg` and deletes, a personal change gives no office signal), `server/it/save.it.test.ts`, `server/data/sql.test.ts` (a nested `tx` throws; a URL with `sslmode` is refused). Done when: the round trip of B2 runs on the real functions; a changed old event fails the save; the seq rules of 4.8 hold. `pgDb` creates its two pools inside the call, never at module level. The pools open on the first query, and `close()` ends both. `server/it`: two requests in a row through `deps.db` on `wrangler dev` both answer 200 (proof E4).
- **C2 Loaders and the office cache.** Files: `server/data/officeCache.ts`, `server/data/loaders/*.ts`, `server/data/loaders/index.ts`, `server/data/loaders/*.test.ts`. One test for each of the 18 rows of AM 6: the scoped load gives the same answer as the whole office. A test fails when a server call has no loader. Cache tests: a change of one project reloads one row; a delete arrives through `office_deletes`; a cache older than the oldest kept delete does a full load; the cache objects are frozen. Done when: these pass. Needs C1, A.
- **C3 runCall.** Files: `server/core/{runCall,actor,story,idempotency,lock,effects,serverCallMap}.ts`, `server/calls/story.ts`, `server/core/*.test.ts` (suite 2 of TM 7: the agent acts with its person's rights; an inactive person is refused; a wrong output shape rolls back; story IDs only from the server, same actor, under 24 hours; a placeholder ref maps once per batch; a repeated idempotency key with the same input runs nothing; the same key with another input gives `key_reused`; a call that adds a member and then throws leaves the cache unchanged, and a second call on the same isolate does not see the member; a batch entry after an office write sees that write), `server/it/lock.it.test.ts` (suite 5, on the production `pgDb`: 20 parallel `tasks.create` all succeed with unique gap-free IDs and rising `seq`; `tasks.complete` and `tasks.delete` on one task at once, one wins; a read during a held write lock does not wait and never sees half a story; `lock_timeout` 5 s gives `failed` with `details.reason: 'busy'`; a preflight that waits 10 s does not hold the lock). Done when: these pass, and `runCall` runs every name of `sharedCalls` and `story.start` once on a seeded office without a thrown error other than `ApiError`. The 8 other server calls are stubs at this point and are checked by their owner tracks. The C3 merge also waits for Z0a.

#### Track D: Db-mode tests [Docker]

- **D1 Harness.** Files: `server/test/db.ts` (one schema for each worker from `VITEST_POOL_ID`, `BEGIN` on the first call, `ROLLBACK` in `afterEach`, lock key from the schema; runs as `madar_server` with the grants for the worker schema; refuses any database host except `127.0.0.1` and `localhost`), `server/test/global-setup.ts` (as `postgres`: drop and create the schemas, apply the non-platform migrations with `search_path`; refuses any host except `127.0.0.1` and `localhost`), `server/test/dbApi.ts` (the mirror store of TM 3.3: write down the test's direct edits, map made-up story IDs to real ones, run `runCall`, read back in place, keep object identity), `server/test/invariants.ts`, `server/test/shadow.ts`, `server/test/db-mode.skip.ts` (with a reason for each line), `src/test/factories.ts` (`testApi` returns the db version when `MADAR_DB=1`). Tests: a `DATABASE_URL` with a Supabase host stops the setup before any SQL. Done when: one API test file passes in db mode. `server/test/global-setup.ts` imports `applyMigrations` from `server/it/migrate.ts` (track B, with its advisory lock) and writes no second migration step.
- **D2 Pass the API tests in db mode.** Fix loaders and save cases that the shadow run finds (in C files, with the C owner's review, since C is merged; D lists each fix). Tests: `npm run test:db` runs the 474 API tests (TM 4.2) with the 5 free checks of TM 3.5. Done when: all pass, the run takes under 120 s, and a call averages under 25 ms.

#### Track E: HTTP and entries

- **E1 Bundle spike [Docker].** Files: `vite.server.config.ts`, `supabase/functions/{api,mcp,jobs}/index.ts`, `supabase/functions/*/deno.json`, `server/entries/deno-api.ts` with a `GET /api/health` that runs one `pg` query and returns `SB_REGION`. Proof: `supabase functions serve api` answers; `pg` holds a transaction with `pg_advisory_xact_lock` through the local pooler; `AsyncLocalStorage` from `node:async_hooks` works in the bundle. Fallback in section 9, risk 1. Do this first: C and every server track rely on it. Done when: the proof is written in `proof.md`, section E1.
- **E2 Deps from the environment.** Files: `server/core/deps.ts`, `server/core/deps.test.ts`. Builds the real `Deps` from `env()`, with the T0 stubs until their owners merge; refuses to start with a missing secret and names it. Done when: the test passes with a full and with a partial environment.
- **E3 App and batch route.** Files: `server/http/{app,batch,cors,errors,limits}.ts`, `server/http/*.test.ts` (in-process `app.fetch` with a fake `runCall`: order kept, one bad entry does not fail the others, 413 for 13 entries and for two overview calls, 409 `client_outdated`, CORS only for allowed origins, `Access-Control-Max-Age: 7200`, `OPTIONS` answered without auth, `countRequest` runs once after the batch and outside every call). The app mounts the routes of `server/http/routes.ts`. Uses the `verify.ts` stub until P merges. Done when: these pass.
- **E4 Node entry and image [Docker].** Files: `server/entries/node.ts` (mounts `/api`, `/mcp`, `/jobs` through the T0 stubs), `Dockerfile`, `server/it/node.it.test.ts`, `server/it/batch.it.test.ts` (the same smoke on `supabase functions serve` and on the Node build). Done when: both smokes pass.

#### Track P: People and sign-in, server [Docker]

- **P1 Token check and principal.** Files: `server/auth/verify.ts` (replaces the stub), `server/auth/principal.ts`, `server/auth/verify.test.ts`. Proves on the local stack that an invitation works with sign-up off, and which link type works for a second invitation. Done when: the tests of 5.1 for `verify` pass and the proof is in `proof.md`.
- **P2 Auth admin, invitations, forgot, effects.** Files: `server/auth/{admin,invite,forgot,effects,rateLimit}.ts` (replace the stubs), `server/calls/people.ts` (replaces the stub), `server/it/auth.it.test.ts`, `server/it/invites.it.test.ts`. Done when: the two it suites of 5.1 pass.
- **P3 First Admin script.** Files: `scripts/first-admin.ts`, `scripts/first-admin.test.ts` [Docker]. Done when: a run makes one Admin with the given language and gender, and a second run refuses.

#### Track U: Sign-in screens and prototype controls

- **U1 Auth screens.** Files: `src/features/auth/{SignInScreen,WelcomeScreen,ForgotScreen,ResetScreen,SignedOutNote,SessionExpiredSheet,AuthGate}.tsx` and tests, `src/app/remote/auth.ts`, `src/i18n/real/auth.{en,ar}.json`. Tests in jsdom with a fake `AuthPort`, both languages, phone width, and the calm checks of rule 8. Done when: each screen test passes in English and Arabic.
- **U2 Gate, routes and sign out.** Files: `src/app/routes.tsx` (path router and `AuthGate` in remote mode around the shell and the meeting view; hash router in fake mode; public routes `/sign-in`, `/welcome`, `/forgot`, `/reset`, `/oauth/consent`), `src/app/PersonMenu.tsx`, `src/app/AppShell.tsx`, tests. `AuthGate` mounts `SessionExpiredSheet` once. The 4 V-22 draft tests get a sign-out and sign-in twin (TM 8.1). Tests: an expired session in the meeting view shows the sheet and keeps the meeting drafts. Done when: these pass and the fake build still uses hash links.
- **U3 Prototype controls and people screens.** Files: `SettingsScreen.tsx`, `PasswordSection.tsx` (replaces the stub), `PeopleSection.tsx`, `PersonFormSheet.tsx` (Language choice, A8), `StorageBanner.tsx`, `src/app/PreviewAs.tsx`, `src/i18n/real/people.{en,ar}.json`. In remote mode: no Preview as, no Simulate errors, no Reset, no Prototype section, no agent form; a "No connection" banner from `runtime.changes.status()`; the Invited badge and "Send the invitation again". Tests: the remote flag hides each control; the fake build still shows them; Password and People in English and Arabic with the calm checks. Done when: these pass.

#### Track R: Remote client

- **R1 RemoteApi.** Files: `src/api/remote/{remoteApi,batcher,stories,keys,errors}.ts` and tests, `src/api/client.ts` (only if T0 left a gap), `src/app/actions.ts` (`useUndoable` uses `api.run()` and `changed`; the second `events.list` call goes; `useAction` keeps the key of a failed attempt for its Retry), `src/app/actions.test.tsx` (lines 63 to 66: the call count without the `events.list` call). Behaviour of CM 2 to 5: batch on `setTimeout(0)`, cap 12, at most one overview call in one request, `forceFunctionRegion=eu-central-1` on every URL, story placeholders, a new idempotency key for each write call, the error table of CM 2.3, 20 s timeout, one retry for a read with no answer, and the adapter slots that F fills (`adapters: Partial<Record<CallName, Adapter>>`). Tests: `src/api/remote/*.test.ts` and `src/api/httpClient.test.ts` (TM 7) with a stub `fetch`: the region parameter is on each URL; two overview calls go in two requests; the same input object sent twice gets two keys; only Retry sends the old key. Done when: these pass.
- **R2 Runtime, signals and bootstrap.** Files: `src/app/runtime.tsx` (body: the remote runtime with `api`, `changes`, `auth`, `mode`; `staleTime: Infinity` for `['api']` in remote mode), `src/app/signals.ts`, `src/app/readMap.ts`, `src/app/readMap.test.ts`, `src/app/signals.test.ts`, `src/app/remote/bootstrap.ts`, `src/app/remote/channel.ts`, `src/main.tsx` (dynamic import by mode; first language from `madar.lang`, then the browser), `src/features/projects/cardMenu.ts` (`createHref`). Done when: the 1,640 tests pass with `{ store, api }` runtimes; the signal tests of 5.3 pass; `npm run build:remote -- test` builds; `check-bundles` passes.

#### Track F: Files [Docker]

- **F1 R2 port.** Files: `server/files/{r2,keys}.ts` (replace the stub), `server/files/r2.test.ts`. A MinIO service in `server/it/minio.ts` for tests. Done when: the signature, key and disposition tests of 5.2 pass.
- **F2 Calls and hooks.** Files: `server/calls/{files,feedback}.ts` (replace the stubs), `server/files/effects.ts`, `server/it/files.it.test.ts`. Done when: the it suite of 5.2 passes, including the slow `FilesPort` case and the second PUT case. After this merge, G re-records `samples.json`.
- **F3 Adapters and screens.** Files: `src/api/remote/{upload,feedback}.ts` (replace the stubs) and tests, `src/app/files.ts`, `src/app/thumbs.ts`, `FilesTab.tsx`, `ProjectCard.tsx`, `DrawingsStrip.tsx`, `src/features/files/Attachments.tsx` (thumb upload through the adapter), tests. Tests: the adapter runs the three steps in order and passes the thumb; an upload failure at step 2 shows one Retry; in remote mode a broken image asks for a new link once; in fake mode `useFileUrl` still revokes its URL on unmount; `downloadFile` asks for `attachment`. Done when: these pass and the prototype smoke passes.

#### Track N1: Realtime [Docker]

- **N1.0 Rollback spike (wave 1).** Files: `scripts/proof/realtime-rollback.ts`. On the local stack: a `realtime.send` inside a rolled-back transaction sends nothing; one inside a committed transaction arrives on a private channel. Done when: the result is in `proof.md`.
- **N1.1 Sender and policies.** Files: `server/signal/realtime.ts` (replaces the stub), `supabase/migrations/20261004000200_platform_realtime.sql`, `server/signal/realtime.test.ts`, `server/it/realtime.it.test.ts`. Done when: the it suite of 5.3 passes.

#### Track N2: Email [Docker for the it test]

- **N2.1 Sender, quota, templates.** Files: `server/mail/{resend,outboxDriver,quota,templates/*}.ts` (replace the stubs), `src/i18n/real/mail.{en,ar}.json`, tests with snapshots. Done when: the template, quota and parallel `reserve()` tests of 5.4 pass.
- **N2.2 Notice mail, summary and switches.** Files: `server/mail/{notices,summary}.ts`, `src/features/settings/NotificationsSection.tsx` (two switches for each trigger, plus Morning summary), `src/features/settings/NotificationsSection.test.tsx`, `src/i18n/real/notices.{en,ar}.json`, `server/it/email.it.test.ts`. Done when: the screen test of 5.4 passes in both languages with the calm checks, and the it suite passes.

#### Track M: Usage meters

- **M1 Meters and warnings.** Files: `server/usage/{meter,meters,warn}.ts` (replace the stub), `server/calls/usage.ts` (replaces the stub), `src/features/settings/admin/UsageSection.tsx` (replaces the stub), `src/features/settings/admin/UsageSection.test.tsx`, `src/i18n/real/usage.{en,ar}.json`, tests (suite 13). Needs C3, N2. Done when: the tests of 5.8 pass, the screen test passes in both languages with the calm checks, and the loaders and the batch route report through the real `MeterPort`.

#### Track N3: Jobs [Docker]

- **N3.1 Job runner and steps.** Files: `server/jobs/{app,run}.ts` (replace the stub), `server/jobs/steps/{heartbeat,triggers,summary,outbox,cleanup,uploads,usage}.ts`, tests (suite 10). `server/entries/deno-jobs.ts` and `node.ts` already import `server/jobs/app.ts`, so N3 edits no E file. Done when: the job tests of 5.5 pass.
- **N3.2 Schedule.** Files: `supabase/migrations/20261004000300_platform_cron.sql`, `server/it/cron.it.test.ts`. Done when: the cron test sees status 200 in `net._http_response` and a new `heartbeat`.

#### Track G: Agents (MCP) [Docker]

- **G1 Hook and token spike (wave 1).** Files: `supabase/migrations/20261004000400_platform_auth_hook.sql`, `server/it/hook.it.test.ts`. Proof on the local stack: the hook sees `client_id`, reads `platform_config.mcp_url`, Auth accepts the changed `aud`, a refresh keeps it (PF 6.8). Fallback: section 9, risk 4. Done when: the test passes and the result is in `proof.md`.
- **G2 Tools and docs (wave 1).** Files: `server/mcp/{tools,docs}.ts`, `scripts/record-samples.ts`, `server/mcp/samples.json`, `server/mcp/tools.test.ts` (each allowed schema compiles with Ajv 2020 and accepts its sample; a tool with no sample fails; each description is 40 to 600 characters; fixed order; every call is in `MCP_ALLOW` or `MCP_DENY`). `mcpTools()` reads `sharedCalls` and the T0 server contracts. Done when: these pass. The merge lead runs `record-samples.ts` again after F2 merges.
- **G3 Server, reasons, auth, metadata.** Files: `server/mcp/{app,run,reasons,auth,metadata,agentUser,forward}.ts` (`app.ts` replaces the stub), `server/entries/deno-mcp.ts` body, `server/mcp/*.test.ts`, `server/it/mcp.it.test.ts`. Done when: the suites of 5.6 pass, and `test:mcp` runs the conformance runner.
- **G4 Consent screen and Settings, Agents.** Files: `src/features/oauth/{ConsentScreen,knownHosts}.tsx`, `src/features/settings/AgentsSection.tsx`, `server/calls/agents.ts` (replaces the stub), `src/i18n/real/agents.{en,ar}.json`, tests. Tests: Approve and Deny each call the right Auth method; a sign-in on the way keeps `authorization_id`; a redirect host that is not loopback and not known shows the warning; Remove leaves the agent off even when `revokeGrant` fails, and shows one Retry; English and Arabic with the calm checks. Done when: these pass.

#### Track O: Ops

- **O1 CI.** Files: `.github/workflows/ci.yml` (`unit` and `server` on every push; `db` and `integration` on pull requests and `main`; `concurrency` cancels older runs; a step that fails on `create_secret(` with a literal value in `supabase/migrations/`). Needs T0. Done when: a pull request shows unit, server, db and integration green.
- **O2 Backups and restore check [Docker].** Files: `.github/workflows/{db-backup,files-backup,restore-reminder}.yml`, `scripts/backup/manifest.sql`, `scripts/restore-check.ts`, `scripts/restore-check.test.ts`. Done when: the restore test of 5.7 passes, and a damaged dump fails.
- **O3 Deploy scripts and headers.** Files: `scripts/deploy/*`, `scripts/deploy/secrets.test.ts`, `.github/workflows/deploy.yml`, `config/headers.template`, `config/remote.test.env`, `config/remote.production.env` (public values only; the Supabase URLs from `accounts.md`). Tests: `secrets.ts` refuses `SUPABASE_URL`; `pages.sh` writes `dist/_headers` with the hosts of the chosen environment and no other; `all.sh production` stops without the typed word. Done when: these pass.

#### Track X: Browser checks on the test deployment

- **X1 Seed and config.** Files: `scripts/seed-test-office.ts`, `playwright.deploy.config.ts`. The seed script refuses every project ref except `qdgwpnesxppnqsaabqzd` (`madar-test`), truncates the Madar tables as `postgres`, writes `writeState(buildSeed(today))`, makes 4 Auth accounts with known test passwords from secrets (one for each role), and prints what it changed. The config signs in once for each role (`storageState`). Done when: a run against the local stack refuses, a dry run against `madar-test` prints the plan, and the config loads.
- **X2 Specs.** Files: `tests/e2e-deploy/*.spec.ts`, `tests/e2e-deploy/goto.ts`. A `goto(route)` helper maps each route to a hash link (prototype) or a path (remote). In remote mode, a sign-in for each role (`storageState`) replaces Preview as, and the Preview as checks are skipped. Specs: today's 11 files through `goto`; Sign in, Forgot, Reset, Session expiry, Settings Password, Agents, Notifications and Usage; one invitation flow from the Admin screen to the first sign-in (mail read from `mail_outbox`); one agent consent flow up to the Approve page. Each runs in English and Arabic, light and dark, at 390, 820 and 1440 px. Every spec fails on a `securitypolicyviolation` event. Written in the build phase; run in Z6. Playwright runs only in a delegated agent. Done when: the specs pass on a local remote build with the local stack.

#### Track Z: Deploy phase [Accounts]

| Task | What | Needs from the owner | Done when |
|---|---|---|---|
| Z0a Cloud proof, probes | Probe scripts in `scripts/proof/`, no app code, on `madar-test`: the ES256 key; the hook SQL on the hosted Auth; `pg` as `madar_server` with the Supabase root CA and `pg_advisory_xact_lock` through the hosted transaction pooler, and a connection without TLS refused; `set local` timeouts through Supavisor; a Realtime rollback by SQL; an R2 PUT from a browser with the CORS rule, an Arabic file name, and `response-content-disposition` with `aws4fetch`; one Resend send to the owner; the Docker image on Railway or on the Mac; `SB_REGION` of a call with `forceFunctionRegion`. | R2 on, the Resend key (done), the test project (done) | `proof.md` has a pass or a design change for each item. The C3 merge waits for this. |
| Z0b Cloud proof, app | After G merges: one DCR agent (Claude Code) through consent to one tool call, a second connect reuses the agent user; browser token 401 on `mcp`, agent token 403 on `api`; the region hop from a US agent and the lock time of a write tool; CPU of the largest first-screen batch, cold and warm, on a synthetic office at the 3-year size of AM 8; egress for each read and for each write. | none | `proof.md` lists each number with its limit. |
| Z1 Supabase settings | For both projects: `db.sh`, `config.sh`, `secrets.ts`; ES256 signing key; Realtime public access off; the Data API off; "Enforce SSL on incoming connections" on; Site URL and redirect URLs; Resend SMTP as fallback; the rate limits page, including client registration | the domain | `proof.md` lists each setting with its value for both projects. |
| Z2 R2 | EU bucket `madar-files`, the CORS rule of 5.2, one read-write token (API) and one read-only token (backups) | R2 on (card) | a signed PUT and GET work from the test deployment. |
| Z3 Email | Resend domain `notices.<domain>`, region `eu-west-1`, DNS records, API key | the domain's DNS | one notice reaches the owner from the domain. |
| Z4 Screens | Pages project `madar`, custom domain, `pages.sh test`, then `all.sh production` from the Mac | Cloudflare Pages token, DNS | both sites load at a deep link such as `/projects/prj_001`. |
| Z5 Backups | `madar-backups` repository and token, `age` key made on the owner's Mac (public key to GitHub, private key offline), B2 bucket and key, rclone crypt password; first backup; one restore into `madar-test` with `secrets.ts test` again; runbook | GitHub, Backblaze, the owner keeps the keys | the restore check passes on the first backup, and the runbook exists. |
| Z6 Test deployment checks | Seed the test office, run X2 (delegated), fix and repeat | the Arabic reading (section 8) | X2 is green. |
| Z7 Security review | An independent review of the server and the MCP sign-in (spec 2, 14) with the code-review agent at the highest level, then the fixes | the owner chooses the reviewer | no open high finding. |
| Z8 Go-live | `first-admin.ts --env production`; the owner signs in and invites 2 or 3 people; 2 weeks of pilot; then the office | the first Admin password, the pilot people | the pilot people sign in and use Madar. |

### 6.4 Merge order

1. T0 (T0.1 to T0.4)
2. A
3. B
4. E (E1 first; if E1 fails, stop and apply risk 1 before any other server merge)
5. R1
6. U (possible now, because T0.4 gave `Runtime` its optional `auth` and `changes`)
7. C1, then C2, then C3. **C3 merges only after Z0a passes.** A Z0a failure changes the design in this plan before C3 merges.
8. D (from here, `test:db` and `test:it` are merge gates)
9. P
10. R2
11. F (then the merge lead runs `record-samples.ts` again)
12. N1
13. N2
14. M
15. N3
16. G
17. O (O1 can merge right after T0; O2 and O3 at this point)
18. X
19. Z0b after G. Z1 to Z8 after step 18.

**What can run at the same time** (each wave starts when its needs merge):

| Wave | Tracks |
|---|---|
| 1 (after T0) | A, B, E, R1, U, O1, G1, G2, N1.0; Z0a as soon as the accounts exist |
| 2 (after A and B) | C (serial C1, C2, C3) |
| 3 (after C3) | D, P, F, N1.1, N2, R2, A9 (with its loader half; merge before D2 ends) |
| 4 (after N2 and P) | M, G3, G4, N3 (after M and F) |
| 5 | O2, O3, X, Z0b (after G) |
| Deploy | Z1 to Z8 |

### 6.5 Done for the whole build

- The 1,640 prototype tests pass, and `npm run build` makes the same prototype artifact. The merge lead rebuilds the artifact once before Z and runs the prototype smoke on it.
- `test:server`, `test:db` (474 API tests on Postgres with the shadow run), `test:it` and `test:mcp` pass in CI.
- X2 passes on the test deployment in both languages, both themes, at 390, 820 and 1440 px, with no CSP violation.
- Z0a and Z0b results are written, and every CHECK item of PF has an answer.
- The security review has no open high finding.
- The first backup exists and one restore worked.

## 7. Test strategy

### 7.1 In-memory tests stay

The `unit` project runs today's 1,640 tests on the fake API in jsdom, on every push. They guard the screens and the rules. Each track adds unit tests next to its files: pure server code (`server/**/*.test.ts`, Node, project `server`), client code (`src/**/*.test.tsx`, jsdom, project `unit`).

### 7.2 Db mode on a local Supabase

- `MADAR_DB=1 vitest --project db` runs the 474 API rule tests with no edit, through the mirror store of TM 3.3 (D1).
- Each call runs the real `runCall` with the scoped loader, then the free checks: the shadow run (the same call in memory on the whole office must give the same output and the same office), a failed call writes nothing, a read writes nothing and sends no signal, events only grow, one signal for each saved change on each channel.
- Isolation: one schema per worker, one transaction per test, rollback after each test, a lock key per schema, a leak guard after all tests (TM 5). The harness refuses any host except `127.0.0.1` and `localhost`.
- CI starts Postgres only (`supabase start -x` with every other service listed in TM 6.1). Gate: under 120 s and under 25 ms per call.

### 7.3 Integration tests on the full local stack

`vitest --project it` with `supabase start` (Auth, Realtime, Mailpit, edge runtime), a MinIO service for R2 and `supabase functions serve`. Suites 3 to 11 and 14 of TM 7. These suites use the production `pgDb` (two pools, real commits), not the savepoint wrapper. Tests that need real commits (lock, Realtime, backup) use their own schema, `TRUNCATE` between tests as `postgres`, and run one file at a time. The setup refuses any host except `127.0.0.1` and `localhost`.

### 7.4 MCP conformance

In-process tests of the 27 points of PF 7.2 (project `server`), the OAuth flow on the local stack (it), and the official `@modelcontextprotocol/conformance` runner against the served function (`test:mcp`). Z0b adds one real client (Claude Code) on the test project.

### 7.5 Browser checks on the test deployment

X2 on the Cloudflare Pages preview with the `madar-test` project, seeded with the sample office and 4 role accounts. Mail goes to `mail_outbox`. It runs nightly on working days and before each production deploy (TM 6.1). Playwright work always runs in a delegated agent.

### 7.6 CI minutes

The plan of TM 6.2 (about 1,475 of the 2,000 free minutes). If the count passes 1,600, run `e2e-deploy` 3 nights a week.

## 8. What the owner must provide, and when

**Done already:**

- [x] The Supabase account with `madar` (`oprkvdjudjxxhvodkzgs`) and `madar-test` (`qdgwpnesxppnqsaabqzd`) in Frankfurt.
- [x] The private GitHub repository `byosamah/madar`.
- [x] In `.env.local` on the Mac: the Supabase access token, both database passwords, and the Resend API key. Claude copies the values that each environment needs into `secrets/test.env` and `secrets/production.env`.
- [x] A Cloudflare account. R2 is not on yet.

**Now, before the build starts:**

- [ ] Install Docker Desktop or OrbStack on the Mac, and keep it running. Cost: free. Most server tracks need a local Supabase.
- [ ] Confirm that the office team finished the prototype review. Spec 2 says the build starts after it. Default: you confirm that it is done.
- [ ] Answer the decisions in section 10. Each has a default, so the build does not wait.
- [ ] Say which secrets may go into GitHub. The Supabase access token controls every project in that Supabase account. Default: GitHub gets only the test-project secrets and the backup connection to production; the access token stays on the Mac; production deploys run from the Mac.

**Before the C3 merge (for Z0a, the cloud proof):**

- [ ] Turn on R2 in Cloudflare. It asks for a card. Up to 10 GB is free. Expected cost: $0.
- [ ] Optional: a Railway account. It asks for a card, and the smallest plan costs about $5 a month (Z0a checks the price). Default: skip it; Claude proves the same server image on the Mac.

**Before go-live (Z1 to Z5):**

- [ ] The domain for Madar, bought after the name check. Cost: about $15 a year. Choose: move the domain's DNS to Cloudflare (simplest), or keep the DNS and use a subdomain.
- [ ] The DNS records for Cloudflare Pages and for Resend. Claude gives the exact records; you add them, or you give DNS access. Cost: free.
- [ ] A Cloudflare API token for Pages deploys. Cost: free.
- [ ] A private GitHub repository `madar-backups` and a token that can write releases there. Cost: free.
- [ ] A Backblaze B2 account for the weekly file copy. Up to 10 GB is free. When the copy passes 10 GB, B2 asks for a card; the price is about $6 for each TB a month (Z5 checks it).
- [ ] The backup key: Claude makes it on your Mac; you save the private key in your password manager and on paper; then Claude deletes it from the disk. Cost: free.
- [ ] For each pilot person: the email, the language (English or Arabic), and the gender. Arabic sentences use the gender. Default: none; Claude needs this list at Z8.
- [ ] A native Arabic speaker reads the new sentences and the email texts, before Z6. Cost: their time, about 1 hour.

**At go-live (Z7, Z8):**

- [ ] Who does the independent security review.
- [ ] Your first Admin email, language and gender, and your password (you type the password yourself into the script).
- [ ] The date the whole office starts, after 2 weeks of pilot.

**Every month after go-live:**

- [ ] Run the restore check with Claude when the reminder issue opens (about 10 minutes).

## 9. Risks and fallbacks

| # | Risk | Check | Fallback |
|---|---|---|---|
| 1 | The Deno bundle of the shared code fails on the edge runtime (`pg` through `node:` modules, or a Vite SSR quirk) | E1, first server task | Bundle with `pg` mapped to `npm:pg` in `deno.json` (planned default). If `pg` still fails: `jsr:@db/postgres` behind the same `Db` port on Deno only, `pg` on Node. If the bundle itself fails: Deno `--unstable-sloppy-imports` through `deno.json`, then Railway as the main host. |
| 2 | A scoped loader leaves out a record and gives a wrong answer | C2 tests of AM 6, D2 shadow run | Load the whole collection for that call (correct, slower), and log it for a later fix. |
| 3 | A request passes 2 s of CPU (the first-screen batch, `dashboard.get`, `projects.list`) | Z0b on a synthetic 3-year office | One overview call in each request (planned); trimmed task rows (planned); then a summary table that the save step keeps (spec 2, 18). |
| 4 | Supabase Auth refuses a changed `aud`, or the hook does not see `client_id` | G1, Z0a | Keep the `client_id` rule alone: the `mcp` function requires it, the `api` function refuses it. That blocks cross use. Record it in the security review. |
| 5 | A main AI app drops Dynamic Client Registration (Supabase has no CIMD yet) | Z0b, and each month after go-live | Serve a Madar authorization front that supports CIMD and maps clients to Supabase DCR clients (a new task); watch supabase/auth issue 2850. |
| 6 | The region hop adds delay for far agents | Z0b | The hop is on by default, because it protects the lock and the data location. If the owner accepts data outside Frankfurt (decision 7), reads may stay in the near region; writes always hop. |
| 7 | Egress passes 5 GB a month | the meter, Z0b measure | The cache loads only changed rows (planned); trimmed rows, smaller pages, then the Supabase Pro plan ($25 a month, owner decision). |
| 8 | The free project pauses before the office uses it every day | Z1 watches for the warning mail | The nightly backup reads the database; if a warning still comes, add a daily read in the job. |
| 9 | R2 ignores `response-content-disposition` | Z0a | `downloadFile` fetches the link and saves a `blob:` (CM 5.3). A 250 MB download on a phone may fail; the screen then opens the file in a new tab. |
| 10 | Resend quota: 100 a day for everything | quota tests, the meter | The hard stops of change 9; notices stay in the app; the Admin gets one warning. The paid Resend plan is an owner decision. |
| 11 | Merge conflicts between tracks | ownership rules 6.1, T0 stubs | The merge lead applies "merge lead patches" for shared files; a track that must edit a file it does not own stops and reports. |
| 12 | Realtime cannot write today's partition when no screen is open | N1 test | Safe by design: nobody listens. The send failure is a warning, not an error; the save does not fail. |
| 13 | Delete of a file keeps its R2 data (for Undo), so space only grows | the storage meter | Owner decision 2; v1 keeps the data and warns at 80%. |
| 14 | Supabase OAuth server is in beta and changes its API (`listGrants` versus `getUserGrants`) | G4 compiles against the pinned `@supabase/supabase-js` | Pin the version; a wrapper `src/app/remote/grants.ts` hides the names. |
| 15 | The Supabase CLI on this Mac signs in to another account (Halulu) | every deploy script | Scripts pass `SUPABASE_ACCESS_TOKEN` and `--project-ref`; they never call `supabase login`. |
| 16 | Real network delay (150 to 400 ms) makes ticks feel slow | Z6 | Optimistic updates with rollback for the few tick actions only (task done, checklist, reactions), as a later task (CM R-14). |
| 17 | GitHub Actions minutes run out | the minutes plan 7.6 | Fewer nightly runs, or a self-hosted runner on an office Mac. |
| 18 | A free plan changes its terms | none | The Node build on Railway (E4, Z0a) and the backups make a move possible in a day. |
| 19 | Supavisor does not accept the custom role `madar_server.<ref>` | Z0a | Connect as `postgres` with `set local role madar_server` as the first statement of each transaction, and keep the B3 checks on that role. |
| 20 | A phishing link gets an agent approval with a false name | the consent screen shows the redirect host and a warning | The security review (Z7) checks the consent screen; the owner can turn off DCR and register known apps by hand. |

## 10. Decisions for the owner (each has a default, so the build does not wait)

| # | Question | Default |
|---|---|---|
| 1 | The Admin form that adds an agent by hand: keep or hide in the real build? | Hide. An agent exists only after its person approves it. |
| 2 | When does the data of a deleted file go for good, and what is the next step at 80% storage? | Never in v1. Above 10 GB, R2 charges about $0.015 for each GB a month (Z2 checks the price), so 20 GB costs about $0.15 a month. The 80% email says this and asks for no action. A "Free space" action that removes the data of files deleted more than 30 days ago is a later task, if you want it. |
| 3 | Railway: add a card for the portability proof, or prove it on the Mac? | Prove it on the Mac. |
| 4 | Monthly restore check: by hand with the offline key, or automatic with a second key in GitHub? | By hand, with a monthly reminder. |
| 5 | Working days for the morning summary | Sunday to Thursday. |
| 6 | DNS: move the domain to Cloudflare, or a subdomain with the DNS elsewhere? | Move to Cloudflare. |
| 7 | May an agent request run outside Frankfurt? | No. Every agent request goes to Frankfurt first. |
| 8 | May notice and summary emails carry task titles, project names and comment text? Resend keeps email content in the US for 30 days. | No. The email says what happened in general words and gives a link. |
| 9 | Production deploys: from the Mac only, or from GitHub with the Supabase access token stored in GitHub? | From the Mac only. GitHub deploys only the test project. |

## 11. Review log

Revision 2 answers 50 critic findings. "Accepted" means the plan now has the fix; the section is named.

1. Cache shared by reference (blocker): accepted. Each call gets a deep copy, the cache is frozen and holds only committed rows, `BatchScope.office` drops after an office write, C3 test added (4.5, 4.6, 4.7, C3).
2. Full cache reload on each write uses egress: accepted. `chg` columns, `office_deletes`, delta load; Z0b measures egress for each write (4.2, 4.7, change 10).
3. One global signal seq: accepted. One counter for each channel, dedupe by signal `id`, new test for a read mark (4.8, 5.3, change 13).
4. Owner role can change the History: accepted. `madar_server` owns nothing; B3 checks truncate, alter and `session_replication_role` (4.1, 4.3, B3, change 24).
5. One connection for each isolate: accepted. Two pools with timeouts, nested `tx` refused, `set local` timeouts, `countRequest` outside calls, it suites on the production `pgDb` (4.5, 4.10, C1, 7.3).
6. R2 calls inside the lock: accepted. `preflight` before the transaction, SQL-only `prepare`, slow `FilesPort` test (4.5, 5.2, C3, F2).
7. MCP writes from the US hold the lock: accepted. The hop is on for every request by default, and the lock time is logged (change 5, 4.5, 5.6).
8. Signed `Content-Disposition` breaks the upload: accepted. Only `Content-Type` is signed; the disposition goes on the GET in RFC 6266 form; Arabic name tests (5.2, 4.5 ports).
9. CSP blocks vaul, the PDF frame and blob images: accepted. `style-src`, `img-src`, `frame-src` added; X2 fails on any violation (5.9, X2).
10. Vault secrets and the MCP URL in migrations: accepted. Names only in migrations; `secrets.ts` writes the values and `platform_config`; CI check (5.5, 5.6, 5.9, O1).
11. 119 tools is too many: accepted. 36-tool allowlist with a deny list test; change 20 (5.6).
12. Phishing by client name and agent copies: accepted. Consent shows the redirect host with a warning; agents keyed by owner, name and host; rate limit for each person (5.6, G4, risk 20).
13. `sslmode=require` fails on the pooler: accepted. CA in `ssl`, no `sslmode`, Enforce SSL at Z1, Z0a checks (4.5, C1, Z0a, Z1).
14. Cron posts to the wrong path: accepted. `/functions/v1/jobs/run`, test reads `net._http_response`, heartbeat row (5.5, N3.2).
15. MCP `legacy` option not chosen: accepted. `legacy: 'stateless'`, tests changed, one 2025-11-25 case (5.6).
16. `files.get` returns a Blob on the server: accepted. It is in `SERVER_EXCLUDED` and off the MCP list (change 1, 4.11).
17. Outbox rows have no claim: accepted. Claim statement, 2-minute retry window, first `hashed_token` kept, `reserve()` under a lock with a unique key (4.12, 5.4).
18. Second PUT and active types: accepted. Staging key plus `CopyObject`; HTML, SVG and XML only as attachment (5.2).
19. Functions in `public` reachable by RPC: accepted. Data API off, `madar_private` schema, default privileges revoked, B3 checks the endpoints (4.1, B3, Z1).
20. Resend keeps client data in the US: accepted. General words and a link; decision 8 (5.4, change 22).
21. One batch can pass 2 s of CPU: accepted. One overview call in each request; Z0b measures the largest first-screen batch on a 3-year office (4.10, R1, Z0b).
22. Idempotency key from a WeakMap: accepted. A new key for each call, only Retry resends it, server digest with `key_reused` (4.10, R1, T0.2).
23. Cross-track files not stubbed (blocker): accepted. T0.4 stubs every such file, two registries, `MeterPort`, C3 done check scoped, each cross edit listed (6.1 rule 5, T0.4, C3).
24. U needs R2's runtime: accepted. T0.4 extends the `Runtime` type with optional fields and fake values (T0.4, 6.4).
25. R1 owns adapters that need F2 work: accepted. Wire forms move to T0.3; adapters move to F3; `makeThumb` is a parameter (T0.3, F3).
26. G2 builds from a C3 file: accepted. `mcpTools` reads `sharedCalls` and T0 contracts; samples recorded again after F2; missing sample fails (5.6, G2, 6.4).
27. Z0 has no gate and needs late code: accepted. Z0a probes gate the C3 merge; Z0b after G; G1 and the N1 spike move to wave 1 (Z, 6.4, change 23).
28. `forceFunctionRegion` missing: accepted. On every request URL, R1 test, `SB_REGION` log and Z0a check (4.10, R1, Z0a).
29. Change 5 sends data outside Frankfurt: accepted. The hop is the default; decision 7 (change 5, section 10).
30. Merge gate holes: accepted. `test` runs unit and server once, `typecheck` covers `server/`, `build:remote` runs the full checks (T0.1, 6.1 rule 6).
31. `base: './'` breaks deep links: accepted. `'/'` for remote modes; `check-bundles` checks it (T0.1, rule 5, change 16).
32. The build flag cannot reach Vite: accepted. `define` from `process.env`, modes `remote-test` and `remote-production`, secrets in `secrets/` (rule 6, T0.1, O3).
33. `public/_headers` leaks into the prototype: accepted. `config/headers.template`, `pages.sh` writes `dist/_headers` for each environment; no `public/` folder (3, 5.9).
34. Rule 4 hides needed test changes: accepted. Named assertions in the tasks that cause them; rule 4 rewritten (3 rule 4, T0.2, T0.3, R1).
35. Removing `prototypeOnly` from `session.get` breaks Simulate errors: accepted. The flag stays; `sharedCalls` uses an explicit exclusion list; new failure-rate test (change 1, T0.2).
36. `files.get` on the server (duplicate of 16): accepted with the same fix.
37. i18n gaps: accepted. T0 owns existing keys, changes `files.tooBig`, adds the error words, runs all three i18n tests on merged trees, fails on a duplicate key (6.1 rules 2 and 3, T0.3, T0.4).
38. Email switches shown twice: accepted. T0.4 moves the section to `NotificationsSection.tsx`; N2 adds one row with two switches; `EmailSection` removed (5.4, T0.4, N2.2).
39. Invitations always in English, no gender: accepted. A8 language field, U3 Language choice, `renderMail` takes genders, Arabic female snapshots (4.13, 5.1, 5.4).
40. No calm or Arabic checks on new screens: accepted. Rule 8 and the done checks of U1, U3, G4, N2.2, M1; X2 adds the screens and 820 px (6.1, X2).
41. Usage panel gaps: accepted. `failedEffects` and `jobsLastRun` in `usage.get`; one calm line; the storage next step is decision 2 instead of a new call, because R2 above 10 GB costs cents (4.11, 5.8, section 10).
42. Tasks with no cases or done line: accepted. Every task now has named cases and one done line (6.3).
43. Tests can reach the hosted databases: accepted. Harness and seed script refuse wrong hosts and refs; the seed truncates first and prints changes (D1, X1, 7.2, 7.3).
44. GitHub environment approval needs a paid plan: accepted. `deploy.yml` deploys only the test project; production deploys from the Mac with a typed word; decision 9 (5.9).
45. Owner checklist out of date: accepted. Done items marked, missing questions added with defaults, a cost on each item, plain R2 wording, Arabic reading before Z6 (section 8).
46. Session sheet missing in the meeting view: accepted. `AuthGate` mounts it once around both routes, with a test (5.1, U2).
47. B2 copy differs from spec 2: accepted. Change 21, `old/` kept 7 days, B2 size is a meter (5.7, 5.8).
48. A missing `morningSummary` reads as off: accepted. "Missing means on" in T0.3, A7, N3 and their tests (T0.3, A7, 5.5).
49. X2 cannot run today's specs on the remote build: accepted. `goto` helper and sign-in for each role (X2).
50. Prototype smoke too rare, fake `files.link` leaks URLs: accepted. Smoke at each screen-track merge and on the rebuilt artifact; fake mode keeps `files.get` with its revoke, and the fake `files.link` caches one URL for each key (6.1 rule 6, 6.5, T0.3, F3).

No finding is rejected. Finding 41 is accepted in part: the plan adds no "Free space" call in v1 and puts the choice in decision 2, with its cost.
