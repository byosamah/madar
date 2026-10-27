# Switch the files to R2 (finished runbook)

Both copies switched on 2026-10-16 (the test copy first, then production at ae63498; health shows `"fileStore":"r2"`). This
file keeps the steps for a rebuild of a copy or a new bucket. The short rules are in `scripts/deploy/CLAUDE.md` and
`server/files/CLAUDE.md`.

For one copy: the test copy first, then production. `<env>` is `test` or `production`, `<bucket>` is `madar-files-test` or
`madar-files`. The lead runs the cloud steps; each network step needs the sandbox off.

**Read this first.** No copy from R2 back to Storage exists. After the switch, a return to `MADAR_FILE_STORE=supabase` loses
every file that people uploaded after the switch. The way back of the server host (the Supabase functions in place of the
Worker) keeps `MADAR_FILE_STORE=r2`. The Storage bucket stays as it is (no delete without the owner's OK). In production, the
switch refuses the open screens for some minutes (step 4): do it in a quiet time and tell the office first.

Before: R2 is on, `<bucket>` exists with `--jurisdiction eu`, its CORS rule is set
(`npx wrangler r2 bucket cors set <bucket> --file config/r2-cors.<env>.json --jurisdiction eu --force`), and the owner has an R2
token with Object Read & Write on `<bucket>` only (`server/files/CLAUDE.md`).
1. The owner adds the four R2 lines to `secrets/<env>.env` (`! open -a TextEdit secrets/<env>.env`). `MADAR_FILE_STORE` stays
   `supabase`: the server ignores the R2 lines until the switch. Check: `npx tsx scripts/deploy/secrets.ts <env> --dry-run`.
2. The first copy: `npx tsx scripts/storage/move-to-r2.ts --env <env>` (production: `echo production | npx tsx ...`). The JSON
   report must say `"mismatched": []`. The screens keep working during the copy.
3. Right before the switch, the same command again. It copies every object again, then the new and changed ones, and removes
   from R2 the keys that Storage no longer has. Production: in the quiet time, with no uploads.
4. The switch. In `secrets/<env>.env` the owner sets `MADAR_FILE_STORE=r2` and `MIN_CLIENT_BUILD` to the build of the switch.
   The Worker gets the same two values in the same step (the Worker secrets of the server track): the file store does not
   follow the server host. Then `scripts/deploy/all.sh <env>` (production: the Release flow and its typed word).
   - The build ID is the UTC day of the build (`buildId` in `scripts/build-remote.ts`, for example `2026.10.16`), or
     `VITE_MADAR_BUILD` when the environment sets it. The server refuses a screen build older than `MIN_CLIENT_BUILD`
     (`buildOlder`, `server/http/limits.ts`) with "Madar has a new version. Reload the page.", so a tab from before the switch
     reloads and gets the new CSP (the R2 host in `img-src`, `connect-src`, `frame-src`).
   - When the copy had a deploy earlier on the same UTC day, give the switch build a fourth part: run all.sh with
     `VITE_MADAR_BUILD=2026.10.16.1` and set `MIN_CLIENT_BUILD=2026.10.16.1`. Every later deploy on that UTC day then needs the
     same `VITE_MADAR_BUILD` or a higher one, else the server refuses its own new screens. From the next UTC day the plain day
     is higher again.
   - From the secrets step to the end of the pages step, the server refuses the old screens, and a reload still gets them.
     After the pages step a reload gets the new screens. An upload in flight at the switch fails with "The file did not
     arrive. Upload it again.": the person uploads it again.
5. `npx tsx scripts/storage/move-to-r2.ts --env <env> --copy-only`: it copies the files that people confirmed on Storage after
   step 3. It never removes and never overwrites a key. The full move now refuses by itself (the file says r2).
6. `npx tsx scripts/storage/verify-r2-keys.ts --env <env>`: exit 0 with `"missing": []`. A missing key: step 5 again, then step 6.
7. Test only: the seed (`npx tsx scripts/seed-test-office.ts`, which writes the 72 sample files to `madar-files-test`), then
   the deploy suite (`tests/CLAUDE.md`; it counts R2 objects only with the R2 lines in the environment).
8. The record: a proof.md section with the two move reports, the copy-only report, the key check and the deploy suite.
   After production: make R2 the source of the weekly file backup (`.github/CLAUDE.md`, the read-only R2 token).
