# Madar enterprises (the enterprise core)

The shared server code of Madar enterprises: each enterprise has its own office object, and one platform object holds the list and the
accounts of the platform. Madar enterprises is a separate platform (plan F, design section 12): the companies' app, VADO included, holds no
door to it. The design is `docs/superpowers/specs/2026-11-08-madar-enterprises-design.md`. The shared names are
`docs/superpowers/plans/2026-11-08-madar-enterprises-contract.md` (the section "Lead decisions" wins). The office object is in
`server/office/CLAUDE.md`. The Postgres path serves ENT_VADO only and loads no file here that imports `cloudflare:workers`.

## The sweep of VADO text
Every enterprise sees the same words, so no screen word and no agent text names VADO content (design D1). `src/i18n/neutralWords.test.ts`
scans the English and Arabic word trees, `INSTRUCTIONS`, `TOOL_DOCS` and `PARITY_DOCS` for Vado, Bunah, Khobar, the prefix `KH` and their
Arabic forms. Its allow list is empty: a new entry needs the owner's reason.
- Changed: the hint of an empty Search (`search.emptyHint`: a project code such as 260902AZT), the hint of the code prefix
  (`admin.prefixHint`: for example AB), and the MCP texts (`INSTRUCTIONS` line 1, rule 1 and the sub-company line).
- Stays, with its reason:
  - `public/privacy.html`: the privacy page and the terms of a sold service are an owner task before the first sale (design section 2).
  - `src/data/seed.ts`, `src/data/sampleSubCompanies.ts` and the codes `KH-26-...` in tests: the sample office of VADOs' Companies in the
    prototype and the test copy. The second fake enterprise has its own small neutral office (`src/data/sampleSecondEnterprise.ts`).
  - `DEFAULT_SETTINGS.codePrefix` (`server/data/lite/schema.ts`) and `emptyState` (`src/api/store.ts`): the value of VADOs' Companies, and
    the default of a plain test office. Every new enterprise gets its prefix from `EnterpriseInit.codePrefix`.
  - `src/features/map/mapStyle.ts` `START_POINT` (Al Khobar): the first view of a map with no pin. It shows no word. The owner may choose a
    view of all Saudi Arabia later.
  - `src/lib/placeSearch.ts` `LEAVE_OUT`: it cuts city names from a map search name. It shows nothing.
  - `src/lib/insightEnv.ts`, `server/core/serverHost.ts` and `src/app/canonicalHost.ts`: host names of the product, not words.
  - The sender `madar@vado.sa` (design call 7).
  - The word "office" in the screens: it names a workplace in general, not VADO.

## Files
- `ids.ts`: the id, the address name, the tag and the email rule. It has no import, so the Postgres path may load it.
  `RESERVED_ADDRESSES` holds `oauth` and `oauth-protected-resource` (path words of `/mcp/...`) and the words `mcp`, `api`, `platform`,
  `admin`, `www`.
- `types.ts`: the enterprise records. `shapes.ts`: the zod shapes of the two ops of the platform object.
- `gate.ts` (`EnterpriseGate`): the identity row of one object (table `enterprise`: id, state, limits, created_at). `refusal(ent, {allow})`
  gives `not_found` (no row), `unauthenticated` with the text of a bad token (another id, a malformed id, or an object name that differs from
  the row), or `forbidden` with the reason `enterprise_paused`. The row is read once and kept in memory (`forget()` drops it).
- `status.ts`: `enterpriseStatusOf`, the status row of one enterprise (people, invited, last write, the day counts, the names).
- `router.ts`: `entRouter`, the one place that turns an untrusted id (a tag, an email result, an address) into an object stub. It keeps the
  list of the platform object for 60 s (`LISTED_TTL_MS`) and reads it again for a miss when it is 5 s old (`LISTED_MISS_MS`). The cache
  lives as long as the isolate (`ListedCache`). `mcpAddressOf` reads `/mcp/<address>/...` and gives a path with no last slash for the tool path (`/mcp/<address>/` gives `/mcp`). `isMcpToolPath` is the one
  test of a tool call path (`/mcp` or `/mcp/`): the Worker (account write stop) and the office object (hold and day cap) both use it.
