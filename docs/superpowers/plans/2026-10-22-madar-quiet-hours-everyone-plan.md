# Batch B: quiet hours (fbk_048) and @everyone (fbk_041)

Owner: Osama, 2026-10-22. Lead: Claude (Opus). Builder: one Sonnet builder on `rb/batch-b` (`~/dev/madar-rb/batch-b`).
Both reports decide who gets a buzz, and when, so they ship together.

## The reports
- fbk_048 (Faisal): "Schedule notifications like slack, if i give comments or send messages on a weekend or weekdays after 5 i dont
  want to bother those who dont want to be bothered, make everyone choose their notification off time, instead, all notifications will
  be held and only come when their time on comes, the default setting should be set by admins and a setting to prevent users from
  turning off notifications during a period of time in weekdays, like 9 to 5 for example".
- fbk_041 (Osama): "Allow mentioning everyone with @everyone or @all in groups and projects chats and tasks chats, and ensure the
  mention sends a notification to the mentioned".

## Owner decisions (2026-10-22, all final)
1. A person sets **work days** (default Sunday to Thursday) and **one time range** (default from the office). Outside it, Madar is
   quiet for that person. A person may also turn quiet hours off (always notify).
2. In quiet hours Madar sends **no push and no email**. The bell and the Inbox still collect everything. When quiet hours end, the
   person gets **one push** with the fixed line ("You have something new in Madar." / «لديك جديد في مدار.»). The things of the quiet
   hours **never send an email**, also not later.
3. **The Admin lock** is on by default: Sunday to Thursday, 9 AM to 5 PM. Nobody can be quiet inside it. The Admin changes its days
   and hours, or turns it off. The Admin also sets the **office default** work days and range.
4. **Release day:** the office default applies at once to every person who did not choose (quiet outside Sunday to Thursday, 9 AM to
   5 PM). A What's new line says how to change it.
5. **The morning summary** moves from 07:30 to the start of each person's work range, on the person's work days only.
6. **@everyone** names: in a group, all members; in a project chat, the project team (the leader and the team members); in a to-do
   thread, the people of the to-do (the lead, the helpers, the maker and the project leader; an office to-do has no leader).
   Never the sender, never a turned-off person, never a person who cannot open that chat or thread.
7. **@everyone gives the bell notice and the push, never an email** (Resend free plan: 100 emails a day).
8. **A right switch** "Mention everyone", on by default for every role. Every new power is a switch (role rights version 2).
9. Lead's calls (not asked, keep them): the typed words `@everyone`, `@all` and `@الجميع` work the same as the pick from the mention
   list (the owner's own words name @everyone and @all). Hours go in 30-minute steps (the job runs every 15 minutes).

## Design

### Quiet hours: data
- `Preferences.workHours` (optional): `{ quiet: boolean, days: Weekday[], from: Clock, to: Clock }`. `Weekday` is 0 (Sunday) to 6
  (Saturday), at least one day. `Clock` is `HH:MM` on a 30-minute step, `from` before `to` (no range over midnight). A missing value
  means the office default with `quiet: true`.
- `Settings.workHours` (optional): `{ days, from, to, lock: { on: boolean, days, from, to } }`. A missing value means the built-in
  default: days Sunday to Thursday, 09:00 to 17:00, lock on with the same days and hours. Keep the default in one constant.
- A person's range must cover the lock while the lock is on: the person's days hold every lock day, `from` is not after `lock.from`,
  `to` is not before `lock.to`. `me.updatePreferences` refuses a range that does not cover the lock (reason `work_hours_lock`, a
  sentence in the words). `quiet: false` is always allowed. When the Admin moves the lock later, a stored person range that no longer
  covers it is not changed: the rule below adds the lock at read time.
- One pure module `src/lib/quietHours.ts` (no zod, no React; the server and the screens share it), on Riyadh time through the helpers
  of `src/lib/dates.ts` (`officeClock`):
  - `workHoursOf(preferences, settings)`: the effective range of the person.
  - `isQuiet(preferences, settings, at)`: true when `quiet` is on and `at` is outside the person's range AND outside the lock (when on).
  - `workStartOn(preferences, settings, day)`: the start of the person's range on that Riyadh day, or null on a day off (for the summary).
  - Tests with fixed clocks: a weekday evening, Friday, the minute of `from` and `to`, a lock wider than the person's range, `quiet: false`.

### Quiet hours: push
- The two push effects (`sendPushNotify`, `sendChatPush`, `server/push/notify.ts`) check `isQuiet` for the person at send time (after
  the 10-second wait of a chat push). A quiet person gets no post: the effect marks the person's devices held (`heldAt` in the device
  doc, the same private rows the effect already writes: no event, no `chg`, no signal) and ends the row as done (no retry).
