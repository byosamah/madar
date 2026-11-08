# Madar enterprises, plan F: the separate platform Implementation Plan

> **For agentic workers:** one builder for each track does its tasks in order, test first. No subagent, no reviewer.

**Goal:** Madar enterprises becomes a separate site with its own platform accounts; the app of the companies (VADO included)
holds no platform door and no platform code.

**Architecture:** The platform object gains platform accounts and sessions. The Worker gets platform sign-in routes and checks a
platform token (audience `madar-platform`) on `/api/platform`. A second Vite entry builds a small platform site, and a second Pages
project (`madar-platform`) serves it with one forwarder that passes only `/api/platform*` to the Worker of the copy.

**Spec:** `docs/superpowers/specs/2026-11-08-madar-enterprises-design.md`, section 12 (D7 to D13). Earlier names:
`docs/superpowers/plans/2026-11-08-madar-enterprises-contract.md`.

## Global Constraints
- Track F1 (`ent-f1`, folder `~/dev/madar-rb/ent-f1`): server, scripts/office, the server guides. Track F2 (`ent-f2`, folder
  `~/dev/madar-rb/ent-f2`): the platform site, the Pages forwarder and deploy script, the companies' screens and prototype, the bundle
  checks, the screen guides. Edit only the files of your track. Both start from `rb/enterprises` 45771b78.
- Tests first. Inside a task: `npm run typecheck` and the touched tests (`npx vitest run <files> --no-file-parallelism
  --testTimeout=60000`); a task that changes the platform object or the SQLite path also runs `npm run test:lite` and `npm run
  test:office` (sandbox off). F2 runs `npm run build` and `npm run build:remote -- test` after its bundle tasks (never two builds at
  once). The lead runs the full gate once at the end.
- One commit for each task, plain ASD-STE100 message, no `Co-Authored-By`, no `Claude-Session`. The dash check before each commit:
  `git diff --cached | perl -CSD -ne 'print if /^\+[^+].*\x{2014}/'` prints nothing.
- Never deploy, never touch the test copy, production, Cloudflare, DNS or GitHub. Those are lead and owner steps.
- Every visible word has an English and an Arabic key (Thmanyah rules); new words of F2 go into `src/i18n/real/ent-f2.*.json`.
  The platform site words keep «منشأة» and «منشآت مدار». No What's new line (the platform is not for the companies' people).
- Error texts name no company, no email and no secret.

## Shared names (both tracks use exactly these)
- Platform account id: `pla_NNN` (form `^pla_\d{3,}$`), `isPlatformAccountId` in `server/enterprise/ids.ts`.
- Routes on the Worker (office path only; the Postgres path answers 404):
  - `POST /api/platform/auth/token`, body `{ grant_type: 'password', email, password }` or `{ grant_type: 'refresh_token',
    refresh_token }`. Answer 200 `{ access_token, refresh_token, expires_in: 900, account: { id, name, email } }`. A wrong email or
    password gives 401 `{ error: { code: 'unauthenticated', reason: 'invalid_credentials' } }` with the same body and padded time for an
    unknown email; over a limit 429 with `Retry-After`; an ended refresh gives 401 reason `session_ended`.
  - `POST /api/platform/auth/logout` with `Authorization: Bearer <platform access token>`: 204, ends the session.
  - `POST /api/platform` (the platform calls, wire as today: one call for each request) with `Authorization: Bearer <platform access
    token>`. A company token gets 401; a turned-off account gets 401 reason `account_off`.
- The platform token: signed with `MADAR_AUTH_PRIVATE_JWK`, issuer the own issuer, audience `madar-platform`, `sub` = the account id,
  claim `sid` = the session id, no `ent`, life 900 s. `signPlatformToken(keys, { accountId, sessionId, now })` in
  `server/auth/own/keys.ts`; `verifyPlatformToken(header): Promise<{ accountId: string; sessionId: string }>` in
  `server/auth/verify.ts`.
- `PlatformStub` additions: `platformSignIn({ email, password, address })`, `platformRefresh({ refreshToken })`,
  `platformSignOut({ sessionId })`, `platformAccount({ accountId }): Promise<{ id, name, email, state } | null>`, and the ops method
  `platformAccounts(input: { action: 'create' | 'password' | 'off' | 'on'; email: string; name?: string; password?: string })`.
  Removed: `isOwner`, `setOwners`, `ownersOf`; `OfficeStub.setPlatformOwners` and `person`.
