# Madar enterprises: the shared names

## Lead decisions after the plan drafts (2026-11-08, Opus lead)
These lines win over the rest of this file and over the plans.
1. **The id of the enterprise** lives on the config: `Config.ent?: EnterpriseId` (`server/core/ports.ts`). Plan B sets it in
   `depsFor` from the object row; the Postgres path leaves it out; `entOfConfig(config)` (plan D) gives `ENT_VADO` when it is
   absent. **The facts** (state, limits, owners) are `Deps.enterprise?: EnterpriseFacts` (plan C). No other name.
2. **The pause gate:** `signin`, `mailRoute`, `mailWork`, `status`, `health` and `setState` pass the gate of a paused object
   (`allow: 'paused'`). Plan C decides each sign-in step of a paused object (design 5.8).
3. **One owner route:** `POST /api/office/platform-owners` (plan B makes it, with the ops secret). Plan C changes its handler
   to `writeOwners`, which also mirrors the owners into each enterprise object. No `/api/platform/owners`.
4. **Error codes:** the word `unauthorized` of this file means `ApiError` code `unauthenticated`, with the text of a bad token.
5. **`meter()`** stores the whole day so far for (ent, day) and replaces the old value, so a repeat adds nothing.
6. **File keys:** the prefix is `e/ent-NNN/` (a hyphen, because an object key takes only `[a-z0-9/-]`). `ENT_VADO` keeps its
   keys with no prefix, and no VADO key starts with `e/`.
7. **Schema steps:** plan B adds step 14 (the `enterprise` table), plan C step 15 (`enterprise_use`). A later plan takes 16.
8. **Additions:** each plan's own "Interfaces" and contract lines are accepted as written (plan B: `RESERVED_ADDRESSES`,
   `isAddressName`, `normalizeEmail`, `register`, `refuseSignin`, `refuseMail`, the tagged browser refresh token, the
   `/api/internal/cron` route; plan C: the `PlatformStub` and `OfficeStub` additions, `enterprise_use`, the reasons, the logo
   route; plan D: `scopedRef`, `MailPoolPort`, `keysOf`, `guardFilesPort`, `runInEnterprise`, the backup file name).
9. **Merge order:** A, then B (B rebases on A for `server/entries/officeSignin.ts`), then C, then D. Each track merges into
   `rb/enterprises`, which takes main with `git merge main` before each wave. The full suites run once, on `rb/enterprises`,
   before main.

Every plan of Madar enterprises (A to E) uses exactly these names, types and values. A plan that needs a new shared name adds it
here in the same commit. The design: `docs/superpowers/specs/2026-11-08-madar-enterprises-design.md`.

## The plans and their order

| Plan | File | What | Needs |
| --- | --- | --- | --- |
| A | `2026-11-08-madar-enterprises-a-parity.md` | Google Calendar and the Daftra step on the office path; the satellite route takes the own key | none |
| B | `2026-11-08-madar-enterprises-b-core.md` | Spikes S1 to S3; the ids module; the `ent` claim; the object identity; the platform object and the directory; routing; tags; the MCP address; the Cron fan-out; the leak tests of two enterprises | none (parallel with A) |
| C | `2026-11-08-madar-enterprises-c-platform.md` | The platform calls and the page; create, pause, resume; limits; name and logo; the email reserve; the meter and the day cap | B |
| D | `2026-11-08-madar-enterprises-d-services.md` | The mail pool and mail keys; the file prefix; logs and PostHog; the backups for each enterprise; the prototype; What's new; the MCP words; the sweep of VADO text; the guides | B (and C for the platform fakes) |
| E | `2026-11-08-madar-enterprises-e-move.md` | The move of VADOs' Companies to production (owner OK at each step) | A, B, C, D |

## New folder
- `server/enterprise/` holds the shared server code of this work, with its own `CLAUDE.md` guide (plan B makes it; plan D
  finishes it). The root `CLAUDE.md` table gets one line for it.

