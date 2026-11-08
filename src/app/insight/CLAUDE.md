# Insight (PostHog)

The owner sees how the team uses Madar, which errors they hit and replays of the screen. Design:
`docs/superpowers/specs/2026-10-25-madar-posthog-insight-design.md`.

## Rules
- Two modules. `index.ts` is in the first load and holds no PostHog code: `startInsight` (called in the idle step of `startIdlePrefetch` in
  `main.tsx`) and the forwarders `reportError`, `noteSlow` and `noteSheet` (in `notes.ts`, which imports nothing big, so `RouteError`,
  `bootstrap.ts` and the sheets import it with no import cycle). `client.ts` is a lazy chunk. Only `client.ts` imports `posthog-js`.
- The start rule: the real build only (`index.ts` folds `import.meta.env.VITE_MADAR_API === 'remote'` itself, so the prototype holds no
  PostHog code), the public key `VITE_POSTHOG_KEY` in `config/remote.<env>.env` (optional: with none, nothing starts), a signed-in person, and
  an address behind the gate (`screensAt(path, true).gated`). A sign-out stops it (`stop()`); the next sign-in starts it for the new person
  (`init` runs once). A failed import stays quiet and never reloads the page. `check-bundles.ts` fails when `$snapshot_data` reaches the
  first load, or `$snapshot_data` or `relay.madar.vado.sa` reaches the prototype.
- Madar enterprises (design 5.16): usage events and screen replays go to PostHog for VADOs' Companies only (`usageAllowed`, `src/lib/enterprise.ts`;
  `VADO_ENTERPRISE` equals `ENT_VADO`, pinned by a server test). The enterprise id comes from the `session.get` answer (`enterprise.id`, read by
  `personOf` in `index.ts` into `InsightPerson.ent`). The lazy client (`createInsightClient`) starts nothing, not even PostHog, until that answer is in the
  cache. A session that names no enterprise counts as "not allowed" (the rule fails closed). An answer older than the last sign-out is not taken for the next person.
  `posthogOptions` takes a required `usage: () => boolean`. With false, `before_send` drops every record except `$exception`, the recorder stops, and the screen
  watcher (`watchRoutes`) does not start. The call watcher stays on, because it reports the bugs of a call as error records. An `$exception` of another enterprise
  gets `ent` and `personId` and never `personName`. Every record of a person with an enterprise gets the property `ent`. `index.ts` is in the first load: keep the
  rule in `client.ts`. The server side: `server/enterprise/CLAUDE.md`, "Logs and PostHog".
- Names (owner, 2026-10-25 and 2026-10-28): only an `$exception` record carries `personId` and `personName` (added in `before_send`; `personName` only when usage is allowed). An
  action carries none: screen views, clicks, slow steps, refusals, failed calls (`madar_call_failed`) and sheets. `eventFields.test.ts`
  pins the fields of every event that `src/app/insight/` captures; a new event needs its line there.
- `madar_call_failed` carries the call name and the cause (chat, 2026-11-08; the failed calls happen only on iPhone): `status` (the HTTP status,
  when there is one), `kind` (`network`, `timeout`, `server` or `refused`; a 4xx status is `refused`, an entry with no status is `server`),
  `offline` (`navigator.onLine === false`) and `via` (`page` for the own `/api` of the page, `direct` for the function address). `causeOf`
  (`watch.ts`) reads numbers and fixed words of `ApiError.details` only (`remote/errors.ts` puts `status`, `cause` and `via` there). It never
  reads the message or a reason text, so no word that a person wrote can leave.
- `posthogOptions` (`client.ts`) holds the privacy rules and `client.test.ts` pins them. `before_send` runs `scrubEvent` (`scrub.ts`), which
  fails closed (a record it cannot read is dropped). `src/lib/urlScrub.ts` keeps the pure parts, shared with the server.
- Put `PRIVATE` (`privateMark.ts`, `ph-no-capture`) on the smallest element that holds a chat message, an amount of money, or a file picture or
  link. `privateMark.test.ts` is a source test: a new file that calls `useFileLink`, `useScreenshotLink`, `useFileUrl` or `amountText` without
  `PRIVATE` fails it. Put the class on a new place of the same kind.
- A new main sheet adds its name to `SheetName` and calls `useSheetSteps(name, open)` (`sheetWiring.test.ts`).
- The page sends to PostHog through the free managed proxy of PostHog on `https://relay.madar.vado.sa` (`POSTHOG_HOST`, 2026-11-08), so an
  ad blocker does not stop it. It is a CNAME of vado.sa (the DNS is in the owner's Vercel team) to `52398457ceaf413c2690.cf-prod-eu-proxy.europehog.com`;
  PostHog keeps the certificate (`proxy-get` of the PostHog MCP gives the status). It uses no Cloudflare request quota, so still no proxy
  through the Pages Functions (the replay packets could use the free quota). The CSP names only this host in `connect-src`. The server
  (`server/core/insight.ts`) still posts straight to `eu.i.posthog.com`: no ad blocker sits on a server. The team sees one line in Settings (`UsageDataSection`) and in the Me hub (`UsageDataNote`).
- Read a web vitals row with care (tsk_487, 2026-10-28). `$web_vitals` CLS is the worst 5 s burst of the whole tab, and the row carries the
  path at the moment of the report, not the screen that shifted. A tab that stays open keeps one `$web_vitals_CLS_event.id` across days
  (the 0.82 row of `/work` shared its id with a row of the day before, and `navigationURL` was `/`). The events hold no element name, so a
  poor score cannot name a screen. Measured on 2026-10-28 (Playwright, `PerformanceObserver` `layout-shift`, 1280 and 1423 px): the
  prototype and the real build on the local office show 0 shift on `/work` for a cold load, a load from Home, a 300 ms network delay,
  a row hover, a task panel, the List and Board views, a hidden and visible tab and the 60 s pass. To name the element, a later task may set
  the web vitals attribution option of posthog-js, after a check of the privacy rules (`client.test.ts`).
