# Supabase: migrations, settings, functions, the local stack

Two hosted projects, both in Frankfurt (eu-central-1): `madar-test` = `qdgwpnesxppnqsaabqzd`, production `madar` =
`oprkvdjudjxxhvodkzgs`. Deploy steps are in `scripts/deploy/CLAUDE.md`. Table design is in `server/data/CLAUDE.md`.

## Migrations (`migrations/`)
- Never edit a merged migration. Add a new file.
- Never write `public.` in a table name.
- No migration holds a secret. CI checks for `create_secret(` (`scripts/ci/check-migration-secrets.ts`).
- Name: `YYYYMMDD` + 6 digits + `_name.sql`. A file that needs the Supabase schemas (auth, realtime, cron, storage) has
  `_platform_` in its name, so the test harness skips it.
- A new file must sort after the last migration of the hosted projects: `supabase db push` (`scripts/deploy/db.sh`, no
  `--include-all`) refuses a file that comes before it. So new app migrations start a new day.
- A new function gets no default EXECUTE. Grant each one by name, only to the role that calls it.
- After any migration change: `npx supabase db reset`, from your own worktree, under the Docker lock. Then run `npm run test:db`
  and `npm run test:it`.
- `pg_trgm` lives in the schema `extensions`, so an index names `extensions.gin_trgm_ops`.
- The office object has one SQLite schema (`server/data/lite/schema.ts`), not these migrations. A new table or column needs both:
  a migration here and a new `LITE_STEPS` version (rules and step list: `server/data/CLAUDE.md`, "The SQLite path"). A change to
  an index for Postgres reads needs no twin: the SQLite plans are their own.

## Settings (`config.toml`)
- `config.toml` holds the values of the local stack. A push sends them to a hosted project unless its `[remotes.test]` or
  `[remotes.production]` block replaces them. `scripts/deploy/config-check.ts` refuses a push without that block.
- `otp_expiry`, `otp_length` and `jwt_expiry`: the rules and the reason are in `server/auth/CLAUDE.md`. `config-check.ts`
  refuses a long `jwt_expiry` and an email `otp_length` other than 10, and `server/auth/forgot.test.ts` reads `otp_expiry`.
- The token hook `public.madar_access_token_hook` comes from a migration, never from `seed.sql`.
- A change to `config.toml` needs `npx supabase stop` and `npx supabase start`.

## Functions (`functions/`)
- `api`, `mcp`, `jobs`: each `index.ts` is a thin wrapper over a bundle in `functions/_build/` (git-ignored).
- Edit `server/`, then run `npm run build:server`. Never edit a bundle or a wrapper for logic.
- Every `all.sh` run deploys them, also when `config/server-host.json` says `workers`: they are the way back, and `jobs` runs
  the 15-minute job in both settings (pg_cron posts to `<project_url>/functions/v1/jobs/run`).
- Every answer names its host: `x-madar-server: supabase`.

## `seed.sql`
- It runs only on the local stack (after `db reset` and the first `start`). It never reaches a hosted project.

## The local stack
- Always the project CLI (`npx supabase`, the version in `package.json`). Never the global `supabase`: it starts older images,
  and Realtime then refuses madar_server. After a CLI update, the first `functions serve` pulls a new edge runtime image for
  minutes: `server/it/cron.it.test.ts` then stops at its wait. Run that file again.
- `npx supabase start -x edge-runtime` for database work. Ports: API 54321, Postgres 54322, Mailpit 54324.
  `supabase status -o env` has no API_URL: the API is `http://127.0.0.1:54321`.
- Every Docker or database task takes the lock first: `scripts/dev/docker-lock.sh run <holder> -- <cmd>` (or `acquire`
  and `release` for long work, `status`). An `acquire` lock is stale after 3 hours: on a longer run, `release <holder>`,
  then `acquire <holder>` (sandbox off). Only one local stack at a time (16 GB Mac).
- `test:db`, `test:it` and the `test:mcp` conformance runner need Docker Desktop and the local stack. The sandbox blocks
  `open -a Docker`; with the sandbox off it works, and Docker is up in about 10 s. The run sequence:
  `docker-lock.sh acquire <holder>`, `npx supabase start -x edge-runtime`, `npx supabase db reset`, `npm run test:db`,
  `npm run test:it`, `npm run test:mcp`, `npx supabase stop`, `docker-lock.sh release <holder>`.
- Never run a shared `supabase functions serve` next to `test:mcp` or `test:it`. They serve their own functions. Stop a served
  function before you start them. `tests/CLAUDE.md` and `.github/CLAUDE.md` point here.

### Run the real product locally
1. `scripts/dev/docker-lock.sh acquire <holder>`, `npx supabase db reset`, `npm run build:server`.
2. `npx tsx tests/e2e-deploy/local.ts functions-env <file>`, then `npx supabase functions serve --env-file <file>`.
3. `npx tsx tests/e2e-deploy/local.ts seed` - the sample office and 4 accounts (`tests/e2e-deploy/accounts.ts`:
   admin, management, accounting and member, each `@madar.test`; passwords in `localPasswords` of `local.ts`).
4. `VITE_MADAR_API=remote VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_PUBLISHABLE_KEY=<PUBLISHABLE_KEY>
   npx vite build --mode remote-local --outDir test-results/remote-local`, then
   `npx vite preview --mode remote-local --outDir test-results/remote-local --host 127.0.0.1 --port 4174 --strictPort`.
- Mail stays local (`MAIL_DRIVER=outbox`, table `mail_outbox`). Release the lock when the owner is done. The deploy suite
  runs against this stack: `tests/CLAUDE.md`.

## Hosted projects
- The Supabase CLI login on this Mac belongs to another account (Halulu). Always pass `SUPABASE_ACCESS_TOKEN` from
  `.env.local` and `--project-ref`. Never log the CLI out.
- Settings that `config.toml` cannot hold go through the Management API with the token: `PATCH /v1/projects/{ref}/config/auth`,
  `/config/realtime`, `/database/password`, `PUT /ssl-enforcement`, `PUT /api-keys/legacy?enabled=false`,
  `PATCH /config/auth/signing-keys/{id}`.
- Both projects today: current password required for a change, legacy API keys off, HS256 key revoked, SSL enforced,
  Realtime private only, the Data API off.
- The Data API is off by `db_schema` = '' (`GET /v1/projects/{ref}/postgrest`). The root `/rest/v1/` now asks for a
  secret key, so read one table with the publishable key (`/rest/v1/users?select=id&limit=1`): PGRST002 (503) means off.
  The `config push` diff still says `api.enabled` true after every push: ignore it. That GET also returns `jwt_secret` (the
  revoked HS256 key): read only `db_schema`, for example with `jq .db_schema`.
- A new database password works on the pooler only after a few seconds.
- A read-only SQL check without the pooler: `POST /v1/projects/{ref}/database/query` with `{"query": "..."}` and the token.
  `GET /config/auth | jq .jwt_exp` shows the token life.
- Management API logs: `analytics/endpoints/logs` works: `select timestamp, event_message from logs where event_message ilike
  '%push%'` with `iso_timestamp_start` and `_end`, token `SUPABASE_ACCESS_TOKEN`. `analytics/endpoints/logs.all` is gone. The
  field `source_name` does not exist there.
