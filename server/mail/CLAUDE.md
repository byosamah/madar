# Email

Madar sends its mail through Resend over HTTPS, from `Madar <madar@vado.sa>`. Mail always leaves through the outbox,
after the commit of the call that asked for it.

## Files
- `resend.ts` (the Resend driver), `outboxDriver.ts` (the local driver), `quota.ts` (the day quota), `effects.ts`, `register.ts`.
- `notices.ts` (notice mail), `summary.ts` (the morning summary), `summaryTasks.ts` (its three task groups), `templates/` (layout, words, and
  the snapshot tests).
- The sign-in mail (invitation, reset, email-changed notice) is in `server/auth/mail.ts`.

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
- Every invitation and reset counts as signin.
- A full day throws `QuotaFull`: the row waits until the next UTC midnight.
- `release()` gives back the place of a row that never made a link.
- The mail reserve takes only the mail lock, in its own transaction. Lock order: the office lock, then the mail lock.
- On SQLite (the office object, exit waves 2 and 3) the quota has no mail lock, because the object runs one request at a time:
  one count and one insert in the caller's transaction (`DAY_COUNT_LITE`, `RESERVE_LITE`; the insert does nothing on a known
  ref), with the UTC day from the caller's clock. `REFUSAL_MARK_LITE` and `SENT_TODAY_LITE` are the first refusal and the meter. A mail of the office object goes through the network port of the Worker; with `MAIL_DRIVER=outbox` it goes into
  `mail_outbox` of the object.

## Content
- Notice mail carries no client data: no task, project or comment text. The morning summary is the one exception (owner, 2026-10-19,
  fbk_021): it lists the open tasks of its reader, and each line holds the task title, the project key (`projectKey`, or "Office" for an
  office task) and the due day. It holds no project name, no client name, no comment text and no link of a task. Resend keeps the
  content, so keep it to those three fields: a template reads only the fields of its data type.
- The two notices of requests and bugs, the notice of a new group, the two notices of a meeting (`meeting_invited`, `meeting_soon`, fbk_022),
  and the notices of a new helper and a deleted task (`helper_joined`, `task_deleted`, fbk_034 and fbk_035)
  never send mail (`IN_APP_ONLY_TRIGGERS`, `emailOn`). A meeting sends no mail: the quota is 100 a day, and calendar apps remind by themselves. `MailData.notice` takes only an
  `EmailTrigger`, and the mail tests iterate `EMAIL_TRIGGERS`.
- The morning summary goes at 07:30 Riyadh, Sunday to Thursday. It lists the open tasks (to do or in progress) that the person
  leads or helps on, in an active project or with no project, in three groups: Past due, Today and This week. The groups follow the
  Work screen (`weekEndOf` has the same week rule as `workGroupOf`; a test pins both). A group keeps the shared order of the screens
  (a placed task first, then the date). The mail shows at most 8 lines in all, the past due first, then "and N more tasks" and one
  button "Open Madar". It adds the count of the reviews that wait for the person, including those of office tasks that the person
  made (owner, 2026-10-06). The mail goes when something is past due or due today, or a review waits: a task due later this week alone
  makes no mail. The subject, the footer and the idempotency key `summary-<day>-<person>` are as before. No signed link, no file, no
  tracking pixel and no picture but the Madar mark of the header. Tests: `summaryTasks.test.ts`, `summaryBrief.test.ts` (the outbox driver
  on SQLite), `templates/render.test.ts`.
- Arabic mail is right to left and uses the `_female` forms for a woman.
- A mail names a person in the language of the person who gets it (`personName` of `src/lib/personName.ts`).
- Every word comes from the word files, in English and Arabic. Never use an em-dash.

## Deliverability
- vado.sa has DKIM and SPF from Resend, and DMARC `p=none` (since 2026-10-05).
- If mail lands in spam, check `_dmarc.vado.sa` and the link hosts first.
- Move DMARC to `p=quarantine` after a few clean weeks. The owner adds DNS records himself (vado.sa DNS is in Vercel).
- Never send mail to a real person without the owner's OK.
