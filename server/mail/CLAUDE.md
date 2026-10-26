# Email

Madar sends its mail through Resend over HTTPS, from `Madar <madar@vado.sa>`. Mail always leaves through the outbox,
after the commit of the call that asked for it.

## Files
- `resend.ts` (the Resend driver), `outboxDriver.ts` (the local driver), `quota.ts` (the day quota), `effects.ts`, `register.ts`.
- `notices.ts` (notice mail), `summary.ts` (the morning summary), `summaryTasks.ts` (its three task groups), `templates/` (layout, words, and
  the snapshot tests).
- The sign-in mail (invitation, reset, email-changed notice) is in `server/auth/mail.ts`.
- The code mail of an agent act (owner, 2026-10-26, effect `mcp.confirm`) is in `server/mcp/guard.ts`; the words are `mcpGuardMail` (`src/i18n/real/mcpguard.*.json`).

## Drivers
- `MAIL_DRIVER=resend` (the default, needs `RESEND_API_KEY`) or `outbox`. `MAIL_FROM` is required (`server/core/deps.ts`).
- The local stack uses `outbox`: mail stays in the table `mail_outbox`.
- Production sends with its own Resend key (sending only, vado.sa only) in `secrets/production.env`.
- The Resend keys of the account (2026-10-05):
  - `Madar`: full access, in `.env.local`.
  - `madar-production`: sending only, vado.sa only, in `secrets/production.env`.
  - `MAZJ`: the Mazj apps use it. Never change or delete it.
  - `VADO`: the old key. Its value leaked in chat and sits in Supermemory. Nothing uses it. The owner keeps it for now.
  - `Onboarding`: not in use.
- `GET https://api.resend.com/api-keys` gives the name, `created_at` and `last_used_at` of each key, never the token.
  To find the row of a token: make one call with it, then see which `last_used_at` moves.

- On the hosted functions, the notice mail of a save leaves right after the answer, not before it (`runCall`,
  `AFTER_ANSWER_KINDS`). The same idempotency key and quota apply. If the worker stops first, the 15-minute job sends the
  claimed row later. The deploy suite's `waitForMail` polls `mail_outbox`, so it is not affected.
- The mention or reply mail of a chat message or a task comment (`mail.chatNotice`) waits 10 s after the answer, and sends nothing
  when its notice is read by then (a read of the chat marks it read). Every other notice mail goes at once.
- The browser push of a save (`push.notify`, `server/push/CLAUDE.md`) runs on the same chain, right after the answer. It carries
  no client data either.

## Quota
- The Resend free plan sends 100 mails a UTC day. `QUOTA_LIMITS` (`quota.ts`): notice 90, summary 90, signin 98, warning 98.
- Every invitation and reset counts as signin. The code mail of an agent act (`mcp.confirm`) counts as signin too.
- A full day throws `QuotaFull`: the row waits until the next UTC midnight.
- `release()` gives back the place of a row that never made a link.
- The mail reserve takes only the mail lock, in its own transaction. Lock order: the office lock, then the mail lock.
- On SQLite (the office object, exit waves 2 and 3) the quota has no mail lock, because the object runs one request at a time:
  one count and one insert in the caller's transaction (`DAY_COUNT_LITE`, `RESERVE_LITE`; the insert does nothing on a known
  ref), with the UTC day from the caller's clock. `REFUSAL_MARK_LITE` and `SENT_TODAY_LITE` are the first refusal and the meter. A mail of the office object goes through the network port of the Worker; with `MAIL_DRIVER=outbox` it goes into
  `mail_outbox` of the object.

## Quiet hours (owner, 2026-10-22, fbk_048)
- `sendNoticeMail` (so `mail.chatNotice` too) reads the work hours with its own statement (`NOTICE_MAIL_SQL` also gives the office hours; `quietFromColumns`,
  `server/core/quiet.ts`) at send time, after the 10-second wait. A person in quiet hours gets
  no mail: the row ends as done, no place of the day quota is taken (the place is reserved inside `sendCounted`, after the check), and no mail goes later.
  The bell keeps the notice. The summary is not held: it goes at the start of the work hours, so the person is not quiet then. Tests: `quietMail.test.ts`.

## Copies (owner, 2026-10-23)
- A copy of a notice for an Admin who picked "Everything" (`Notification.forUserIds`) sends no mail: `NEW_NOTICES_SQL` and the SQLite reader
  (`liteNoticeRows`) skip it, so no `mail.notice` and no `mail.chatNotice` row exists for it. Tests: `server/push/adminCopies.test.ts`.

- A notice from @everyone (`Notification.everyone`, owner 2026-10-22, fbk_041) sends no mail either: `NEW_NOTICES_SQL` and `liteNoticeRows` skip it. The
  Resend free plan sends 100 mails a day. Test: `everyoneMail.test.ts`.