- A new step of the 15-minute job (`server/jobs/steps/`, next to `summary.ts`): for each person with a held device who is no longer
  quiet, send ONE push with the fixed line to each device, then clear `heldAt`. Skip the push (and still clear) when the person has
  nothing unread any more (no unread bell notice and no unread chat or thread; the person read it at night). Retry rules as today.
- Both data paths: Postgres and the SQLite office object (`chatFacts.ts` shows the pattern of two SQL texts and the lite tests).

### Quiet hours: email
- The notice mail effect and the chat notice mail (`mail.chatNotice`, `server/mail/`) send nothing for a person who is quiet at send
  time: the row ends as done with no mail, and `release()` gives the quota place back. No email ever goes later for it.
- The morning summary (`server/jobs/steps/summary.ts`, `SUMMARY_START` 07:30) goes per person at `workStartOn` of the person, on the
  person's work days only, at the first run of the 15-minute job at or after that time. The idempotency key `summary-<day>-<person>`
  stays, so a second run never sends twice. A person with `quiet: false` still has a range (the stored one, else the office default):
  use its start. Keep "the mail goes only when something is past due, due today, or a review waits". Update `server/mail/CLAUDE.md`.

### Quiet hours: screens
- Settings, a new section "Quiet hours" right after the push section (`QuietHoursSection.tsx`, words in the batch word files). One
  switch "Quiet outside my work hours" (on by default), then "Work days" (one group of seven small day toggles, the week from Sunday
  in both languages), then "From" and "To" (selects of 30-minute steps from 06:00 to 23:30, on the 12-hour words of `clockFormat`). One
  line under it: "In quiet hours Madar sends no push and no email. The bell keeps everything." When the lock is on, one more line names it
  ("Your office keeps notifications on Sunday to Thursday, 9 AM to 5 PM.") and the choices that would break it are not offered (days
  of the lock stay ticked and locked; times stay outside the lock). Each change saves at once with `me.updatePreferences` and a toast,
  as `AdminReachSection` does. With the switch off, the day and time controls hide.
- Admin, the office settings section (the `office.settings` right): a block "Work hours" with the office default (days, from, to) and
  "Keep notifications on" (a switch, days, from, to). `settings.update` takes `workHours`. A save that would leave the default range
  outside the lock is refused with a sentence.
- The prototype saves the choices (shared calls) and has no push or email.

### @everyone
- `src/lib/text.ts`: `mentionsEveryone(body)`: true when the body holds `@everyone`, `@all` or `@الجميع` as a whole word (start of the
  text or a space before the `@`; a space, the end or a mark of the sentence after it; English case does not matter). An email address
  like `x@all.com` is no match. Tests in both languages.
- The audience (`everyoneOf`, one function for chats and comments, in `src/api/handlers/`): a group: its members; a project chat: the
  leader and the team of its project; a to-do thread: the lead, the helpers, the maker and the project leader of the task (an office
  to-do: the maker, the lead, the helpers). Then the rules of `namesIn`: active people who can open the chat or the thread, never the
  sender. The person who writes must hold the new switch; without it the words stay plain text and name nobody.
- Chat messages (`postMessage`, the edit, the restore in `src/api/handlers/chats.ts`) and task comments (`src/api/handlers/content.ts`):
  the everyone people join `mentions` (so the bubble marks "names you" for each, and `planPushes` pushes them as named people), and get
  ONE mention notice each with a new flag `everyone: true` (a person named by name too gets one notice, not two). An edit that adds the
  words names the people for the first time only, as `first()` does today. The notice flag is optional in the contract (additive).
- Email: a notice with `everyone: true` sends no mail (`NEW_NOTICES_SQL`, the SQLite reader, `emailOn` or its neighbour; a test).
- The bell sentence: "<name> mentioned everyone in <chat>" (`src/lib/noticeSentence.ts`, shared with the push line; words in English
  and Arabic, the `_female` forms in Arabic). The push line uses the same sentence.
