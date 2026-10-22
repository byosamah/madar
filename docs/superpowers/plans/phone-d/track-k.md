> Part of `docs/superpowers/plans/2026-10-22-madar-phone-d-plan.md`. Read that file first: its Global Constraints, shared interfaces and Lead amendments win over this file.

## Track K: A to-do, the task panel (wave 2, branch rb/phone-d-k)

**Owns:** these files and their tests. Do not edit any other file.
- `src/features/project/tasks/`: `TaskSheet.tsx`, `TaskHelpers.tsx`, `TaskTiming.tsx`, `TaskNeeds.tsx`, `TaskVersions.tsx`, `ChecklistRow.tsx`, `ChecklistDrag.tsx`. New: `useTaskPanel.ts`, `nextStep.ts`, `NextStep.tsx`, `StateLine.tsx`, `PhoneTop.tsx`, `DetailRows.tsx`, `PhoneDetails.tsx`, `PhoneBody.tsx`, `DeskBody.tsx`, `TaskParts.tsx`.
- `src/features/comments/CommentThread.tsx` (the docked box).
- New: `src/lib/fileSize.ts`, `src/i18n/real/phonetask.en.json`, `src/i18n/real/phonetask.ar.json`, `src/test/phoneViewport.ts`, `src/test/renderPanel.tsx`.
- Two small props in `src/components/DateDraftField.tsx` and `src/components/DateField.tsx`. No track lists these two files in the design table. The lead must confirm that K may edit them.
- Browser specs: `tests/e2e/toastUndo.spec.ts`, `tests/e2e/calm.spec.ts`, `tests/e2e/menus.spec.ts`, new `tests/e2e/phoneTask.spec.ts`.

**Reads:** area section "A to-do (the task panel)" (the design file wins where they differ). Design rules 1, 4, 5, 6, 7, 8, 9, 10, 11 and lead decisions 1, 2, 14, 15. The contract parts `Sheet` (`tall`, `phoneHeader`), `Tabs` (`variant="pill"`, `spread`), `useIsPhone`, `--phone-bar`. Track S must be joined before K starts.

**Rules for the builder of this track**
- The desk layout (640 px and wider) does not change. jsdom reads a desk, so every old test stays green. Run the old tests in every task that edits an old file: `npx vitest run src/features/project/tasks src/features/comments src/features/focus --no-file-parallelism --testTimeout=60000`. Call this command **TASK-TESTS**.
- The browser keeps these hooks at 390 px: `#task-owner`, `#task-status` (a real `<select>`, transparent, never `display:none`), `#task-review` (`role="switch"`), `#task-note`, the region "Review", the buttons "Approve" and "Send back", the role `tab` named Conversation, the button "Focus".
- One main (navy) button for each view of the panel. Rule: `NextStep` draws the main button. In the Conversation view the next step button turns secondary (prop `demote`), because the Send button of the dock is the main button there.
- Each new word goes in both `phonetask` files, key tree `phoneTask`. English in ASD-STE100. Arabic in the Thmanyah style. Western digits. No em-dash.
- Words that exist stay: reuse `taskSheet.*`, `tasks.*`, `lead.*`, `taskHelp.*`, `office.*`, `focus.*`.

---

### Task K1: nextStep (the rule for the one next step)

**Files:**
- Create: `src/features/project/tasks/nextStep.ts`
- Test: `src/features/project/tasks/nextStep.test.ts`

**Interfaces:**
- Consumes: `TaskDetail` (`src/api/contract/views`), `isWaiting` (`src/lib/waiting`).
- Produces:
  ```ts
  export type NextStepKind = 'review' | 'take' | 'complete' | 'waiting' | 'needs_lead' | 'wait_approval' | 'new_version' | 'join' | 'none';
  export type NextStep = { kind: NextStepKind; completeWord?: 'markDone' | 'sendToReview' };
  export function mayChangeOf(viewerCan: TaskDetail['viewerCan']): boolean; // editDetails || editDates || work || editAll
  export function nextStep(data: TaskDetail, viewerCan: TaskDetail['viewerCan'], makerId: string): NextStep | null;
  ```

- [ ] **Step 1: Write the failing test.** The file builds a `TaskDetail` with a local `detail(overrides)` function. Test names and assertions:
  ```ts
  it.each([...])('returns %s', ...)            // one row for each kind, with the fields that make it true
  it('keeps the order of the design', ...)     // review beats take; take beats complete; complete beats waiting; new_version beats join
  it('says Send to review only when the call lands in review', () => {
    // needsReview true, project to-do, setNeedsReview false        -> 'sendToReview'
    // needsReview true, setNeedsReview true (a reviewer)           -> 'markDone'
    // needsReview false                                            -> 'markDone'
    // office to-do (projectId null), ownerId === makerId           -> 'markDone'
    // office to-do, ownerId !== makerId, setNeedsReview false      -> 'sendToReview'
  })
  it('gives complete only for To do or In progress, with a lead, with canMove and nothing to wait for', ...)
  it('returns waiting when waitingFor has a task, and needs_lead for no lead and no take right', ...)
  it('returns wait_approval for a to-do in review when canMove is true and review is false', ...)
  it('uses mayChange for join and none', () => {
    // editDates true, help true -> null (no join, no none)
    // all flags false, help true, editAll false -> 'join'; help false -> 'none'
  })
  it('returns null when nothing applies', ...)
  ```
