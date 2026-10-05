# Supabase: migrations, settings, functions, the local stack

Two hosted projects, both in Frankfurt (eu-central-1): `madar-test` = `qdgwpnesxppnqsaabqzd`, production `madar` =
`oprkvdjudjxxhvodkzgs`. Deploy steps are in `scripts/deploy/CLAUDE.md`. Table design is in `server/data/CLAUDE.md`.

## Migrations (`migrations/`)
- Never edit a merged migration. Add a new file.
- Never write `public.` in a table name.
- No migration holds a secret. CI checks for `create_secret(` (`scripts/ci/check-migration-secrets.ts`).
- Files named `*_platform_*` need the Supabase schemas (auth, realtime, cron, storage), so the test harness skips them.
- Number ranges: app 20261004000100-199, realtime 0200, cron 0300, auth and agents 0400s, files 0500, usage 0600s.
- A new function gets no default EXECUTE. Grant each one by name, only to the role that calls it.
- After any migration change: `npx supabase db reset`, from your own worktree, under the Docker lock.

## Settings (`config.toml`)
- `config.toml` holds the values of the local stack. A push sends them to a hosted project unless its `[remotes.test]` or
  `[remotes.production]` block replaces them. `scripts/deploy/config-check.ts` refuses a push without that block.
- `otp_expiry = 3600`. Never 86400 (see `server/auth/CLAUDE.md`).
- The token hook `public.madar_access_token_hook` comes from a migration, never from `seed.sql`.
- A change to `config.toml` needs `npx supabase stop` and `npx supabase start`.

## Functions (`functions/`)
- `api`, `mcp`, `jobs`: each `index.ts` is a thin wrapper over a bundle in `functions/_build/` (git-ignored).
- Edit `server/`, then run `npm run build:server`. Never edit a bundle or a wrapper for logic.

## `seed.sql`
- It runs only on the local stack (after `db reset` and the first `start`). It never reaches a hosted project.

## The local stack
- Always the project CLI (`npx supabase`, version 2.119.0). Never the global `supabase`: it starts older images, and
  Realtime then refuses madar_server.
- `npx supabase start -x edge-runtime` for database work. Ports: API 54321, Postgres 54322, Mailpit 54324.
- `supabase status -o env` has no API_URL: the API is `http://127.0.0.1:54321`.
- Every Docker or database task takes the lock first: `scripts/dev/docker-lock.sh run <holder> -- <cmd>` (or `acquire`
  and `release` for long work, `status`). Only one local stack at a time (16 GB Mac).
- Never run a shared `supabase functions serve` next to `test:mcp` or `test:it`. They serve their own functions.

## Hosted projects
- The Supabase CLI login on this Mac belongs to another account (Halulu). Always pass `SUPABASE_ACCESS_TOKEN` from
  `.env.local` and `--project-ref`. Never log the CLI out.
- Settings that `config.toml` cannot hold go through the Management API with the token: `PATCH /v1/projects/{ref}/config/auth`,
  `/config/realtime`, `/database/password`, `PUT /ssl-enforcement`, `PUT /api-keys/legacy?enabled=false`,
  `PATCH /config/auth/signing-keys/{id}`.
- Both projects today: current password required for a change, legacy API keys off, HS256 key revoked, SSL enforced,
  Realtime private only, the Data API off.
- A new database password works on the pooler only after a few seconds.
