# Madar insight with PostHog: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Owner rule (2026-10-07) wins here:** one builder runs every task. No reviewer, verifier or critic agent. Run only the type check and the touched test files per task; the full suite runs once, in Task 7.

**Goal:** Madar sends screen views, clicks, slow steps, refusals, errors (with the person) and masked screen replays to PostHog Cloud EU, and its server sends its errors there too, with no visible change for the team except one line in Settings.

**Architecture:** A small first-load module (`src/app/insight/index.ts`) decides when to start and forwards notes; a lazy chunk (`client.ts`, `watch.ts`) holds `posthog-js` and the watchers. One class (`ph-no-capture`, constant `PRIVATE`) hides private parts from replays and clicks. The server wraps its logger so that each `error` line also posts one `$exception` record after the answer.

**Tech Stack:** React 19, Vite, TanStack Query, React Router, `posthog-js` (exact version, `dist/module.full.no-external`), Hono server on Supabase functions and the Worker, vitest.

**Spec:** `docs/superpowers/specs/2026-10-25-madar-posthog-insight-design.md` (read it first; this plan argues from it).

## Global Constraints

- Every text in ASD-STE100 (comments, commits, docs, words). No em-dash anywhere. Commits carry no `Co-Authored-By` and no `Claude-Session` line.
- Every visible word has an English and an Arabic key (`src/i18n/real/insight.en.json`, `insight.ar.json`). Arabic in the Thmanyah style.
- `posthog-js` is pinned to an exact version in `package.json` (the repo pins exact versions). Run a full `npm install` in the worktree first (its own `node_modules`, never a link), then `npm install --save-exact posthog-js`.
- The prototype build (`VITE_MADAR_API=fake`) holds no PostHog code and sends nothing. Fold the flag with `import.meta.env.VITE_MADAR_API === 'remote'` in the module that does the dynamic import, as `main.tsx` does.
- The first load of the remote build stays within `scripts/check-bundles.ts` (970,000 B raw, 296,000 B gzip, 35 files) and does not grow by more than the small `index.ts` module.
- PostHog host: `https://eu.i.posthog.com`. Capture endpoint for the server: `https://eu.i.posthog.com/i/v0/e/`.
- Slow step: `SLOW_REQUEST_MS = 2000`. Server send cap: `SERVER_SENDS_PER_MINUTE = 60`.
- `env` is `production` only when the host is `madar.vado.sa`, else `test`.
- No new Madar call, table, migration or MCP change.
- Tests: `npx vitest run <files> --no-file-parallelism --testTimeout=60000`. Type check: `npm run typecheck`.
- Write a report to `REPORT-posthog.md` in the worktree root (untracked) as you go, so a dropped call loses nothing.

## Review Focus

1. A sign-out, then another person signs in on the same tab: PostHog resets, and the next error carries the new person (Task 3 test "resets on sign-out and names the new person").
2. The PostHog chunk fails to load (a release removed it) or PostHog is blocked: Madar shows nothing and never reloads the page (Task 3 test "a failed import stays quiet"; never use `reloadOnFailedImport` here).
3. The Google callback address `/settings#google=finish&code=...&state=...` is the address when PostHog starts: no code or state goes out (Task 1 test).
4. The prototype build: no PostHog chunk, no network call (Task 3 test "does nothing in the fake build", Task 3 `check-bundles` case).
5. A flood of server errors (the database is down): at most 60 sends a minute, and the answer never waits (Task 5 tests "caps the sends" and "keeps the send off the answer").

---

### Task 1: The shared scrub and the private mark

**Files:**
- Create: `src/lib/urlScrub.ts`, `src/lib/insightEnv.ts`, `src/app/privateMark.ts`, `src/app/insight/scrub.ts`
- Test: `src/lib/urlScrub.test.ts`, `src/lib/insightEnv.test.ts`, `src/app/insight/scrub.test.ts`

**Interfaces:**
- Produces: `scrubUrl(url: string): string`, `scrubText(text: string): string` (lib, server-safe); `insightEnv(host: string): 'production' | 'test'`; `PRIVATE = 'ph-no-capture'`; `scrubEvent<T extends { event: string; properties?: Record<string, unknown> }>(event: T): T`.

- [ ] **Step 1: Write the failing tests**

