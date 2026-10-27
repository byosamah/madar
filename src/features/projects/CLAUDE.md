# Projects list and project sheets

The Projects screen, the New and Edit project sheets, the form fields, the template picker. The project page: `src/features/project/CLAUDE.md`.

## Rules
- A closed sheet reads nothing: `NewProjectSheet`, `ApplyTemplateSheet` and `EditProjectSheet` read with `enabled: open`. The button that
  opens one starts its reads on pointerdown with `usePrefetchCall`: `usePrepareNewProject` (the New project button and the Search command)
  and `MenuItem.onPrepare` (the "Edit project" and "Apply a template" items of `ProjectActions`). `ClosedSheetReads.test.tsx` pins it. A new
  sheet that reads data follows the same rule.
- A project row prefetches `projects.get` on pointerdown, never on hover. Never put a router hook in a row body: a row part that needs one is
  its own small component, as `RowMenu` in `ProjectListRow.tsx`.
- The New project sheet starts with one choice, "Client project" or "Internal project" (`ProjectFormValues.kind`, Client at first). Internal
  hides the code group, client, location, area, sub-company and contract date (`ProjectFields`, flag `internal`). The sheet sends
  `kind: 'internal'` and none of the client fields. `validateProjectForm` skips the code and the sub-company. The edit sheet reads `kind` from
  the project. The "same contract" list leaves internal projects out. The Projects list row shows "Internal" where a client shows.
- The switch "Continuous project" (`Switch`, id `project-continuous`) sits right under the dates of both sheets. While it is on, the Target
  end date field is gone and its value is empty (the switch clears it). Words: `real/fbk069.*`.
- A project has an English name and maybe an Arabic name (`nameAr`; an empty value means none). Every spot that shows a project name uses
  `useProjectName()` (`app/projectName.ts`) or `shownName(project, lang)` (`lib/projectLabel.ts`), and lists sort with `useByProjectName()`.
  Arabic screens show the Arabic name, else the English name. Every view that names a project builds its ref with `projectRef` or
  `projectTile` (`lib/projectRef.ts`), which add `nameAr` only when it is set. A text that the server writes with a project name has an
  Arabic twin: the notice view gives `targetAr` and a project event gives `detail.labelAr`.
- The form shows 2 to 5 sub-companies as one row of logo choices (`SegmentedControl` with `icon`) and more than 5 as a select. A new project
  starts with the only sub-company, or the one of the last project of the same client. The Dashboard filter, the Projects filter, the task
  lists, the meeting and the Open space read `subCompany` in the link (`useScope`, `app/useScope.ts`). The Projects filter has "No
  sub-company" (`filter=no_sub_company`, a data gap).
- A code typed by hand with a warning shows the tick "Use this code anyway" (`CodeAnywayTick`). The warning is the field message until the
  tick. A change of the code clears the tick. A project code shows as its key (`projectKey`) in lists and rows, and in full in the header and
  About.
- Projects on a phone: `ProjectSearch` and `searchProjects`. The search text lives in `ProjectsFind`, not in the link or the Filter count.

## Templates in the new-project form and "Apply a template"
- "Start from a template" (`TemplateUse.tsx`, `templateForm.ts`): the picker sits right under the Name. The people of the roles are ticked
  and locked in the Team list. A chosen template takes the place of the stage list and makes the start date required. The dates come from
  `lib/projectPlan.ts`, as on the server. The ticks "Can stretch" stay folded.
- "Apply a template" is in the "More actions" menu of the project header (`features/project/ApplyTemplateSheet.tsx`), for
  `viewerCan.applyTemplate` (`project.template`) on an active or paused project. Step 2 is `LinkProjectSheet` in `mode="apply"`. A project
  that follows a template shows one line and a confirm tick before the list works. The sheet says the lead rule and the dates of the new
  parts from `shiftAdded` (the server uses it too). The Admin "Link" in Project templates uses the same sheet in `mode="link"`.
- The template editor and the update of linked projects: `src/features/settings/CLAUDE.md`.
