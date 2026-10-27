# Home

Home (`HomeScreen.tsx`). The first request of Home, the stored answers and the role hint: `src/app/CLAUDE.md` (Early reads).

## Rules
- The day ring shows its words ("11 of 14 done today"). The text wraps under the date on a narrow phone.
- The Today panel lists my to-dos due today or past due. With none it is "Coming up": my next 3 open to-dos with a due date (`comingUp`,
  `lib/home.ts`). With neither it says that nothing is due today. Home follows the shared order of the Tasks screen (`src/api/handlers/CLAUDE.md`, "Tasks").
- Home starts `meetings.list` with `todayMeetingsInput(today)` in an effect (`usePrefetchCall`), so the Meetings card, which mounts after
  three answers, finds the answer and the read goes in the first request. The Home task panel warms 1 s after the first three reads answered
  (not after the mount, and a stored answer does not count; `HomeWarm.test.tsx`). `main.tsx` warms it at once for `/?task=`.
- `MeetingsCard` ("Meetings today") shows only my meetings that are on or still to come, three rows. A 60 s tick (`useMinuteTick`) redraws it
  on every screen, so a desk Home drops a meeting that ended. Its Join link follows `mainAction` in `meetingLinks.ts` (a secondary
  `<a target="_blank">`, https places only).
- `PushAskCard` shows one of three cards (push ask, the iPhone steps, the Android install). Rules: `src/features/settings/CLAUDE.md`. On a
  phone it shows a 20 px bell before the ask line only; the other two cards have none.

## On a phone
- `HomeScreen` renders five blocks as direct children of one grid, `grid grid-cols-[minmax(0,1fr)] gap-4`: the title, `NextCard`, `TodayPanel`,
  `MeetingsCard` and `PushAskCard`. Add no `display: contents` wrapper, because the `.screen-enter` rule reads the DOM tree.
- A phone mounts no "Your projects" section and no "See what's new" link: `useCall('projects.list', ..., { enabled: !phone })` sends no
  read. A turn to landscape starts the read and shows the section. The What's new row of the Me hub shows the word "New".
- A push link `/?task=` still opens the sheet. Home selectors in tests are `[data-screen] > .grid`, not `main .grid`, because the phone top
  row has its own grid.