- [ ] **Step 2: Run it and see it fail.** `npx vitest run src/features/project/tasks/nextStep.test.ts --no-file-parallelism --testTimeout=60000`. Expected: it fails with "Failed to resolve import ./nextStep".
- [ ] **Step 3: Implement.** One pure function. The order and the tests of the design:
  ```ts
  review:        viewerCan.review
  take:          viewerCan.take
  complete:      status in ['todo','in_progress'] && data.canMove && task.ownerId !== null && !isWaiting(data)
  waiting:       isWaiting(data) && data.canMove
  needs_lead:    task.ownerId === null && data.canMove && !viewerCan.take
  wait_approval: task.status === 'in_review' && data.canMove
  new_version:   viewerCan.newVersion
  join:          !mayChange && !viewerCan.take && viewerCan.help === true && !viewerCan.editAll
  none:          !mayChange && !viewerCan.take
  completeWord = 'sendToReview' when task.needsReview && !(task.projectId === null && task.ownerId === makerId) && !viewerCan.setNeedsReview, else 'markDone'
  ```
- [ ] **Step 4: Run the test and `npm run typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit.** `git add src/features/project/tasks/nextStep.ts src/features/project/tasks/nextStep.test.ts && git commit -m "Task panel: add nextStep, the rule for the one next step of a to-do"`

---

### Task K2: useTaskPanel and the split of TaskSheet (no visible change)

**Files:**
- Create: `src/features/project/tasks/useTaskPanel.ts`, `src/features/project/tasks/TaskParts.tsx`, `src/features/project/tasks/DeskBody.tsx`, `src/test/phoneViewport.ts`, `src/test/renderPanel.tsx`
- Modify: `src/features/project/tasks/TaskSheet.tsx` (keep only `TaskBody`, `taskPanelReads`, `usePanelPrefetch`, `TaskSheet`, `ProjectTaskSheet`)
- Test: `src/features/project/tasks/useTaskPanel.test.tsx`

**Interfaces:**
- Consumes: `mayChangeOf` (K1).
- Produces:
  ```ts
  // TaskParts.tsx: moved without change from TaskSheet.tsx
  export type Patch; export type ChecklistDraft; export const newItemId; export function Fact; export function Checklist; export const TaskFiles; export const History; export const EMPTY_FILES;
  // useTaskPanel.ts
  export type TaskPanelProps = { detail: ProjectDetail | null; data: TaskDetail; onClose: () => void; noteFirst: boolean };
  export type TaskPanel = {
    data: TaskDetail; detail: ProjectDetail | null; task: Task; viewerCan: TaskDetail['viewerCan'];
    canDetails: boolean; canDates: boolean; canWork: boolean; mayChange: boolean;
    root: RefObject<HTMLDivElement | null>; reviewBlock: RefObject<HTMLElement | null>;
    title: string; setTitle(v: string): void; description: string; setDescription(v: string): void; unsaved: boolean; note: string; setNote(v: string): void;
    patch(changes: Patch): void;
    move; approve; sendBack; take; join; leave; remove; saveTemplate; newLead; complete;   // the useUndoable / useAction objects of today; complete = useUndoable('tasks.complete')
    leadJoins: MutableRefObject<boolean>;
    people: UserCard[]; choices: User[]; teamIds: Set<string>; makerId: string; helping: boolean; canUndoAgent(actingForId: string): boolean;
    files: FileView[];
    section: 'details' | 'conversation'; setSection(next: 'details' | 'conversation'): void;
    timingKey: number; failures: number; dates: ReturnType<typeof useDateReason>; back: ReturnType<typeof useStageBack>;
    checklistDraft: MutableRefObject<ChecklistDraft>;
  };
  export function useTaskPanel(props: TaskPanelProps): TaskPanel;
  // src/test/phoneViewport.ts
  export function phoneViewport(options?: { coarse?: boolean }): void;   // matchMedia('(max-width: 639px)') is true; '(pointer: coarse)' is true when coarse; restored with onTestFinished
  // src/test/renderPanel.tsx
  export function setupTask(taskId: string, userId: string, patch?: Partial<Task>): (state: State) => void;  // sets the person, applies the patch, empties prerequisiteIds of the to-do and of its stage
  export function addOfficeTask(state: State, patch?: Partial<Task>): void;  // tsk_900: office, lead usr_005, maker usr_004 (as TaskSheetPrefetch.test.tsx)
  export function renderPanel(taskId: string, options?: { prepare?: (s: State) => void; path?: string; projectId?: string | null; phone?: boolean; render?: (panel: TaskPanel) => ReactNode }):
    Promise<Awaited<ReturnType<typeof renderWithRuntime>> & { onClose: Mock }>;  // no render: shows the real ProjectTaskSheet; render: shows only that node, fed by useTaskPanel
  ```

- [ ] **Step 1: Write the failing test** (`useTaskPanel.test.tsx`, desk width):
  ```tsx
  it('says that an outsider may not change the to-do', ...)   // render prints String(panel.mayChange) -> 'false'
  it('says that the lead may change it', ...)                 // setupTask('tsk_007','usr_005') and ownerId 'usr_005' -> 'true'
  it('sends a to-do with Needs review to review for its lead', async () => {
    // setupTask('tsk_007','usr_005',{ ownerId:'usr_005', status:'todo', needsReview:true })
    // render a button that calls panel.complete.mutate({ id:'tsk_007' }); click it
    await waitFor(() => expect(store.state.tasks.tsk_007.status).toBe('in_review'));
  })
  it('opens the Conversation when the link has thread=1', ...) // path '/?thread=1' -> panel.section === 'conversation'; setSection('details') drops thread
  ```
- [ ] **Step 2: Run it and see it fail.** `npx vitest run src/features/project/tasks/useTaskPanel.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: it fails with "Failed to resolve import ./useTaskPanel".
- [ ] **Step 3: Implement.** Move lines 237 to 395 of `TaskSheet.tsx` (all state and actions of `TaskBody`) into `useTaskPanel`, with the same code. Move `Fact`, `Checklist`, `TaskFiles`, `History` into `TaskParts.tsx` and the desk JSX into `DeskBody.tsx` (props `{ panel: TaskPanel }`, same markup, same ids). Add `complete = useUndoable('tasks.complete', { message: (o) => (o.result === 'in_review' ? t('tasks.sentToReview') : t('tasks.completed')) })`. `mayChange` uses `mayChangeOf`. `TaskBody` becomes `useTaskPanel` plus `DeskBody`. Write the two test helpers as the interfaces above say (`renderPanel` builds on `renderWithRuntime` with `path`).
- [ ] **Step 4: Run TASK-TESTS and `npm run typecheck`.** Expected: PASS, and no old test changes.
- [ ] **Step 5: Commit.** `git add` the nine files above and `git commit -m "Task panel: move the state of the panel into useTaskPanel and split the desk body"`

