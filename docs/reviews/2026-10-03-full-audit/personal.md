# Personal and list screens audit

Scope: Home, Focus mode, My tasks (`/work`), Task list (`/tasks`), Projects list and the new-project flow, Search, comments, attachments.
Method: I read each code path end to end. I proved the findings marked "Probe" with scratch tests over the sample office (`audit/per-probe/*.test.ts*`, run with a scratch Vitest config; nothing in the repo changed). The 84 existing tests for this area pass.

Sample people used below: Faisal Al-Harbi (usr_002, leader of KH-26-001), Reem Al-Ghamdi (usr_003), Omar Haddad (usr_004), Sara Al-Qahtani (usr_005), Yousef Saleh (usr_006), Khalid Al-Mutairi (usr_008).

## Findings

### PER-1 "Next for you" and the day ring push a helper to finish a task only the lead can finish
- Type: BUG
- Severity: MEDIUM
- Where: src/lib/home.ts:13-23, src/lib/home.ts:34-39, src/api/handlers/tasks.ts:147-148, src/features/home/NextCard.tsx:17-19
- What happens: Probe. Faisal creates a task on KH-26-001 with lead Sara, helper Yousef, due 60 days ago. Yousef opens Home -> the card says `Finish "Probe helper task"` with "Open task" and "Focus". The row has `canMove: false`, the task panel has no Done, Focus mode has no Done, and `tasks.complete` refuses ("You cannot do this."). The card stays on this task until Sara finishes it. The same task also counts in Yousef's day ring total and in "N things today", so his ring cannot fill by his own work. `tasks.list { filter: 'mine' }` returns lead and helper tasks, and `nextForYou`, `dueByToday` and `dayRing` never check `row.canMove`. Owner decision C2: "one lead finishes the task; helpers see it in their Tasks". Home must not tell a helper to finish it. On My tasks the helper row only shows a dimmed tick with no word that says "Helper" or who leads it.
- Fix idea: In `nextForYou`, `dueByToday` and `dayRing`, count only rows with `row.canMove` (or `task.ownerId === me`). Keep helper rows on `/work`, with a small "Helper · lead: Sara" line.

### PER-2 "Next for you" gets stuck on a task that waits for another task
- Type: BUG
- Severity: MEDIUM
- Where: src/lib/home.ts:16-21 (no `waitingFor` check); compare src/features/project/tasks/TaskRowItem.tsx:43-50
- What happens: Probe. Faisal adds "Probe prerequisite" (due in 5 days) and "Probe blocked" for Khalid (due 30 days ago, needs the prerequisite). Khalid's Home card says `Finish "Probe blocked"`. Its tick only shows the "waiting for" toast, Focus mode's Done fails ("Finish Probe prerequisite first."), and the card cannot move to anything he can do until Faisal finishes his task. The row has `waitingFor.tasks` set, but `nextForYou` ignores it. ADHD rule: one obvious next step that the person can actually take.
- Fix idea: Skip rows where `isWaiting(row)` in steps 2 to 4. Optionally show "Waiting for X" as context when every candidate waits.

### PER-3 Search finds nothing for a project code written as "#KH-26-014"
- Type: BUG
- Severity: MEDIUM
- Where: src/api/handlers/insights.ts:163-168, src/lib/text.ts:17-27
- What happens: Probe. `search.query { text: 'KH-26-001' }` returns the project. `search.query { text: '#KH-26-001' }` returns `{ projects: [], tasks: [], people: [], files: [] }`, so the screen says "No results for “#KH-26-001”". Comments and posts write project links as `#KH-26-001` (spec 7.2), so people will copy and paste that form. Spec 7.3: "Search finds projects ... by name and code."
- Fix idea: Strip a leading `#` (and `@`) from the query in `searchQuery` before matching.