```ts
expect(scrubUrl('https://madar.vado.sa/projects/prj_1?tab=files&task=tsk_9#x')).toBe('https://madar.vado.sa/projects/prj_1?tab=files');
expect(scrubUrl('https://madar.vado.sa/settings#google=finish&code=abc&state=def')).toBe('https://madar.vado.sa/settings');
expect(scrubUrl('https://madar.vado.sa/search?q=client%20name')).toBe('https://madar.vado.sa/search');
expect(scrubUrl('https://a.eu.r2.cloudflarestorage.com/madar-files/k?X-Amz-Signature=1')).toBe('https://a.eu.r2.cloudflarestorage.com/madar-files/k');
expect(scrubUrl('not a url')).toBe('not a url');
expect(scrubText('Failed https://x.test/a?sig=1 now')).toBe('Failed https://x.test/a now');
expect(insightEnv('madar.vado.sa')).toBe('production');
expect(insightEnv('preview.madar-46r.pages.dev')).toBe('test');
// scrubEvent: $current_url, $referrer, $initial_current_url, $initial_referrer, $pathname-free props stay;
// $exception_list[i].value and $exception_message go through scrubText;
// a $snapshot event: each item of properties.$snapshot_data with type 4 (rrweb Meta) gets data.href scrubbed.
```

- [ ] **Step 2: Run them, expect FAIL** (modules missing).
- [ ] **Step 3: Implement.** `scrubUrl` parses with `new URL`, keeps origin and path, keeps only `tab` of the query, drops the hash; text that is no URL comes back as it is. `scrubText` replaces each `https?://\S+` with `scrubUrl` of it. `scrubEvent` returns a copy and never throws (a wrong shape comes back as it is).
- [ ] **Step 4: Run them, expect PASS.**
- [ ] **Step 5: Commit** `git commit -m "Insight: the URL scrub, the env rule and the private mark"`

### Task 2: Mark the private parts of the screens

**Files:**
- Modify: `src/components/RichText.tsx` (root element), the Inbox row preview in `src/features/inbox/ChatList.tsx`, `BubbleReplyQuote` and `ComposerReplyStrip` (`src/features/inbox/`), `src/features/search/MessageHits.tsx` (the line), the preview of `MessageSheet` (`src/features/inbox/`), the excerpt in `src/features/notifications/NotificationsScreen.tsx`, the amounts in `src/features/project/payments/PaymentsPanel.tsx`, `PaymentSheet.tsx` (shown totals), `src/features/project/overview/OverviewTab.tsx` (payments part), `src/features/dashboard/MoneyPanel.tsx`, `src/features/dashboard/meeting/MeetingSummary.tsx`, every component that renders a `useFileLink` or `useScreenshotLink` picture or link, and `src/components/ImageViewer.tsx`. Find more with `git grep -n "amount" src/features` and `git grep -ln "useFileLink\|useScreenshotLink" src`.
- Test: `src/app/privateMark.test.ts`, plus one render assertion in the existing test of `RichText`, `MoneyPanel` and `PictureAttachments`.

**Interfaces:**
- Consumes: `PRIVATE` (Task 1).

- [ ] **Step 1: Write the failing tests.** `privateMark.test.ts` is a source test (as `app/firstLoadImports.test.ts`): every non-test file under `src` that calls `useFileLink(` or `useScreenshotLink(` also contains `PRIVATE`; `ImageViewer.tsx` contains `PRIVATE`. Render assertions: the `RichText` root has the class `ph-no-capture`; the amount element of `MoneyPanel` has it; a picture of `PictureAttachments` has it (or sits inside an element that has it).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Add `PRIVATE` to the `className` of each place.** Put it on the smallest element that holds the private text or the picture, so the replay box stays small. Never on a button whose label is not private.
- [ ] **Step 4: Run the new tests and the existing test files of each touched component, expect PASS.** Then `npx tsx scripts/check-rtl.ts`.
- [ ] **Step 5: Commit** `git commit -m "Insight: hide chat text, amounts and file pictures from the replays"`

### Task 3: The screen client, its start and its stop