---

### Task K3: Top row, large title and state line

**Files:**
- Create: `src/features/project/tasks/PhoneTop.tsx` (`PhoneHeader`, `TitleBlock`), `src/features/project/tasks/StateLine.tsx`, `src/i18n/real/phonetask.en.json`, `src/i18n/real/phonetask.ar.json`
- Test: `src/features/project/tasks/PhoneTop.test.tsx`, `src/features/project/tasks/StateLine.test.tsx`

**Interfaces:**
- Consumes: `TaskPanel`, `renderPanel`, `phoneViewport` (K2). `dueWord`, `dueText`, `startsLater`, `startsText` (`src/lib/due`), `StatusSign` (`src/components/StatusSign`), `waitingNames` (`src/lib/waiting`), `versionOf` (`src/lib/taskPeople`), `ProjectTile`.
- Produces:
  ```ts
  export function PhoneHeader(props: { data: TaskDetail }): JSX.Element;      // node for Sheet phoneHeader: ProjectTile 22 + <bdi> project name as a Link to /projects/:id, or the word office.word with no link
  export function TitleBlock(props: { panel: TaskPanel }): JSX.Element;       // text-page-title, dir="auto"; a button for an editor, plain text for a reader
  export function StateLine(props: { data: TaskDetail }): JSX.Element;
  // words: phoneTask.editTitle = "Tap to edit the title" / «اضغط على العنوان لتعدّله»
  ```

- [ ] **Step 1: Write the failing tests.**
  ```tsx
  // PhoneTop.test.tsx (phone: true)
  it('shows the project link, or the word Office with no link', ...)           // link 'Corniche Office Tower' href ends '/projects/prj_001'; office to-do: text 'Office', no link
  it('lets an editor tap the title, type, and save on blur', ...)              // click button -> textbox 'Title' has focus; type; tab -> store title changes
  it('saves on Enter and puts the old title back on Escape', ...)
  it('does not save an empty title', ...)
  it('shows plain text to a reader', ...)                                      // outsider: no button named like the title, no textbox
  it('keeps the title of 280 characters in one wrapped block and cuts the project name', ...)   // classes break-words / truncate
  it('saves a typed title when the panel closes by a tap outside', ...)        // type, then onClose path: unmount renderPanel; title saved (saveTyped)
  // StateLine.test.tsx (TODAY is 2026-09-30)
  it('shows the status word, then the due word', ...)                          // 'In progress' + '2 days past due' inside [data-sign="late"] when due 2026-09-28
  it('shows no late sign for a to-do in review, only a quiet date', ...)       // /Due 28 Sep/, no [data-sign]
  it('shows Starts <date> and no due word when the start is later', ...)
  it('shows no due word for a done to-do', ...)
  it('shows Flagged in text-attn, the version badge from version 2, and Waiting for X', ...)
  it('shows only what is true', ...)                                           // a plain to-do with no date: the status word alone
  ```
- [ ] **Step 2: Run them and see them fail.** `npx vitest run src/features/project/tasks/PhoneTop.test.tsx src/features/project/tasks/StateLine.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: "Failed to resolve import ./PhoneTop".
- [ ] **Step 3: Implement.** `TitleBlock`: a `<button>` with the title and an `sr-only` hint when `panel.canDetails`. A tap shows `<input id="task-title" aria-label={t('taskSheet.title')} autoFocus dir="auto">`. Blur and Enter call `panel.patch({ title })` with the rule of the desk (`title.trim() && title.trim() !== task.title`). Escape puts the old title back. The input uses `panel.title` and `panel.setTitle`, so `saveTyped` still saves a typed title at close. `StateLine` is one `flex-wrap` line of `text-footnote text-ink-2`. `StatusSign state="late"` shows only when `dueWord(...).tone === 'attn'` and the to-do does not start later. Add both word files with `phoneTask.editTitle`.
- [ ] **Step 4: Run the two test files, the words tests (`npx vitest run src/i18n --no-file-parallelism`) and `npm run typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit.** `git add` the five files and `git commit -m "Task panel: add the top row, the large title and the state line for a phone"`

---

### Task K4: The next step slot (NextStep)