### PER-4 A workload number on the Dashboard opens a Task list with more tasks than the number
- Type: BUG
- Severity: MEDIUM
- Where: src/features/tasklist/TaskListScreen.tsx:57-58,66 and src/api/handlers/tasks.ts:132 (`involves`: lead or helper) against src/api/handlers/insights.ts:113-114 (`t.ownerId === user.id`: lead only); link at src/features/dashboard/Workload.tsx:40
- What happens: Probe. Yousef is a helper on one task due this week. The workload grid shows "1" for Yousef this week. The cell opens `/tasks?owner=usr_006&from=2026-09-27&to=2026-10-03`, which lists 2 tasks ("Authority comments response" and the helper task). The title says "Tasks of Yousef Saleh". A person who clicks "1" and sees 2 tasks loses trust in both numbers.
- Fix idea: Pick one rule for "a person's tasks" and use it in both places (either count helper tasks in the workload, or add a `leadOnly` input to `tasks.list` for this link).

### PER-5 Picking a Stage in the Projects filter silently drops "Mine" and shows other people's projects
- Type: BUG
- Severity: MEDIUM
- Where: src/features/projects/ProjectsScreen.tsx:47-53, :65, :106, :113
- What happens: Probe. Faisal opens `/projects?filter=mine` (3 rows). In the filter popover he picks Stage "Schematic Design". The link becomes `?stage=Schematic+Design` (`filter=mine` is deleted), no "Show" radio stays checked, and the list shows "Eastern Shore Primary School", a project he is not on. Choosing "Mine" again deletes the stage. Spec 3.3 lists Show and Stage as separate choices in one filter, and `projects.list` already accepts `filter` and `stageName` together; the screen forces `filter: 'all'` whenever a stage is set.
- Fix idea: Keep `filter` and `stage` as two independent link values; send both to `projects.list`.

### PER-6 Focus mode does not let a helper tick the checklist
- Type: BUG
- Severity: MEDIUM
- Where: src/features/focus/FocusMode.tsx:36, :83; compare src/features/project/tasks/TaskSheet.tsx:304 and src/api/handlers/tasks.ts:313-316
- What happens: Probe. For helper Yousef, `tasks.get` returns `viewerCan.edit: false, contribute: true`. The task panel lets him tick items (`tick={viewerCan.contribute && !edit}`), and the API allows it. Focus mode uses `viewerCan.edit` only, so the same checklist is read-only there. Spec 5.1: "the checklist (tickable when the person may change it)".
- Fix idea: Use `data.viewerCan.edit || data.viewerCan.contribute` for the checkboxes in Focus mode.

### PER-7 Enter in the "New client" fields creates the project and throws away the client
- Type: BUG
- Severity: MEDIUM
- Where: src/features/projects/ProjectFields.tsx:82-92 (no Enter guard); the form and its submit button at src/features/projects/NewProjectSheet.tsx:100,104 and src/features/projects/EditProjectSheet.tsx:94,98; the guard that exists for the template name at src/features/projects/StageTemplatePicker.tsx:80-85
- What happens: In New Project, type a name, press "New client", type "Harbour Holding" in "Client name (English)", press Enter. The client fields sit inside `<form id="new-project">`, and the footer button `type="submit" form="new-project"` is the form's default button, so the browser submits the project form: the project is created with no client, the sheet closes and the typed client name, contact, phone and email are gone. In Edit project, the same Enter saves the project. The stage-template field already blocks Enter for this exact reason ("Enter must not send the project form that holds this field"); the client fields do not. Confirmed by code and the HTML implicit-submission rule; jsdom does not run implicit submission, so I could not show it in a test.
- Fix idea: Add the same `onKeyDown` Enter guard to the client fields (Enter adds the client), or render the client form outside the project `<form>`.

### PER-8 Closing the New Project sheet by accident loses the whole form
- Type: ADHD
- Severity: MEDIUM
- Where: src/features/projects/NewProjectSheet.tsx:29-35, src/components/Sheet.tsx:38-40
- What happens: Fill 8 fields of New Project, then tap the dim layer, press Esc, or swipe the phone sheet down (Vaul closes on all three). Press "New project" again -> every field is empty, because the sheet resets the form each time it opens. There is no "Discard changes?" step and no draft. ADHD rule: "nothing that resets or loses work by accident".
- Fix idea: Keep the values while the screen lives and reset only after a create or an explicit Cancel; or ask before closing a form with changes.

