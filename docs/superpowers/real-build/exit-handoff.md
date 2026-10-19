# The Supabase exit: the handoff (paused 2026-10-18)

Read this file first when the owner says "continue the move", "the Cloudflare exit", "wave 5" or "Track R". It says what is done,
what the systems hold now, what needs doing, and where every record lives. The details stay in the files that section 8 names.

## Status in four lines
- **Paused** by the owner on 2026-10-18 after wave 5 step R5: the team asked for an important feature, and that comes first.
- **The build is done.** Waves 0 to 4 are on main. Production never used that code: it runs on Supabase as before.
- **The test copy is back on Supabase** (`config/server-host.json`: both `supabase`). Its office object on Cloudflare still holds
  the imported sample office.
- **Backups:** GitHub refuses every Actions job until its free minutes come back (end of October 2026). The database backup runs
  from the Mac each evening until then (section 4).

## 1. What the exit is
The owner's goal (2026-10-16 and 2026-10-17): all of Madar on Cloudflare, on the free plans only, with no Supabase ("one vendor,
one bill"). The owner said GO on 2026-10-17. The design: one SQLite Durable Object (the "office object") for each copy, the own
sign-in in place of Supabase Auth, live updates on the object sockets in place of Supabase Realtime, the jobs on a Cron Trigger,
files on R2 (done before the exit, 2026-10-16), and backups by an export route to GitHub. Free limits that matter: 100,000 rows
written, 5 million rows read and 100,000 requests a day for the whole account; 10 ms of CPU for a plain Worker (the office object
was not stopped at 10 ms, up to 135 ms a call, proof.md wave 0); 5 Cron Triggers for the account.

## 2. What is done
| Step | What | Record |
|---|---|---|
| Wave 0 | Probes: the object CPU, rows on one year of data, sockets, sign-in crypto | proof.md "Wave 0 of the Supabase exit", "Wave 0, the rest" |
| Wave 1 | The SQLite path beside Postgres (`test:lite`, `test:office`, rows pins) | proof.md "Wave 1 of the Supabase exit: done" |
| Wave 2 | The own sign-in and the agents (OAuth) on SQLite | proof.md "Wave 2 of the Supabase exit" |
| Wave 3 | The office object, live sockets, the Cron, the day meters | proof.md "Wave 3 ...", "The merge of exit waves 2 and 3" |
| Wave 4 | Export, import, reverse export, restore check, seed, day cap, wrangler-only deploy | proof.md "Wave 4 of the Supabase exit" (merged a75ca94..4f9736d) |
| Fixes | Session key of the own sign-in (c50d0d0), consent line (8f5eac5), backup age from `publishedAt` (b4eb2e6) | proof.md wave 4 section, `.github/CLAUDE.md` |
| Wave 5 R1 to R5 | Test copy at b4eb2e6, secrets, import of the test office, switch to the office object (f7f504a), speed test | proof.md "Test copy at b4eb2e6", "Wave 5 on the test copy, R1 to R5, and the pause" |
| Pause | The test copy back on `supabase`, Track R stopped | the same proof.md section; `TASKS.md` line "PAUSED" |

The speed test of 2026-10-18 (`scripts/proof/server-time.sh 20`): the office path answered in 136 to 140 ms, the Supabase
function in 287 to 350 ms (medians). The member step of the office path is not measured yet (a TASKS item).

## 3. The state of each system now (2026-10-18)
- **Production** (`madar.vado.sa`, Supabase project `madar` = `oprkvdjudjxxhvodkzgs`): database, Auth, Realtime and the server on
  Supabase; files on R2 (`madar-files`); release ff963e1; word `supabase`. `madar-server-production` has no office binding, no
  migration and no Cron. The office team uses production for real work from 2026-10-18 to 2026-10-22: no production change in
  that week unless the owner asks for a fix.
- **The test copy** (`preview.madar-46r.pages.dev`, Supabase project `madar-test` = `qdgwpnesxppnqsaabqzd`): word `supabase`.
  Its Worker `madar-server-test` has the binding `OFFICE` (migration `office-v1`), the Cron `*/15 * * * *` (it returns at once
  while the word is not `office`), `MADAR_TEST_TOOLS = "on"`, `MADAR_DAY_CAP` (50% of each Free day limit, decision 6 form A),
  the secrets `MADAR_OPS_SECRET` and `MADAR_EXPORT_SECRET`, and the sign-in key `MADAR_AUTH_PRIVATE_JWK` (kid `RC72NWU2...`,
  made by `scripts/office/auth-key.ts`, kept by `secrets.ts`). Its office object holds the sample office of `madar-test` as
  imported on 2026-10-18 (917 records, version 2689). The office routes `/api/office/export|import|peek|drop` answer through
  the Pages binding whatever the word says, and only with their secret header (401 without it).
