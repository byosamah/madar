# Project page

The project page (`ProjectScreen.tsx`, header, tabs), the to-do list and panel, the Files & Links tab, payments, hidden and internal
projects. The sheets of the Projects list (new, edit): `src/features/projects/CLAUDE.md`. Pictures and uploads: `src/features/files/CLAUDE.md`.

## Tabs and reads
- The read lists sit next to the parts that mount them: `taskPanelReads` (`tasks/TaskSheet.tsx`), `tabReads` (`tabs.tsx`, next to `TAB_BODY`),
  `meetingProjectReads` (`features/dashboard/MeetingProjects.tsx`). `reads.ts` holds `prefetchReads` and `sessionSeesPayments`: only a cached
  session with `can(user, 'payment.view')` prefetches `payments.list`. A change to a `useCall` key in one of these parts changes its list in
  the same commit. `tabs.test.tsx`, `TaskSheetPrefetch.test.tsx` and `MeetingPrefetch.test.tsx` pin the lists.
- The Overview tab owns the open Tracker read and gives it to Attention. The To-dos tab asks `taskTemplates.list {}` once, under the gates
  of the menu. `tabReads('tasks')` starts it with `projects.get` only when the cached session may add a to-do on any project
  (`sessionMayAddTask`). A person off the team asks for no templates (`TemplateMenuRemote.test.tsx`). `TemplateMenu` keeps the templates of
  its stage with `lib/sameText.ts`, as the handler does.
- An internal project has no Tracker tab (`tabsOf(project)`; `?tab=tracker` opens the Overview), no payments (`viewerCan.payments` false),
  no Tracker read, no side choice in the pause sheet, and an About panel without code, place, area and contract date.
- The Projects list and the project header show "Stage ends" (`ProjectSummary.stageEnd`) while the project has no named deadline. "No
  deadline" shows only with neither. That line wraps and never truncates; a named deadline truncates. A continuous project says "Continuous"
  (`NextDeadlineLabel` takes `continuous`; key `projects.continuous`). The About panel shows "Continuous" for the end date. The Overview
  "Stage ends" row shows the plain date, never a late count. Test: `features/projects/ProjectContinuous.test.tsx`.
- The paused banner (`PausedBanner.tsx`) says "Restart reminder on <date>." before the day. After it, the banner says "Planned restart was
  <date>." in the Attention color, with Resume project and the field "Set a new date" (`projects.setRestart`, toast with Undo). Never write
  "Restarts": Madar restarts nothing.

## Hidden and internal projects
- Where a code shows, an internal project shows the word "Internal". Call `shownKey(source, t)` or `shownCode(source, t)`
  (`lib/projectLabel.ts`), never `projectKey` alone. `source` is the project or only the code string. The code `INT-...` shows on no screen.
- A hidden project shows a lock beside its name (`components/HiddenMark.tsx`, `isHiddenProject`): the header, the list row, the map pin
  card. It is no control.
- `team/AccessBlock.tsx` (Team tab, above the leader): "Who sees this project" with two native radios and, for the second, a list of chosen
  people and one picker. Each change calls `projects.setAccess` through `useUndoable`. A person without `viewerCan.access` sees one line.
- The prototype office has "Portfolio 2026" (`data/sampleInternalProject.ts`, added by `bootstrap` and `sampleOffice`, not by `buildSeed`).

## Files & Links tab (`files/`)
- The tab key stays `?tab=files`. The links (`ProjectLinks`, with the model folder) sit above the files. One "Add" menu offers "Upload a file"
  (`viewerCan.upload`) and "Add a link" (`viewerCan.links`, the same `LinkSheet` that edits a link). With no file and no link the tab shows one
  empty state with the Add button in it, never twice. A link of the kind Location still sets the pin.
- Download all: each stage group has a quiet "Download all (N)" at the end of its heading row, and one for the whole project above the first
  group. It hides for fewer than two files, and the whole-project button hides when only one group holds files. Each takes the newest version
  of each file. ZIP names use `shownKey`, so an internal project says "Internal". How it works: `src/features/files/CLAUDE.md`.