- `pad.ts`: `padTo`, the minimum answer time of a branch. `mailRoute.ts`: `runMailRoute`, the limits of forgot and renew, shared by the
  office object and the platform object.
- `fanout.ts`: the Cron fan-out (`runFanout`, `selfTransport`, `CRON_PATH`).
- `platform/`: the platform object (`schema.ts`, `stub.ts` = `PlatformStub`, `parts.ts` = the work, `object.ts` = the class `Platform`), the platform accounts (`accounts.ts`), and the platform calls (`enterprises.ts`, `handlers.ts`, `guard.ts`, `route.ts`, `auth.ts` = the sign-in routes, `answer.ts` = the refusal answer).

## Rules
- The enterprise never comes from a header, a query value or a body field that the browser sets. It comes from the signed claim `ent`, a
  tag, the email directory or the MCP address.
- An untrusted id becomes an object stub in `entRouter` only (`listedStub`, `addressStub`). The router never makes an object for a name that
  the platform object does not list. A verified token claim goes through `router.stub(ent)` with no list check.
- A tagged text (`<ent>.<secret>`: a link, a renew key, a browser refresh token, a socket ticket) has no fallback. An untagged one is
  refused with the answer of an unknown one. Never read an untagged text as `ENT_VADO`. An agent refresh token stays bare (the MCP address
  names the enterprise).
- A refusal of a wrong enterprise has the same text as a bad token ("Sign in to continue."). It names no enterprise and no email.
- Unknown input runs the real step on empty tables: `platform.refuseSignin` (password, verify, refresh) and `platform.refuseMail` (forgot,
  renew) use the sign-in tables of the platform object, which stay empty. So the answer, the limit counting and the time match a wrong
  credential, and no office object is made. Every branch of forgot, renew and the socket ends at the same minimum time (`padTo`).
- The limit of one network address in a step before a token (password sign-in, link open, forgot, renew) is counted once, in the platform
  object (`platform.hitAddress`), in the Worker route and before the enterprise is chosen. So one address stops at the same request for a
  known email of any enterprise and for an unknown email. The Worker then passes `addressChecked: true` on the object call and on the refuse
  call, and they count the limits of the email or of the key only. The password step still keys its email limit with the address of the
  person (`signin:pair`, review 2026-11-10), which the Worker passes in the input. The flag is on the RPC input only: no route builds an input from a request
  field, and the local path never sets it, so the step counts the address itself there. Forgot and renew count the address only for a body
  with a good email or key, as before. Do not move this count into an object: a per-object count tells whether two emails share an enterprise.
- A limit that comes from a Cloudflare plan is a named constant or a setting, never a bare number in a branch.

## Platform accounts and calls (plans C and F)
- **Accounts (plan F, design D8).** A platform account belongs to no company. The platform object holds it: `platform_accounts` (id `pla_NNN`, email, name,
  PBKDF2 hash, state `active` or `off`) and `platform_sessions` (the sha256 of the refresh secret, `prev_hash` and `used_at` for the 10 s reuse window (`PLATFORM_REUSE_MS`; the 60 s of `REFRESH_REUSE_MS` is for a company browser only),
  `ends_at`). `accounts.ts` holds the work: `platformSignIn`, `platformRefresh`, `platformSignOut`, `platformAccount`, `platformAccounts` (the ops).
  A wrong password and an unknown email give one answer after the same work (one PBKDF2 each). `off` shows only after the right password. The limits
  use the counts, windows and rule of `server/auth/own/limits.ts` with their own keys (`psignin:ip`, `psignin:pair` for the email with the address,
  `psignin:email` for the total of the email), so a try on the platform never counts against a company, and a stranger does not lock an account out.
  A refresh rotates like `rotateSession`; the previous token after the window ends the session. A new password ends every session;
  `off` ends none (the refresh then gives `account_off`). The password has 12 to 200 characters (`PLATFORM_PASSWORD_MIN`).
