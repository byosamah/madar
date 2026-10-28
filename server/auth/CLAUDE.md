# Sign-in and people

Email and password on Supabase Auth, or on the own sign-in of the office object (see the last section). Open sign-up is off.
Only an Admin invites. Madar sends the invitation and the reset mail itself, through Resend (see `server/mail/CLAUDE.md`).

Commands: `npx vitest run server/auth` runs the unit tests. `npm run test:lite` runs the own sign-in rows on SQLite.
First Admin: `scripts/deploy/CLAUDE.md`, "Other scripts".

## Files
- `verify.ts` (the token check), `principal.ts` (the person of a token), `admin.ts` (the AuthAdminPort over the Auth admin API).
- `invite.ts`, `renew.ts`, `forgot.ts`: the three mail routes. `mail.ts`: the sign-in mail. `effects.ts`: the `auth.*` effects.
- `rateLimit.ts`: fixed-window limits in the `rate_limits` table.
- The screens: `src/features/auth/` (Sign-in, Welcome, Forgot, Reset) and `src/app/remote/auth.ts` (the sign-in port).

## Rules
- `otp_expiry = 3600` in `supabase/config.toml`. Never 86400: Auth has one life for every email link, so a reset link
  would live a day too.
- `otp_length = 10` in `[auth.email]`, the most that Auth takes. The token hash of a link comes from this code, and Auth also
  takes the code itself, so 6 digits let a guesser with many addresses find a live reset code. Madar mails only the token
  hash. `config-check.ts` refuses another value.
- `jwt_expiry = 900`. The API checks no Auth session for a browser token, so after a sign-out elsewhere (for example a
  password change) an open browser keeps working until its token expires: 15 minutes at most. An agent token stops at once
  (`agent_session_ok`). `config-check.ts` refuses a longer life; `signin.spec.ts` checks it.
- Invitation (`invite.ts`): an `invite` link while the Auth user is unconfirmed, a `recovery` link after (Auth answers 422
  `email_exists`). Call `generate_link` only for an email that a users row holds.
- Renew key ("Send me a new link", `renew.ts`): random, 52 base32 characters. Madar keeps only its sha256 after the send. A
  key works only after its mail went out. The same answer for every key, limits per key and per address, a minimum answer
  time, and the work after the answer.
- Forgot (`forgot.ts`): the same answer for every email. Limits for each email (the window is the life of a link; a test
  reads config.toml) and for each address. Over a limit: 429 with Retry-After. No office-wide cap. `users.resendInvite` has a
  daily limit for each person.
- The client address is `cf-connecting-ip` on Supabase (proven: it cannot be forged behind Cloudflare). On the Worker it is
  `x-madar-client-address`, which the Pages Function writes from its own `cf-connecting-ip` (the Worker has no public
  address; steps in `functions/CLAUDE.md`). Never read `x-forwarded-for` or `true-client-ip`.
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

## The own sign-in
- Files: `own/` (the office object side: passwords, keys, rows, sessions, steps, routes, the import) and `ownKeys.ts` (the
  Worker side: the public key and the issuer). No Supabase entry loads `own/`: bcryptjs imports the bare module `crypto`, which
  Deno may not load (`server/workerGraph.test.ts`). The hosts pass the routes in (`ownApiRoutes`, `mountOAuth`).
- Rows: `auth_users` (the id of `auth.users` for an imported person), `auth_links`, `auth_sessions`, `oauth_clients`,
  `oauth_requests`. The sign-in link is `auth_users.user_id`; the office snapshot carries the links, so `principalOf` stays as it
  is. `setLiteAuthLink` is the one write of a link.
- Passwords: PBKDF2 SHA-256, `PBKDF2_ROUNDS` = 100,000, never more (deployed Workers refuse more; local workerd does not show
  it). A copied bcrypt hash works once, then the row holds PBKDF2. The hash work runs in the office object between two
  transactions, never in the Worker (the Free CPU limit is 10 ms).
- Tokens: ES256, issuer = MCP_URL, the secret `MADAR_AUTH_PRIVATE_JWK` (a P-256 private JWK with a kid). The public key set is
  `GET /api/auth/jwks` and `GET /mcp/oauth/jwks`. With the secret set, `verifyBrowserToken` and `agentTokenCheckerOf` use the own
  key; without it they use Supabase Auth.
- Sessions (`own/sessions.ts`): refresh tokens rotate; a second use inside `REFRESH_REUSE_MS` rotates again, a later one ends the
  session. Sign-out others ends agents too. The API checks no session for a browser token (15 minutes at most, as on Supabase).
- Links: random bytes, only the sha256 in the table, one use; a new link ends the open links of the person. A link opens a link
  session that may set a password once with no current password. An agent token never sets a password (403 `agent_token`).
- Limits are in `own/limits.ts` (sign-ins for one email and for one address, link opens, OAuth registrations). The address is
  `clientAddress` (`forgot.ts`).
- `liteAuthAdmin` is the Auth admin port over these rows, so `invite.ts`, `effects.ts`, `forgot.ts`, `renew.ts` and
  `users.invites` keep their logic; each text of theirs has a `_LITE` twin (`server/data/CLAUDE.md`, "The SQLite path").
- Steps run through `SigninOffice` (`own/office.ts`). On the office path, `objectSigninOffice` (`server/entries/officeSignin.ts`)
  sends each step to `Office.signin`. The forgot and renew routes need the database, so they run in the object in two calls:
  `Office.mailRoute` (the shape check and the limits) and, after the answer, `Office.mailWork` (the `work` option of
  `createForgotRoute` and `createRenewRoute`).
- `own/cleanup.ts` (`cleanupSignin`) deletes the links, OAuth requests and sessions that ended more than a day ago; the Cron of
  the office object runs it in its first run after 00:00 UTC (`server/office/jobs.ts`).
- The sign-in key of an office copy is the Worker secret `MADAR_AUTH_PRIVATE_JWK`, made by `npx tsx scripts/office/auth-key.ts
  test` straight into the Worker (never in a file: `scripts/deploy/secrets.ts` refuses a secrets file that holds it). A new key
  signs every person and agent of that copy out once. The test seed (`scripts/office/seed.ts`) gives the 4 accounts fixed ids
  (`SEED_AUTH_IDS`) and PBKDF2 hashes of their passwords. On the office path the day cap of the test Worker counts a sign-in
  step as a read (`server/office/cap.ts`). `npm run dev:office` runs the own sign-in end to end on the Mac.