### PER-9 Focus mode never says why Done is missing, and shows Done on a blocked task
- Type: ADHD
- Severity: LOW
- Where: src/features/focus/FocusMode.tsx:35, :94
- What happens: (a) A task that waits for another task shows Done; pressing it gives an error toast ("Finish Probe prerequisite first."). The task row handles the same case with a "Waiting for …" line. (b) A task In review or Done opens in Focus mode (the task panel offers Focus for every task) with no Done button and no state word, so the person cannot tell whether the task is finished, waiting for review or not theirs. ADHD rule: clear state words.
- Fix idea: Show one state line under the title ("Waiting for review", "Done", "Waiting for X") and hide Done while the task waits.

### PER-10 My tasks shows the same task twice for a leader who is also a helper
- Type: ADHD
- Severity: LOW
- Where: src/features/work/WorkTasks.tsx:31-32, :57-60
- What happens: Probe. Faisal is a helper on Sara's task; Sara ticks it, so it goes In review. Faisal's `/work` lists it under "Waiting for my review" and again under its date group (`mine` includes helper tasks, and `includeDone: false` keeps In review). ADHD rule: one place for each thing.
- Fix idea: Remove rows that are already in the review group from the date groups.

### PER-11 Opening Focus from the task panel throws away a half-written comment
- Type: ADHD
- Severity: LOW
- Where: src/features/focus/focusLink.ts:13-21, src/features/home/HomeScreen.tsx:104, src/features/comments/CommentThread.tsx:130
- What happens: Open a task panel, type a comment in its Conversation, press "Focus". Focus mode deletes `task` and `project` from the link, which unmounts the panel; "Exit focus" brings the panel back with an empty comment box. The same loss happens when the person opens another task row while typing. Nothing warns the person.
- Fix idea: Keep the comment draft per target (for example in a small in-memory map keyed by `targetId`), or keep the panel mounted under Focus mode.

### PER-12 Home shows two counts for today that disagree
- Type: ADHD
- Severity: LOW
- Where: src/features/home/HomeScreen.tsx:67, :78-80
- What happens: Probe with the sample office. Omar's greeting says "2 things today" next to the ring "0 of 1" (the first count adds the review waiting for him, the ring does not). Faisal sees "2 things today" and no ring at all. ADHD rule: no duplicate counters, and one count should mean one thing.
- Fix idea: Use one number: either drop "N things today" when the ring shows, or count reviews in both.

### PER-13 A leader's paused or stale project disappears from Home
- Type: GAP
- Severity: LOW
- Where: src/features/home/HomeScreen.tsx:32 (no `status`, so `projects.list` uses its default `active` at src/api/handlers/projects.ts:68)
- What happens: Probe. Reem leads "Tamr Staff Housing" (KH-26-010), paused and Stale for 45 days. Her "Your projects" lists 3 other projects and not this one; it shows only on the Dashboard and on Projects with Status set to Paused. Spec 3.2 limits only the Admin's list to active projects; owner decision D7 asks for stale projects to stand out.
- Fix idea: For a non-Admin, include the person's paused projects (they already carry the Paused, Awaiting client or Stale word), or at least the stale ones.

### PER-14 Search results blank out between key presses and the search is gone after Back
- Type: ADHD
- Severity: LOW
- Where: src/features/search/SearchScreen.tsx:29-31, :87-88
- What happens: Each new query is a new query key with no previous data, so `Results` returns null for the API delay (120 ms) after each pause in typing: the list flashes empty, then refills. The search text lives in component state only, so after opening a result and pressing Back the field and the results are empty. ADHD rule: no flashing, nothing lost by accident.
- Fix idea: Use `placeholderData: keepPreviousData` for `search.query`, and keep the text in the link (`/search?q=`).

### PER-15 A file found by Search opens the Files tab but not the file
- Type: GAP
- Severity: LOW
- Where: src/features/search/SearchScreen.tsx:72; the Files tab reads no file from the link (src/features/project/files/FilesTab.tsx)
- What happens: Search "permit", choose a file -> the project opens on Files with every file listed and nothing selected; the person must find the file a second time. Tasks get `&task=` and open their panel; files get nothing.
- Fix idea: Pass `&file=<id>` and let the Files tab open that file's preview or scroll to its row.