**Files:**
- Create: `src/features/project/tasks/NextStep.tsx`
- Modify: `src/i18n/real/phonetask.en.json`, `src/i18n/real/phonetask.ar.json`
- Test: `src/features/project/tasks/NextStep.test.tsx`

**Interfaces:**
- Consumes: `nextStep` (K1), `TaskPanel` (K2), `NewVersion` (`TaskVersions.tsx`), `fade`, `AnimatedIcon`, `CircleCheckIcon`.
- Produces: `export function NextStep(props: { panel: TaskPanel; demote?: boolean }): JSX.Element | null`. Words: `phoneTask.markDone` = "Mark done" / «أنهِ المهمة»; `phoneTask.sendToReview` = "Send to review" / «أرسلها للمراجعة».

- [ ] **Step 1: Write the failing test** (`phone: true`, `render: (panel) => <NextStep panel={panel} />`):
  ```tsx
  it.each(KINDS)('draws the right control for %s', ...)
  // review (usr_002, tsk_010): region 'Review', Approve (class signature), textbox 'What needs to change?' with id task-note, Send back disabled until the note has text
  // take (office or project to-do with no lead): region 'No lead', hint, 'Take it' (signature)
  // complete: 'Mark done' (signature, 52 px class min-h-[52px]); 'Send to review' for a lead with needsReview
  // waiting: text 'Waiting for ...' and no button;  needs_lead: 'Not yet. Give this to-do a lead first.' and no button
  // wait_approval: 'This to-do waits for the leader to approve it.';  new_version: hint + button 'New version', click opens the form with 'Start version 2'
  // join: region 'Join as a helper', button secondary;  none: the read only line (project and office words)
  it('draws one main button at most for each kind', ...)                       // querySelectorAll('.signature').length <= 1
  it('keeps the focus rule of Send back with a note', ...)                     // noteFirst: note has focus, Send back signature, Approve not
  it('calls tasks.complete and shows the toast of the server result', ...)     // tap -> store status; toast 'Sent to review...' or 'To-do done.'
  it('ignores a second tap while the call runs', ...)                          // click twice fast: one event in store.state.events for the move
  it('turns the main button secondary when demote is true', ...)
  it('takes no space when no kind applies', ...)                               // container has no [data-next-step]
  it('moves to New version after Mark done', ...)                              // waitFor 'New version'; 'Mark done' gone
  ```
- [ ] **Step 2: Run it and see it fail.** `npx vitest run src/features/project/tasks/NextStep.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: "Failed to resolve import ./NextStep".
- [ ] **Step 3: Implement.** One `motion.div data-next-step` inside `AnimatePresence mode="wait" initial={false}`, keyed by the kind, `fade` transition. The review and take blocks keep the markup, `aria-label` and `ref={panel.reviewBlock}` of `DeskBody`. Main buttons use `className="min-h-[52px] w-full"` and the variant `demote ? 'secondary' : 'primary'`. The complete button holds an `AnimatedIcon` `CircleCheckIcon` inside a `motion.span` with `animate={panel.complete.isPending ? { scale: [1, 0.82, 1] } : { scale: 1 }}` and `transition={{ duration: 0.42, times: [0, 0.35, 1], ease: 'easeOut' }}`. A button is `disabled` while its mutation is pending. The line for `none` reads `taskSheet.readOnly` for a project to-do and `office.readOnly` for an office to-do.
- [ ] **Step 4: Run the test, TASK-TESTS and `npm run typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit.** `git add` the three files plus both word files and `git commit -m "Task panel: add the next step slot with Mark done, Approve, Take it and the quiet lines"`

---

### Task K5: Docked Conversation

**Files:**
- Modify: `src/features/comments/CommentThread.tsx` (props `docked`, `hideTitle`)
- Test: `src/features/comments/CommentThreadDocked.test.tsx`

**Interfaces:**
- Consumes: `renderPanel`, `phoneViewport` (K2), `MentionField` `placement="above"` (exists).
- Produces: `CommentThread` props `docked?: boolean` and `hideTitle?: boolean`, both default `false`.

- [ ] **Step 1: Write the failing test.** The test renders `<CommentThread targetType="task" targetId="tsk_007" ... docked hideTitle />` with `renderWithRuntime`.
  ```tsx
  it('hides the heading Comments and keeps the section name', ...)              // no heading 'Comments'; region 'Comments' exists
  it('puts the box in a dock at the bottom of the scroll area', ...)            // [data-comment-dock] has sticky, bottom-0, border-t, bg-panel
  it('opens the @ list above the box and keeps the row Everyone', ...)          // type '@' with everyone={3}; listbox has class bottom-full; first option 'Everyone'
  it('scrolls once to the newest comment when the comments arrive', ...)        // spy Element.prototype.scrollIntoView: called once; a new comment later does not call it again
  it('keeps Attach only with canAttach and shows comments.cannot without canPost', ...)
  it('keeps the old layout when docked is false', ...)                           // heading shown; no dock
  ```
- [ ] **Step 2: Run it and see it fail.** `npx vitest run src/features/comments/CommentThreadDocked.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: it fails (no dock, heading still shown).
- [ ] **Step 3: Implement.** With `hideTitle`, do not render the `h3`. With `docked`, wrap the form (and the `comments.cannot` line) in `<div data-comment-dock className="sticky bottom-0 z-10 -mx-5 -mb-5 border-t border-hairline bg-panel px-5 pb-2 pt-3">` and pass `placement="above"` to `MentionField`. The sheet already pads `env(safe-area-inset-bottom)` under its body, so the dock adds no second pad. Put `<div ref={end} />` before the dock. One effect calls `end.current?.scrollIntoView({ block: 'end' })` the first time `comments.data` is defined, then sets a ref flag. Keep `behavior` default (instant).
- [ ] **Step 4: Run the test and TASK-TESTS and `npm run typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit.** `git add src/features/comments/CommentThread.tsx src/features/comments/CommentThreadDocked.test.tsx && git commit -m "Comments: add the docked box and the hidden heading for the phone panel"`