- **Refusals are data.** `platformSignIn`, `platformRefresh` and `platformAccounts` return `PlatformOutcome` (`{ ok: true, value }` or `{ ok: false, error }`),
  not a throw: an `ApiError` thrown in a Durable Object loses its class over the RPC hop. The Worker calls `valueOfOutcome` to throw it again. Tests that read a
  refusal as a throw wrap the parts (`accounts.test.ts`, `unwrapped`; `nodeWorld` offers `accounts()`).
- **Token (design D10).** `signPlatformToken` (`server/auth/own/keys.ts`): audience `madar-platform` (`PLATFORM_AUDIENCE`), `sub` = the account id, `sid` = the
  session id, no `ent`, 900 s, signed in the platform object with `MADAR_AUTH_PRIVATE_JWK`. `verifyPlatformToken` (`server/auth/verify.ts`) refuses a token with
  any other audience, with an `ent` or with a `client_id`. The company check needs the audience `authenticated`. So neither kind of token works on the routes of
  the other. `/mcp` sends a platform bearer away before any object work (`isPlatformBearer`).
- **Routes** (office path only; the Postgres path answers 404). `POST /api/platform/auth/token` (`password` or `refresh_token`; 200 `{ access_token, refresh_token,
  expires_in: 900, account }`), `POST /api/platform/auth/logout` (204). A refusal is `{ v: 1, error: { code, message, details: { reason } } }` with status 401 for
  every `unauthenticated` reason (`invalid_credentials`, `session_ended`, `account_off`; `answer.ts`) and 429 with `Retry-After` for a limit.
- **Calls.** The eight calls `platform.me`, `platform.enterprises.{list,create,update,pause,resume,resendInvite}` and `platform.meter.get` have their contract in
  `src/api/contract/platform.ts` and their handlers in `platform/handlers.ts` (`PLATFORM_HANDLERS`). They run in the Worker, on `POST /api/platform`
  (`platform/route.ts`), never in an enterprise object. The route checks, in this order: the build, the body size, the platform token (a company token, an
  agent token or no token gets 401), the account (`platform/guard.ts`: it asks the platform object only, and the account must exist and be `active`, else 401,
  `account_off` at once for a token still valid), then the shape, the name, the input and the handler. The output goes through the contract output, which
  strips every key it does not name. All eight are on `MCP_DENY`. `platform.me` answers only `{ createOpen }`. The list row has no owner key (the owner list is gone, design D11).
- **VADO is a normal company** (design D11). There is no owner list: no `isOwner`, no `setOwners`, no mirror in the office object, no `owner_enterprise`
  refusal (the reason is gone from the contract and the words). The platform pauses `ent_001` like any other company, with the typed name. `session.get` never sets `platformOwner`. The platform table `owners`
  and the column `enterprise_use.owners` stay in the schema (a released step never changes) and nothing reads or writes them.
- Create runs in this order: `platform.create` (row `creating`, address and Admin email reserved), `office.init` (settings, `usr_001`, the invitation),
  `platform.activate`. A failed step leaves the row `creating`; the same call again finishes it. A change of two sides writes the object first and the
  platform row second (`update` sends the object only the fields that changed). `pause` needs the typed name.