### PER-16 The Area field refuses Arabic-Indic digits
- Type: BUG
- Severity: LOW
- Where: src/features/projects/projectForm.ts:30, src/features/projects/ProjectFields.tsx:206
- What happens: Probe. `validateProjectForm` with area `١٢٠٠` returns `{ area: 'projectForm.errors.areaNumber' }`. An Arabic phone keyboard (the field asks for `inputMode="decimal"`) can type these digits, and the person gets "must be a number" for a valid number.
- Fix idea: Convert Arabic-Indic and Persian digits (and the Arabic decimal mark) to Western digits before the check and the save.

### PER-17 Arabic uses one word for "past due" and for "Late"
- Type: ADHD
- Severity: LOW
- Where: src/i18n/ar.json:203 (`health.late` "متأخر"), :757 (`work.group.overdue` "متأخرة"), :1161 (`due.pastDue` "متأخرة 3 أيام"), :1214 (`home.projectCount`)
- What happens: The redesign (spec 5.4) splits the calm "past due" (Attention color) from the project health "Late" (Late color). In Arabic both read "متأخر/متأخرة", so a Late project row and a past-due task row use the same word in two colors. Also `home.projectCount` "{{n}} نشطة" has no Arabic plural forms ("1 نشطة", "2 نشطة").
- Fix idea: Use a distinct gentle phrase for past due (for example "فات موعدها منذ 3 أيام"), and add `_one/_two/_few/_many` forms for `home.projectCount`.

### PER-18 Task list: an empty panel under the load error, and empty states with no next step
- Type: GAP
- Severity: LOW
- Where: src/features/tasklist/TaskListScreen.tsx:33-35, :99-101; src/features/search/SearchScreen.tsx:33-35
- What happens: When `tasks.list` or `deadlines.list` fails, the screen shows the error and, under it, an empty list panel (the ternary renders the `<ul>` whenever data is missing); the same empty panel shows while loading. The empty state repeats the page title ("Past-due tasks" twice) and says "No tasks match this list." with no action; Search says "No results for …" with no hint. The brief asks that every list says what to do.
- Fix idea: Render the list only when `tasks.data` exists; add one action to each empty state (for example "Back to Dashboard", or "Search by name or code").

### PER-19 Editing a comment silently drops a mention of someone who left the team
- Type: BUG
- Severity: LOW
- Where: src/features/comments/CommentThread.tsx:42, :69; src/lib/text.ts:51-62; people list at src/features/project/tasks/TaskSheet.tsx:188
- What happens: A comment mentions Omar while he is on the team. Omar leaves the team. The author fixes a typo and saves: `plainText` turned the mention into "@Omar Haddad", and `withMentionMarkup` only re-links current members, so the saved comment loses the mention link. The same happens after a person changes their display name.
- Fix idea: Keep the original mention markup in the edit draft (map "@Name" back with the mentions already in the body), not only with the current team.

## Unconfirmed
- Phone bottom sheet: Vaul drags the whole sheet on phones (`handleOnly={!phone}`, src/components/Sheet.tsx:38), so a downward swipe at the top of a long form may close New Project; I could not test a touch drag here. If it does, PER-8 gets worse on phones.
- Focus checklist after a failed save: Focus mode (src/features/focus/FocusMode.tsx:50-54) and the task panel checklist (TaskSheet.tsx:55-62) keep the new tick on screen when `tasks.update` fails, because nothing reloads the saved list. The error toast with Retry shows, but the screen says "ticked" while the data says "not ticked". Seen in code only (needs "Simulate errors").
- Cross-area note for the controller (dashboard area): the dashboard numbers apply the Leader, Client and Team filters, but their links to `/projects` and `/tasks` do not carry them. Plan 4 decided this on purpose ("the leader and client filters do not carry over"), so I did not list it; the Team filter came later (D6) and may deserve a second look.