## Content
- Notice mail carries no client data: no task, project or comment text. The morning summary is the one exception (owner, 2026-10-19,
  fbk_021): it lists the open tasks of its reader, and each line holds the task title, the project key (`projectKey`, or "Office" for an
  office task) and the due day. It holds no project name, no client name, no comment text and no link of a task. Resend keeps the
  content, so keep it to those three fields: a template reads only the fields of its data type.
- The two notices of requests and bugs, the notice of a new group, the two notices of a meeting (`meeting_invited`, `meeting_soon`, fbk_022),
  and the notices of a new helper and a deleted task (`helper_joined`, `task_deleted`, fbk_034 and fbk_035)
  never send mail (`IN_APP_ONLY_TRIGGERS`, `emailOn`). A meeting sends no mail: the quota is 100 a day, and calendar apps remind by themselves. `MailData.notice` takes only an
  `EmailTrigger`, and the mail tests iterate `EMAIL_TRIGGERS`.
- The morning summary goes at the start of the work hours of each person, only on the work days of the office (Sunday to Thursday by default) that are
  also work days of that person (owner, 2026-10-22, fbk_048; it was 07:30 for all). A person who set more days of their own, such as all 7, gets no
  summary on a day off of the office (fbk_058). The first run of the 15-minute job at or after the start sends it (`jobs/steps/summary.ts`,
  `summaryStartOn` in `src/lib/quietHours.ts`, which calls `workStartOn`). The Postgres path and the office object path share this one step. A job_runs row
  `summary:<day>:<person>` closes one person for one day; the old row `summary:<day>` still closes the whole day. A person with quiet hours off uses the
  stored range, else the office default. The key `summary-<day>-<person>` is as before.
- The morning summary lists the tasks as follows. It lists the open tasks (to do or in progress) that the person
  leads or helps on, in an active project or with no project, in three groups: Past due, Today and This week. The groups follow the
  Work screen (`weekEndOf` has the same week rule as `workGroupOf`; a test pins both). A group keeps the shared order of the screens
  (a placed task first, then the date). The mail shows at most 8 lines in all, the past due first, then "and N more tasks" and one
  button "Open Madar". It adds the count of the reviews that wait for the person, including those of office tasks that the person
  made (owner, 2026-10-06). A project review waits for its leader only while the leader holds `task.review.lead`; else it waits for the Admins
  (`SUMMARY_REVIEWERS_SQL` and `summaryReviewers` give the reviewing leaders as `$3` of `SUMMARY_COUNTS_SQL`). The mail goes when something is past due or due today, or a review waits: a task due later this week alone
  makes no mail. The subject, the footer and the idempotency key `summary-<day>-<person>` are as before. No signed link, no file, no
  tracking pixel and no picture but the Madar mark of the header. Tests: `summaryTasks.test.ts`, `summaryBrief.test.ts` (the outbox driver
  on SQLite), `templates/render.test.ts`.
- Hidden projects (owner, 2026-10-22, wave D3): a line of the morning summary never names a to-do of a project that the person does not view,
  though the person leads or helps on it, and the count of the tasks due today leaves it out. `SUMMARY_COUNTS_SQL` (`$4` "See every project",
  `$5` "See hidden projects") and `SUMMARY_TASKS_SQL` (`$3`, `$4`) join `viewSql`: the holder of `project.hidden`, the leader, a team member,
  a chosen person (`access.viewerIds`), and the holder of `project.seeAll` when the project is open. `summaryViews` reads the two rights from the
  roles of `SUMMARY_REVIEWERS_SQL`. The SQLite forms (`liteVisible`) call `mayViewProject`. The reviews that wait are not filtered: the reviewer is
  the leader or an Admin, and both view the project. Notice mail follows `notify`. Tests: `hiddenProjectSummary.test.ts`.
- Arabic mail is right to left and uses the `_female` forms for a woman.
- A mail names a person in the language of the person who gets it (`personName` of `src/lib/personName.ts`).
- Every word comes from the word files, in English and Arabic. Never use an em-dash.

## The code mail of an agent act (owner, 2026-10-26)
- `mcp.confirm` goes to the PERSON of the agent, never to the agent and never to another address, with one plain line of what the agent asks, a 6-digit code and "one time,
  10 minutes". It holds no link, no token and no client data. The names in the line are cut to 60 characters and have no control or direction mark. It runs before the
  answer (it is not in `AFTER_ANSWER_KINDS`), so the answer to the agent can tell the person to look. A full day leaves the row for the job, but a code is dead after 10 minutes,
  so the late row sends nothing. At most 5 new codes for one person in one hour. Flow: `server/mcp/CLAUDE.md`, "The email code guard".

## Deliverability
- vado.sa has DKIM and SPF from Resend, and DMARC `p=none` (since 2026-10-05).
- If mail lands in spam, check `_dmarc.vado.sa` and the link hosts first.
- Move DMARC to `p=quarantine` after a few clean weeks. The owner adds DNS records himself (vado.sa DNS is in Vercel).
- Never send mail to a real person without the owner's OK.