- The object RPCs of plan C: `init`, `setState`, `setLimits`, `setIdentity`, `reinvite`, `brand` (`lifecycle.ts` holds the work).
- Limits: `facts.ts` (`EnterpriseFacts`, `Deps.enterprise`) holds the id, state and limits in memory. The people limit has two steps. The `prepare` of
  `users.create` and `users.reactivate` (`server/calls/peopleHooks.ts`) gives the early, calm refusal. The real check is in the write step of
  `runCall` (`assertPeopleWithinLimit`, `server/core/peopleLimit.ts`): after the save and inside the lock, for every write call, it refuses with
  `people_limit` when the call turned more people on than off and the count is above the limit, so an Undo or an Undo story of a turn-off or of a
  remove cannot go above the limit. A call that adds nobody never fails there. No facts (the Postgres path) means no check. The storage limit has two steps. `assertStorageRoom` in `files.uploadStart` counts the running total in `enterprise_use`, the bytes of
  the open, unused, unexpired file uploads of the SAME person (`upload_intents` with the actor of the start, not the screenshots of reports: the SQL leaves out the screenshot prefix of this enterprise, `e/<ent>/feedback/` or `feedback/` for ENT_VADO, so `assertStorageRoom` needs `deps.config`) and this file with its small picture. The open uploads of other people do not count at the start, so one person cannot block the starts of the others; the check in the lock stays the real guard. The real check is
  `assertStorageRoomInLock` in the `prepare` of `files.upload` (`server/calls/files.ts`): inside the lock it counts the running total plus this file and
  its small picture (`thumbSize`, from the preflight), because many starts at once each pass the first check. The running total (`storage.ts`) counts
  version sizes only, never the small pictures. The email directory is the preflight and settle of the people hooks (`server/calls/peopleHooks.ts`,
  `directory.ts`, `NetApi.directoryReserve`). The settle step makes the directory equal to the rows: after the commit it re-reads the rows, and
  the row of the target counts as a holder. It frees the reserved email when no row holds it, and the old email after a first answer only
  (`outcome.replayed` is true for a stored answer of an idempotency key). `users.remove` frees the email only when the row is removed now.
- Plan and cap: `plan.ts` (`planFrom`, `capVerdict`, `accountStop`, `warnings`) reads the Free limits from `MADAR_PLAN_*` and the share from
  `MADAR_ENTERPRISE_SHARE`. The platform object keeps the day counts (`meter`, `capState`, `meterToday`). The Worker gate `accountGate.ts` refuses every
  enterprise but ENT_VADO at 90 percent of the account (kept 60 s, fails open); the object refuses the share of its own enterprise in a batch and in a tool
  call of MCP, never in a sign-in step, forgot or renew. `MADAR_ENTERPRISE_CREATE = "open"` opens create.
- Name and logo: `brand.ts` (`mailOptionsOf`) gives the mail header; `logoRoute.ts` is `GET /api/enterprise-logo/:ent` (the same 404 for every miss; the logo
  comes from the object, not from the platform copy).

## The platform object
- One Durable Object named `platform` (`PLATFORM_OBJECT`), binding `PLATFORM`, migration `platform-v1`. Tables: `enterprises` (id, address,
  state, names, limits, first_admin), `emails` (the directory: normalized email to enterprise), `owners` (unused since plan F), `platform_accounts` and
  `platform_sessions` (plan F), `status` (one row for each
  enterprise, from its Cron), `account_day` (the day counts for each (day, enterprise); `meter` replaces the whole day so far), and empty
  copies of `rate_limits`, `auth_users`, `auth_links`, `auth_sessions`, `auth_old_hashes` and `auth_known_addresses` (`serverTableSql`;
  `PLATFORM_COPIED_TABLES`). A copy that a refuse step reads needs a platform step too, as the two copies of step 5.
- `listed()` and `resolveAddress` leave out an enterprise in state `creating`. `hitAddress` holds the counters of the address (`rate_limits` of the platform object, swept by `sweep`). `reserveEmail` answers `taken` for another enterprise.
  `register` (ops secret only) upserts a row in any state and reserves its emails; a conflict leaves nothing behind.
