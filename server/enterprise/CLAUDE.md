# Madar enterprises (the enterprise core)

The shared server code of Madar enterprises: each enterprise has its own office object, and one platform object holds the list. The
design is `docs/superpowers/specs/2026-11-08-madar-enterprises-design.md`. The shared names are
`docs/superpowers/plans/2026-11-08-madar-enterprises-contract.md` (the section "Lead decisions" wins). The office object is in
`server/office/CLAUDE.md`. The Postgres path serves ENT_VADO only and loads no file here that imports `cloudflare:workers`.

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
  lives as long as the isolate (`ListedCache`). `mcpAddressOf` reads `/mcp/<address>/...`.
- `pad.ts`: `padTo`, the minimum answer time of a branch. `mailRoute.ts`: `runMailRoute`, the limits of forgot and renew, shared by the
  office object and the platform object.
- `fanout.ts`: the Cron fan-out (`runFanout`, `selfTransport`, `CRON_PATH`).
- `platform/`: the platform object (`schema.ts`, `stub.ts` = `PlatformStub`, `parts.ts` = the work, `object.ts` = the class `Platform`).

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
  call, and they count the limit of the email or of the key only. The flag is on the RPC input only: no route builds an input from a request
  field, and the local path never sets it, so the step counts the address itself there. Forgot and renew count the address only for a body
  with a good email or key, as before. Do not move this count into an object: a per-object count tells whether two emails share an enterprise.
- A limit that comes from a Cloudflare plan is a named constant or a setting, never a bare number in a branch.

## The platform object
- One Durable Object named `platform` (`PLATFORM_OBJECT`), binding `PLATFORM`, migration `platform-v1`. Tables: `enterprises` (id, address,
  state, names, limits, first_admin), `emails` (the directory: normalized email to enterprise), `owners`, `status` (one row for each
  enterprise, from its Cron), `account_day` (the day counts for each (day, enterprise); `meter` replaces the whole day so far), and empty
  copies of `rate_limits`, `auth_users`, `auth_links`, `auth_sessions` (`serverTableSql`).
- `listed()` and `resolveAddress` leave out an enterprise in state `creating`. `hitAddress` holds the counters of the address (`rate_limits` of the platform object, swept by `sweep`). `reserveEmail` answers `taken` for another enterprise.
  `register` (ops secret only) upserts a row in any state and reserves its emails; a conflict leaves nothing behind.
- `PLATFORM_SCHEMA_VERSION` 1, `PLATFORM_STEPS` for later versions. A directory read costs 1 row for a hit and 0 for a miss (proof.md,
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
- `platform-register` (`{ row, emails }`) and `platform-owners` (`{ owners }`) take the ops secret and no `?office=`. The register op empties the
  listed cache of the isolate, so an import that follows finds the new enterprise at once.
- The first `import` begin on an object named with an enterprise id makes its identity row. The old name `office` and a rehearsal name make none.

## Tests
- `server/office/test/nodeWorld.ts` makes a platform object and one office object for each id on node:sqlite, with `route()` through the real
  Worker routes and a `created` spy on `stubFor`. `server/office/enterpriseLeaks.test.ts` and `.wd.test.ts` are the leak tests of two enterprises
  with the same record ids. `scripts/office/enterprise.ts` makes the fake second enterprise (`ent_002`) for the local stack.
