# Cloudflare Pages Functions

`scripts/deploy/pages.sh` uploads this folder with the screens. Today it holds two functions:
- `mcp/[[path]].ts`, the short MCP address (https://madar.vado.sa/mcp).
- `api/batch.ts`, the same-host batch address (`POST /api/batch`, performance audit FET-10). Only the batch goes this way:
  `/api/auth/forgot` and `/api/auth/renew-invite` limit by the client address, so they stay on the Supabase address. A
  build uses it only when `VITE_BATCH_URL` is set in its `config/remote.<env>.env`.

- Keep each file a one-line wrapper. The logic and its tests live in `server/http/pagesMcpProxy.ts` and
  `server/http/pagesApiProxy.ts` (the same host list, `MCP_TARGETS`; 404 for any other host or path, 405 for any other
  method; the Cloudflare, client address and cookie headers go).
- The rules of the forwarder (host list, 404 cases, dropped headers) are in `server/mcp/CLAUDE.md`.
- A new function here runs on every Pages host, production too. It needs a fixed host list and tests, like the forwarder.
- Check a change with `npx wrangler pages functions build --outdir <scratch folder>`. It builds only code files, so this
  CLAUDE.md never reaches the build (checked 2026-10-05).
