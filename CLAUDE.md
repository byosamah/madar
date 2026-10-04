# Madar

Office project management system (مدار). React + TypeScript screens, a TypeScript server on Supabase Edge Functions,
Supabase Postgres and Auth. Tasks: `TASKS.md`. Proven facts: `docs/superpowers/real-build/proof.md`.
Plan: `docs/superpowers/plans/2026-10-03-madar-real-build-plan.md`.

## Commands
- `npm run typecheck` - screens and server.
- `npm test` - unit and server tests. Run it alone: next to a build or Playwright, screen tests time out.
- `MADAR_IT=1 npx vitest run --project it <files>` - database tests on the local stack. Each suite has its own schema.
  The restore test needs `MADAR_AGE` (the `age` binary).
- `npx supabase start -x edge-runtime` - the local stack. Use the project CLI (npx), never the global `supabase`.
- `scripts/dev/docker-lock.sh run <holder> -- <cmd>` - every Docker or database task takes this lock first.

## Run the real product locally
1. `scripts/dev/docker-lock.sh acquire <holder>`, `npx supabase db reset`, `npm run build:server`.
2. `npx tsx tests/e2e-deploy/local.ts functions-env <file>`, then `npx supabase functions serve --env-file <file>`.
3. `npx tsx tests/e2e-deploy/local.ts seed` - sample office and 4 accounts (`tests/e2e-deploy/accounts.ts`;
   passwords in `localPasswords` of `local.ts`).
4. Build: `VITE_MADAR_API=remote VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_PUBLISHABLE_KEY=<PUBLISHABLE_KEY>
   npx vite build --mode remote-local --outDir test-results/remote-local`, then
   `npx vite preview --mode remote-local --outDir test-results/remote-local --host 127.0.0.1 --port 4174 --strictPort`.
- `supabase status -o env` has no API_URL: the API is `http://127.0.0.1:54321`. Mail stays local (`MAIL_DRIVER=outbox`).

## Gotchas
- Auth confirms the email AND stores a password value as soon as an invite link opens. Only the user_metadata mark
  `madar_password_set` (`PASSWORD_SET_MARK`) says that a person saved a password.
- Screen tests use a hash router: a link href is `#/...`.
- A project page can take more than the 1 s `findBy` default: use `{ timeout: 10_000 }`. A panel that waits for its
  own query (DecisionsPanel on `projects.get`) can come after the card: wait for the panel itself.
- `src/components/MadarMark.test.tsx` lists every file that may use the logo. Never put it in a project list.
- Every visible word has an English and an Arabic key (`src/i18n/`). An Arabic verb after a name needs a `_female` key.

## Rules
- Secrets live only in `.env.local`. Load `SUPABASE_ACCESS_TOKEN` from it for the Supabase CLI.
- Before the deploy phase, change only madar-test (`qdgwpnesxppnqsaabqzd`), never production (`oprkvdjudjxxhvodkzgs`).
- Tests first for every fix. Screenshots (EN/AR, light/dark, 390 px) for every screen change.