- Ops route: `POST /api/office/platform-accounts` (ops secret header), body as `platformAccounts` input. Removed:
  `POST /api/office/platform-owners` and `scripts/office/platform-owners.ts`.
- Hosts: `PLATFORM_HOSTS` in `server/core/serverHost.ts`: `'preview.madar-platform.pages.dev': 'test'`,
  `'madar-platform.pages.dev': 'production'`, `'platform.madar.vado.sa': 'production'`. They are not company page hosts.
- The site: entry `platform.html`, source `src/platform/`, config `vite.platform.config.ts`, output `dist-platform/`, Pages project
  `madar-platform`, forwarder folder `functions-platform/` (one file `api/platform/[[path]].ts`, logic in
  `server/http/pagesPlatformProxy.ts`), deploy script `scripts/deploy/pages-platform.sh <test|production>` (branch `preview` for test,
  `main` for production), session key `madar.platform.session` in the site's own localStorage.

## Track F1: server
### Task F1.1: platform accounts in the platform object
Files: `server/enterprise/platform/{schema,parts,stub,object}.ts` (schema version 4: tables `platform_accounts` (id, email unique,
name, password_hash, state, created_at), `platform_sessions` (id, account_id, refresh_hash, ends_at, used_at), the platform limits
rows), `server/enterprise/ids.ts`, tests beside them and `server/office/platform.wd.test.ts`.
- Passwords: PBKDF2 SHA-256, `PBKDF2_ROUNDS` of `server/auth/own` (100,000), the hash work in the platform object between two
  transactions; sessions rotate like `server/auth/own/sessions.ts` (reuse its code where it fits).
- Limits: the counts and windows of `server/auth/own/limits.ts` for one email and one address (the address step of `hitAddress` stays).
- Tests: create, sign in, wrong password and unknown email give the same answer, refresh rotates, a reused old refresh ends the
  session, off refuses sign-in and refresh, password change ends every session of the account.

### Task F1.2: the platform token and the routes
Files: `server/auth/own/keys.ts`, `server/auth/verify.ts`, `server/enterprise/platform/route.ts`, `server/enterprise/platform/guard.ts`,
`server/entries/officeWorker.ts`, tests.
- The guard of `/api/platform`: `verifyPlatformToken`, then `platformAccount` must be active; no company object call.
- Leak tests (design D10): a company browser token and an agent token on `/api/platform` give 401; a platform token on `/api/batch`,
  `/mcp`, `/api/live` ticket and every company sign-in step gives 401 and touches no company object; a platform token of an account
  turned off gives 401 `account_off` at once.

### Task F1.3: remove the owner list, VADO becomes a normal company
Files: `server/enterprise/platform/*` (`isOwner`, `setOwners`, `ownersOf`, the mirror), `server/office/*` (`setPlatformOwners`,
`person`, the `enterprise_use.owners` reads), `server/core/runCall.ts` (`Ctx.enterprise.platformOwner` stays false), the
`owner_enterprise` refusal of pause, `server/entries/officeWorker.ts` (the ops route), `scripts/office/platform-owners.ts` (delete),
`server/mcp` docs if they name the owner list, tests.
- The column `owners` of `enterprise_use` stays in the schema (a released step never changes) and is no longer read or written.
- Tests: the platform pauses `ent_001` like any other company; `session.get` never sets `platformOwner`.

### Task F1.4: the ops route and the Mac script
Files: `server/entries/officeWorker.ts` (`POST /api/office/platform-accounts`), `scripts/office/platform-account.ts` (new:
`--to <page address> --email <e> [--name <n>] [--password | --off | --on]`; it reads the password twice from a hidden prompt, refuses a
password under 12 characters, never prints it, and sends it once over HTTPS with the ops secret), tests.

### Task F1.5: guides
`server/enterprise/CLAUDE.md` (the platform accounts, the token, the routes; remove the owner list lines), `server/auth/CLAUDE.md`,
`server/office/CLAUDE.md`, the contract file of plans (append "Names of plan F"), `TASKS.md` lines for the lead steps.