---

### Task K6: Row parts, People group and This to-do group

**Files:**
- Create: `src/features/project/tasks/DetailRows.tsx`, `src/features/project/tasks/PhoneDetails.tsx`
- Modify: `src/features/project/tasks/TaskHelpers.tsx` (prop `layout?: 'plain' | 'rows'`), `src/i18n/real/phonetask.en.json`, `.ar.json`
- Test: `src/features/project/tasks/DetailRows.test.tsx`, `src/features/project/tasks/PhoneDetails.people.test.tsx`

**Interfaces:**
- Consumes: `TaskPanel`, `personOption` (`TaskHelpers.tsx`), `Switch`, `NoLeadMark`, `Avatar`, `moveTargets`, `BOARD_COLUMNS`.
- Produces:
  ```ts
  export function Group(props: { title: string; hint?: string; children: ReactNode }): JSX.Element;       // <section aria-labelledby>, title text-caption font-semibold uppercase tracking-[0.06em] text-ink-2, body rounded-2xl bg-fill with .hairline, hint text-caption
  export function ValueRow(props: { label: string; children: ReactNode }): JSX.Element;                    // min-h-12, label at the start, value text-end
  export function PickRow(props: { id: string; label: string; value: string; display: ReactNode; onChange: (v: string) => void; children: ReactNode }): JSX.Element; // real <select id aria-label> opacity-0 over the row, chevron at the end
  export function SwitchRow(props: { id: string; label: string; description?: string; checked: boolean; onChange: (v: boolean) => void }): JSX.Element; // the Switch; the label covers the row (label::after absolute inset-0), the button has z-10
  export function PhoneDetails(props: { panel: TaskPanel }): JSX.Element;  // this task: People, This to-do
  // TaskHelpers layout="rows": a fragment of rows (avatar, <bdi> name, X of size-11), a quiet row taskSheet.noHelpers for an editor with none, a last PickRow id task-add-helper. The hint goes to Group hint.
  // words: phoneTask.groupPeople "People" / «الأشخاص»; phoneTask.groupThis "This to-do" / «هذه المهمة»
  ```

- [ ] **Step 1: Write the failing tests.**
  ```tsx
  // DetailRows.test.tsx
  it('PickRow keeps the select id and its label, and a change calls onChange', ...)    // getByLabelText('Lead') is a SELECT with id task-owner and class opacity-0
  it('SwitchRow keeps role=switch and the id, and a tap on the row toggles it', ...)   // click the label text and the far end of the row: onChange(true) once each
  it('Group names its section by its title', ...)
  // PhoneDetails.people.test.tsx (phone: true)
  it('shows the Lead row as a select for editAll, and as a plain row for a reader', ...) // usr_002: select; outsider: no select, the name as text
  it('shows NoLeadMark and No lead for a to-do with no lead', ...)
  it('sends the new lead with the Undo toast, with (joins the team) in the option', ...)
  it('lists a helper row with Remove helper of 44 px, and an Add a helper row that hides at MAX_HELPERS', ...)
  it('hides the helpers rows for a reader with no helper', ...)
  it('shows Status as a select with moveTargets, and as a plain row for the reviewer', ...) // usr_002 on tsk_010 (in review): ValueRow 'In review', no #task-status
  it('shows Stage as a select, as a plain row, or no row for an office to-do', ...)
  it('shows the Flag and Needs review switches by the gates of the desk', ...)           // task-flag, task-review; none for a reader; no review switch when the lead is the maker of an office to-do
  it('saves the description on blur, keeps Not saved yet, and shows RichText to a reader', ...)
  ```
- [ ] **Step 2: Run them and see them fail.** `npx vitest run src/features/project/tasks/DetailRows.test.tsx src/features/project/tasks/PhoneDetails.people.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: "Failed to resolve import ./DetailRows".
- [ ] **Step 3: Implement.** `PickRow`: the row is `relative flex min-h-12 items-center gap-3 px-4`; the `<select>` is `absolute inset-0 size-full cursor-pointer opacity-0` and carries the `id`; the visible label is a plain `span` with `aria-hidden`; the name of the select is `aria-label={label}`. The select, the options and the handlers are the ones of `DeskBody` (copy `task-owner`, `task-status`, `task-stage` logic, `leadJoins`, `newLead`, `move`). `SwitchRow` wraps `Switch` with `relative [&_label]:after:absolute [&_label]:after:inset-0 [&_label]:after:content-[''] [&_button]:relative [&_button]:z-10`. `TaskHelpers layout="rows"` keeps the early return `!canEdit && helpers.length === 0`. `PhoneDetails` draws People (Lead, helper rows, hint) and This to-do (Status, Stage, Flag, Needs review, Description) in the order of the design; K7 and K8 add the other groups.
- [ ] **Step 4: Run the two files, TASK-TESTS and `npm run typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit.** `git add` the files above and `git commit -m "Task panel: add grouped rows for the people and the status of a to-do on a phone"`

---

### Task K7: When group and Checklist group