## Ids and names (`server/enterprise/ids.ts`, plan B)
```ts
export type EnterpriseId = string;                       // form ^ent_\d{3,}$
export const ENTERPRISE_ID = /^ent_\d{3,}$/;
export const ENT_VADO: EnterpriseId = 'ent_001';         // VADOs' Companies
export const ADDRESS_NAME = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/;
export const VADO_ADDRESS = 'vados';
export const PLATFORM_OBJECT = 'platform';               // the name of the one platform object
export function isEnterpriseId(value: unknown): value is EnterpriseId;
/** "<ent>.<secret>": the tag of a link, a renew key or a socket ticket. */
export function tagged(ent: EnterpriseId, secret: string): string;
/** The parts of a tagged text, or null for any other form (an untagged text is null: no fallback). */
export function untag(text: string): { ent: EnterpriseId; secret: string } | null;
```
- The object name of an enterprise is its id (`ent_001`). The object class stays `Office` (binding `OFFICE`).
- The platform object is a new class `Platform` (`server/enterprise/platform/object.ts`), binding `PLATFORM`, a new wrangler
  migration tag `platform-v1` with `new_sqlite_classes = ["Platform"]`, in every env block that has `OFFICE`.
- Words: English "enterprise" in code and in the platform page; Arabic «منشأة», plural «منشآت»; the page title "Madar
  enterprises" / «منشآت مدار».

## Enterprise records (`server/enterprise/types.ts`, plan B)
```ts
export type EnterpriseState = 'creating' | 'active' | 'paused';
export type EnterpriseLimits = { people: number | null; storageBytes: number | null };   // null: no limit
export type EnterpriseRow = {
  id: EnterpriseId; address: string; name: string; nameAr: string; state: EnterpriseState;
  limits: EnterpriseLimits; createdAt: string; firstAdmin: { name: string; email: string };
};
export type DayCounts = { requests: number; rowsRead: number; rowsWritten: number; mails: number };
export type EnterpriseStatus = {
  ent: EnterpriseId; people: number; invited: number; storageBytes: number; lastWriteAt: string | null; day: DayCounts;
  name: string; nameAr: string;
};
```

## The token claim (plan B)
- Every own token (browser and agent) carries the claim `ent: EnterpriseId`.
- `signBrowserToken(keys, { authId, sessionId, now, ent })` and `signAgentToken(keys, { authId, sessionId, clientId, now, ent })`
  (`server/auth/own/keys.ts`).
- `TokenChecker` (`server/auth/verify.ts`) returns `{ authUserId: string; sessionId?: string; ent?: EnterpriseId }`. On the own
  key, a token with no valid `ent` fails as `unauthorized`. On the Supabase key (the Postgres way back), `ent` is absent and the
  Postgres path treats it as `ENT_VADO`.
- One key for all enterprises: `MADAR_AUTH_PRIVATE_JWK`.

## The enterprise object (plan B unless named)
- A new server table `enterprise` in the object (a new `LITE_STEPS` step; `LITE_SCHEMA_VERSION` 13 becomes 14): one row with
  `id`, `state`, `limits` (JSON text), `created_at`.
- Every object RPC input carries `ent: EnterpriseId`: `OfficeBatchInput`, `OfficeCronInput`, `OfficeSigninInput`,
  `OfficeMailInput`, `OfficeMailWork`, `OfficeMcpInput`, `OfficeEffectsInput`. The object refuses with `unauthorized` when
  `ent` differs from its row, and with `not_found` when it has no row (an object that was never made).
- New RPC methods on `OfficeStub`:
  - `init(input: EnterpriseInit, net: NetApi): Promise<OpResult<{ adminUserId: string }>>` (plan C uses it).
  - `setState(input: { ent: EnterpriseId; state: EnterpriseState }): Promise<void>` (plan C).
  - `setLimits(input: { ent: EnterpriseId; limits: EnterpriseLimits }): Promise<void>` (plan C).
  - `status(input: { ent: EnterpriseId }): Promise<EnterpriseStatus>` (plan B makes it; the Cron sends it on).
```ts
export type EnterpriseInit = {
  ent: EnterpriseId; address: string; name: string; nameAr: string; logo: string | null;
  limits: EnterpriseLimits; codePrefix: string; admin: { name: string; email: string; language: 'en' | 'ar' };
};
```
- A paused object refuses every RPC except `setState`, `status` and `health` with `ApiError('forbidden', ..., { reason:
  'enterprise_paused' })`.

