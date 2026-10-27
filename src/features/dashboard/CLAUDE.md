# Dashboard

## Rules
- Every link to a list carries the Leader, Client and Team filters (`withFilters`, `Tiles.tsx`). The Projects screen and the Task list read
  `leader`, `client` and `team` from the link.
- A new card in the pattern of Stale projects uses `AttentionCard.tsx` and shows only when it has a row. Money and Data gaps draw only when
  `dashboard.get` sends them (the server decides by role).
- The Workload table has a "No lead" row first (`Workload.tsx`) with a dashed empty mark (`NoLeadMark`). It shows only when it holds a to-do.
  The Task list says "Due until <day>" for a range with one end (`taskList.dueUntil`).
- The Map tab (`DashboardMap.tsx`, `MapPinCard.tsx`): `src/features/map/CLAUDE.md`. The meeting view (`MeetingView.tsx`) is the team view,
  never for the client.
- The Dashboard and its sub-routes need `dashboard.view`. A link to the Dashboard (the lists behind its numbers, the team meeting sheet, the
  entries of What's new) is left out without it. Without `workload.view` the Workload block is left out.
- In the meeting view (remote build), `PrefetchNextProject` starts the reads of the next project once no `['api']` read is in flight. The
  meeting task panel takes its project from the meeting `tasks.list` row, and any `tasks.get` error still closes it
  (`MeetingPrefetch.test.tsx`).