- The mention list (`src/components/MentionField.tsx`): an "Everyone" row first when the typed letters fit `everyone`, `all` or
  `الجميع` (or nothing is typed yet), with the count of people ("Everyone · 6 people"), only where the person holds the switch and the
  place is a group, a project chat or a to-do thread (never a direct chat). The pick puts `@everyone` (English screens) or `@الجميع`
  (Arabic screens) into the box. The bubble draws the three words as a mention chip (`RichText`, `segmentsOf`).
- The right: one new power in the Chat section of the catalog, a basic switch, on for every built-in role (Member, Management,
  Accounting; the Admin holds all). Change `docs/superpowers/specs/2026-10-21-madar-role-rights-v2-catalog.json` and its plain copy
  `src/api/rightsCatalog.ts` together, the count lines (112 becomes 113; each role count grows by one), the role sheet words, and every
  test that pins a count (run the tests and read the real numbers; never add deltas by hand). Defaults: nobody loses a power.

### Leak tests (root rule: a feature that reaches people by a rule gets probes from its builder)
- @everyone in a group never reaches a person outside the group (notice, push row, mentions list, error text, Realtime signal).
- @everyone in an office to-do thread never reaches the project leader of another project or any person outside its people.
- @everyone in a project chat by a holder of `chat.project.all` who is not on the team reaches the team only.
- A turned-off person and the sender are never in the list.
- A person without the switch: the words name nobody, and the answer tells nothing about who would have been named.

### MCP (owner rule: every feature change updates the MCP side in the same commit)
- `server/mcp/docs.ts` `TOOL_DOCS`: `chats.send` and `comments.create` say that `@everyone`, `@all` or `@الجميع` names everyone of the
  chat or the to-do thread (who that is, per kind), only when the person holds "Mention everyone", with a bell notice and a push, never an
  email; and that people in quiet hours get the push when their quiet hours end. `INSTRUCTIONS` (`madar.readFirst`): one short rule line
  on quiet hours (the push and the email of a person in quiet hours wait, and an email never comes for them).
- `me.updatePreferences` and `settings.update` stay on the deny list: only a person sets quiet hours, only the Admin sets the office.
- The new right is not an AI tool group: check that the AI section of the catalog needs no line.

### What's new
Ids from `2026-10-23-25` upward. (a) Quiet hours: no push or email outside your work hours, with the one push when they end, and where
to change them. (b) @everyone and @all in groups, project chats and to-do threads. (c) The morning summary now comes at the start of your
work hours. English and Arabic (Thmanyah style).

## Tasks (tests first in each)
1. `src/lib/quietHours.ts` and its tests. The contract: `Preferences.workHours`, `Settings.workHours`, the notice flag `everyone`, the
   reason `work_hours_lock`. The calls `me.updatePreferences` and `settings.update` take the new fields with the lock rules.
2. The push hold: the effects check, `heldAt`, the job step of the quiet end, both data paths, tests (Postgres-shaped SQL texts are
   tested the way `chatFacts` tests them; the lead runs the Docker suites).
3. The email hold and the morning summary per person, tests (`summaryTasks.test.ts`, `summaryBrief.test.ts` show the pattern).
4. @everyone on the server: `mentionsEveryone`, `everyoneOf`, chats and comments, the flag, no mail, the right switch with the catalog,
   the leak tests above.
5. The screens: the Quiet hours section, the Admin block, the mention list row, the chip, the bell sentence; words; screen tests.
6. MCP docs and `INSTRUCTIONS`, What's new, the guides (`server/push/CLAUDE.md`, `server/mail/CLAUDE.md`, `src/CLAUDE.md`,
   `src/api/CLAUDE.md`, `server/mcp/CLAUDE.md`) where a line becomes wrong or a new rule starts.

## Checks the builder runs
The touched and new test files (`--no-file-parallelism --testTimeout=60000`), `npm run typecheck`, `npm run build`,
`npm run build:server`, and `npm run build:remote -- test` with the sandbox off. Not the full `npm test`, not Docker, not Playwright:
the lead runs the full suite, `test:db`, `test:it` and `test:mcp` once at the merge.
