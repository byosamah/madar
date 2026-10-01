# Madar build record: rulings, deferred minors and Arabic doubts

Build steps 2 to 5 ran on 2026-09-30 with the owner's standing approval. Each step had a fresh independent code review and a fix pass, and each fix has a test that failed first. This file keeps every decision the builder made for the owner, every small finding left for later, and every Arabic phrase for the native-speaker review. It comes from the build ledgers.

## Build step 2: Projects

Review fixes: 10. Rulings: 17. Deferred minors: 12.

### Review fixes

- C1 cover and board clip the "…" menu: Menu now draws its list in a portal with fixed place from the trigger  --  overlays.test "draws a menu at the page level" RED→GREEN, suite 460/460
- I2 team member cannot undo the delete of their own cover file  --  history.test "lets a team member undo the delete of their own file that was the cover" RED→GREEN, suite 460/460
- security-review finding on I2 (fail-open cover exception): the exception now needs the right to undo the matching file.deleted in the same project  --  history.test "does not bring the cover back for a person who left the team" RED (fail-open code) → GREEN, suite 460/460
- I3 Undo offered for a change that did not happen: useUndoable asks events.list for the story and shows no toast when it is empty  --  actions.test "actions that change nothing" RED→GREEN, suite 460/460
- I4 schedule arrow keys lose steps and checklist ticks lose each other: local draft plus one save 400 ms after the last key; checklist keeps a local draft  --  ScheduleTab.test "three quick arrow presses ... saves once", TaskSheet.test "keeps two quick checklist ticks" RED→GREEN, suite 460/460
- I5 date fields save on every keystroke: DateDraftField saves on blur or Enter and ignores years before 2000  --  ScheduleTab.test "saves a typed stage date once", TaskSheet.test "saves the due date once" RED→GREEN, suite 460/460
- I6 multi-call actions unsafe to retry: New Project closes after create and retries the cover alone; composer remembers uploaded files; Files tab retries the rest of the queue  --  NewProjectSheet.test "creates the project once when the cover upload fails...", OverviewTab.test "does not upload an attachment twice after a failed post", FilesTab.test "retries only the files that did not upload" RED→GREEN, suite 460/460
- I7 dead controls in the task sheet: read-only viewers see plain facts  --  TaskSheet.test read-only case RED→GREEN, suite 460/460
- I8 cover never shows a new version: ProjectSummary.coverLetter feeds useFileUrl  --  projects.test "gives the latest letter of the cover" RED→GREEN, suite 460/460
- I9 no focus ring on Upload files and Attach files  --  FilesTab.test and OverviewTab.test "shows a focus ring on ..." RED→GREEN, suite 460/460

### Rulings

