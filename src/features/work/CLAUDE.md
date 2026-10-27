# Work (Tasks tab)

`/work` is the Tasks tab: To-dos, Meetings (`src/features/meetings/CLAUDE.md`) and, on a phone, Projects. The Work tab header:
`src/app/CLAUDE.md`.

## Rules
- One main button, "New office to-do" (`NewOfficeTaskSheet.tsx`: title, lead, due date). A list screen opens a to-do panel with
  `?task=<id>` and, for a project to-do, `&project=<id>` (`openTask`, `lib/params.ts`). `taskLink(null, id)` sends an office to-do to
  `/work?task=<id>`. Office to-do rules: `src/features/project/CLAUDE.md`.
- The Board (`WorkBoard.tsx`): the small "View" button (`WorkViewButton.tsx`) sits at the end of the To-dos and Meetings row, in the To-dos
  view only. The choice stays on this device (`usePersistentChoice`, key `madar.work.view` in `workView.ts`, List at first). The Board is
  `TaskBoard` of the project tab with two options: `reviews` may be a function of the row, and `across` makes a card name its project, or the
  word Office, and say "Your review" on a card of mine to review.
- `WorkBoard.tsx` merges three reads into one card for each to-do (`boardRows.ts`): the review queue first (`review_for_me`), my open
  to-dos, and the Done column (`doneWindow`: `tasks.list {filter:'mine', status:['done'], doneFrom}`). The done read starts only while the
  Board shows (and on a press of the View button in the List view). The List view never reads done rows. I approve a to-do of someone else with
  a move to Done. "Send back with a note" opens the panel ready for the note (`ProjectTaskSheet noteFirst`).
- The Board is a chunk of its own (`WorkBoardLazy.ts`, `lazyOverlay`, warmed at idle). Never import `WorkBoard.tsx` statically, or the drag
  code joins the first load.
- The Board on a phone shows a snap lane with `BoardDots` (`IntersectionObserver`) and the Done header "Last 7 days".
