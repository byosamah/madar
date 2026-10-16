# Accounts and projects (no secrets here)

Secrets live only in `~/dev/madar/.env.local` (git ignores it) and in each host's secret store.

| Service | Name | Reference | Region |
|---|---|---|---|
| Supabase | madar (production) | `oprkvdjudjxxhvodkzgs` | Central EU (Frankfurt), confirmed 2026-10-03 |
| Supabase | madar-test (test copy) | `qdgwpnesxppnqsaabqzd` | Central EU (Frankfurt), confirmed 2026-10-03 |
| GitHub | byosamah/madar | private repository | |
| Cloudflare | O.khalil@mazj.org's Account | `d76d34779c63849f5acdf3d6af3751cd` | R2 not turned on yet (2026-10-03) |
| Cloudflare Pages | madar | https://madar-46r.pages.dev (production, branch main); https://preview.madar-46r.pages.dev (test, branch preview) | made 2026-10-04 on the classic Pages path (`wrangler pages project create --force` once); madar.pages.dev belongs to someone else |
| Domain | madar.vado.sa (main) and www.madar.vado.sa | CNAME records `madar` and `www.madar` to `madar-46r.pages.dev`, in the Vercel DNS of vado.sa (another Vercel team than the CLI login); Pages custom domains, Google certificates | added 2026-10-05; www moves to madar.vado.sa in the screens (`src/app/canonicalHost.ts`) |
| Cloudflare | CA certificate `supabase-root-2021-ca` | `056db33b-f928-46b0-8302-e167f5d1d832` | the Supabase Root 2021 CA (`config/supabase-root-2021-ca.crt`), uploaded 2026-10-16 for Hyperdrive verify-full |
| Cloudflare Hyperdrive | `madar-db-test` (madar-test, session pooler, port 5432) | `1c4fc4b830234fad8956b6e80c52f4fc` | made 2026-10-16; user `madar_server.<test ref>`, verify-full with the CA above, caching off, origin connection limit 10 |
| Cloudflare Hyperdrive | `madar-db-test-tx` (madar-test, transaction pooler, port 6543) | `5dee5c010db64061a45c5fd3ff592136` | made 2026-10-16 for the probe only: its queries hang (proof.md, Hyperdrive probe); origin connection limit 10 |
| Cloudflare Workers | `madar-probe` (placement `aws:eu-central-1`, bindings `DB_SESSION`, `DB_TX`, secret `PROBE_SECRET`) and `madar-probe-edge` (service binding `PROBE`) | `scripts/proof/hyperdrive/` | probe Workers of 2026-10-16; no public address since the probe (workers_dev false) |
| Cloudflare Workers | `madar-server-test` (test copy) and `madar-server-production` (production): the server host of each copy | `wrangler.server.toml`, `[env.test]` and `[env.production]`; deployed by `scripts/deploy/worker.sh` | owner, 2026-10-16; no public address (workers_dev and preview_urls false); `madar-server-test` deployed 2026-10-16, `madar-server-production` after the Hyperdrive id below; account workers.dev subdomain `vado-sa` (unused) |
| Cloudflare Pages bindings | `MADAR_SERVER_TEST` (preview) to `madar-server-test`; `MADAR_SERVER_PRODUCTION` (production) to `madar-server-production` | `scripts/deploy/cloudflare-setup.ts` sets them | `MADAR_SERVER_TEST` set 2026-10-16; `MADAR_SERVER_PRODUCTION` when the production Worker exists |
| Cloudflare Hyperdrive | `madar-db-production` (madar, session pooler, port 5432) | `21d31839432b41a8b2ca3f808891e04c` | made 2026-10-16 by `cloudflare-setup.ts --env production`; like `madar-db-test`: verify-full with the CA above, caching off, origin connection limit 10 |
| Resend | the owner's account | sender `Madar <madar@vado.sa>` (production); verified domains vado.sa, mazj.sa (ap-northeast-1), mazj.org (eu-west-1) | the owner chose vado.sa on 2026-10-04 |

The Supabase command line on this Mac is signed in to another account (Halulu). Madar commands use the Madar account token from `.env.local` (`SUPABASE_ACCESS_TOKEN`), so the Halulu sign-in stays as it is.

Database connections go through the pooler: host `aws-1-eu-central-1.pooler.supabase.com`, session mode port 5432, transaction mode port 6543, user `postgres.<reference>`. Both passwords were tested on 2026-10-03.

Public values (every page holds them, so they are not secrets):

- madar-test publishable key: `sb_publishable_kfY3EbMbn4RfWcDMNo6LVw_pj6G71ZI` (track R2, 2026-10-04). Track O3 puts it in `config/remote.test.env` as `VITE_SUPABASE_PUBLISHABLE_KEY`.