**Files:**
- Modify: `src/features/project/tasks/TaskTiming.tsx` (prop `layout?: 'plain' | 'rows'`; export `DurationField`), `src/features/project/tasks/TaskParts.tsx` (`Checklist` prop `rows?: boolean`), `src/features/project/tasks/ChecklistRow.tsx` (prop `rows?: boolean`; grip `max-sm:w-11`, attribute `data-vaul-no-drag`), `src/features/project/tasks/ChecklistDrag.tsx` (pass `rows`), `src/features/project/tasks/PhoneDetails.tsx` (When and Checklist groups), `src/components/DateDraftField.tsx` and `src/components/DateField.tsx` (props `align?: 'start' | 'end'` and `touchClear?: boolean`), word files
- Create: `DateRow` in `src/features/project/tasks/DetailRows.tsx`
- Test: `src/features/project/tasks/PhoneDetails.when.test.tsx`, `src/features/project/tasks/PhoneChecklist.test.tsx`, add two cases to `src/components/DateDraftField.test.tsx`

**Interfaces:**
- Consumes: `Group`, `ValueRow`, `PickRow` (K6), `DateDraftField`, `SegmentedControl`, `DateNotes` (`TaskNeeds.tsx`), `spring.expand`.
- Produces:
  ```ts
  export function DateRow(props: { id: string; label: string; value: string; onCommit: (v: string | null) => void }): JSX.Element; // label span at the start, DateDraftField hideLabel align="end" touchClear
  // DateDraftField: align 'end' puts justify-end on the face; touchClear makes the clear control size-11 (44 px) in place of size-8
  // Checklist rows: one <label> holds the box and the text (the row is the tick area); the X is a separate size-11 button; the grip is a 44 px button
  // words: phoneTask.groupWhen "When" / «المواعيد»; phoneTask.timing "Timing" / «الجدولة»; phoneTask.checklistCount "Checklist · {{done}} of {{count}}" / «قائمة التحقق · {{done}} من {{count}}»
  ```

- [ ] **Step 1: Write the failing tests.**
  ```tsx
  // DateDraftField.test.tsx
  it('puts the date at the end with align="end"', ...)      // face has justify-end
  it('makes the clear control 44 px with touchClear', ...)  // button 'Clear' has class size-11
  // PhoneDetails.when.test.tsx (phone: true)
  it('shows Start, Timing and Due rows for a Static to-do', ...)   // Timing value 'Static: due date'
  it('opens the two timing choices in place and shows the hint', ...) // click Timing -> radiogroup 'How the to-do is timed' + hint; choose Dynamic -> patch schedule dynamic, durationDays 5
  it('shows Duration and the computed due line for Dynamic, and Pick a start date first with no start', ...)
  it('asks for a reason when a date moves, and Cancel puts the old date back', ...)   // clear the due date: sheet 'Why ...'; Cancel: value back
  it('shows plain rows to a person who cannot change the dates', ...)
  it('lists the automatic date changes under the group', ...)
  // PhoneChecklist.test.tsx (phone: true)
  it('titles the group Checklist · n of m', ...)
  it('ticks an item with a tap on the text, once', ...)           // click the text: store checklist item done true, one patch
  it('does not tick when the grip is tapped', ...)
  it('shows boxes that stay off for an editor without the tick right, and icons for a reader', ...)
  it('removes an item with a 44 px X, and adds an item in the last row with Enter', ...)
  it('keeps the grip with the keyboard order change and marks it data-vaul-no-drag', ...)
  it('saves a typed new item when the panel closes', ...)
  it('keeps 40 long items in one list with no horizontal overflow classes', ...)
  ```
- [ ] **Step 2: Run them and see them fail.** `npx vitest run src/features/project/tasks/PhoneDetails.when.test.tsx src/features/project/tasks/PhoneChecklist.test.tsx src/components/DateDraftField.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: failures for the missing props and groups.
- [ ] **Step 3: Implement.** `TaskTiming layout="rows"` returns row elements: Start (`DateRow`, id `${idPrefix}-start`), Timing (a button row that toggles a block animated with `spring.expand`, with the `SegmentedControl` and `taskSheet.scheduleHint`), then Due (`DateRow`, id `${idPrefix}-due`) for Static, or `DurationField` as a number row plus the computed due line for Dynamic. The reader gets `ValueRow`s with the texts of the desk. The `key={`${timingKey}-${failures}`}` of `DeskBody` stays on the rows. `Checklist rows` draws the items inside `Group` with the count title; `ChecklistRow rows` wraps the box and the text in one `<label>`.
- [ ] **Step 4: Run the three files, TASK-TESTS (the old `TaskTiming`, `ChecklistOrder`, `ChecklistSwap` stay green) and `npm run typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit.** `git add` the files above and `git commit -m "Task panel: add the When and Checklist groups for a phone"`

---

### Task K8: Files, Needs first, Versions, History and the end buttons

**Files:**
- Create: `src/lib/fileSize.ts`
- Modify: `src/features/project/tasks/TaskParts.tsx` (`TaskFiles` and `History` prop `layout`), `src/features/project/tasks/TaskNeeds.tsx` (`layout="rows"`), `src/features/project/tasks/TaskVersions.tsx` (`layout="rows"`), `src/features/project/tasks/PhoneDetails.tsx`, word files
- Test: `src/lib/fileSize.test.ts`, `src/features/project/tasks/PhoneDetails.rest.test.tsx`

