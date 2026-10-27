# Open space

The Open space map (`OpenSpaceScreen.tsx`, `spaceTree.ts`, `SpaceNode.tsx`). The name stays "Open space" (the team's own word). It is read
only and fills the screen at `/dashboard/space`.

## Rules
- The "Detail" control opens one level for the whole map. `openedForLevel` (`spaceTree.ts`) gives the ids that a step opens, plus what a
  person in focus opens (`focusPlan`). A tap on a card adds or removes one id (`Taps`: `extra` and `closed`). A step change, a focus change
  and Overview clear the taps. At the Projects step one project opens alone (an accordion). A task card opens the task panel over the map.
- A column is the depth of the tree, so no card moves when a level opens (the Arabic map mirrors the columns). The sub-company column shows
  when `subCompanies.list` has a sub-company and the link filters none; a project with none goes under `NO_SUB_ID`. A deadline sits beside
  the to-dos of its stage in date order, or under the project when it has no stage. A checklist item shows for an open to-do only, at most
  `CHECK_CAP`, then one "+N more" card. A deadline of a project that is not in `projects.list` never gets a card: the leak test is in
  `OpenSpaceScreen.test.tsx`.
- `CARD_HEIGHT` in `spaceTree.ts` is measured in a browser (`offsetHeight`) for each card kind. Measure it again when a card changes.
- Fit: every fit passes `includeHiddenNodes: true`, so a card that is not drawn yet counts. The map uses `onlyRenderVisibleElements` and gives
  each node `initialWidth` and `initialHeight`. A `ResizeObserver` fits again after the box stops its change (a change under 10 percent keeps
  the view; a pan never fits again). `maxZoomFor` gives the ceiling of a fit. The data of a card keeps its object while its fields stay the
  same, and the toggle never changes, so a tap redraws only the cards that changed.
- The office card carries the `MadarMark` (one of the three places the mark may show).