- Folders: a stage group holds files and folders, one level, always inside a real stage ("No stage" has none). "+ Folder" shows only for
  `viewerCan.upload`. The name field saves on Enter or blur with text. A taken name shows the refusal as a toast (`folder_name_taken`), with no
  check on the screen. A person who may upload sees every stage as a group once the tab has a file, a folder or a link. The groups wait for
  `files.list`. Delete asks nothing and the Undo brings back the folder and the folder of its files (`events.undoStory`). A file whose
  `folderId` is not a folder of its stage reads as at the root, so a file is never hidden (`groupsOf`, `placeOfFile`). `groupsOf` lives in
  `files/groupsOf.ts` with no UI import (`FileGroups.tsx` exports it again), so the picker "Insert from a project" of a chat reuses the groups
  without the rows (`src/features/files/CLAUDE.md`).
- "Move to" is in the "..." menu of every file for `viewerCan.upload`, on a desk and a phone (`MoveFileSheet`, `files.move`).
- The pointer drag works for a desk with a fine pointer and `viewerCan.upload` (`dragOn`). dnd-kit is a chunk of its own: `FilesDragLayer.tsx`
  through `filesDragLoader.ts`, the same loaded-module pattern as `dragLayerLoader.ts`. `check-bundles.ts` refuses `DndDescribedBy` in the
  first load, and `filesDragImports.test.ts` holds the imports. The list first draws static slots (`fileDragSlots.tsx`: `Row` and `Zone`).
  When zones sit inside each other the smallest wins (`innermost`). There is no keyboard drag (use "Move to") and no touch drag. The test
  helpers load the layer first; a test of the swap calls `forgetFilesDragForTests()`.
- A file from the computer dropped on a folder uploads into it (`files.upload` with `folderId`). A native drop counts only when the drag
  carries `Files` (`carriesFiles`). An upload with the name of a file that the project has adds a version and leaves the file where it is.
- Tests: `Folders.test.tsx`. A pointer drag in jsdom: `fireEvent.pointerDown` on the row (`isPrimary`, `button: 0`), two `pointerMove` on
  `document` (the first past 6 px), then `pointerUp`. Mock `getBoundingClientRect` by the `aria-labelledby` of each zone (`layout()`).

## Payments and the Daftra part
- `payments/DaftraPart.tsx` holds `useDaftraPart`. `PaymentSheet` puts its `part` under the form, outside it, so Enter in the search field
  never saves a payment. Madar only reads Daftra. A screen never names a Daftra account: each call takes the payment, and the server finds
  the account (`server/daftra/CLAUDE.md`).
- A holder of `payment.daftraLink` (ask `useRight`, no other way) on an open payment with no link gets the link states, only after
  `daftra.status` says ready. The prototype answers "not ready" and shows nothing. A linked payment shows its state to every person who sees
  payments, from the payment itself with no Daftra call. Only the holder gets Unlink. A linked payment has no Mark as received. A read that
  answers `daftra_not_ready` hides the part.
- The Link button sits inside the part and is the one main button while an invoice shows (`linkShown`); Save is then secondary. Link sends
  only `{ id, invoiceId }`. A link or unlink closes the sheet and shows an Undo toast.
- `daftra.paymentLink` and `daftra.findClients` have no change signal (`readMap` rule `none`, stale time 0): the sheet reads again each time it
  opens, after its own match, and after a refused link. The search waits after each key. An invoice number and a Daftra name sit in a
  direction isolate in Arabic. `PaymentSign` shows "Invoiced" while `payment.daftra` is set and the money has not come, also past the due day.

## To-do list and panel (`tasks/`)
- A date group of the Tasks screen, Home Today and each stage of the project list reorder by drag through one component,
  `SortableTaskRows` (`@dnd-kit/sortable`). Coming up on Home has no grips. Home Today holds two date groups in one list, so it gives
  `groupOf` (`workGroupOf`): a drop in the other group saves nothing. The row content sits in an inner box (`RowDrag`), so the drag and the
  slide never set one transform.
- dnd-kit is a chunk of its own. `SortableTaskRows.tsx` draws static rows, and a list with a grip loads `DragLayer.tsx` through
  `dragLayerLoader.ts` and swaps it in. The test helpers load the layer first (`DragLayerSwap.test.tsx` holds the swap). The checklist drag is
  the same pattern (`ChecklistDrag.tsx`, `checklistLayerLoader.ts`, `ChecklistSwap.test.tsx`); one drop calls `change` once with the whole
  list. The three loaders and their swaps stay written out in each part: one shared loader file (`lazyLayer.ts`, 2026-10-27) split the
  first load of the remote build from 30 into 48 files, and `check-bundles.ts` refused it. A dnd-kit keyboard drag in jsdom needs `getBoundingClientRect`
  mocked for each row (`features/work/WorkOrder.test.tsx`), and the test awaits the place message after Space and after each arrow key.