**Interfaces:**
- Consumes: `Group`, `ValueRow`, `PickRow` (K6), `canPreview`, `PreviewSheet`, `downloadFile`.
- Produces:
  ```ts
  export function fileSizeText(size: number, t: TFunction, lang: Lang): string;   // < 1 MB: files.kb with a whole number of at least 1; else files.mb with one decimal
  // words: phoneTask.filesCount "Files · {{n}}" / «الملفات · {{n}}»; phoneTask.seeAll "See all ({{n}})" / «اعرض الكل ({{n}})»
  ```

- [ ] **Step 1: Write the failing tests.**
  ```ts
  // fileSize.test.ts
  it('gives KB under 1 MB with a minimum of 1', ...)     // 100 -> '1 KB'; 2048 -> '2 KB'
  it('gives MB with one decimal from 1 MB', ...)         // 1572864 -> '1.5 MB'; Arabic uses Western digits
  // PhoneDetails.rest.test.tsx (phone: true)
  it('lists files as rows with a plain icon, the name and the size', ...)           // title 'Files · 2'; the empty line taskSheet.noFiles
  it('opens the preview for a picture and saves any other file', ...)
  it('shows Needs first rows with status words and an X for editors, and an Add row that hides at MAX_PREREQUISITES', ...)
  it('hides Needs first for an office to-do and for an empty read only list', ...)
  it('shows Unlocks as a read only group with its hint', ...)
  it('shows Versions from version 2 and no group before', ...)
  it('shows the 3 newest history rows and See all (n) shows the rest in place', ...)   // button 'See all (5)'; after click 5 rows; button gone
  it('puts Undo agent change under the text of its row, 44 px, with the toast Change undone.', ...)
  it('shows Leave, Save as template and Delete in full width 48 px buttons by the gates of the desk', ...) // min-h-12 w-full; destructive keeps text-late; each gate hides its button
  it('deletes a to-do with the Undo toast and closes the panel', ...)
  ```
- [ ] **Step 2: Run them and see them fail.** `npx vitest run src/lib/fileSize.test.ts src/features/project/tasks/PhoneDetails.rest.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: "Failed to resolve import ./fileSize".
- [ ] **Step 3: Implement.** `fileSizeText` holds the two lines now in `FilesTab.tsx` (K does not edit `FilesTab.tsx`; the lead may point it to the new helper later). `TaskFiles layout="rows"` draws one button row for each file: a plain `AttachFileIcon` (no tile), `<bdi>` name, the size. `History layout="rows"` slices `data.history` to 3 and keeps a `useState` flag for "See all". The row `Undo agent change` is a plain `Button` of `min-h-11` under the text. `TaskNeeds layout="rows"` returns two `Group`s (Needs first, Unlocks) with the same gates and limits as today, and the add row is a `PickRow` id `task-add-need`. `PhoneDetails` ends with the three stacked buttons, each with the gate of `DeskBody` (`helping`, `viewerCan.saveTemplate`, `viewerCan.delete`).
- [ ] **Step 4: Run the two files, TASK-TESTS and `npm run typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit.** `git add` the files above and `git commit -m "Task panel: add the Files, Needs first, Versions and History groups for a phone"`

---

### Task K9: PhoneBody, the switch and the wire-up in TaskSheet

**Files:**
- Create: `src/features/project/tasks/PhoneBody.tsx`
- Modify: `src/features/project/tasks/TaskSheet.tsx` (`TaskBody` picks `PhoneBody` when `useIsPhone()`; `Sheet` gets `tall` and `phoneHeader`)
- Test: `src/features/project/tasks/PhoneTaskSheet.test.tsx`

**Interfaces:**
- Consumes: `PhoneHeader`, `TitleBlock` (K3), `StateLine` (K3), `NextStep` (K4), `CommentThread` `docked` `hideTitle` (K5), `PhoneDetails` (K6 to K8), `Sheet` props `tall` and `phoneHeader`, `Tabs variant="pill" spread` (track S).
- Produces: `export function PhoneBody(props: { panel: TaskPanel }): JSX.Element`.

- [ ] **Step 1: Write the failing test** (`PhoneTaskSheet.test.tsx`, `phone: true`, real `ProjectTaskSheet`; a spy wrapper of `Sheet` records its props):
  ```tsx
  it('passes tall and a phoneHeader to the Sheet', ...)
  it('names the dialog by the task title and keeps the sr-only title with data-sheet-title', ...)
  it('draws the blocks in the order of the design', ...)    // project link, Focus button, Close, title, state line, next step, tablist, People group (compare DOM positions)
  it('draws the office note under the state line for an office to-do', ...)
  it('draws one main button for each next step kind', ...)  // a table of users and to-dos: review, take, complete, waiting, new version, join, none -> '.signature' count <= 1 in Details and in Conversation
  it('gives every row a labelled native control', ...)      // for each [data-row-control]: select, switch, input has an accessible name
  it('shows a reader no control', ...)                      // outsider: no select, no switch, no textarea, no checkbox that can change
  it('switches to the Conversation with the pill, keeps role=tab named Conversation (n), and the link thread=1', ...)
  it('docks the box and hides the heading in the Conversation view', ...)
  it('keeps the next step slot in both views and turns its button secondary in the Conversation', ...)
  it('opens the Conversation first for a link with thread=1', ...)
  it('closes the panel by the X and by Back, and saves a typed description at close', ...)
  it('keeps the Focus button', ...)                         // click -> useFocusLink opens focus mode
  it('does not change the desk panel', ...)                 // desk width: label 'Title' field, tab 'Details', no [data-next-step]
  ```