- **Cloudflare account** `d76d34779c63849f5acdf3d6af3751cd` (o.khalil@mazj.org): Workers `madar-server-test`,
  `madar-server-production`, `madar-probe` and `madar-probe-edge` (the Hyperdrive probes, kept for a re-run), and
  `binhindi-massing` (never touch it). 1 Cron Trigger of 5 is in use. Pages project `madar`. The Cloudflare mail "Workers CPU
  limit exceeded" of 2026-10-17 came from the CPU probe of 2026-10-16 (`scripts/deploy/CLAUDE.md`).
- **GitHub** (`byosamah/madar`): the 2,000 free minutes of October are used up; GitHub refuses every job with a "payments" text
  (no payment failed; no card on the account). `ci.yml` and `ci-stack.yml` start only by hand since 0dad809. `db-backup.yml`
  stays on its schedule and runs again when the minutes come back. `office-backup.yml` is off until `vars.OFFICE_BACKUP_URL`
  exists. The secret `OFFICE_EXPORT_SECRET` exists (2026-10-18).
- **Backups** (`byosamah/madar-backups`): the newest GitHub backup is `madar-db-20261017-011632Z`. The Mac backup
  `scripts/backup/mac-backup.sh` makes the same file. Its first run was set for 2026-10-18 17:30 Riyadh: check its release.
- **Worktrees** (`~/dev/madar-rb/`): `exit-signin`, `exit-live`, `exit-ops` are merged; `cloudflare`, `cf-files`, `cf-server`
  are older tracks; `read-cost` holds Track R (the note 67ea87e on 0dad809, no code). Remove a worktree or its `.reports/` only
  with the owner's OK. main is checked out in `~/dev/madar/.claude/worktrees/deploy-test`.

## 4. What needs doing now (during the pause)
1. **The database backup from the Mac**, each evening after 17:00 Riyadh, until GitHub runs `db-backup.yml` again:
   `scripts/backup/mac-backup.sh` (sandbox off). `--check` tests the inputs with no dump. Check the run with
   `gh release list -R byosamah/madar-backups --limit 3`. When `gh run list -R byosamah/madar --workflow "DB backup" --limit 1`
   shows a success again, stop the Mac runs. The script removes no old backup: the workflow does that again.
2. **The team's feature.** The normal flow of the repo (`CLAUDE.md`, the guides). Every new or changed call also keeps
   `npm run test:lite` and `npm run test:office` green (the SQLite path), so the restart stays cheap. The merge gate runs on the
   Mac: GitHub runs no test by itself.
3. **No production change before Friday 2026-10-23** unless the owner asks for a fix.

## 5. How to restart the move
1. Read `TASKS.md` (the line "PAUSED" and the "Exit wave 5" lines) and Part 2 of
   `docs/superpowers/plans/2026-10-17-madar-exit-wave4-ops-plan.md` (the runbook R1 to R14).
2. R1 again: the Cron count (`scripts/proof/do-socket/gql.mjs`, or the count of the runbook) and the rows of the UTC day.
3. A fresh office: `npx tsx scripts/office/import.ts --from test --to https://preview.madar-46r.pages.dev --mode replace
   --used-today <rows>` (or the seed, `scripts/office/seed.ts`). Run `npx wrangler whoami` first if a Cloudflare query gives 401.
4. R5: the word `office` for test in `config/server-host.json`, commit, `scripts/deploy/all.sh test`, then R5 step 4 (the owner
   signs in; the peek check of the PBKDF2 hash).
5. R6 to R14: the deploy suite on the office path (after 17:00 Riyadh, about 45 minutes; tell the owner first), the measurements,
   the nightly office backup and its restore check, one week of use, the rehearsal with the owner, the budget table, the check of
   decision 6, the close of wave 5.
6. Track R: start one builder in `~/dev/madar-rb/read-cost` (the brief of 2026-10-18 is in the session transcript; the design
   note and the exit plan section "Track R" hold the content). Its `node_modules` links to `deploy-test` already.
7. Wave 6: the switch of production on one evening (`TASKS.md` "Exit wave 6"), 30 days of watch, then the Supabase delete with
   the owner's OK.

