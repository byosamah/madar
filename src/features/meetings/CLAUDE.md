# Meetings screens

`/meetings` is the second view of the Tasks tab. The calls and rules of meetings: `src/api/handlers/CLAUDE.md`, "Meetings".

## Rules
- Use `now()` from `lib/dates.ts`, never `new Date()`: the tests fix the clock. The test office: usr_002 leads prj_001, usr_005 and usr_006
  are on its team, and now is Wednesday 2026-09-30 09:00 in Riyadh. Helpers: `testMeetings.ts` (`withMeeting`, `as`, `withSeries`, `ENDED`,
  `SOME_MINUTES`, `withLine`).
- The desk pill keeps its tabs: `isNavActive` keeps Tasks open on `/meetings`, and `screenKey(pathname, phone)` (`app/phoneShell.ts`) gives
  both views one entrance. `WorkSwitch` (`features/work/`) sits in `ScreenControls`, in the same row and space as the Filter button of
  Projects. The one main button follows the view: "New office to-do" or "New meeting".
- The view reads `meetings.list` through `readInputs.ts` (`meetingsListInput(today)`). The Home card and the project Overview panel read
  through it too, and `tabReads` (`project/tabs.tsx`) prefetches the panel read with the same input. `groups.ts` makes Today, This week
  and Later, and the days before today are one folded row. A row opens the sheet with `?meeting=<id>` (`openMeeting`, `closeMeeting`,
  `meetingParam` in `lib/params.ts`). A notice and the Home card link to `meetingLink(id)`.
- `MeetingSheet.tsx` has at most one main button, chosen by `mainAction` (`meetingLinks.ts`): "Join" (the place is one `https://` link and
  the meeting starts in 30 minutes or less or is on), else "Open in Google Maps" (a site visit of a project with a pin), else none. A
  cancelled or finished meeting has none. The footer order is: "Cancel meeting" (`destructive`, `me-auto`) or "Delete meeting" for a
  cancelled one, then "Edit" (secondary), then the main button. Each shows by `viewerCan` (`cancel`, `delete`, `edit`). The footer wraps
  and never overflows. A meeting that the person may not see reads "This meeting is not available.", as one that does not exist.
- Cancel asks first (Keep meeting has the focus), then shows a toast with Undo. "Delete meeting" asks nothing for a meeting in no series
  (toast with Undo). A series opens `ScopeSheet` in mode `delete`.
- `MeetingForm.tsx` plans and edits. Eight controls stay visible: Kind, Title, Project, Day, Time, Length, People, Where. The fold "More" holds
  Guests, Notes, Repeat and Until. A kind sets the length until the person chooses it (`kindDefaults`). The edit form has no Project
  (`project_fixed`), sends only the fields that changed, and writes nothing when nothing changed. `TimeField.tsx` is a select of
  15-minute steps. `formModel.ts` holds the pure rules (slots, lengths, `defaultSlot`, `stampOf`, `REPEATS`, `REPEAT_MAX_DAYS`).
- Series: `ScopeSheet.tsx` asks "This meeting" or "This and later meetings" before an edit, a cancel or a delete of a meeting with a
  `seriesId` (focus on the first button). The edit form opens it after Save when something changed, and turns the second button off when the
  change moves the meeting to a new day (the server refuses a new day with `later`). The rule of a series is fixed, so the edit form has no
  Repeat. Words: `series.*`.
- Minutes (`MinutesPart.tsx`, `MinutesSheet.tsx`): after the end the sheet shows one quiet text button "Add the minutes" (`viewerCan.minutes`):
  no task, no notice, no badge, no main button. Any attendee writes the minutes. The save sends `since`, the `updatedAt` that the sheet
  opened (kept in state, so a newer read behind the sheet never changes it). `minutes_changed` keeps the text in the field and shows its word.
  A project meeting uploads to its project (`{ projectId }`), a meeting with no project to the meeting (`{ projectId: null, meetingId }`).
  The Tracker entry sheet of an auto meeting line shows the same part (`TrackerRow.meeting`, `minutes`, `canEditMinutes`).
- Feed words: `feed.meeting.<created|updated|cancelled>_<meeting|visit>` and `feed.meeting.minutes_saved_<meeting|visit>` (`projects/feed.ts`,
  with `_female` forms in Arabic).
