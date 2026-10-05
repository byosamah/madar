# Deploy

Production is live at https://madar.vado.sa with real people on it. A wrong step here reaches them. Production deploys
only from the Mac, after the typed word `production`. The test copy is https://preview.madar-46r.pages.dev.

## Steps
- `scripts/deploy/all.sh <test|production>` runs every step in this order. Each step also runs alone:
  1. `db.sh`: pushes the new migrations. It links the CLI, pushes, and unlinks again.
  2. `config.sh`: pushes `supabase/config.toml` through the `[remotes.<env>]` block (`config-check.ts` checks it first).
  3. `secrets.ts`: from `secrets/<env>.env`. It writes the Vault secrets, `platform_config.mcp_url`, the madar_server
     password (as a SCRAM verifier), and the function secrets. It prints names, never a value.
  4. `functions.sh`: builds the server bundles and deploys `api`, `mcp`, `jobs`. Then it asks `api/health` in Frankfurt.
  5. `pages.sh`: builds the remote screens, writes `dist/_headers` (CSP) with `headers.ts`, and uploads to the Pages
     project `madar`: branch `preview` for test, `main` for production. The `functions/` folder (the /mcp forwarder) goes too.
- All CLIs come from `package.json`, never a global copy.

## Production rules
- `all.sh production` asks once for the typed word. Without a terminal: `echo production | scripts/deploy/all.sh production`.
- Every script refuses production when `CI` or `GITHUB_ACTIONS` is set. A `MADAR_DEPLOY_CONFIRMED` from the shell never counts.
- The auto-mode safety system may refuse a production deploy or a key change until the owner says so in chat. Respect
  the refusal. Never work around it.
- Change only madar-test unless the owner asked for production.

## Secrets
- `secrets/test.env`, `secrets/production.env`, `secrets/test-accounts.env`: git-ignored, mode 600. Never print them.
- `secrets.ts` needs `SUPABASE_ACCESS_TOKEN` (the Madar account) and the postgres password: `MADAR_TEST_DB_PASSWORD` for
  test, `MADAR_DB_PASSWORD` for production (both in `.env.local`).
- `MCP_URL` in each file is the short MCP address (see `server/mcp/CLAUDE.md`).

## Cloudflare
- wrangler is signed in as o.khalil@mazj.org. The Pages project `madar` is `madar-46r.pages.dev` (`madar.pages.dev`
  belongs to someone else). R2 is not on.
- wrangler 4.147+ sends `pages project create` to the new Workers path. The project exists, so `pages deploy` works.
- Pages custom domains go through the Cloudflare API with the wrangler login token (`npx wrangler whoami` refreshes it;
  `oauth_token` in `~/Library/Preferences/.wrangler/config/default.toml`).
- vado.sa DNS is in a Vercel team that the CLI cannot see. Give the owner the records, and he adds them himself.
  Never pay Vercel.

## Other scripts
- First Admin: `npx tsx scripts/first-admin.ts --env test|production|local --email --name --language --gender`.
  `--password-stdin` reads the typed word and the password from one stdin.
- `scripts/seed-test-office.ts` seeds madar-test only (load `.env.local` and `secrets/test-accounts.env`).
- `token-scope.sh` is the first step of `deploy.yml`: it stops the GitHub job if the token can reach production.
- After a deploy, run the deploy suite on the test copy (see `tests/CLAUDE.md`), and write the result in proof.md,
  section "Deploy".
