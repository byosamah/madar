# Plan: four team reports (fbk_052, fbk_055, fbk_058, fbk_059)

Date: 2026-10-25. Lead: Opus. Builders: Sonnet 5.5, one for each track. Studies (session scratchpad, read them for the details and
the `file:line` facts): `fbk/study-052.md`, `fbk/study-055.md`, `fbk/study-059.md`. The lead studied fbk_058 (below).
Release: the full checks, then the test copy. Production waits for the owner's word.

## Owner decisions (2026-10-25)

- fbk_052 (Ctrl+Z): fill the 3 gaps. Ctrl+Z and Cmd+Z also work on an Arabic keyboard; an Undo toast stays 8 s (a plain toast 5 s);
  a swipe on a notice shows a toast with Undo. No session stack.
- fbk_055 (Open space): one "Detail" control with "Show less" and "Show more", 5 steps: Sub-companies, Projects (the start), Stages,
  To-dos and deadlines, Checklists. A sub-company column. The map fits again on each resize and phone turn, and zooms up to 1.6 on a
  wide screen. Lead calls: "Milestone" is a Deadline of a project; "Sub-task" is a checklist item; the phone keeps the 2D map.
- fbk_058 (morning summary): the summary comes only on the office work days, whatever days a person sets for notifications.
- fbk_059 (Focus mode): one quiet "Project chat" button opens the chat as a panel beside the timer; closed at first; the device
  remembers the last choice. An office to-do shows its own thread. The person can write. No dot for a new message while the panel
  is closed. Under 1024 px the chat opens as a full page over Focus mode, with "Back to focus".

## Track D1: Undo and the summary days (branch `rb/undo-summary`, worktree `~/dev/madar-rb/undo-summary`)

fbk_052 (study-052, "Recommended design" and "Files to change"):
- `src/app/toasts.tsx`: the key rule runs the newest Undo when Ctrl or Cmd is down (no Shift, no Alt) and the key is "z", or the code is
  `KeyZ` and the key is not a Latin letter (an Arabic layout sends an Arabic letter). Never `code` alone: on AZERTY `KeyZ` is the W key.
  Keep the text-field guard. An Undo toast stays `UNDO_STAY_MS` (8000); any other toast keeps 5000.
- `src/features/notifications/NotificationsScreen.tsx`: a swipe that marks an unread notice read shows a toast with Undo that calls
  `notifications.markUnread` for that notice (a read mark writes no event, so `events.undoStory` cannot undo it). A swipe on a read notice
  and a tap show no toast.

fbk_058 (lead study): the summary step (`server/jobs/steps/summary.ts`) calls `workStartOn` (`src/lib/quietHours.ts`), which follows the
person's own work days. Faisal set all 7 days, so he got the email on Friday.
- Add a pure rule beside `workStartOn` (for example `summaryStartOn`): no summary on a day that is not in the office work days
  (`officeWorkHoursOf(settings).days`, Sunday to Thursday by default); on an office work day, the time of today's rule.
- The summary step uses it on both paths (Postgres and the office object; `test:lite` and `test:office` cover the second).
- Words: `mail.footerSummary` (`src/i18n/real/mail.*.json`) and `summaryHint` (`src/i18n/real/notices.*.json`) say "on the office work
  days" in place of "on your work days", in English and Arabic. Update the mail snapshots on purpose. Fix `server/mail/CLAUDE.md`.

Tests first: the key cases (Arabic key with `KeyZ` runs, AZERTY "w" with `KeyZ` does not, a text field keeps the browser undo), the 8 s
and 5 s times, the swipe toast and its Undo (also by Ctrl+Z), no toast on a read notice or a tap; the summary rule (a person with all 7
days gets no email on Friday or Saturday, gets one on Sunday at the own start; an office that adds Saturday sends on Saturday).
No MCP change. No new call.

## Track D2: the Open space levels (branch `rb/space-levels`, worktree `~/dev/madar-rb/space-levels`)

Follow study-055 sections 2, 3 (option a, F1 and F2), 5, 7, 8 and 9:
- Reproduce the owner's picture first (a window of about 2848 x 1508): the code says the first view fits 4 projects, the picture shows 8.
- The 5 steps of the stepper, the whole map at once. A tap on a card still opens or closes that card; a step change clears the taps.
- A sub-company column when the office has sub-companies, with a "No sub-company" card; no column when the link already filters one.
- Deadline cards (a small diamond, the name and the date) beside the to-dos of their stage, and under the project for a deadline with no
  stage. A new read of `deadlines.list` with the filters of the map; it already keeps the hidden-project rule; write the outsider probe.
- Checklist cards for open to-dos only, at most 12 for one to-do, then one "+N more" card that opens the to-do panel.
- Fit: a `ResizeObserver` on the map box refits to the last target after 150 ms with no change (skip a change under 10 percent); a phone
  turn uses the same path. `maxZoom` is 1 up to a 1400 px window, then grows to 1.6 at 2200 px; the first view picks as many projects as
  fit the box at that zoom (at least 3). Keep the floors of today.
- Speed: memoize the data of each card and set `onlyRenderVisibleElements`. Measure with the sample office copied 5 times (about 700
  cards): the layout under 50 ms, a tap under 200 ms. If slower, limit the two deepest steps to the first 10 projects and say so in one line.
- Words in a new pair `src/i18n/real/space2.*.json` ("Sub-company", never "entity").
No MCP change. No server change.

## Track D3: the chat in Focus mode (branch `rb/focus-chat`, worktree `~/dev/madar-rb/focus-chat`)

Follow study-059 sections 2, 7, 8 and 9, with the decisions above. The seven blocks of section 1 each get a fix and a test: Escape from
inside the panel does not end Focus; the layer order (pictures, sheets and menus show above Focus); the phone chat page is not inert under
Focus; an embedded form of the chat pane (a slim header with Close, no Back to the Inbox, no menu, no Search, no typing line, no
navigation away); no composer autofocus on a desk; the timer keeps its time when the panel opens or closes (never a new parent above it);
the draft survives a close. The chat loads lazily at the first press. The read marks follow the Inbox rule (only while the panel shows).
Words in a new pair `src/i18n/real/focuschat.*.json`. No MCP change. No server change.

## The join (lead)

1. Rebase each branch on main and fast-forward main in `deploy-test` (check `git worktree list` first: the session of `rb/posthog` may
   move main).
2. What's new, take ids above every open branch (main has 101, `rb/posthog` has 102): `2026-10-23-103` Undo, `-104` the Open space,
   `-105` the chat in Focus mode, `-106` the summary days. `day` is the planned release day; add a new day to `entries.test.ts`.
3. Gates once: typecheck, `npm test`, the prototype smoke (it builds), `build:server`, `build:remote -- test`, `test:db`, `test:lite`,
   `test:it`, `test:office`, `test:mcp`.
4. Screenshots: the swipe toast, the Open space steps (desk wide and 390 px), the Focus chat panel (desk 1440 and 1024, the phone page),
   EN and AR, light and dark. WebKit for Focus and the map.
5. `all.sh test`, then ask the owner for production. After production: the release record, the push, and the four reports done.
