# Sign-in and people

Email and password on Supabase Auth. Open sign-up is off. Only an Admin invites. Madar sends the invitation and the reset
mail itself, through Resend (see `server/mail/CLAUDE.md`).

## Files
- `verify.ts` (the token check), `principal.ts` (the person of a token), `admin.ts` (the AuthAdminPort over the Auth admin API).
- `invite.ts`, `renew.ts`, `forgot.ts`: the three mail routes. `mail.ts`: the sign-in mail. `effects.ts`: the `auth.*` effects.
- `rateLimit.ts`: fixed-window limits in the `rate_limits` table.
- The screens: `src/features/auth/` (Sign-in, Welcome, Forgot, Reset) and `src/app/remote/auth.ts` (the sign-in port).

## Rules
- `otp_expiry = 3600` in `supabase/config.toml`. Never 86400: Auth has one life for every email link, so a reset link
  would live a day too.
- `jwt_expiry = 900` (owner, 2026-10-06, Z7). The API checks no Auth session for a browser token, so after a sign-out
  elsewhere (for example a password change) an open browser keeps working until its token expires: 15 minutes at most.
  An agent token stops at once (`agent_session_ok`). `config-check.ts` refuses a longer life; `signin.spec.ts` checks it.
- Invitation (`invite.ts`): an `invite` link while the Auth user is unconfirmed, a `recovery` link after (Auth answers 422
  `email_exists`). Call `generate_link` only for an email that a users row holds.
- Renew key ("Send me a new link", `renew.ts`): random, 52 base32 characters. Madar keeps only its sha256 after the send. A
  key works only after its mail went out. The same answer for every key, limits per key and per address, a 1.5 s minimum
  answer, and the work after the answer.
- Forgot (`forgot.ts`): the same answer for every email. 3 in one window for each email (the window is 1 hour, the life of a
  link; a test reads config.toml), 10 an hour for each address. Over a limit: 429 with Retry-After. No office-wide cap.
- `users.resendInvite`: 5 a day for each person.
- The client address is `cf-connecting-ip` on Supabase (proven: it cannot be forged behind Cloudflare). On the Worker it is
  `x-madar-client-address`, which the Pages Function writes from its own `cf-connecting-ip` (the Worker has no public
  address). Never read `x-forwarded-for` or `true-client-ip`.
- Welcome and Reset use the link token only on the button press, and sign out the other devices after a save.

## Accepted or Invited
- Accepted = a confirmed email AND the user_metadata mark `madar_password_set` (`PASSWORD_SET_MARK` in
  `src/api/contract/server.ts`).
- Reason: Auth confirms the email and stores a password value as soon as an invite link opens.
- The screens set the mark with each password save and after a password sign-in.
- `users.invites`, the renew route and the `auth.email` effect all use this rule. Keep them the same.

## Email change and turn-off
- Only an Admin changes an email, never through an agent. After acceptance the old address gets a notice (no link).
- A security notice is never marked done unless its mail went out.
- Turn-off: `auth.ban` (100 years) and `agents.revokeAll`. Effects read the person again when they run.

## First Admin
- `npx tsx scripts/first-admin.ts --env test|production|local --email --name --language --gender`.
- With no terminal: `--password-stdin` reads the typed word `production` and the password from one stdin.