## Track F2: the site and the companies' app
### Task F2.1: no platform part in the companies' app and prototype
Files: the person menu line and the Me tab line of "Madar enterprises" and their tests, the `/enterprises` route of the companies'
routes (and the route pins), `usePlatform` and `src/api/remote/platformClient.ts` out of the companies' build, the Preview as
"Platform owner" option and the platform fakes of the prototype (`src/api/platformFake.ts` and its use), the building icon if nothing
else uses it, `scripts/check-bundles.ts` (a rule for the remote and the prototype bundles: no marker of the platform, for example the
call name `platform.enterprises.create`), tests. The fake directory of two companies stays (it is the companies' prototype).

### Task F2.2: the platform site
Files: `platform.html`, `vite.platform.config.ts`, `src/platform/` (boot, runtime, the session store `madar.platform.session`, the API
client of the routes above with one refresh before a retry, the sign-in screen, a small shell: the title "Madar enterprises" / «منشآت
مدار», the language and theme switch, Sign out), and the page: reuse `src/features/enterprises/` (the list, the sheets, the meter, the
logo picker) by moving what the site needs so that no file of `src/platform/` imports the companies' shell, routes or api runtime.
Design tokens, the Thmanyah font, English and Arabic, light and dark, 390 px. `npm run build:platform` script (and its line in
`scripts/vite-config.test.ts`). A bundle check `check-bundles.ts platform`: no Supabase, no companies' screens (for example no
`tasks.list`), one first-load bound of its own.
- Tests: the sign-in screen (wrong password text, too many text, the paused text is not shown here), the session refresh, sign out, the
  list loads with the platform token, a 401 sends the person to the sign-in screen.

### Task F2.3: the forwarder, the hosts and the deploy script
Files: `server/http/pagesPlatformProxy.ts` (only `/api/platform` and `/api/platform/*`, else 404; host from `PLATFORM_HOSTS`; the
service binding of the copy; the same header rules as `pagesForward.ts`), `functions-platform/api/platform/[[path]].ts` (a one-line
wrapper), `server/core/serverHost.ts` (`PLATFORM_HOSTS`), the headers file of the site (CSP: own origin only),
`scripts/deploy/pages-platform.sh` and one step in `scripts/deploy/all.sh` after `pages.sh` (it skips with a clear line when the
Pages project does not exist yet), `scripts/deploy/CLAUDE.md`, `functions/CLAUDE.md` (a section for the platform forwarder), tests
(`pagesPlatformProxy.test.ts`: a company path gives 404, a company host gives 404, the binding call keeps the path and drops the
client headers).

### Task F2.4: guides
`src/CLAUDE.md` (the third build), `src/features/enterprises/CLAUDE.md`, `src/api/CLAUDE.md` (no platform fakes), `src/i18n/CLAUDE.md`
if words moved, the root `CLAUDE.md` (the commands line of `build:platform`, and the rule "the companies' app holds no platform part").

## Lead and owner steps (after both tracks merge and the gate is green)
1. Owner OK: make the Pages project `madar-platform` with the service bindings `MADAR_SERVER_TEST` (preview) and
   `MADAR_SERVER_PRODUCTION` (production).
2. The owner runs `all.sh test` (it deploys both sites); the lead checks `preview.madar-platform.pages.dev`.
3. The owner runs `npx tsx scripts/office/platform-account.ts --to https://preview.madar-platform.pages.dev --email <his> --name
   <his>` and types the password.
4. Screenshots of the platform site (sign-in and the list, EN and AR, light and dark, 390 px and desk) and of the companies' person
   menu and Me tab without the line.
5. Later, with the owner: the DNS record of `platform.madar.vado.sa` and its custom domain on the Pages project.

## Review Focus
1. A company Admin who knows the platform address sees only the platform sign-in, and his company login fails there.
2. An old company tab that held the `/enterprises` route shows the normal not-found page, not an error.
3. The platform sign-in gives the same answer and time for an unknown email and a wrong password.
4. Pausing `ent_001` from the platform stops VADO's sign-in with the paused text, and resume brings it back.
5. The platform site loads with no company code (the bundle check), and the companies' bundles hold no platform code.
