# The morning summary mail: rules

The detail of the morning summary. The short rules that a change can break silently are in `server/mail/CLAUDE.md`. These
tests pin the rules: `summaryTasks.test.ts`, `summaryBrief.test.ts` (the outbox driver on SQLite), `quietMail.test.ts`,
`hiddenProjectSummary.test.ts`, `templates/render.test.ts`.

## Content
Notice mail carries no client data: no task, project or comment text. The morning summary is the one exception: it lists the open
tasks of its reader, and each line holds the task title, the project key (`projectKey`, or "Office" for an office task) and the
due day. It holds no project name, no client name, no comment text and no link of a task. Resend keeps the content, so keep it to
those three fields: a template reads only the fields of its data type.

## When it goes
- The morning summary goes at the start of the work hours of each person, only on the work days of the office (Sunday to
  Thursday by default) that are also work days of that person. A person who set more days of their own, such as all 7, gets no
  summary on a day off of the office. The first run of the 15-minute job at or after the start sends it (`jobs/steps/summary.ts`,
  `summaryStartOn` in `src/lib/quietHours.ts`, which calls `workStartOn`). The Postgres path and the office object path share
  this one step.
- A job_runs row `summary:<day>:<person>` closes one person for one day; the old row `summary:<day>` still closes the whole day.
  A person with quiet hours off uses the stored range, else the office default. The idempotency key is `summary-<day>-<person>`.
- The mail goes when something is past due or due today, or a review waits: a task due later this week alone makes no mail.

## Which tasks
- It lists the open tasks (to do or in progress) that the person leads or helps on, in an active project or with no project, in
  three groups: Past due, Today and This week. The groups follow the Work screen (`weekEndOf` has the same week rule as
  `workGroupOf`; a test pins both). A group keeps the shared order of the screens (a placed task first, then the date).
- The mail shows at most 8 lines in all, the past due first, then "and N more tasks" and one button "Open Madar". It adds the
  count of the reviews that wait for the person, including those of office tasks that the person made. A project review waits for
  its leader only while the leader holds `task.review.lead`; else it waits for the Admins (`SUMMARY_REVIEWERS_SQL` and
  `summaryReviewers` give the reviewing leaders as `$3` of `SUMMARY_COUNTS_SQL`).
- No signed link, no file, no tracking pixel and no picture but the Madar mark of the header.

## Hidden projects
A line of the morning summary never names a to-do of a project that the person does not view, though the person leads or helps on
it, and the counts leave it out. `SUMMARY_COUNTS_SQL` (`$4` "See every project", `$5` "See hidden projects") joins `viewSql` in the
tasks due today and in the reviews of project to-dos. `SUMMARY_TASKS_SQL` (`$3`, `$4`) joins it in the lines. `viewSql` holds: the
holder of `project.hidden`, the leader, a team member, a chosen person (`access.viewerIds`), and the holder of `project.seeAll` when the
project is open. `summaryViews` reads the two rights from the roles of `SUMMARY_REVIEWERS_SQL`. The SQLite forms (`liteVisible`) call
`mayViewProject`. A review of an office to-do has no project, so it has no view rule. The reviewer of a project is its leader or an
Admin, and both view the project today (the leader leads it, and the Admin holds every right). The review count still joins `viewSql`,
so a change of those facts never counts the to-do of a hidden project (2026-10-28). Notice mail follows `notify`.
Test: `hiddenProjectSummary.test.ts`. It pins the join as text for the Postgres form, because the unit tests run only the SQLite form.