**Files:**
- Create: `src/app/insight/index.ts`, `src/app/insight/client.ts`
- Modify: `src/main.tsx` (keep the router in a const; call `startInsight` in the `start` callback of `startIdlePrefetch`), `config/headers.template` (add `https://eu.i.posthog.com` to `connect-src`, with one comment line), `scripts/check-bundles.ts` (a PostHog marker in `LAZY_MARKERS` and a refusal in the prototype check), `scripts/deploy/remote-env.test.ts` (allow an optional `VITE_POSTHOG_KEY` that matches `^phc_[A-Za-z0-9_-]{20,}$`), `package.json`, `package-lock.json`
- Test: `src/app/insight/index.test.ts`, `src/app/insight/client.test.ts`, `scripts/check-bundles.test.ts`, the headers test of `scripts/deploy/`

**Interfaces:**
- Consumes: `scrubEvent`, `insightEnv` (Task 1).
- Produces (index.ts, no `posthog-js` import):
  - `type AppRouter = ReturnType<typeof createAppRouter>` (from `src/app/routes.tsx`)
  - `type InsightPerson = { id: string; name: string }`
  - `type SheetName = 'newProject' | 'newTask' | 'newOfficeTask' | 'payment' | 'meeting' | 'trackerLog' | 'feedback'`, `type SheetStep = 'open' | 'save' | 'close_unsaved'`
  - `startInsight(o: { queryClient: QueryClient; auth: AuthPort | undefined; router: AppRouter }): void`
  - `reportError(error: unknown, where: string): void`, `noteSlow(calls: string[], ms: number): void`, `noteSheet(name: SheetName, step: SheetStep): void` (no-ops while no client runs)
- Produces (client.ts): `type InsightClient = { track(event: string, props?: Record<string, unknown>): void; exception(error: unknown, props?: Record<string, unknown>): void; stop(): void }`; `posthogOptions(o: { env: 'production' | 'test'; build: string; person: () => InsightPerson | null }): Partial<PostHogConfig>`; `createInsightClient(o: { key: string; env; build: string; person: () => InsightPerson | null; queryClient: QueryClient; router: AppRouter }): InsightClient`.

- [ ] **Step 1: Write the failing tests.**
  - `index.test.ts`: "does nothing in the fake build" (flag `fake`: no import, forwarders do nothing); "does nothing with no key"; "starts only after sign-in on a gated address" (a fake auth signed out, then signed in; the client factory is a `vi.mock` of `./client`); "resets on sign-out and names the new person" (stop called on sign-out; after a new sign-in, `person()` reads the new `session.get` answer from the query cache key `['api', 'session.get', {}]`); "a failed import stays quiet" (the mock throws; no error escapes, no reload).
  - `client.test.ts` pins `posthogOptions`: `api_host` `https://eu.i.posthog.com`, `person_profiles` `'identified_only'`, `persistence` `'sessionStorage'`, `autocapture` true, `capture_pageview` false, `capture_pageleave` true, `capture_exceptions` true, `disable_external_dependency_loading` true, `disable_surveys` true, `enable_recording_console_log` false, web vitals on and network timing off, `session_recording` with `maskAllInputs` true, `recordHeaders` false, `recordBody` false; and `before_send` runs `scrubEvent`, adds `personId` and `personName` to a `$exception` event only, and never to another event. Check each option name against the installed `posthog-js` types; where a name differs, use the real one and say so in the report.
  - `check-bundles.test.ts`: a first load with the marker fails; a prototype dist with the marker fails.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** `index.ts` reads `VITE_POSTHOG_KEY`, folds the flag around `import('./client')`, starts when `auth.status()` is `signed_in` and `screensAt(location.pathname).gated` is true, subscribes to `auth` for the stop and the next start, and wraps every step in try/catch. `client.ts` imports `posthog-js/dist/module.full.no-external`, inits with `posthogOptions`, registers `env` and `build` (`VITE_MADAR_BUILD`) as super properties, and `stop()` calls `stopSessionRecording`, `reset` and opts out of capture.
- [ ] **Step 4: Run the tests, then `npm run typecheck`, expect PASS.**
- [ ] **Step 5: Commit** `git commit -m "Insight: the lazy PostHog client of the real screens"`

### Task 4: The signals of the screens

