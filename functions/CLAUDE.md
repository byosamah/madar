# Cloudflare Pages Functions

`scripts/deploy/pages.sh` uploads this folder with the screens. Today it holds one function:
`mcp/[[path]].ts`, the short MCP address (https://madar.vado.sa/mcp).

- Keep each file a one-line wrapper. The logic and its tests live in `server/http/pagesMcpProxy.ts`.
- The rules of the forwarder (host list, 404 cases, dropped headers) are in `server/mcp/CLAUDE.md`.
- A new function here runs on every Pages host, production too. It needs a fixed host list and tests, like the forwarder.
- Check a change with `npx wrangler pages functions build --outdir <scratch folder>`. It builds only code files, so this
  CLAUDE.md never reaches the build (checked 2026-10-05).
