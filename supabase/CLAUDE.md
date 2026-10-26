# Supabase: migrations, settings, functions, the local stack

Two hosted projects, both in Frankfurt (eu-central-1): `madar-test` = `qdgwpnesxppnqsaabqzd`, production `madar` =
`oprkvdjudjxxhvodkzgs`. Deploy steps are in `scripts/deploy/CLAUDE.md`. Table design is in `server/data/CLAUDE.md`.

## Migrations (`migrations/`)
- Never edit a merged migration. Add a new file.
- Never write `public.` in a table name.
- No migration holds a secret. CI checks for `create_secret(` (`scripts/ci/check-migration-secrets.ts`).
- Files named `*_platform_*` need the Supabase schemas (auth, realtime, cron, storage), so the test harness skips them.
- Number ranges: app 20261004000100-199, realtime 0200, cron 0300, auth and agents 0400s, files 0500, usage 0600s.
- A new file must sort after the last migration of the hosted projects: `supabase db push` (`scripts/deploy/db.sh`, no
  `--include-all`) refuses a file that comes before it. So new app migrations start a new day, for example
  `20261005000100_project_templates.sql`.
- A new function gets no default EXECUTE. Grant each one by name, only to the role that calls it.
- After any migration change: `npx supabase db reset`, from your own worktree, under the Docker lock.
- The Supabase CLI native runtime (no Docker, alpha since 2026-10-02) is not in use: the MinIO suites need Docker
  (`server/it/minio.ts`). The trial is a TASKS.md item.
- `pg_trgm` lives in the schema `extensions` (`20261020000200_message_search.sql`), so an index names `extensions.gin_trgm_ops`. The
  function `search_fold` must stay in step with `bodySearchText` (`src/lib/searchMatch.ts`); `server/it/messageSearch.it.test.ts`
  checks that they agree.
- `20261022000100_chat_reads_conversation.sql` indexes `chat_reads (conversation_id)`: the chat view reads every read mark of one chat
  (the seen times). Its SQLite twin is `LITE_SCHEMA_VERSION` 10. `20261022000200_platform_presence.sql` adds the Presence policies
  `madar_status_track` (insert, only the topic `status:<own id>`) and `madar_status_read` (select, any `status:` topic), never for an agent
  token or a turned-off person.
- `20261022000300_read_indexes_perf2.sql` (speed release perf2): the indexes `comments_author_task`, `notifications_inbox_c` (the old
  `notifications_inbox` is dropped) and the partial `events_report_verbs`, then analyze. The SQLite path needs no twin: its plans are its own.
- `20261026000100_agent_confirms.sql` (the email code guard of agents, owner 2026-10-26): the server-only table `agent_confirms` with RLS and the `madar_server` policy. Its SQLite twin is
  `LITE_SCHEMA_VERSION` 11. The migration needs `npm run test:db` and `npm run test:it` (Docker).
- The office object has one SQLite schema (`server/data/lite/schema.ts`), not these migrations. Until the switch (wave 6), a
  new table or column needs both: a migration here and the SQLite schema with a new version.

## Settings (`config.toml`)
- `config.toml` holds the values of the local stack. A push sends them to a hosted project unless its `[remotes.test]` or
  `[remotes.production]` block replaces them. `scripts/deploy/config-check.ts` refuses a push without that block.
- `otp_expiry = 3600`. Never 86400 (see `server/auth/CLAUDE.md`).
- `jwt_expiry = 900` (15 minutes, Z7). `config-check.ts` refuses more (see `server/auth/CLAUDE.md`).
- The token hook `public.madar_access_token_hook` comes from a migration, never from `seed.sql`.
- A change to `config.toml` needs `npx supabase stop` and `npx supabase start`.

## Functions (`functions/`)
- `api`, `mcp`, `jobs`: each `index.ts` is a thin wrapper over a bundle in `functions/_build/` (git-ignored).
- Edit `server/`, then run `npm run build:server`. Never edit a bundle or a wrapper for logic.
- Every `all.sh` run deploys them, also when `config/server-host.json` says `workers` (owner, 2026-10-16): they are the way
  back, and `jobs` runs the 15-minute job in both settings (pg_cron posts to `<project_url>/functions/v1/jobs/run`).
- Every answer names its host: `x-madar-server: supabase`.

## `seed.sql`
- It runs only on the local stack (after `db reset` and the first `start`). It never reaches a hosted project.

## The local stack
- Always the project CLI (`npx supabase`, version 2.121.0 since 2026-10-20). Never the global `supabase`: it starts
  older images, and Realtime then refuses madar_server.
- CLI 2.121.0 starts Postgres `17.11.0.004` and Realtime `v2.143.4`. After a CLI update, the first `functions serve` pulls a
  new edge runtime image for minutes: `server/it/cron.it.test.ts` then stops at its 240 s wait. Run that file again.
- `npx supabase start -x edge-runtime` for database work. Ports: API 54321, Postgres 54322, Mailpit 54324.
- `supabase status -o env` has no API_URL: the API is `http://127.0.0.1:54321`.
- Every Docker or database task takes the lock first: `scripts/dev/docker-lock.sh run <holder> -- <cmd>` (or `acquire`
  and `release` for long work, `status`). An `acquire` lock is stale after 3 hours: on a longer run, `release <holder>`,
  then `acquire <holder>` (sandbox off). Only one local stack at a time (16 GB Mac).
- Never run a shared `supabase functions serve` next to `test:mcp` or `test:it`. They serve their own functions.

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
  The `config push` diff still says `api.enabled` true after every push (2026-10-05): ignore it. That GET also returns
  `jwt_secret` (the revoked HS256 key): read only `db_schema`, for example with `jq .db_schema`.
- A new database password works on the pooler only after a few seconds.
- A read-only SQL check without the pooler: `POST /v1/projects/{ref}/database/query` with `{"query": "..."}` and the token.
  `GET /config/auth | jq .jwt_exp` shows the token life (900).
- Management API logs: `analytics/endpoints/logs.all` is gone (2026-09-23). `analytics/endpoints/logs` works (2026-10-21):
  `select timestamp, event_message from logs where event_message ilike '%push%'` with `iso_timestamp_start` and `_end`, token
  `SUPABASE_ACCESS_TOKEN`. The field `source_name` does not exist there.
