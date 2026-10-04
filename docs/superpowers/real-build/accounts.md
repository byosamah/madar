# Accounts and projects (no secrets here)

Secrets live only in `~/dev/madar/.env.local` (git ignores it) and in each host's secret store.

| Service | Name | Reference | Region |
|---|---|---|---|
| Supabase | madar (production) | `oprkvdjudjxxhvodkzgs` | Central EU (Frankfurt), confirmed 2026-10-03 |
| Supabase | madar-test (test copy) | `qdgwpnesxppnqsaabqzd` | Central EU (Frankfurt), confirmed 2026-10-03 |
| GitHub | byosamah/madar | private repository | |
| Cloudflare | O.khalil@mazj.org's Account | `d76d34779c63849f5acdf3d6af3751cd` | R2 not turned on yet (2026-10-03) |

The Supabase command line on this Mac is signed in to another account (Halulu). Madar commands use the Madar account token from `.env.local` (`SUPABASE_ACCESS_TOKEN`), so the Halulu sign-in stays as it is.

Database connections go through the pooler: host `aws-1-eu-central-1.pooler.supabase.com`, session mode port 5432, transaction mode port 6543, user `postgres.<reference>`. Both passwords were tested on 2026-10-03.

Public values (every page holds them, so they are not secrets):

- madar-test publishable key: `sb_publishable_kfY3EbMbn4RfWcDMNo6LVw_pj6G71ZI` (track R2, 2026-10-04). Track O3 puts it in `config/remote.test.env` as `VITE_SUPABASE_PUBLISHABLE_KEY`.