- `PLATFORM_SCHEMA_VERSION` 5 (`mail_pool` came in step 3, the platform accounts in step 4, the copies of the sign-in memory in step 5), `PLATFORM_STEPS` for the later versions. A directory read costs 1 row for a hit and 0 for a miss (proof.md,
  "Madar enterprises: core spikes S2 and S3").

## The Cron fan-out
- `scheduled` reads `platform.listed()`, sweeps the rate limits of the platform on the first run after 00:00 UTC, and sends one leg for each
  id through the transport. A leg is `POST /api/internal/cron` (jobs secret, body `{ ent, at }`): the job in the object, then
  `platform.report(status)` and `platform.meter(...)`. A leg that throws (a paused object) still reports its status.
- The transport is `MADAR_CRON_TRANSPORT`: `self` (the service binding `SELF`, a new Worker invocation for each leg, so each job has its own
  budget of outside calls) or `api` (the public API address). Local runs use `api`. The lead sets the default from the probe of spike S1
  (`scripts/proof/cron-fanout/probe.ts`, proof.md "S1: Cron fan-out").

## Ops names (`/api/office/<op>`, `server/entries/officeWorker.ts`)
- Without `?office=` an op is for `ENT_VADO`. `export` and `import` take the old name `office`, a rehearsal name or a listed enterprise id;
  `peek` takes `office` or a listed id; `drop` takes a rehearsal name only. An id that the platform does not list gives 403.
- `platform-register` (`{ row, emails, keepExisting? }`; with `keepExisting` a row that is there stays as it is and only the missing emails are added; the seed and `scripts/office/register-company.ts` call it) and `platform-accounts` (`{ action: create | password | off | on, email, name?, password? }`, design D13) take the ops
  secret and no `?office=`. `platform-accounts` answers `{ ok: true, account }` (never a hash), logs no body and is called only by
  `scripts/office/platform-account.ts`. The ops route sits on the company address of the copy: the platform site passes only `/api/platform` on. The register op empties the
  listed cache of the isolate, so an import that follows finds the new enterprise at once.
- The first `import` begin on an object named with an enterprise id makes its identity row. The old name `office` and a rehearsal name make none.

## Tests
- `server/office/test/nodeWorld.ts` makes a platform object and one office object for each id on node:sqlite, with `route()` through the real
  Worker routes and a `created` spy on `stubFor`. `server/office/enterpriseLeaks.test.ts` and `.wd.test.ts` are the leak tests of two enterprises
  with the same record ids. `scripts/office/enterprise.ts` makes the fake second enterprise (`ent_002`) for the local stack.

## Mail (plan D)
- A mail key and a `mail_log` ref start with the enterprise id. `scopedRef(ent, key)` (`scope.ts`) gives `<ent>:<key>`. A caller passes the plain key
  (`notice-ntf_001`), and `sendCounted` and `reservePlace` (`server/mail/quota.ts`) add the prefix. Resend keeps one key space for the whole account,
  and a record id such as `usr_001` repeats in each enterprise, so a bare key would make Resend drop the second mail. `entOfConfig(config)` reads
  `Config.ent` and gives `ENT_VADO` when it is absent (the Postgres path).
- One pool counts the mails of all enterprises for the UTC day: the table `mail_pool` of the platform object (schema version 3, `platform/mailPool.ts`,
  `PlatformStub.mailReserve({ ent, kind, day, ref })`). One ref holds one place, so a retry of the same mail takes its place once. A `signin` place is
  full at the limit minus 2 (98). A `notice` place is full at 90 percent of the limit (90). An enterprise except `ENT_VADO` also holds at most
  `max(1, floor(share * 90))` notice places a day (9 with the share 0.1). `ENT_VADO` is never held back by the share. The limit is `PLAN_LIMITS.mails`
  (`MADAR_PLAN_MAILS`, 100). A call writes only when it adds a place, and it deletes the rows older than 2 days.
