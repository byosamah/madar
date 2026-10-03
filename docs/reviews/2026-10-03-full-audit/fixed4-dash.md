# Wave 4, group "dash": Dashboard and meeting

Branch w4-dash in /Users/osamakhalil/dev/madar-w4-dash. Last commit e730c9e. Full suite: 156 files, 1577 tests pass (10 new). `tsc --noEmit` passes. `node scripts/check-rtl.ts` passes.

F-18 | fixed | df40239 | A new task in the meeting summary, the copied table and the chat message now reads as the panel shows it, "Action: <title> · <person> · <Tue 6 Oct>" (Arabic "إجراء: ..."), through one shared helper (`meeting/actionLine.ts`); a task with no due date leaves the date out.
F-21 | fixed | 97a9eb1 | Skip now shows the Undo toast "<project> moved to the end of the agenda." ("نُقل <project> إلى آخر جدول الأعمال."), and Undo puts the project back in its old place, removes the Skipped mark that Skip added, and shows it again.
F-5 | fixed | e730c9e | Below 640 px the meeting shows the project screens only: the View choice hides and a `?mode=timeline` link opens the project screens; the earlier, Today and later buttons now wrap as one piece, so the Arabic arrows stay on one row (they split at 820 and 900 px before).
F-10 | fixed | d4ff4db | The workload cell label takes its task count from a new plural key `dashboard.cellTasks`, so it says "1 task" ("مهمة واحدة", "مهمتان", "لا مهام" in Arabic).
F-14 | fixed | 51b8a52 | The Leader list now shows only the people who lead a project in the status the numbers count ("All statuses" means active and paused), and a leader from the link stays in the list so the choice stays visible.

Notes:
- F-18: a reply task made from the Tracker during the meeting also reads as an Action line now, because the meeting panel already lists it as one. One older summary test changed its expected line for this reason.
- F-18: an Action line shows no name in front of it, as in the panel. The person who added it stays in the Who column of the copied table.
- F-5: this replaces the BRW-18 choice "a mode in the link still wins on a phone". That was a fixer's choice, not an owner decision. Its test now checks the new rule.
- Browser check (Playwright, `npx vite` on port 5394, fonts allowed): 24 of 24 checks pass in English and Arabic, with no console errors. Note: with the linked node_modules, a plain `npx vite` in a worktree answers 403 for the web fonts. The check used a scratch config that allows that folder.

## Questions for the owner

1. The meeting Timeline between 640 and about 900 px wide (a tablet, or a narrow laptop window): the name column keeps 384 px, so the stage bars get only 110 px at 640, 190 px at 720 and 290 px at 820. In Arabic the month labels overlap there. Should the meeting offer Projects only below 1024 px too, or should the name column get narrower below 1024 px (for example 10 to 14rem) so the bars get more room? Screenshots: `f5-ar-640-meeting-timeline-header.png`, `f5-ar-720-meeting-timeline-header.png`.

## Screens that changed

Screenshots are in `audit/final/shots/w4-dash/`.

- `#/dashboard`, press Filter: the Leader list shows Any leader, Faisal, Hala, Omar and Reem only. With `?view=schedule&status=on_hold`, it shows the leaders of the paused projects.
- `#/dashboard?view=people`: the screen-reader label of a one-task cell ends "1 task" (nothing changes on screen).
- `#/dashboard/meeting?mode=projects`, press Skip: the toast "<project> moved to the end of the agenda." with Undo (`f21-en-skip-toast.png`, `f21-ar-skip-toast.png`).
- `#/dashboard/meeting?mode=projects`, add an Action in Decisions, then Agenda, then "See the meeting summary": the line "Action: <title> · <person> · <date>" with no name in front (`f18-en-summary-action.png`, `f18-ar-summary-action.png`). "Copy as a table" and "Share to the project chats" use the same words.
- `#/dashboard/meeting?mode=timeline` at 360 and 390 px, English and Arabic: the project screen with no View switch (`f5-en-390-meeting-timeline-link.png`, `f5-ar-390-meeting-timeline-link.png`).
- `#/dashboard/meeting?mode=timeline` in Arabic at 820 and 900 px: the earlier arrow, Today and the later arrow sit on one row.

## Repair

F-18 review (copied table, Who column) | Fixed | c62b5fb | The meeting form calls the person of an action "Who", but the copied table put the person who added the action in its Who column. Now an Action row puts the person of the action (the task owner) in the Who column, and the What cell keeps the full action line. The `alone` flag in MeetingSummary.tsx became an `owner` field, so the summary list and the chat message work as before. The F-18 test now expects the owner (Faisal Al-Harbi) in the Who cell, not the meeting runner (Hala Nasser).

Screen that changed: Dashboard, Meeting, Summary, "Copy as a table". Paste the table: an Action row shows the person of the action under Who.

Checks after the repair: full suite 156 files, 1577 tests pass; `npx tsc -p tsconfig.json --noEmit` passes; `node scripts/check-rtl.ts` passes.