## 6. Owner decisions
- Decided: GO (2026-10-17); the passwords move as the copied bcrypt hashes (decision 4); R2 alone, no B2 copy of the files
  (decision 5, 2026-10-18); the test copy on the same account with the 50% day cap (decision 6 form A, 2026-10-18); Resend stays
  for mail (decision 8); the pause (2026-10-18).
- Open: the safety valve if a Free limit stops Madar (decision 2; the owner refuses paid plans, so ask before any payment); the
  switch date (decision 3); the Supabase delete date (decision 7, recommended 30 days after the switch).

## 7. Open items
All in `TASKS.md`: the "Exit wave 5" and "Exit wave 6" lines, the Track R lines, and these faults from wave 4: the Usage page shows
the words of Workers Paid for the office host; `Office.drop` leaves an object with no tables in memory; `peek` reads the whole
result; an import carries no agent links or sessions (people sign in again, AI apps connect again); the replace mode deletes
`job_runs` and `mail_log`; `tests/e2e-deploy` is outside the type check; `wrangler dev` gives no client address, so local sign-ins
share one limit count; `server-time.sh` has no member sign-in for the office path.
Chat search on the office path scans `messages` and `comments` (`instr`). At the restart, give both an FTS5 table with the trigram
tokenizer, fed by the save, and lower the `search.query` pins (`server/office/test/pins.ts`; the numbers are in `proof.md`, "Chat search").

## 8. References
- Spec: `docs/superpowers/specs/2026-10-16-madar-cloudflare-exit-design.md` (wave 0 results and six changes at the top; section 7
  the owner decisions).
- Plans: `docs/superpowers/plans/2026-10-17-madar-cloudflare-exit-plan.md` (the roadmap, wave 1, Track R),
  `...-exit-wave2-signin-plan.md`, `...-exit-wave3-live-plan.md`, `...-exit-wave4-ops-plan.md` (Part 2: the wave 5 runbook).
- Track R note: `docs/superpowers/specs/2026-10-17-madar-read-cost-design.md` on branch `rb/read-cost`.
- Records: `docs/superpowers/real-build/proof.md` (the sections of section 2), `TASKS.md`.
- Guides: `server/CLAUDE.md` ("The office object"), `scripts/deploy/CLAUDE.md` ("The server host", the Workers lines),
  `.github/CLAUDE.md` (CI by hand, backups, the Mac backup), `functions/CLAUDE.md`, `server/auth/CLAUDE.md`, `tests/CLAUDE.md`.
- Settings: `config/server-host.json` (the word of each copy), `wrangler.server.toml` (the binding, migration, Cron, test vars).
- Scripts: `scripts/office/` (`import.ts`, `seed.ts`, `reverse.ts`, `new-secret.ts`, `auth-key.ts`), `scripts/deploy/all.sh`,
  `scripts/deploy/secrets.ts` (`--office`), `scripts/backup/` (`dump.ts`, `mac-backup.sh`, `officeRestore.ts`),
  `scripts/proof/server-time.sh`, `scripts/proof/do-socket/gql.mjs` with `scripts/proof/office-day/day.graphql`.
- Commits of 2026-10-17 and 2026-10-18 on main: 4f9736d (wave 4 merged), b4eb2e6, f5f0f08, 0dac68a, 0dad809, f7f504a, and the
  pause commit after it.
- Secrets (names only; never print them): `.env.local` (`MADAR_DB_PASSWORD`, `MADAR_TEST_DB_PASSWORD`, `BACKUP_REPO_TOKEN`, the
  Supabase token), `secrets/test.env` (with `MADAR_OPS_SECRET` and `MADAR_EXPORT_SECRET`), GitHub `BACKUP_DB_URL`,
  `BACKUP_REPO_TOKEN`, `OFFICE_EXPORT_SECRET`, variable `BACKUP_AGE_RECIPIENT`. The backup private key is with the owner only.

## 9. Facts that cost time once
- GitHub gives a release the `createdAt` of the commit of its tag. Read `publishedAt` for the time of a backup.
- GitHub's "recent account payments have failed or your spending limit needs to be increased" also means "the free minutes are
  used up". Read the billing page before you think of a card.
- The wrangler OAuth token in `~/Library/Preferences/.wrangler/config/default.toml` expires. `npx wrangler whoami` renews it.
- In Cloudflare GraphQL, a deleted Worker shows as `__unknown__`, and a CPU stop is the status `exceededResources`.
- `all.sh test` with no keyboard answers its config question with yes, which is the right answer for both projects.
- `grep -c` that counts 0 exits 1 and stops a `&&` chain.
- A worktree whose `node_modules` links to the main folder can lack a new package (bcryptjs): link it to `deploy-test`.
