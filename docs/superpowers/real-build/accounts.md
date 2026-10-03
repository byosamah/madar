# Accounts and projects (no secrets here)

Secrets live only in `~/dev/madar/.env.local` (git ignores it) and in each host's secret store.

| Service | Name | Reference | Region |
|---|---|---|---|
| Supabase | madar (production) | `oprkvdjudjxxhvodkzgs` | to confirm: Central EU (Frankfurt) |
| Supabase | madar-test (test copy) | `qdgwpnesxppnqsaabqzd` | to confirm: Central EU (Frankfurt) |
| GitHub | byosamah/madar | private repository | |

The Supabase command line on this Mac is signed in to another account (Halulu). Madar commands use the Madar account token from `.env.local` (`SUPABASE_ACCESS_TOKEN`), so the Halulu sign-in stays as it is.