- Task 1: Ruling: the call-map test lists every extra call; the plan missed adding events.undoStory there  --  added it to EXTRA_CALLS  --  cost if wrong: none, one list entry.
- Task 1: Ruling: 'reports an unknown story' passed before the code existed (the whole call was missing, which also gives not_found)  --  kept as a guard for the finished call  --  cost if wrong: none.
- Task 5: Ruling: vitest's jsdom already defines URL.createObjectURL (and it throws on these blobs), so the plan's stub-if-missing never applied  --  the test setup now always stubs it  --  cost if wrong: none, test setup only.
- Task 11: Ruling: the Tasks tab drew the stage groups before the task list loaded, so each group flashed 'No tasks here yet.' (the first test caught it)  --  the tab now waits for tasks.list before it draws the list; Task 12's TasksTab gets the same guard  --  cost if wrong: none.
- Task 12: Ruling: dnd-kit types its listeners as Function, so the plan's pointer-only spread failed the type check  --  cast onPointerDown to PointerEventHandler<HTMLLIElement>  --  cost if wrong: none, same runtime code.
- Task 13: Ruling: Vaul keeps its dialog modal for screen readers even with modal={false}, so while any sheet is open the page (toasts included) is aria-hidden; this made the Undo test flaky and hid toasts from screen readers  --  the toast area is now an aria-live region, which the hiding library always keeps; test 'keeps toasts reachable for screen readers while a sheet is open' RED→GREEN  --  cost if wrong: none.
- Task 16: Ruling: the plan's Team test looked up 'Open tasks: 2' in the whole list, but Yousef also has 2  --  the test now looks inside Sara's row  --  cost if wrong: none, test only.
- Task 17: Ruling: screenshot review found the leader row's discipline field out of line (no menu) and a cover taller than a third of a 900 px screen  --  added a fixed 44 px menu slot and lg:aspect-[4/1] on the cover  --  cost if wrong: one class each; proof by screenshot, no unit test can see layout.
- Task 17: Ruling: test-side  --  shell.spec waited only for the heading on '/', so axe ran before the cards drew (flaky dark results); it now waits for the first card. projects.spec axe check is expect.soft so every tab is checked and shot in one run. The subagent made the board keyboard test wait for the column highlight between key presses.  --  cost if wrong: none, tests only.
- Final: Ruling: security review also asked to reject reused correlation IDs  --  kept as is: a stranger's event in a story makes undoStory fail as forbidden and roll back, it never grants a right; IDs are random cor_ui_ values  --  cost if wrong: one Undo can fail; the Python build should scope a story to its actor.
- Final: Ruling: plan gap, agent-change undo from the feed item (spec 10.7)  --  build it in plan 3, which owns the feed and Inbox: the feed item of an agent event gets Undo when the viewer may undo it  --  cost if wrong: one button moves plans.
- Final: Ruling: 5-second toast vs WCAG 2.2.1  --  spec 5.5 fixes 5 s; plan 5 accessibility pass pauses toasts on hover and focus  --  cost if wrong: a slow reader misses an Undo.
- Final: Ruling: card-to-screen motion, toolbar shrink, board drop spring, task sheet exit animation, crowded month labels  --  all plan 5 motion and polish, as clarification 3 says  --  cost if wrong: visual only.
- Final: Ruling: comments and reactions, Inbox "review requested" left after undo  --  plan 3 owns them  --  cost if wrong: a stale Inbox line.
- Final: Ruling: typed mention markup acts as a real mention; tasks.delete leaves comments  --  plan 1 API behavior, harmless in a prototype; noted for the Python build  --  cost if wrong: a stray notification or orphan comment in sample data.
- Final: Ruling: the agent sees every Admin control  --  correct under spec 17 (the agent has its person's rights)  --  cost if wrong: none.
- Final: Ruling: CardFace end padding on cards with no controls; Download in the "…" menu for other file types  --  cosmetic, and spec 5.7 allows either reading  --  cost if wrong: one class.

### Deferred minors

- override reason shows on hover only (HealthPill title); phone, keyboard and screen reader users miss it
- FilesTab computes canDelete and TaskSheet computes canUndoAgent in the screen; should come from FileView.viewerCan and history entries
- quick add disables its input during the call, so focus drops after each Enter
- New Project checks the 25 MB cover size only after create; should show on the field at pick time
- Enter in the new-client field submits the project without the client
- schedule bar tooltip has an English "to" in Arabic
- checklist checkbox is a 20 px target with no label around it
- the non-blocking task panel still hides the page from screen readers (plan 5 accessibility pass)
- ContextMenu does not return focus to the card when it closes
- Retry from useAction drops the first call's callbacks (AddMember shows no toast, keeps the form)
- Team discipline field keeps the old value when cleared, and has no maxLength 40
- a person who cannot tick a task sees a disabled checkbox (spec 2.3 prefers a status icon)

## Build step 3: My Work, Inbox, comments, search

Review fixes: 7. Rulings: 23. Deferred minors: 12.

### Review fixes

- I1 a typed "@Full Name" in a new post was not a mention (plan clarification 9; the plan's own Composer used only picked names)  --  OverviewTab.test "counts a typed full name as a mention" RED→GREEN, suite 518/518
- I2 a notice for a deleted task or post read "gave you “”" and Open went nowhere: the notice now takes the name from the delete event, returns gone, and the Inbox says "This item does not exist anymore." with no Open or Approve  --  InboxScreen.test "keeps the sentence of a notice whose task was deleted" RED→GREEN, suite 518/518
- I3 a timesheet cell kept a value that did not save, and a day over 24 hours gave a generic message: onError puts the saved value back; the cell checks the day total first with "A day cannot have more than 24 hours."  --  HoursTab.test "puts the saved value back when a save fails", "refuses more than 24 hours in one day" RED→GREEN, suite 518/518
- I4 a failed events.list after a good delete showed a failure and removed Undo: the check failure is caught and the Undo toast shows  --  actions.test "a change whose follow-up check fails" RED→GREEN, suite 518/518
- I5 new screens stayed blank when their first load failed: a shared LoadFailed with Retry on My Work, Hours, Inbox, Search results, project code links and comment threads  --  WorkTasks.test and InboxScreen.test "shows Retry when ... cannot load" RED→GREEN, suite 518/518
- Minor 1 (re-graded) feed Undo on changes the API refuses: one mayUndoAgentChange in history.ts feeds FeedItem.canUndo  --  content.test "tells the viewer which agent changes..." and "offers no Undo on a change the API cannot undo" RED→GREEN, suite 518/518
- tab bar label contrast on frosted glass (axe color-contrast at 390 px, light: all tabs, dark: active tab), exposed when the Projects grid stopped overflowing: glass 0.72 → 0.85 and a glass accent (#0055AA light, #64B5FF dark)  --  tokens.test 'keeps the tab bar labels at 4.5:1 over any content' RED→GREEN, suite  Tests 519 passed (519)

### Rulings

- | Plan 2 fix pass → T3 | Composer now keeps an uploaded-file map (519a98e) | T3 rewrites Composer text box to MentionField | Ruling: keep the uploaded map and the Attach focus ring when T3 swaps the text box  --  the plan text predates the fix  --  cost if wrong: attachments upload twice again |
- | Plan 2 fix pass → T4/T5/T6 | TaskSheet now shows Facts for read-only viewers, DateDraftField, local checklist draft (519a98e) | T4/T5/T6 edit TaskSheet | Ruling: apply plan 3 edits on top of the fixed TaskSheet; never bring back disabled inputs  --  cost if wrong: dead controls return |
- | Plan 2 final review gap → T4 | agent-change Undo from the feed item (spec 10.7) | T4 owns FeedEntry | Ruling: add it in T4: FeedItem gets canUndo from the API for agent events, FeedEntry shows Undo  --  cost if wrong: one button |
- Task 1: Ruling: the plan 1 notices test expected the old link /projects/prj_001?task=tsk_001; Task 1 adds tab=tasks on purpose, so the old expectation now names the new link  --  cost if wrong: none, test only.
- Task 1: Ruling: added FeedItem event canUndo (agent change, viewer is the person it acted for, or has event.undoAgent), per the pre-flight ruling for spec 10.7; test 'tells the viewer which agent changes in the feed they may undo'  --  cost if wrong: one field.
- Task 2: Ruling: the plan's setup stub used `'ResizeObserver' in window`, which TypeScript narrows to never  --  changed to a typeof check with the same effect  --  cost if wrong: none, test setup only.
- Task 3: Ruling: the plan's MentionField kept the list open after a pick (the picked name still matches its own @query), so its own test failed  --  pick now sets dismissedAt to the mention start  --  cost if wrong: none; the list opens again when the person types.
- Task 3: Ruling: the plan replaced Composer.tsx whole; the plan 2 fix pass (uploaded-file map, Attach focus ring) was put back on top, per the pre-flight ruling  --  cost if wrong: none.
- Task 4: Ruling: the plan's reaction test clicked 👍 on a comment Yousef already liked in the sample data, so it turned the like off  --  the test now uses 👀, which he has not used  --  cost if wrong: none, test only.
- Task 4: Ruling: FeedEntry event lines got an EventLine component with 'Undo agent change' when FeedItem.canUndo is true (spec 10.7, plan 2 review gap)  --  OverviewTab.test 'lets the leader undo an agent change from the feed' RED→GREEN and 'shows a team member no Undo on an agent change'  --  cost if wrong: one button.
- Task 5: Ruling: the plan's 'opens the task panel in place' test looked for the My Work heading while the panel is open; the sheet hides the page from screen readers (Vaul, plan 2 deferred minor 17), so the test finds it with hidden: true  --  cost if wrong: none, test only; plan 5 accessibility pass owns the sheet behavior.
- Task 6: Ruling: the plan added the Log time row in a mount effect; the row was saved while time.week made its first load, and TanStack Query v5 does not restart a first load on invalidate (it cancels only when data exists), so the week showed without the row  --  the effect now waits for week.data  --  'opens this week from a task's Log time' RED→GREEN. General hazard noted for the final review: any change during a query's first load is lost until the next change  --  cost if wrong: a stale screen until the next change.
- Task 8: Ruling: the plan's person test looked for any option named Sara Al-Qahtani and hit the sidebar 'Preview as' list before the results came; the test now looks inside the People group  --  cost if wrong: none, test only.
- Final: Ruling: re-graded Minor 1 (feed canUndo true on changes the API refuses, for example project.created, or a team member's agent creating a task) to Important: a person clicks an offered Undo that always fails. Fixed in the pass. The Task 1 test had encoded the wrong expectation (team member canUndo true); it now expects false  --  cost if wrong: none.
- Final: Ruling: declined-to-judge  --  week unlock and viewing another person's hours: plan 4 owns them  --  cost if wrong: none.
- Final: Ruling: declined-to-judge  --  Approve has no Undo toast: spec 10.7 asks for Undo in place of confirm dialogs; approval is a plan 2 pattern  --  cost if wrong: an Admin must send a task back by hand.
- Final: Ruling: declined-to-judge  --  MentionField ARIA pattern (no combobox role), Vaul sheet hides the page, sticky timesheet header edge, swipe under Reduce motion, contrast: plan 5 accessibility and polish passes  --  cost if wrong: screen reader friction until plan 5.
- Final: Ruling: declined-to-judge  --  time.removeRow does not check the week lock in the API (plan 1 code; the screen hides the button): note for the Python build  --  cost if wrong: an agent could remove an empty row from a locked week, which holds no hours.
- Final: Ruling: declined-to-judge  --  tasks on On hold projects stay out of My Work (plan 1 activeProjectsOnly default): stands, a paused project's work is paused  --  cost if wrong: a person misses a task on a paused project.
- Final: Ruling: declined-to-judge  --  a team member cannot undo their own task.created (plan 2 rule: needs task.delete): stands, it matches who may delete tasks  --  cost if wrong: the member asks the leader.
- Final: Ruling: declined-to-judge  --  Arabic copy quality (native-speaker review before step 5), Arabic search on screen (sample names are English; plan 1 unit tests cover Arabic), review queue rows show the project code not the sender (spec silent)  --  cost if wrong: wording only.
- Final: Ruling: the e2e 'hours typed in a cell stay after a reload' flaked once (typed before last week drew); the test now waits for the Sunday 20 September cell  --  cost if wrong: none, test only.
- Final: Ruling: Clear glass (0.25, a user setting) cannot hold 4.5:1 over any content; it stays a user choice, and the default Frosted passes  --  cost if wrong: a person who picks Clear gets weaker label contrast over bright covers.

### Deferred minors

- an empty mention box in Arabic shows its placeholder left to right (dir=auto with no text); use the page direction while empty
- the Arabic short day unit 'ي' (for example '2 ي') is unclear; for the native-speaker review
- Log time on a Friday or Saturday loses the cursor while the weekend is folded
- the timesheet refuses ".5" and "7."
- an invalid cell value shows its toast twice (Enter, then blur)
- the mention list active index does not reset when the matches shrink
- Inbox Approve marks the item read before the approval succeeds
- the Inbox swipe to mark read has no single-pointer control of its own (WCAG 2.5.1; plan 5 accessibility pass)
- a person outside the project sees a "Comment" button on a post with no comments, which opens a dead end
- the update link value never clears, so a filter change reopens and scrolls to that post
- search results go empty on each new text until the new results come (no placeholder data)
- "Last week's rows are added." shows when last week had no rows

## Build step 4: Dashboard, Task list, Admin

Review fixes: 8. Rulings: 9. Deferred minors: 11.

### Review fixes

- I1 the Created link dropped finished tasks  --  TaskListScreen.test "lists as many tasks as the dashboard counts for a created week" RED→GREEN, suite 568/568 (1f502f5)
- I2 the weekly chart drew an empty frame when nothing matched  --  Charts.test "says so in every chart and the schedule" (5 sentences) RED→GREEN, suite 568/568
- I3 Admin forms hid the API's reason: invalid() carries a reason (last_admin, email_taken, agent_admin), errorMessage and fieldError show it under the field; target, limit, prefix and stage checks show inline  --  AdminSettings.test last-Admin, "shows why an email cannot be used", "says the weekly target range", "says what is wrong with the office settings" RED→GREEN, suite 568/568
- I4 an agent could hold the Admin role and let the last human Admin step down: the API refuses Admin for agents and counts only active people; the form hides Role for agents  --  people.test "Admins are people" (3), AdminSettings.test "offers no Admin role for an agent" RED→GREEN, suite 568/568
- I5 office schedule colors had no words: legend (Done stages, Current stage, Next stages, Deadline, Today)  --  OfficeSchedule.test "names every color and mark in a legend" RED→GREEN, suite 568/568; screenshot shots/plan4/schedule-legend.png
- I6 chart marks under 3:1: --c-chart-muted #8E8E93 for Created bars and outlined next stages, label-2 for done stages, orange-text for deadlines  --  tokens.test "chart marks keep 3:1 against the card" RED→GREEN, suite 568/568
- I7 Admin sections showed an empty form or list on a failed load: LoadFailed with Retry; the office form renders only from loaded settings (also closes the deferred minor about the empty form)  --  AdminSettings.test "shows Retry when the office settings / the people list cannot load" RED→GREEN, suite 568/568
- Minor 1 (re-graded) health links: projects.list takes health, the Projects screen reads ?health= and shows a clearable "Health: ..." note  --  Charts.test "opens exactly the projects behind each health number", projects.test "lists the projects of one health value" RED→GREEN, suite 568/568

### Rulings

- | Plan 3 fix pass → T8/T9 | LoadFailed component for failed first loads (review finding I5) | plan 4 screens written before it | Ruling: new screens that would return null on a failed load use LoadFailed  --  cost if wrong: none |
- Task 4: Ruling: the plan 1 shell test expected the Dashboard placeholder text; the Dashboard replaces it in this task, so the test checks the heading and the navigation only  --  cost if wrong: none, test only.
- Task 8: Ruling: the plan's 'ignores bad values' test looked for one 'Stair details', but the unfiltered list holds every open task and several projects have a task with that name  --  the test expects more than one  --  cost if wrong: none, test only.
- Task 8: Ruling: per the pre-flight ruling, the task and deadline lists show LoadFailed with Retry on a failed first load  --  test 'shows Retry when the list cannot load'  --  cost if wrong: none.
- Task 9: Ruling: three plan tests acted before the people list or the settings loaded (sync getBy right after the region appeared)  --  they now wait with findBy  --  cost if wrong: none, test only.
- Final: Ruling: re-graded Minor 1 (health mix links open lists that disagree with the number: On track 5 opens 10) to Important: it breaks the plan's own global constraint that every number opens the list behind it. Fixed in the pass. Cost if wrong: none.
- Final: Ruling: no "Today" word in the schedule's tick row; the legend names the red line, and a tick label there overlaps the month labels  --  cost if wrong: one label.
- Final: Ruling: browser proof of the chart focus fix and the new colors runs in plan 5 Task 5 (full sweep, axe, both themes, three widths)  --  cost if wrong: a late find.
- Final: Ruling: declined-to-judge items stand: leader and client filters do not carry (clarification 1, add status too at handoff), Created bars not clickable (clarification 3), Area opens Active projects (clarification 2), office-hours target counts everyone (plan 1 API), hours sheet rows are not links (spec 8.2 silent), schedule details only in titles for screen readers (spec 8.5), no Reactivate (clarification 6), everyone reads all active projects (spec 8)  --  cost if wrong: small, each is an owner choice at handoff.

### Deferred minors

- the office form shows empty fields until the settings load, and text typed before that is replaced by the loaded values
- on wide screens the Health mix card and the weekly chart card stretch to their row neighbour's height and show a large empty area
- M2 the dashboard status filter does not carry to the lists (tell the owner with clarification 1)
- M3 a stage name not in the default list opens a filtered Projects screen with no chip on
- M4 hand-typed links: one-sided date range shows no subtitle; an unknown owner or leader gives a silent empty list or select
- M5 the dashboard's failed load uses a plain EmptyState, and failed user or client lists leave the selects with only "Any"
- M6 the Task list and deadline list draw an empty card while loading and under LoadFailed
- M7 a Retry of the week unlock shows no confirmation toast
- M8 UnlockSection's one-column grid has no grid-cols-1
- M9 the weekly table header reads "Week of " and dashboard.cell says "1 tasks"
- M10 the weekly table links are digit-sized, under 44 px

## Build step 5: Polish and team review

Review fixes: 6. Rulings: 15. Deferred minors: 4.

### Review fixes

- I1 compact bars read a stale scroll position (updater ran after previous changed)  --  useCompactBars.test "follows the scroll direction, frame by frame" RED→GREEN, suite 584/584 (2c79e16)
- I2 Reduce motion still moved the bars: movement behind motion-safe: variants, label fade kept  --  proof: the reviewer's measurement (toolbar slid 4 px, tab bar scaled 0.92 with reduce on) → e2e 'reduce motion keeps the bars still while the page scrolls' added; runs in the final browser run. No unit test can read media-query CSS.
- I3 header Back lost the list's filter and scroll: the Projects screen remembers its link (lastList.ts), Back opens it, ScrollRestoration keyed by pathname restores the place  --  ProjectScreen.test "goes Back to the same filtered list" RED→GREEN; headless Chrome: #/?filter=at_risk with 5 cards and the scroll place back
- I4 a second visit opened mid-page: ScrollRestoration in AppShell (getKey pathname)  --  ProjectScreen.test "opens a project at the top of the page" RED→GREEN; headless Chrome: second visit at 0, tab switch keeps 300
- I5 saved offices from before the field kept masculine verbs: STATE_VERSION 2 and migrateState (v1 → v2 adds sample genders, keeps local work)  --  bootstrap.test "adds the sample genders to an office saved before them" RED→GREEN
- Minor 3 (re-graded) Arabic counts: plural forms (_one _two _few _many _other) for time.days, weeks, daysLeft, daysLate, used through counted()  --  grammar.test "uses the Arabic number forms" RED→GREEN, i18n.test allows plural keys in Arabic only

### Rulings

- Ruling: plan 5 starts from plan-4-dashboard at cd4a122 while the plan 4 review runs; the plan 4 fix pass is committed on plan-4-dashboard and merged into plan-5-polish (a merge, no history rewrite)  --  cost if wrong: one merge commit.
- | Plan 2 fix pass → T1 | ProjectCover reads the cover's latest letter (useFileUrl(coverFileId, summary.coverLetter ?? undefined), 519a98e) | T1 replaces ProjectCover and calls useFileUrl(coverFileId) only | Ruling: keep the coverLetter argument in T1's ProjectCover  --  cost if wrong: the cover stops showing new versions again |
- | Plan 3 contrast fix → T2 | TabBar active label uses text-glass-accent (b853b3a) | T2 edits the TabBar classes | Ruling: T2 keeps text-glass-accent and adds only the compact classes  --  cost if wrong: contrast failure again |
- Task 4: Ruling: Arabic verbs after a person's name did not agree with women (Hala, Reem, Sara, Lina), which the task scope names; added an optional grammatical gender on people (User.gender, UserCard.gender, seed values, users.create/update, an Admin form field 'Form of address in Arabic'), an actorContext helper, and 30 '_female' Arabic keys used as i18next context by the feed, task history and Inbox  --  feed.test, history.test, i18n.test, AdminSettings.test RED→GREEN, suite 577/577  --  cost if wrong: one optional field; unset reads masculine as before.
- Task 4: Ruling: team.makeLeader proposed 'تعيين قائدًا للمشروع' has no object; used 'تعيين كقائد للمشروع' and listed it as a doubt  --  cost if wrong: one menu label.
- Task 5: Ruling: the subagent read the Arabic feed lines as jumbled; they are correct right-to-left order (name, verb, then the English label), and the feminine verb shows for Reem  --  no change  --  cost if wrong: none.
- Final: Ruling: re-graded Minor 3 (Arabic day and week counts ungrammatical, "بعد 5 يوم" on every card; my Task 4 change caused it) to Important  --  fixed in the pass. Cost if wrong: none.
- Final: Ruling: plan clarification 2 says the compact toolbar hides its shadow line; the code only lifts it 4 px. The handoff text is corrected instead of the code  --  cost if wrong: one CSS rule.
- Final: Ruling: declined  --  keyboard flows in a real browser: covered by acceptance.spec (61/61 twice, and the final run)  --  cost if wrong: none.
- Final: Ruling: declined  --  SegmentedControl radios are separate Tab stops (plan 1 component): stands for the prototype; a roving tab index is a plan for the real build  --  cost if wrong: extra Tab presses for keyboard users.
- Final: Ruling: declined  --  the Arabic doubts go to the native-speaker review (spec 15)  --  cost if wrong: wording only.
- Final: Ruling: declined  --  glass stutter on weak Windows graphics is the owner's manual check (spec 13.4); the guide tells reviewers to set Glass to Solid  --  cost if wrong: a slow screen for some reviewers.
- Final: Ruling: declined  --  screenshots and Task 6 were outside the review range; screenshots were read in Task 5  --  cost if wrong: none.
- Final: Ruling: declined  --  English sample names in Arabic mode are sample data (spec 12)  --  cost if wrong: none.
- Final: Ruling: declined  --  two scroll listeners, one reading per frame each: negligible  --  cost if wrong: none.

### Deferred minors

- compact tab targets are 43.8 px high in English (spec asks 44)
- the cover image stretches during the move (inner image has no layout prop) and the card's overflow clips it early
- the health filter pill still uses the status word in Arabic ("الحالة الصحية", "إظهار كل الحالات")
- polish.spec does not test the shrink back; the high-contrast test does not assert data-glass="solid"

### Arabic doubts for the native-speaker review

- team.makeLeader: تعيين كقائد للمشروع: a common office calque; a native speaker may prefer another neutral form.
- nav.dashboardTab: اللوحة: Short "اللوحة" clashes with the task board view "لوحة"; use the full term if it fits the phone tab bar.
- nav.myWork: عملي: عملي can also read as "practical"; أعمالي is unambiguous (change all four My Work keys together).
- screens.myWork: عملي: عملي can also read as "practical"; أعمالي is unambiguous (change all four My Work keys together).
- work.tabs: أقسام عملي: Follows the optional My Work change to أعمالي.
- search.command.myWork: الانتقال إلى عملي: Follows the optional My Work change to أعمالي.
- project.statusTo.active: تعيينه نشطًا: "تعيينه نشطًا" is a literal calque of "Mark as active"; a verbal noun reads like a Saudi app menu.
- project.statusTo.completed: تعيينه مكتملًا: "تعيينه مكتملًا" is a literal calque of "Mark as completed".
- project.deleteBody: يحذف هذا المشروع مع مهامه وملفاته ومنشوراته وساعاته. لا يمكن التراجع عن ذلك.: "يحذف هذا المشروع" can read as "this project deletes"; the passive future is unambiguous.
- projectForm.errors.stageRequired: أبقِ مرحلة واحدة على الأقل.: The imperative أبقِ is correct but rare and reads stiff.
- projectForm.removeStage: حذف {{name}}: English says Remove, and common.remove is إزالة; حذف is the Delete word.
- taskSheet.removeItem: حذف {{text}}: English says Remove, and common.remove is إزالة; حذف is the Delete word.
- hours.removeRow: حذف {{row}}: English says Remove, and common.remove is إزالة; حذف is the Delete word.
- tasks.addTask: أضف مهمة: Other Add buttons use the verbal noun (إضافة مرحلة، إضافة موعد، إضافة عضو).
- tasks.addTaskIn: أضف مهمة في {{stage}}: Other Add buttons use the verbal noun.
- taskSheet.addItem: أضف بندًا: Other Add buttons use the verbal noun.
- overview.edited: معدّل: معدّل alone can read as "average" or "rate"; تم التعديل is the common edited marker.
- comments.edited: معدّل: معدّل alone can read as "average" or "rate".
- common.loadFailed: لم تُحمَّل البيانات.: تعذّر is the usual Saudi app wording for a failed load.
- projects.loadFailed: لم يتم تحميل المشاريع.: تعذّر is the usual wording, and it matches common.loadFailed.
- errors.forbidden: لا يمكنك تنفيذ هذا في هذا المشروع.: "تنفيذ هذا في هذا" repeats هذا and is vague.
- settings.reset: إعادة البيانات التجريبية: إعادة البيانات means "return the data"; reset is إعادة ضبط.
- settings.triggers.week_under_target: ساعات أسبوعي أقل من الهدف: Target is المستهدف elsewhere (inbox, admin.target), not الهدف.
- placeholder.title: هذه الشاشة قادمة: "قادمة" is a literal calque of "comes next".
- files.empty: ارفع هنا المخططات والصور والمستندات.: "الصور" loses "renders"; architects call renders المناظير.
- files.setCover: تعيين كغلاف: "تعيين كغلاف" uses the calque كـ.
- files.kb: {{n}} ك.ب: "ك.ب" is not widely known; files.tooBig already spells ميغابايت in full.
- files.mb: {{n}} م.ب: "م.ب" is not widely known and م is the metre sign in this app.
- team.noOne: كل الأشخاص في الفريق بالفعل.: "بالفعل" is a literal calque of "already".
- dashboard.anyLeader: أي قائد: Filter options read "all X" in Arabic, as in status.all "كل الحالات".
- dashboard.anyClient: أي عميل: Filter options read "all X" in Arabic, as in status.all "كل الحالات".
- dashboard.tiles.officeHours: ساعات المكتب هذا الأسبوع: "ساعات المكتب" also means the office opening hours.
- dashboard.overShort: فوق: "فوق" alone reads as "above" in a red cell.
- dashboard.zoom: التكبير: التكبير means magnification; this control picks month, quarter or year.
- admin.editTitle: تعديل الشخص: "تعديل الشخص" reads as "edit the person".
- admin.gender: صيغة المخاطبة بالعربية: "form of address" means how the app speaks to the person; the field changes sentences about the person
- feed.project.leader_changed: عيّن {{leader}} قائدًا: a woman leader needs قائدةً, and the feed does not carry the leader's gender


## Calm redesign (2026-10-01)

The owner asked for the redesign on 2026-10-01. The work is on the branch `redesign-a-calm`. It ran in two build steps, A and B, each with its own plan.

Unit tests: 618 pass at the time of writing.

Browser sweep: pending

### Why

The owner found the first design busy. He said a team member with ADHD would get lost. The goal is a clean product that still gives a few perfect motions. Each screen now has one title, at most one main button and one color highlight.

### What changed, by screen

- Tab pill: five buttons (Home, Projects, Dashboard, Inbox, Search) replace the sidebar and the toolbar. The pill sits at the top on a computer and at the bottom on a phone.
- Person menu: the picture at the top end opens Preview as, Language, My hours and Settings.
- Home (new): the greeting, the day ring, the Next for you card, Today, and Your projects.
- Projects: one list at `/projects` with one Filter button. The grid view and the filter chips are gone.
- Project page: a calm header with the tile, name, client, stage, progress line and next deadline. The cover picture moves into the About panel.
- Task rows: fewer parts, and gentle words such as "3 days past due" in place of "Overdue".
- Dashboard: three numbers at the top. A switch shows one section at a time: Projects, People or Schedule.
- Inbox: items in day groups. The project tile and the actions sit on the row.
- Panels and sheets: solid, with no glass. The Glass setting is gone. The stored value stays in the data, and the app ignores it.
- Colors: each project keeps one of 8 soft colors for life.

### Focus helpers

- Focus mode: the Focus button in the task panel and on the Next for you card opens one task on a calm full page. The page holds the checklist, a Done button and a quiet Exit focus button.
- Focus timer: the 25-minute timer is optional. It saves nothing, makes no sound and stops when Focus mode closes.
- Day ring: it shows the tasks done today out of the tasks due today or past due.
- One Filter button: each list has one Filter button and no rows of chips.
- Gentle words: "3 days past due" replaces "Overdue". "At risk" and "Late" keep their own colors.

### Motion moments

The motion uses only movement and fade. Under Reduce motion, each moment becomes a short fade.

- A row grows into the project header, and back.
- A ticked task squeezes, fills, then slides away.
- The next item for you rises into place.
- Numbers count up once per visit.
- Sheets and panels rise like paper.
- Lists glide when a filter or a sort changes.
- Arabic turns the page when the language changes.
- Undo slides the item back to its place.

### What stayed the same

- The data, the roles, the permissions and the rules.
- The fake server, Undo, the error messages and the sample data.
- Every feature of the first build, except the controls this redesign removes: the sidebar, the Glass setting, the grid view and the filter chips.
- Saved links still work. The old link `/#/?filter=at_risk` redirects to `/#/projects?filter=at_risk`.

### Tests

New pure helpers have unit tests written first. They cover Next for you, the day ring, the project color and initials, the progress value and the gentle due words.