## The platform object (`PlatformStub`, plan B makes the class; plan C adds the platform calls)
```ts
export type PlatformStub = {
  resolveEmail(input: { email: string }): Promise<{ ent: EnterpriseId } | null>;      // email normalized by the caller
  resolveAddress(input: { address: string }): Promise<{ ent: EnterpriseId } | null>;
  listed(): Promise<EnterpriseId[]>;                                                   // ids with state active or paused
  reserveEmail(input: { ent: EnterpriseId; email: string }): Promise<'ok' | 'taken'>;
  releaseEmail(input: { ent: EnterpriseId; email: string }): Promise<void>;
  isOwner(input: { ent: EnterpriseId; userId: string }): Promise<boolean>;
  setOwners(input: { owners: { ent: EnterpriseId; userId: string }[] }): Promise<void>; // ops secret only
  report(input: EnterpriseStatus): Promise<void>;                                      // the Cron of each object
  meter(input: { ent: EnterpriseId; day: string; counts: DayCounts }): Promise<CapAnswer>;
  mailReserve(input: { ent: EnterpriseId; kind: 'signin' | 'notice'; day: string }): Promise<'ok' | 'full'>; // plan D
  // plan C adds: list, create, update, setState, resendInvite, meterToday.
};
export type CapAnswer = { allowed: boolean; reason?: 'busy' };
```
- The Worker keeps the result of `listed()` for 60 seconds in the isolate. An id from a link tag, a ticket tag or an MCP address
  passes only when it is in that list. An id from a verified token claim needs no list check.
- Email normalization: `email.trim().toLowerCase()` (the same rule as the current users records; plan B checks the current rule
  and uses it).

## Routing (plan B)
- `stubFor(env, ent: EnterpriseId): OfficeStub` replaces `stub(env)` in `server/entries/officeEntry.ts`. `platformStub(env):
  PlatformStub` is new. `OFFICE_NAME` stays only for the ops of the test copy and the old rehearsal names.
- `/mcp` serves `ENT_VADO`. `/mcp/<address>` serves the enterprise of that address name. Issuer, audience and resource metadata
  come from the full address of the request.
- Untrusted enterprise ids never come from a header, query or body that the browser sets.

## Platform calls (plan C)
- Names: `platform.me`, `platform.enterprises.list`, `platform.enterprises.create`, `platform.enterprises.update`,
  `platform.enterprises.pause`, `platform.enterprises.resume`, `platform.enterprises.resendInvite`, `platform.meter.get`.
- Contract: `src/api/contract/platform.ts` (`PLATFORM_CALL_NAMES` and the zod inputs and outputs). They are not shared calls of
  an office, and `can()` never sees them.
- Route: `POST /api/platform`, one call for each request, the same wire form as one entry of `/api/batch`. The office path
  only; the Postgres path answers 404.
- `platform.*` is on the MCP deny list (`server/mcp/tools.ts`).

## Screens and contract fields (plan C)
- `Settings` (`src/api/contract/entities.ts`) gets optional `enterpriseName`, `enterpriseNameAr`, `enterpriseLogo` (the form of
  `SubCompany.logo`).
- `session.get` output gets optional `enterprise: { id: string; name: string; nameAr: string; logo: string | null }` and
  optional `platformOwner: boolean`.
- Error reasons: `enterprise_paused`, `people_limit`, `storage_limit`, `email_taken`, and the current `busy`.

## Shared keys (plan D)
- File keys of every enterprise except `ENT_VADO` start with `e/<ent>/`.
- Mail idempotency keys and `mail_log` refs start with `<ent>:`.
- PostHog `distinct_id` is `<ent>:<personId>`; every server log line and error record has the field `ent`.

## Plan settings (plan C makes them, read by B, C and D)
- `PLAN_LIMITS` in `server/enterprise/plan.ts`, read from env with Free values as the defaults: requests 100,000, rows read
  5,000,000, rows written 100,000, mails 100 a day. The share of each enterprise except `ENT_VADO`: 10% (`MADAR_ENTERPRISE_SHARE`).
  The stop line for all others: 90% of the account. `ENT_VADO` is never refused by the cap.
- `MADAR_ENTERPRISE_CREATE = "open"` opens `platform.enterprises.create` in production (closed by default; plan E opens it after
  the 14-day way-back window).