- The kinds: `notice` and `summary` are `notice` places. `signin` and `warning` are `signin` places (`POOL_KIND` in `quota.ts`).
- The office object reaches the pool through `NetApi.mailReserve` (`Deps.mailPool`, `NetPorts.mailPool`). `WorkerNet` sends the `ent` of the Worker and never one
  from the object. The call is no outside call, so it does not count in `NET_BUDGET`. It still refuses inside a transaction, so the pool call always
  goes before the transaction (`poolPlace`, `reservePlace`). A pool that does not answer (no platform in `WorkerNet`, an error) stops the mail, and the
  outbox row waits. A full pool acts like a full local day: no mail, no local row, the same first refusal mark and Admin warning path.
- The Postgres path and the `outbox` mail driver have no `mailPool`. The local quota decides alone there.
- A pool place that a mail never used stays until midnight UTC: a skipped invitation, and a renewal that the person limit refuses after the pool call.
  This is accepted. The count is one place for each skipped row.
- `Config.mailDayLimit` is the total of the account (`planFrom(read).limits.mails`, set in `depsFor`). `quotaLimitsOf(total)` (`server/mail/limits.ts`) gives
  the local limits. A bad `MADAR_PLAN_MAILS` falls back to 100 in the local count. The platform object then fails its own pool call, so no mail goes out.
- `status().day.mails` is `sentToday` (the sent kinds only, never the refusal mark).
- Tests: `platform/mailPool.test.ts`, `server/mail/pool.test.ts`, `server/mail/scopedRefs.test.ts`, `server/office/workerNet.test.ts`, `server/office/net.test.ts`.

## Files (plan D)
- A key of an enterprise except `ENT_VADO` starts with `e/<ent>/`: `ent_002` gives `e/ent-002/` (a key allows no underscore). `ENT_VADO` keeps its keys with no
  prefix, and no key of `ENT_VADO` starts with `e/`. `keysOf(ent)`, `enterpriseKeyPrefix(ent)` and `keyBelongsTo(ent, key)` are in `server/files/keys.ts`. The
  module functions of `keys.ts` equal `keysOf(ENT_VADO)`. A call takes `keysOf(entOfConfig(deps.config))`.
- `guardFilesPort(port, ent)` (`server/files/guard.ts`) checks every key before it calls the store: `copy` checks both keys, `remove` checks all keys before it
  removes one. A refusal says only `The file key is not valid.` It names no key and no enterprise.
- Two walls hold it: `WorkerNet` (the Worker, with the `ent` of the request) and `netPorts` (the object, with its own `ent`).
- The enterprise is a required input with no default in `WorkerNet`, `netPorts` and `guardFilesPort`. A missing or malformed id throws
  `ENT_REQUIRED` when the port is made, so a caller that forgets it never gets a port for `ENT_VADO`. An object with no identity row (the old name `office`
  and a rehearsal name) passes `ENT_VADO` on purpose, in `depsFor` (`server/office/parts.ts`), as `entOfConfig` reads a config with no `ent`.
- Tests: `server/files/enterpriseKeys.test.ts`, `server/office/net.test.ts`, `server/office/workerNet.test.ts`.

## Google (plan D)
- The keys of one enterprise are `googleKeysOf(key, ent)` (`server/google/keys.ts`). `ENT_VADO` keeps the HKDF info texts `madar-google-seal` and
  `madar-google-state`, so the sealed tokens of the move still open. Any other enterprise uses `madar-google-seal:<ent>` and `madar-google-state:<ent>`. A token or
  a state of one enterprise does not open with the keys of another. The key cache holds at most 64 entries (`GOOGLE_KEY_CACHE_MAX`) and drops all of them when it is full.
- The signed state carries the claim `ent`. `readState` answers `bad` for a state with no valid `ent`. `entOfState(state)` reads the claim of an unchecked state.
- `google.connect` refuses a state whose `ent` differs from the `ent` of the deps, with the word of an old state (`google_link_old`).
- The callback (`server/google/callback.ts`) reads the claim with `entOfState`, accepts an id only when it has the id form and is in the list of the Worker (`listed`),
  derives the keys of that enterprise, and checks the signature. Every failure is the word `failed`, and an unlisted id derives no key.
