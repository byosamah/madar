# The 15-minute job

`server/jobs/`: `app.ts` (the `/jobs` route), `run.ts` (`JOB_STEPS`, `runJob`), `steps/` (one file for each step).

## How it runs
- pg_cron calls `jobs/run` of the Supabase jobs function every 15 minutes, in both host settings, with the secret header
  `x-madar-jobs-secret`. The Worker keeps `/jobs` mounted, but nothing calls it: pg_cron and the Vault `project_url` do not change. The office
  object runs the steps from its Cron Trigger (`server/office/CLAUDE.md`).
- The steps run in the order of `JOB_STEPS`: `heartbeat`, `triggers`, `meetings`, `daftra`, `summary`, `quietEnd`, `outbox`, `cleanup`,
  `uploads`. The office path adds `signin` on the first run after 00:00 UTC. A step that throws is reported, and the next step still runs.

## Rules
- Each step is idempotent. A step that fails logs the id and the code only, and the loop goes on.
- A step or an effect that needs what a person may see runs a read call as that person (`deps.runCall ?? runCall`, see "Rules a change
  must keep" in `server/CLAUDE.md`). `Deps.runCall` is set only by the office object (its own SQLite run).
- The `triggers` step runs the scheduled triggers (`runScheduledTriggers`, `src/api/notify.ts`): due and overdue reminders, the restart day of a
  paused project (`resume_due`, to the leader and to the person who paused it) and the reminder of a meeting before its start. It writes the mail
  and push outbox rows in its own save (`server/push/CLAUDE.md`).
- `heartbeat` writes the `job_runs` row "heartbeat". The health check of the office object reads it as `lastJob` (`JOBS_LAST_RUN_SQL`).
- `summary` sends the morning summary at the start of the work hours of each person. A `job_runs` row `summary:<day>:<person>` closes one
  person for one day; it is written when the outcome is final. A project that the person may not view adds nothing (`viewSql` in
  `server/mail/summary.ts`).
- `quietEnd` sends the one push to a person whose push was held in quiet hours (`server/push/held.ts`, `server/push/CLAUDE.md`).
- `outbox` retries the rows that failed. `cleanup` deletes old rows (the table list and the ages are in the comment of `cleanup.ts`; a
  Google `revoking` row goes after one day). `uploads` removes every `up/` upload object older than the life of its link plus a margin
  (`uploads.ts`), used or unused.
- `daftra` reads Daftra with no lock and sets "Received" through the internal call `payments.daftraPaid`. It returns at once with no Daftra
  account, and on the office object path. Rules: `server/daftra/CLAUDE.md`.

## The meetings step (`steps/meetings.ts`)
- It settles the meetings that ended. One read (`SETTLE_SQL`, `SETTLE_LITE`, the partial index `meetings_to_settle`) gives a bounded number of
  due meetings, the oldest end first. For each one the step runs the normal call `meetings.settle` as `settleActorOf`: the organizer while the
  organizer views the project of the meeting; else the first active Admin who views the project (a project meeting); else the first active
  attendee. The mark and the Tracker line come from the one settle rule and carry the events of a normal call. The step writes no row of its own.
  It reports `{ settled, skipped, failed, extended }`.
- The second half keeps the repeating series full. One read (`EXTEND_SQL`, `EXTEND_LITE`, the index `meetings_starts`) gives the last meeting of
  each scheduled series with fewer than `SERIES_AHEAD` scheduled meetings ahead. The step skips a series whose rule has no day left
  (`occurrencesOf`) and a series of a completed or archived project. It runs `meetings.extend { seriesId }` as `extendActorOf` (the organizer,
  else the first active Admin of a project series; a private series of an organizer who left is skipped), and counts the meetings in `extended`.
- Tests: `meetings.test.ts`, `hiddenMeetings.test.ts`, `lite.test.ts`, `steps.test.ts`.