- The chat icon of a row (`TaskRowItem.tsx`, all lists use this one row) shows `row.unreadCount` and never `commentCount`: no number when all
  comments are read, `99+` above 99 (fbk_071). Opening the thread marks it read (`useMarkTaskRead`), and the read mark reloads the lists of to-dos
  (`readMap.ts`), so the number goes at once. The words are `tasks.unreadComments` in `real/todo-unread.*.json`.
- `TaskPeople.tsx` loads `TaskPeopleList.tsx` through `lazyOverlay`, so vaul stays out of the first load. A failed import reloads the page
  once (`reloadOnFailedImport`). A second failure shows the toast of a failed step through `ListGuard`. A test of a failed import needs its
  own file for each step (`TaskPeopleFirstFailure.test.tsx`, `TaskPeopleFailedChunk.test.tsx`): a lazy part keeps its first answer for the
  life of the page. One press on a name changes the task at once with an Undo toast. A row without the right keeps an empty box of the "+"
  size, so the avatars line up. The desk list is a `Popover` with `fit` (`popoverPlace`).
- The task panel on a phone: `TaskBody` in `TaskSheet.tsx` draws `PhoneBody`, and on a desk `DeskBody`. Both read `useTaskPanel.ts`, which
  holds all state and actions, and both draw the same shared parts: the Review, Take and Join blocks (`StepBlocks.tsx`), the description,
  the read-only dates and the footer buttons (`TaskPanelParts.tsx`), the two views and the comment thread (`Conversation.tsx`). The lead and
  status choices and the lead change come from `useLeadChoices.ts` through `useTaskPanel` (`statusOptions`, `ownerOptions`, `changeLead`);
  the lazy `TaskPeopleList.tsx` reads the same hook. `useLeadChoices.ts` imports no vaul and no dnd-kit, so the panel stays out of the vaul chunk. The move and the finish of a to-do, with their toast words, are
  `useMoveTask` and `useCompleteTask` (`useTaskMoves.ts`): the panel, the board and the row use them. The title and the description each take a
  new saved value on their own, and a field with unsaved typing keeps it (`TaskSheetTyping.test.tsx`). `nextStep(data, viewerCan, makerId)` in `nextStep.ts` picks one next step; `NextStepSlot.tsx` draws it. The
  file name differs in case from `nextStep.ts` on purpose, because macOS resolves `./NextStep` to the `.ts` file. At most one main button;
  in the Conversation view it is secondary (`demote`).
- Hooks kept at 390 px for the browser specs: `#task-owner`, `#task-status`, `#task-review`, `#task-note`, `#task-title`,
  `#task-add-helper`, `#task-add-need`, the region Review, the buttons Approve and Send back, the role `tab` named Conversation, and the
  button Focus. Layout props on the shared parts (`layout="rows"`, `rows`, `docked`, `hideTitle`) are in `DetailRows.tsx` and its callers.
- An office to-do has no project: the word Office (`office.word`) shows where a project shows, and its panel (`TaskSheet` with `detail`
  null) has no stage and no prerequisites. `taskLink(null, id)` sends it to `/work?task=<id>`.

## Project page on a phone
- Five tabs, `PHONE_TABS` in `tabs.tsx`. Activity, Schedule and Team are pages inside More (`MoreSubPage`). `?tab=more` is the list. On a
  desk `?tab=more` opens Overview. `tabOfLink`, `litPhoneTab`, `isMorePage` and `tabSearch` hold these rules. `ProjectHeader` owns the open
  sheets and swaps `PhoneHeader` and `DeskHeader`, so a phone turned sideways keeps the open sheet. `phoneMainButton` (`mainButton.ts`)
  decides the one navy button of each tab.
- `usePostDraft` (`overview/postDraft.ts`) keeps the update draft in memory and in the draft store key `post:<project>`. `PhoneHeader` reads
  only `useHasPostDraft` (a boolean from the same store), so a key in the update box does not render the header. The Project chat
  link and the file-share "Open" action send `state.from = pathname + search` for Back.
- The Tracker log form is a `Sheet` that stays mounted, so the type and the side stay for the next line. A PDF opens a sheet with a real
  `<a target="_blank">` made after the signed link loads (the Arabic word is «افتح الملف»: `src/i18n/arabic.test.ts` refuses Latin letters).
