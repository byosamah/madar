# Fix wave 2, Group D: Dashboard, meeting, Home and Projects list

Branch `w2-dash` in `/Users/osamakhalil/dev/madar-w2-dash`. Last commit: see the end of this file.

## Items

V-6 | fixed | 779c199 | The Home "Your projects" count now says "N projects" (Arabic "مشروع واحد / مشروعان / N مشاريع / N مشروعًا / N مشروع", zero "لا مشاريع"), because the list holds paused projects too.
V-18 | fixed | 779c199 | The PER-12 test now gives Faisal a task due today and a review waiting, and checks that the date line shows only the date (no review count) while the ring shows; a mutation of the rule makes it fail.
V-7 | fixed | 51218dc, 7949538 | A paused row of the office schedule shows the meeting's sign (Paused, Awaiting client or Stale) on its own line under the project name, and the legend names Paused (same grey swatch) when a paused row shows.
V-12 | fixed | 6079791 | The numbers, charts and workload always ask for active projects; the Status choice shows only in the Schedule section, where it changes the rows; elsewhere a status in the link reads as Active, does not count on the Filter button and does not go to the meeting.
V-32 | fixed | c1c545b | The next-deadline line cuts the deadline name and keeps the date whole (checked at 390 px in English and Arabic, and at 1440 px the line stays end-aligned).
V-37b | fixed | 02d52fa | The Past-due tile, the Deadlines row, the weekly chart table and the workload cells carry `team=` to the Task list, so the list matches the number once Group A's `teamId` lands.
V-4c | fixed | 825e98c | The meeting Action "Who" list leaves out inactive members and defaults to the viewer or the first active member; it reads the member `active` flag of `projects.get` (V-4a) when present, else the active-only `users.list`.

## Questions for the owner

1. V-7: the owner rule of 2026-10-02 keeps one quiet grey for On track and Paused, so the legend now shows two grey swatches ("On track", "Paused") and the row sign tells them apart. Do you want Paused to get its own tone instead?
2. V-12: a status in the link stays when the person moves from Schedule to Projects or People (it reads as Active there and comes back in Schedule). The Meeting view button sends the status only from the Schedule section. Is that the behavior you want?
3. V-37b: the Task list links carry the team only, as asked. The Leader and Client filters also change these numbers, but their links still open the whole-office list. Should the Task list take leader and client too?

## Notes for the merge

- V-4c: after Group A's V-4a lands, `DecisionsPanel` reads `member.active` first. The `users.list` call there then only serves as a fallback and can go.
- V-37b: the Task list ignores `team=` until Group A's V-37a lands; nothing breaks in between.
- V-12 changed two older tests that expected the old behavior: DashboardScreen "keeps its filters in the link" (it expected the tile to read 0 under Paused) and MeetingView "opens the meeting view with the filters in the link" (now starts from the Schedule section).

## Screens that changed

- `#/` (Home) as usr_003 (Reem): the header of "Your projects" reads "4 projects"; in Arabic "4 مشاريع".
- `#/` and `#/projects` at 390 px, English and Arabic: each row's next-deadline line keeps the date ("In 3 days", "بعد 3 أيام") whole; the deadline name ends with "...".
- `#/dashboard?view=schedule&status=all` at 1440 px: Gulf Crest HQ Interiors shows "Awaiting client" and Tamr Staff Housing "Stale · paused 45 days" under the name; the legend has "Paused" after "Late".
- `#/dashboard` and `#/dashboard?view=people`: the Filter sheet has no Status choice. `#/dashboard?view=schedule`: it has one. `#/dashboard?status=on_hold`: Active projects 9, At risk or late 5, the charts have data.
- `#/dashboard?team=tm_003`: the Past-due tile, the Deadlines row, the weekly table links and the People workload cells link to `#/tasks?...&team=tm_003`.
- `#/dashboard/meeting?mode=projects` with an inactive leader on Shore Walk Retail Kiosks: Action, the Who list has no inactive person, and Add makes the task.

## Checks

- Full suite (two runs, load average 36 to 60): 1432 of 1433 pass, 148 of 149 files. The one failure both times is `src/app/routeError.test.tsx` "shows a calm page for a screen that breaks": the known render-helper popstate flake (V-8, Group C fixes `src/test/render.tsx`). It passes 3 of 3 when run alone. This branch does not change `src/app` or `src/test`.
- `npx tsc -p tsconfig.json --noEmit`: passes.
- `node scripts/check-rtl.ts`: passes.
- Real-browser check (Playwright at 390 x 844 and 1440 px, English and Arabic) for V-6, V-7 and V-32. The dev server logged 403s for files behind the linked node_modules folder; the app showed no other console error.

Last commit: 7949538
