# Email

Madar sends its mail through Resend over HTTPS, from `Madar <madar@vado.sa>`. Mail always leaves through the outbox,
after the commit of the call that asked for it.

## Files
- `resend.ts` (the Resend driver), `outboxDriver.ts` (the local driver), `quota.ts` (the day quota), `effects.ts`, `register.ts`.
- `notices.ts` (notice mail), `summary.ts` (the morning summary), `templates/` (layout, words, and the snapshot tests).
- The sign-in mail (invitation, reset, email-changed notice) is in `server/auth/mail.ts`.

## Drivers
- `MAIL_DRIVER=resend` (the default, needs `RESEND_API_KEY`) or `outbox`. `MAIL_FROM` is required (`server/core/deps.ts`).
- The local stack uses `outbox`: mail stays in the table `mail_outbox`.
- Production sends with its own Resend key (sending only, vado.sa only) in `secrets/production.env`.
- The Resend key in `.env.local` is account-wide and also serves Mazj. Never delete it.

## Quota
- The Resend free plan sends 100 mails a UTC day. `QUOTA_LIMITS` (`quota.ts`): notice 90, summary 90, signin 98, warning 98.
- Every invitation and reset counts as signin.
- A full day throws `QuotaFull`: the row waits until the next UTC midnight.
- `release()` gives back the place of a row that never made a link.
- The mail reserve takes only the mail lock, in its own transaction. Lock order: the office lock, then the mail lock.

## Content
- Notice and summary mail carry no client data: no task, project or comment text.
- The morning summary goes at 07:30 Riyadh, Sunday to Thursday.
- Arabic mail is right to left and uses the `_female` forms for a woman.
- Every word comes from the word files, in English and Arabic. Never use an em-dash.

## Deliverability
- vado.sa has DKIM and SPF from Resend, and DMARC `p=none` (since 2026-10-05).
- If mail lands in spam, check `_dmarc.vado.sa` and the link hosts first.
- Move DMARC to `p=quarantine` after a few clean weeks. The owner adds DNS records himself (vado.sa DNS is in Vercel).
- Never send mail to a real person without the owner's OK.
