# Madar insight with PostHog: design

Date: 2026-10-25. Owner: Osama. Status: approved by the owner on 2026-10-25 ("go ahead").

## 1. Why

The owner wants to know how the team uses Madar, which errors they hit, and where they get stuck. With that data, he
fixes problems faster, makes the hard steps easier, and later hides or removes the features that nobody uses.
AI agents (Claude) must read the same data, so the owner can ask "which features does nobody use?" or "what did the
person do before this error?".

Today Madar loses this information:
- A broken screen shows the calm page of `src/app/RouteError.tsx`, and nobody else learns about it.
- The server writes errors to the function logs (`consoleLogger` in `server/core/deps.ts`). The Supabase free plan
  keeps these logs for about 1 day.
- The History records each change (who, what, when), but no screen open, no button press, and no slow step.
- The feedback button (`src/features/feedback/FeedbackSheet.tsx`) depends on a person who stops to write a report.

## 2. Owner decisions (2026-10-25)

1. **The team sees nothing new while they work.** No pop-up, no ask, no slowdown. One line in Settings and one What's
   new entry tell them what Madar records (text in section 8). The owner turned down a fully secret version.
2. **Errors carry the name of the person. Actions carry no name.** An action is a screen open, a button press, a slow
   step or a refusal.
3. **Depth:** screens, buttons, slow steps, steps that people stop halfway, and screen replays.
4. **The data lives outside Madar's database,** on PostHog Cloud EU (Frankfurt), on the free plan, with no card.
   The owner turned down Hotjar (its parent Contentsquare bought the Israeli company Clicktale) and Microsoft Clarity
   (a BDS priority boycott target).
5. **A replay hides all typed text, every chat message and every amount.** Typed text shows as stars. A chat message,
   an amount and a file picture show as a gray box (section 5 says why). Task names, project names and the rest of the
   screen stay readable, so a replay makes sense.
6. **The hide or remove of features comes later,** one feature at a time, after the data shows what to hide. This build
   does not add feature switches.
7. **No Sentry and no error alerts in this build** (section 12).

## 3. Goals, non-goals, anti-goals

Goals:
- Every screen error and every server error reaches PostHog, with the person, the screen and the replay.
- The owner can count the use of each feature: each screen, each project tab, each main sheet.
- The owner can see slow steps and the sheets that people open and close without a save.
- Claude reads all of it through the PostHog MCP server.

Non-goals:
- No feature switches and no new Admin screen (decision 6).
- No new Madar call, no new table, no migration.
- No data from the prototype build (`VITE_MADAR_API=fake`).

Anti-goals (a failure even if it works):
- The team feels it: a slower first screen, a slower chat, a pop-up, or a cookie banner.
- A replay or an action shows typed text, a chat message, an amount, a password, a token or a signed file link.
- PostHog sends a bill, or Madar breaks when PostHog is down or blocked.
- A record carries the auth token or the body of an API call.

## 4. What Madar sends

All of it goes to one PostHog project. Every record carries `env` (`production` on `madar.vado.sa`, else `test`) and
the build version (`VITE_MADAR_BUILD`).

| Record | When | Name of the person |
| --- | --- | --- |
| Screen view | each route change; the screen name comes from `screensAt(pathname)` in `src/app/routes.tsx`, plus the `tab` of a project page | no |
| Button press | PostHog autocapture of clicks | no |
| Sheet open, save, close without save | the main sheets: new project, new task, new office task, payment, meeting, Tracker log, feedback (the builder may add more) | no |
| Slow step | a batch request of `RemoteApi` that takes 2 s or more, with the call names and the time; plus the PostHog web vitals | no |
| Refusal | the server says no with a reason (for example `needs_lead`, `week_locked`); the call name, the code and the reason only | no |
| Call failure | a call that ends with the code `failed` (a server fault, a lost network, a timeout); the call name only (owner, 2026-10-28) | no |
| Screen error | `window.onerror`, `unhandledrejection`, and the error of `RouteError` | yes |
| Server error | each `error` line of the server logger, on the Supabase functions and on the Worker | the person id (and the agent id for an MCP call), when the line has one |
| Replay | the screen of each visit after sign-in | no name tag; an error in the same visit links to it |

