# Email

Madar sends its mail through Resend over HTTPS, from `Madar <madar@vado.sa>`. Mail always leaves through the outbox,
after the commit of the call that asked for it.

Commands: `npx vitest run server/mail` runs the unit tests. The snapshot tests are in `server/mail/templates/render.test.ts`.

## Files
- `resend.ts` (the Resend driver), `outboxDriver.ts` (the local driver), `quota.ts` (the day quota), `effects.ts`, `register.ts`.
- `notices.ts` (notice mail), `summary.ts` (the morning summary), `summaryTasks.ts` (its three task groups), `templates/` (layout, words, and
  the snapshot tests).
- The sign-in mail (invitation, reset, email-changed notice) is in `server/auth/mail.ts`.
- The code mail of an agent act (effect `mcp.confirm`) is in `server/mcp/guard.ts`; the words are `mcpGuardMail`
  (`src/i18n/real/mcpguard.*.json`).

## Drivers
- `MAIL_DRIVER=resend` (the default, needs `RESEND_API_KEY`) or `outbox`. `MAIL_FROM` is required (`server/core/deps.ts`).
- The local stack uses `outbox`: mail stays in the table `mail_outbox`.
- Production sends with its own Resend key (sending only, vado.sa only) in `secrets/production.env`.
- The Resend keys of the account: `Madar` (full access, in `.env.local`), `madar-production` (sending only, vado.sa only, in
  `secrets/production.env`), `MAZJ` (the Mazj apps use it: never change or delete it), `VADO` (the old key: its value leaked in
  chat, nothing uses it, the owner keeps it, do not ask again) and `Onboarding` (not in use).
- `GET https://api.resend.com/api-keys` gives the name, `created_at` and `last_used_at` of each key, never the token. To find the
  row of a token: make one call with it, then see which `last_used_at` moves.
- The notice mail of a save leaves right after the answer, not before it, on the hosted functions (`AFTER_ANSWER_KINDS`, rules in
  `server/CLAUDE.md`). The same idempotency key and quota apply. If the worker stops first, the 15-minute job sends the claimed
  row later. The mention or reply mail of a chat message or a task comment (`mail.chatNotice`) waits, and sends nothing when its
  notice is read by then (a read of the chat marks it read). Every other notice mail goes at once.
- The browser push of a save (`push.notify`, `server/push/CLAUDE.md`) runs on the same chain. It carries no client data either.

## Quota
- The Resend free plan sends 100 mails a UTC day. `QUOTA_LIMITS` (`quota.ts`, pinned by `quota.test.ts`) keeps notice and summary
  mail below the limits of sign-in and warning mail, so a sign-in mail always has room.
- Every invitation and reset counts as signin. The code mail of an agent act (`mcp.confirm`) counts as signin too.
- A full day throws `QuotaFull`: the row waits until the next UTC midnight.
- `release()` gives back the place of a row that never made a link.
- The mail reserve takes only the mail lock, in its own transaction. Lock order: the office lock, then the mail lock.
- On SQLite (the office object) the quota has no mail lock, because the object runs one request at a time: one count and one
  insert in the caller's transaction, with the UTC day from the caller's clock (the `_LITE` constants in `quota.ts`). A mail of
  the office object goes through the network port of the Worker; with `MAIL_DRIVER=outbox` it goes into `mail_outbox` of the
  object.

## Mail that never goes
Each rule here has a test. A new notice type also goes into this list (`src/api/CLAUDE.md`, "Notices").
- Quiet hours: `sendNoticeMail` (so `mail.chatNotice` too) reads the work hours with its own statement (`NOTICE_MAIL_SQL`;
  `quietFromColumns`, `server/core/quiet.ts`) at send time, after the wait. A person in quiet hours gets no mail: the row ends as
  done, no place of the day quota is taken (the place is reserved inside `sendCounted`, after the check), and no mail goes later.
  The bell keeps the notice. The summary is not held: it goes at the start of the work hours. Test: `quietMail.test.ts`.
- The copy of a notice for an Admin who picked "Everything" (`Notification.forUserIds`): `NEW_NOTICES_SQL` and the SQLite reader
  (`liteNoticeRows`) skip it, so no `mail.notice` and no `mail.chatNotice` row exists for it. Test: `server/push/adminCopies.test.ts`.
- A notice from @everyone (`Notification.everyone`): skipped the same way. Test: `everyoneMail.test.ts`.
- The in-app only notices (`IN_APP_ONLY_TRIGGERS`, `emailOn`): the two notices of requests and bugs, the notice of a new group,
  the two notices of a meeting (`meeting_invited`, `meeting_soon`), the notices of a new helper and a deleted task
  (`helper_joined`, `task_deleted`) and the due day of a payment (`payment_due`). A meeting sends no mail: calendar apps remind by
  themselves. `MailData.notice` takes only an `EmailTrigger`, and the mail tests iterate `EMAIL_TRIGGERS`.

## Content
- Notice mail carries no client data: no task, project or comment text. The morning summary is the one exception: it lists the
  open tasks of its reader with only the task title, the project key and the due day. Resend keeps the content, so a template
  reads only the fields of its data type. The summary rules (send time, groups, the 8 lines, reviewers, hidden projects):
  `docs/superpowers/real-build/mail-summary.md`.
- Hidden projects: the summary never names a to-do of a project that the person does not view (`SUMMARY_COUNTS_SQL` and
  `SUMMARY_TASKS_SQL` join `viewSql`; the SQLite forms call `mayViewProject`). Test: `hiddenProjectSummary.test.ts`.
- Arabic mail is right to left and uses the `_female` forms for a woman.
- A mail names a person in the language of the person who gets it (`personName` of `src/lib/personName.ts`).
- Every word comes from the word files, in English and Arabic. Never use an em-dash.

## The code mail of an agent act
- `mcp.confirm` goes to the PERSON of the agent, never to the agent and never to another address, with one plain line of what the
  agent asks, a 6-digit code and "one time, 10 minutes". It holds no link, no token and no client data. The names in the line are
  cut to 60 characters and have no control or direction mark. It runs before the answer (it is not in `AFTER_ANSWER_KINDS`), so
  the answer to the agent can tell the person to look. A full day leaves the row for the job, but a code is dead after 10
  minutes, so the late row sends nothing. At most 5 new codes for one person in one hour. Flow: `server/mcp/CLAUDE.md`, "The
  email code guard".

## Deliverability
- vado.sa has DKIM and SPF from Resend, and DMARC `p=none`.
- If mail lands in spam, check `_dmarc.vado.sa` and the link hosts first.
- Move DMARC to `p=quarantine` after a few clean weeks. The owner adds DNS records himself (vado.sa DNS is in Vercel).
- Never send mail to a real person without the owner's OK.