- [ ] **Step 2: Run it and see it fail.** `npx vitest run src/features/project/tasks/PhoneTaskSheet.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: it fails (the phone still draws the desk body).
- [ ] **Step 3: Implement.** `PhoneBody` is one `div ref={panel.root} className="flex flex-col gap-4 pt-1"`: `TitleBlock`, `StateLine`, the office note, `NextStep demote={panel.section === 'conversation'}`, `Tabs variant="pill" spread` (label `taskSheet.sections`, `idPrefix="task-section"`, same options and `panel.setSection` as the desk), then a `TabPanel`: Details gives `PhoneDetails`, Conversation gives `CommentThread` with `docked hideTitle` and the same props as `DeskBody`. End with `{panel.back.sheet}{panel.dates.sheet}`. In `TaskSheet`, add `tall` and `phoneHeader={phone && task.data ? <PhoneHeader data={task.data} /> : undefined}`; `headerAction` (Focus) stays as it is. `taskPanelReads` does not change.
- [ ] **Step 4: Run the test, TASK-TESTS, `npx vitest run src/app/firstLoadImports.test.ts --no-file-parallelism` and `npm run typecheck`.** Expected: PASS. The new files load only through `TaskSheet.tsx`.
- [ ] **Step 5: Commit.** `git add` the three files and `git commit -m "Task panel: show the new body on a phone and wire the Sheet props"`

---

### Task K10: Browser specs for the panel at 390 px

**Files:**
- Modify: `tests/e2e/toastUndo.spec.ts`, `tests/e2e/calm.spec.ts`, `tests/e2e/menus.spec.ts`
- Create: `tests/e2e/phoneTask.spec.ts`
- `tests/e2e-deploy/walk.spec.ts`: no edit. It uses only the kept hooks (`#task-owner`, `#task-status`, `#task-review`, `#task-note`, the region "Review", "Approve", "Send back"). Check this with `grep -n "task-" tests/e2e-deploy/walk.spec.ts`.

**Interfaces:**
- Consumes: the finished panel (K1 to K9). The builder writes the specs and does not run them. The lead runs them in the join task L4 through a Playwright agent.
- Produces: four spec changes.

- [ ] **Step 1: Write the specs** (they are the tests):
  ```ts
  // toastUndo.spec.ts: in deleteAComment, after the Conversation tab opens
  const box = await sheet.getByRole('textbox', { name: 'Add a comment' }).boundingBox();
  const frame = await sheet.boundingBox();
  expect(frame!.y + frame!.height - (box!.y + box!.height)).toBeLessThan(160);   // the box sits at the bottom of the sheet
  // calm.spec.ts
  test('the task panel at 390 px has one main button in each view', ...)  // tsk_007 and tsk_010 (Hala is the Admin): dialog.locator('.signature') count <= 1 in Details and in Conversation; tsk_010 shows Approve as the one
  // menus.spec.ts, in the read only test, only when width === 390
  await expect(page.getByRole('dialog').locator('select, textarea, [role="switch"], input:not([type="hidden"])')).toHaveCount(0);
  await expect(page.getByRole('dialog').getByText(/You can view this to-do/)).toBeVisible();
  // phoneTask.spec.ts: viewport 390 by 844, touch; for kind in [review, take, complete, waiting, new version, join, none] x lang [en, ar] x theme [light, dark]
  //   open the panel, check window.innerWidth === 390, save a PNG to the scratchpad folder
  //   probe: Focus, Close, the pill tabs, the main button, a Remove helper X and a checklist grip have height >= 44 (getBoundingClientRect) and elementFromPoint at their centre is the control
  ```
- [ ] **Step 2: Check the specs list and compile.** `npx playwright test --list tests/e2e/phoneTask.spec.ts tests/e2e/calm.spec.ts tests/e2e/menus.spec.ts tests/e2e/toastUndo.spec.ts` and `npm run typecheck`. Expected: the new tests list with no error. Do not run a browser here: Playwright runs only in a delegated agent.
- [ ] **Step 3: Implement.** Only the specs above. Use the same fixtures and shot folder style as `menus.spec.ts`.
- [ ] **Step 4: Run the type check and the unit tests of the track once.** `npm run typecheck` and TASK-TESTS. Expected: PASS.
- [ ] **Step 5: Commit.** `git add tests/e2e/toastUndo.spec.ts tests/e2e/calm.spec.ts tests/e2e/menus.spec.ts tests/e2e/phoneTask.spec.ts && git commit -m "Task panel: add the browser specs for the phone panel at 390 px"`

---

**Review focus candidates:** each is an input a person on a phone will meet. The owning task holds its test.
1. A title of 280 characters with no space, or a long Arabic project name next to an English title. The top row and the title must wrap or cut and must not push the X off the screen. Test: K3 (`keeps the title of 280 characters in one wrapped block and cuts the project name`).
2. A person types a title, a description or a new checklist item, then taps outside the sheet or presses Back. The text must save. Tests: K3 (`saves a typed title when the panel closes by a tap outside`), K7 (`saves a typed new item when the panel closes`), K9 (`saves a typed description at close`).
3. A double tap on Mark done or Approve on a slow network. Only one call may go out. Test: K4 (`ignores a second tap while the call runs`).
4. A checklist of 40 long items, where a finger lands on the grip, the text or the X. The tap on the text ticks once, the grip never ticks, and the sheet does not drag with the grip. Tests: K7 (`does not tick when the grip is tapped`, `keeps 40 long items in one list`, `marks it data-vaul-no-drag`).