**Files:**
- Create: `src/app/insight/watch.ts`, `src/app/insight/useSheetSteps.ts`
- Modify: `src/app/insight/client.ts` (start the watchers), `src/api/remote/remoteApi.ts` (`onSlow` option, `SLOW_REQUEST_MS`), `src/app/remote/bootstrap.ts` (pass `onSlow: noteSlow`), `src/app/RouteError.tsx` (report a failed screen, not a 404), and the seven sheets of `SheetName` (find each: `NewProjectSheet`, `NewTaskSheet`, `NewOfficeTaskSheet`, `PaymentSheet`, the sheet around `MeetingForm`, the Tracker `QuickLog` sheet, `FeedbackSheet`)
- Test: `src/app/insight/watch.test.ts`, `src/app/insight/useSheetSteps.test.tsx`, `src/api/remote/remoteApi.test.ts` (or the existing client test), `src/app/RouteError.test.tsx`

**Interfaces:**
- Consumes: `InsightClient` (Task 3), `noteSlow`, `noteSheet`, `reportError` (Task 3).
- Produces: `watchRoutes(router: AppRouter, track: InsightClient['track']): () => void`; `watchCalls(queryClient: QueryClient, client: InsightClient, person: () => InsightPerson | null): () => void`; `useSheetSteps(name: SheetName, open: boolean): () => void` (returns `saved`); `RemoteApiOptions.onSlow?: (calls: string[], ms: number) => void`; `SLOW_REQUEST_MS = 2000`.

- [ ] **Step 1: Write the failing tests.**
  - `watchRoutes`: one `$pageview` at start and one for each change of the path or of `tab`, with `screen` from `screensAt(pathname).screens.at(-1)`, `tab`, and `$current_url` scrubbed; no event when only another query value changes.
  - `watchCalls`: an `ApiError('conflict', ..., { reason: 'week_locked' })` on the query key `['api', 'tasks.update', {...}]` gives `madar_refused { call: 'tasks.update', code: 'conflict', reason: 'week_locked' }` with no person; a mutation error with code `failed` on key `['api', 'chats.send']` gives `madar_call_failed { call, personId, personName }`; `unauthenticated` gives nothing; a plain `Error` gives `exception`.
  - `useSheetSteps`: open then close gives `open`, `close_unsaved`; open, `saved()`, close gives `open`, `save` and no `close_unsaved`.
  - `remoteApi`: a request that answers after 2,100 ms (fake `now`) calls `onSlow(['tasks.list'], 2100)`; one at 500 ms does not; a timeout does not.
  - `RouteError`: a thrown screen error calls `reportError(error, 'route')`; a 404 does not.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement**, then wire `useSheetSteps` into the seven sheets (call `saved()` in the success step of the save).
- [ ] **Step 4: Run the new tests and the existing test file of each touched sheet, then `npm run typecheck`, expect PASS.**
- [ ] **Step 5: Commit** `git commit -m "Insight: screen views, refusals, slow steps, screen errors and sheet steps"`

### Task 5: The server sender

**Files:**
- Create: `server/core/insight.ts`
- Modify: `server/core/ports.ts` (`Config.posthogKey?: string`), `server/core/deps.ts` (`serverEnvFrom` reads `POSTHOG_KEY`; `depsFrom` wraps the logger when the key is set, with `env` from `insightEnv(new URL(config.appUrl).host)` or the field that holds `APP_URL`), `server/core/runCall.ts:292` (add `personId` and `agentId` of the request to the fields of "A call failed."), `scripts/deploy/secrets.ts` (`POSTHOG_KEY` in `FUNCTION_SECRETS`; when present it must match `^phc_[A-Za-z0-9_-]{20,}$`, error text names the variable only)
- Test: `server/core/insight.test.ts`, `scripts/deploy/secrets.test.ts`, the existing test of `deps.ts` that reads the env

**Interfaces:**
- Consumes: `scrubText`, `insightEnv` (Task 1); `requestHost` (`server/core/after.ts`).
- Produces: `POSTHOG_CAPTURE_URL`, `SERVER_SENDS_PER_MINUTE = 60`, `insightLogger(log: Logger, o: { key: string; env: 'production' | 'test'; fetch?: typeof fetch; keep?: (work: Promise<unknown>) => void; now?: () => number }): Logger`.

