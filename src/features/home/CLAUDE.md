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

- "Your projects" shows rows or boxes by the one choice of the Projects page (`useProjectView`, fbk_080). A quiet round toggle (32 px to see, 44 px to press,
  `size="quiet"`, fbk_082) sits beside the project count (`ProjectViewToggle`, only while the list has a project). The phone Projects page keeps the 44 px disc. The column is about 630 px wide, so it holds 2 boxes across.
  `HomeBody` takes `view` and the stable setter as props, so a link change does not render the boxes again.

- The weekly card (`features/week/WeekCard.tsx`, fbk_088, owner 2026-11-08) sits under the title, before `NextCard`. Sunday to Wednesday it asks "What do you
  plan this week?", Thursday to Saturday "What did you do this week?". It is a card, never a pop-up: nothing opens by itself. Its lines are the to-dos of
  the person from the Home list `mine` (`weekLines`, `lib/week.ts`; Sunday: open, due this week; Thursday: done since Sunday; a to-do with no project is left
  out), each kept until the person clears it, plus one box "Anything else". Save is the secondary button (Home keeps one navy button). After Save the card is
  one quiet line ("Plan sent.", Edit, "See the team's week" for a holder of `checkin.read`); Undo of the toast takes the answer back. The card lives in its
  own chunk (`weekCardLazy.ts`, `lazyOverlay`); Home only starts the import and the read `checkins.mine` in its first request (`weekMineInput`), so the card
  adds no request. It draws nothing for a person without `checkin.answer`. The page `/week` (`WeekScreen.tsx`, route right `checkin.read`) shows one row for
  each person who answered, the plan and the done list side by side, who has not answered, and links to the week before and after (`?week=<Sunday>`).

## On a phone
- `HomeScreen` renders five blocks as direct children of one grid, `grid grid-cols-[minmax(0,1fr)] gap-4`: the title, `NextCard`, `TodayPanel`,
  `MeetingsCard` and `PushAskCard`; the weekly card is a sixth direct child that draws nothing when the person has no question. Add no `display: contents` wrapper, because the `.screen-enter` rule reads the DOM tree.
- A phone mounts no "Your projects" section and no "See what's new" link: `useCall('projects.list', ..., { enabled: !phone })` sends no
  read. A turn to landscape starts the read and shows the section. The What's new row of the Me hub shows the word "New".
- A push link `/?task=` still opens the sheet. Home selectors in tests are `[data-screen] > .grid`, not `main .grid`, because the phone top
  row has its own grid.