- Tests: `server/google/enterprise.test.ts`.

## Daftra (plan D)
- The Daftra accounts belong to `ENT_VADO` only. `daftraOf` returns `undefined` and `daftraAccountsOf` returns `[]` for any other enterprise
  (`server/daftra/client.ts`), so `daftra.status` answers `ready: false` and the job step answers `skipped: no_config`. `WorkerNet` sends no Daftra
  request for another enterprise. Only `client.ts` (the gate) and `entries/officeEntry.ts` may read `config.daftra`: `server/daftra/enterprise.test.ts` fails when a
  new file reads it.

## Logs and PostHog (plan D)
- Every log line has the field `ent` when the enterprise is known. `server/enterprise/context.ts`: `runInEnterprise(ent, work)` sets the scope of one request
  (AsyncLocalStorage), `currentEnterprise()` reads it, and `entLogger(log, getter)` adds `{ ent }` to each line, unless the line sets its own `ent`.
- `loggerOf(config)` (`server/core/deps.ts`) uses `currentEnterprise() ?? config.ent`, outside the PostHog sender, so a posted record also gets the id. The
  Worker routes `batch`, `mcp`, the Cron leg and the socket run inside `runInEnterprise` as soon as the enterprise is known. The office object adds `ent` from
  its identity row (`parts.ts`). A line from the Postgres path has no `ent`.
- `insightLogger` (`server/core/insight.ts`) posts `distinct_id` as `<ent>:<personId>` (`<ent>:madar-server` with no person) and the property `ent`. It sends
  only a real enterprise id.
- Screen usage events and replays go to PostHog for `ENT_VADO` only (`usageAllowed`, `src/lib/enterprise.ts`; a server test pins `VADO_ENTERPRISE` to `ENT_VADO`).
  Another enterprise, or a session that names none, sends `$exception` records only, with `ent` and the person id and with no name. See `src/app/insight/CLAUDE.md`.
- Tests: `server/enterprise/context.test.ts`, `server/core/insight.test.ts`, `server/entries/officeWorker.test.ts`, `server/office/enterprise.test.ts`.

## Backups (plan D)
- One encrypted file for each enterprise: `madar-office-<copy>-<ent>-<stamp>.tar.gz.age`. The old name without an enterprise stays valid.
- The Worker op `enterprises` (the export secret) answers the ids of `platform.listed()`. `scripts/backup/officeEnterprises.ts` prints them. `export` takes
  `?office=<ent>` for a listed id only.
- `.github/workflows/office-backup.yml` lists the ids, reads the age of each enterprise, exports each one (two tries), uploads each file as its own release and
  fails at the end when one enterprise has no backup tonight, so the others still get theirs.
- The export names the id of the object in the manifest (`ent`). `officeRestoreCheck` fails the step `enterprise` when the name and the manifest differ.
- Limits and minutes: `docs/superpowers/real-build/proof.md`, "Madar enterprises: backups".
- Tests: `scripts/backup/*.test.ts`, `server/entries/officeWorker.test.ts`.

## Review fixes (plan D, after the review)
- `mailReserve` refuses a ref that does not start with `<ent>:` of the call (`invalid_input`, no place, no enterprise named in the text). It looks a ref up with the `ent` too, and the insert has no `on conflict`, so a row of another enterprise under the same ref makes the call fail and the mail stops.
- `session.get` on the Postgres path (no `Deps.enterprise`) gives `enterprise.id` `ENT_VADO` and never `platformOwner` (`baseOf` in `server/core/runCall.ts`, design 5.20). The name fields come from Settings; an absent name stays `Madar`, so the header looks as before. An office object whose facts have no identity row still gives no enterprise. Tests: `server/core/runCall.test.ts`.