- [ ] **Step 1: Write the failing tests.**
  - "logs first, then sends one $exception": the inner logger gets the same line; the fetch gets `POST POSTHOG_CAPTURE_URL` with `api_key`, `event: '$exception'`, `distinct_id` = `personId` or `'madar-server'`, and properties `$exception_list[0].value` (the scrubbed message and error text), `$exception_source: 'server'`, `call`, `personId`, `agentId`, `env`, `$process_person_profile: false`; the body holds no key named `input`.
  - "keeps the send off the answer": the fetch promise goes to `keep`, and `error()` returns before it settles.
  - "drops a failed send": a rejecting fetch and a 500 answer throw nothing and send nothing again.
  - "caps the sends": the 61st error inside one minute (fake `now`) sends nothing; the first error of the next minute sends.
  - `info` and `warn` never send.
  - `secrets.test.ts`: a file with a wrong `POSTHOG_KEY` shape is refused by name; a file without it passes.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** The default `keep` is `(work) => requestHost().after?.(work)`. Check the `$exception` shape against the PostHog docs ("capture an exception through the API"; use Context7) and write what you found in the report.
- [ ] **Step 4: Run the tests, then `npm run typecheck`, expect PASS.**
- [ ] **Step 5: Commit** `git commit -m "Insight: server errors go to PostHog after the answer"`

### Task 6: The words, the Settings line, the privacy page and What's new

**Files:**
- Create: `src/i18n/real/insight.en.json`, `src/i18n/real/insight.ar.json` (keys `insight.title` "Usage data" / «بيانات الاستخدام», `insight.body` with the exact text of spec section 8)
- Modify: `src/features/settings/SettingsScreen.tsx` (one last `Section` with the title and the one paragraph, no control), the Me hub (`src/features/me/MeScreen.tsx` or `OfficeGroup.tsx`: the same paragraph at the end, quiet text), `public/privacy.html` (one short part in English and one in Arabic: what Madar records, what it never records, PostHog Cloud EU in Frankfurt, only the office owner sees it, replays kept 30 days), `src/whatsNew/entries.ts` and the What's new word files (one entry with the text of spec section 8; its id above every id on main and on each open `rb/*` branch, sorted as numbers; `day` is today, the lead fixes it at the release)
- Test: `src/features/settings/SettingsScreen.test.tsx`, the Me hub test, `src/app/privacy.test.ts`, `src/whatsNew/entries.test.ts`

The line shows in both builds (it describes the real Madar; my call).

- [ ] **Step 1: Write the failing tests:** Settings shows the title and the body in English and in Arabic; the Me hub shows the body; the privacy page names PostHog and Frankfurt in both language parts; the What's new entry exists by its id.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** Use the existing `Section` and tokens; no new style.
- [ ] **Step 4: Run the tests, `npx tsx scripts/check-rtl.ts`, and the i18n tests (`src/i18n`), expect PASS.**
- [ ] **Step 5: Commit** `git commit -m "Insight: the Settings line, the privacy page and What's new"`

### Task 7: The guides and the one full run

**Files:**
- Modify: `src/CLAUDE.md` (a new section "Insight (PostHog, owner 2026-10-25)": the two modules, the start rule, the private class and its source test, the scrub, `sessionStorage`, no proxy), `server/CLAUDE.md` (one line under the logger: `insightLogger`, the cap, `POSTHOG_KEY`), `scripts/deploy/CLAUDE.md` (`POSTHOG_KEY` in the secrets list; the PostHog host in `connect-src`), `TASKS.md` (one item: built, waits for the owner's PostHog keys and the test copy check)

- [ ] **Step 1: Update the guides.**
- [ ] **Step 2: Run the full gates once, alone (no build or Playwright beside it):** `npm run typecheck`, `npm test`, `npm run build`, `npm run build:server`, then `npm run build:remote -- test` (it needs the sandbox off). Expected: all green; `check-bundles` prints the first-load size within its limit. If one fails, fix it and run only that gate again.
- [ ] **Step 3: Commit** `git commit -m "Insight: the guides and the task list"`
- [ ] **Step 4: Finish the report** (`REPORT-posthog.md`): each task, the test counts, the first-load size before and after, every PostHog option name that differed from the plan, and anything left open. Give the same text as the final message.