"Name of the person" on the screens means the Madar person id and the English display name, as properties of the
error record only. Madar never calls PostHog `identify`, and uses `person_profiles: 'identified_only'`, so actions stay
anonymous (and cheaper). In an office of 15, a replay can still show who it is. Only the owner sees the replays.

## 5. Privacy rules (the builder tests each one)

1. **One class hides a private part:** `ph-no-capture`, as the constant `PRIVATE` in `src/app/privateMark.ts`. PostHog
   leaves such a part out of the click records, and the replay draws a gray box of the same size in its place (it
   records no text and no attribute inside it). One class does both jobs, so no text of a chat message reaches PostHog
   through a click either. That is why a private part is a gray box and not stars.
2. **What carries the class:** every written body that `RichText` draws (chat messages, to-do comments and project
   posts; the posts are my call: one rule for all written text), every other place that shows the words of a message
   (the Inbox row preview, the reply quote and the reply strip, the Search message hits, the message sheet preview, the
   excerpt of a notice), every amount of money, and every picture or link of a file (`useFileLink`,
   `useScreenshotLink` and the `ImageViewer`). A file picture holds client work, and its signed link must never reach
   PostHog.
3. **Inputs** show as stars (`maskAllInputs: true`). Passwords are always masked.
4. **No network capture, no headers, no bodies, no console** in replays. Network timing is off too: the signed file
   links carry their signature in the request address. The web vitals stay on.
5. **URLs lose their query and hash** before they go out (`before_send`), except the `tab` of a project page. The
   same scrub runs on the address of each replay and on any address inside an error message.
6. **No PostHog before sign-in.** The sign-in, welcome, forgot, reset and OAuth consent screens load nothing. Sign-out
   stops the replay and resets PostHog.
7. **No lasting device id.** PostHog keeps its ids in `sessionStorage`, so a new tab is a new anonymous visitor and no
   id follows a person across days.
8. **Errors carry no call input.** A server error sends the message, the call name and the person id. A screen error
   sends the message and the stack. Never the zod input, never the text a person wrote.
9. **The client IP is discarded** (a PostHog project setting, "Discard client IP data").
10. **The AI agents' MCP calls make no actions.** Only their server errors go out (rule 8 holds).

## 6. How it works

Screens:
- `src/app/insight/` owns PostHog. Only its lazy client file imports `posthog-js`.
- It starts only in the real build: the module folds the flag `import.meta.env.VITE_MADAR_API === 'remote'` itself, as
  `main.tsx` does, so the one-file prototype build holds no PostHog code. It also needs the public key
  (`VITE_POSTHOG_KEY` in `config/remote.<env>.env`) and a signed-in person.
- It starts in the idle step of `startIdlePrefetch` (`main.tsx`), after the first screen shows its data. The first load
  of the remote build must stay under the `check-bundles` limits, and Home must stay instant.
- It loads `posthog-js/dist/module.full.no-external` (the full library with the replay recorder, the web vitals and
  the error capture inside it), with `disable_external_dependency_loading: true`. No script loads from another host.
- The security policy (`config/headers.template`) adds `https://eu.i.posthog.com` to `connect-src`. Nothing else.
- Every call into PostHog sits in a `try`. If PostHog is down, blocked by an ad blocker, or over its free limit, Madar
  works as before and shows nothing.
- The data goes straight to PostHog, with no proxy through Madar's Pages Functions (my call). A proxy beats ad blockers,
  but replay packets every few seconds from 15 people could use most of the Cloudflare free plan of 100,000 requests a
  day, which Madar's own `/api` and `/mcp` need. A person with an ad blocker sends nothing: accepted.

Server:
- The server reads `POSTHOG_KEY` (the same public key) from `secrets/<env>.env`, which `scripts/deploy/secrets.ts` gives
  to the functions and to the Worker. With no key, nothing changes.
- The logger's `error` level also sends one `$exception` record to `https://eu.i.posthog.com/i/v0/e/`. The send goes
  through `requestHost().after` (`server/core/after.ts`), so the answer never waits on PostHog. A failed send is
  dropped, never retried, and never throws. This is not a database write, so the outbox rule does not apply.

AI agents:
- The owner connects the PostHog MCP server to his Claude (Claude Code and claude.ai) with a PostHog personal API key.
  The key lives in `.env.local` only, never in chat.
- No Madar MCP change: this build adds no Madar call and no new rule for agents.

## 7. Free plan and limits

The PostHog free plan, each month: 1,000,000 events, 5,000 replays, 100,000 errors. Replays are kept 30 days, events
1 year. The free allowance resets on the 1st.

Estimate for 15 people: about 130,000 events (13%) and 2,000 to 4,500 replays (the tight one).
- The account has no card, so PostHog cannot bill.
- Replays shorter than 5 seconds are dropped (the PostHog minimum duration setting). This cuts the quick phone checks.
- If a month runs out, PostHog stops until the 1st. Madar does not change.

## 8. Words (English and Arabic keys)

Settings (desk) and the Me hub (phone), one short section at the end, for every person:
- EN: "Madar records how people use it, the errors they hit, and replays of the screen, so we can fix problems and
  improve it. It never records what you type, chat messages or amounts. An error carries your name, so we can ask you
  about it. Only the office owner sees this data."
- AR: «يحفظ مدار كيف تستخدمه، والأخطاء التي تظهر لك، ومقاطع من شاشتك، لنصلح المشاكل ونحسّن التطبيق. لا يحفظ ما
  تكتبه، ولا رسائل المحادثة، ولا المبالغ. يحمل الخطأ اسمك لنسألك عنه. يرى هذه البيانات صاحب المكتب فقط.»

What's new (one entry, in `src/whatsNew/entries.ts` and the What's new word files, dated on the production day):
- EN: "Madar now records errors and how people use it, so we fix problems faster. It never records what you type, chat
  messages or amounts. Details in Settings."
- AR: «صار مدار يحفظ الأخطاء وطريقة استخدامه، لنصلح المشاكل أسرع. لا يحفظ ما تكتبه، ولا رسائل المحادثة، ولا المبالغ.
  التفاصيل في الإعدادات.»

The public privacy page (`public/privacy.html`, English and Arabic) gets one short part with the same facts, and names
PostHog and its EU cloud in Frankfurt.

## 9. Owner steps (outside the repo)

1. Make a PostHog account in the **EU** region (eu.posthog.com) with the office email. Add no card.
2. Add the project key (it starts with `phc_`) to `.env.local` as `POSTHOG_KEY`. Claude copies it to the two
   `config/remote.*.env` files and the two `secrets/*.env` files (it is a public key).
3. Make a personal API key, add it to `.env.local` as `POSTHOG_PERSONAL_KEY`, and connect the PostHog MCP server.
4. Turn on "Discard client IP data" and the 5-second replay minimum (or let Claude set them through the API).

## 10. Checks

- Unit tests: no PostHog in the fake build; no PostHog before sign-in; the URL scrub; the private class on every place
  of rule 5.2 (a source test fails when a new file uses a file link without it); the server sender drops on failure and
  never throws; error records carry the person, actions do not.
- Bundle: `check-bundles` passes, the first load does not grow, and it fails when PostHog code reaches the first load
  or the prototype.
- Live check on the test copy: one replay shows stars for typed text and gray boxes for a chat message, an amount and
  a file preview; one forced screen error and one forced server error arrive with the person.
- Speed: Home and the Inbox open as fast as before on the test copy (desktop Chrome and iPhone Safari).
- Screenshots of the Settings and Me line: English and Arabic, light and dark, 390 px.
- What's new entry, dated on the production day.

## 11. Left to the builder

- The PostHog options that implement section 5, checked against the installed `posthog-js`.
- The full list of main sheets in section 4 (start with the list there).
- Where the Settings section and the Me line sit, with the existing `Section` component and the design tokens.

## 12. Later (not in this build)

- Hide or remove features, one at a time, once the data shows what nobody uses. PostHog feature flags (1,000,000
  free requests a month) are one way; Madar's own Admin switches are another. The owner decides per feature.
- PostHog dashboards: Claude can make them through the MCP server when the owner asks.
- Sentry: not added (owner, 2026-10-25). PostHog covers the errors, with 100,000 a month free against Sentry's 5,000,
  and links each error to its replay. Add Sentry for errors only if PostHog's error part falls short.
- Error alerts: none in this build (owner, 2026-10-25). PostHog can send one later (Slack, Teams, Discord, a web hook,
  or an email when errors jump).
