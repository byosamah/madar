# Cloudflare Pages Functions

`scripts/deploy/pages.sh` uploads this folder with the screens. It holds five functions:
- `mcp/[[path]].ts`: the short MCP address (https://madar.vado.sa/mcp), logic in `server/http/pagesMcpProxy.ts`.
- `api/[[path]].ts`: the page's own `/api` (owner, 2026-10-16), logic in `server/http/pagesApiProxy.ts`.
- `.well-known/oauth-authorization-server/[[path]].ts` and `.well-known/openid-configuration/[[path]].ts` (exit wave 4): the
  discovery of the own OAuth server, only for a copy with the word office (`server/http/pagesWellKnown.ts`); every other copy
  answers 404. Two narrow files, not one `.well-known/[[path]].ts`, so no other `/.well-known/` path of the site changes.
- `map/[[path]].ts`: the same-origin street map of the Dashboard (fbk_017, probe of 2026-10-18), logic in `server/http/pagesMap.ts`.
  It reads the R2 bucket of the binding `MAP`. Without the binding, every request answers 404 `map_not_ready`. Only the map keys
  pass: the PMTiles file, the RTL text plugin and the glyph files of Noto Sans Regular, which hold Arabic (the route also allows
  the name Noto Sans Arabic Regular, which no upload makes). It has no host list. The rule "A new function here runs on every
  Pages host" asks for one. This route reads one bucket and forwards nothing, so the owner decides the list. The binding waits
  for the owner OK (proof.md, Map basemap probe).

Both follow `config/server-host.json` (`server/core/serverHost.ts`), which Pages builds into the function: with `workers` or
`office` (exit wave 4), each request goes to the Worker of its copy through a Pages service binding (`MADAR_SERVER_TEST` on the
preview environment, `MADAR_SERVER_PRODUCTION` on production). With `supabase`, or when the binding is missing, it goes to the
Supabase function of that copy, and the Pages log gets one JSON line (`reason` `setting` or `binding_missing`). A change of
the setting reaches the functions only with a new Pages deploy (`pages.sh`). `/api/office` and every path under it (the office
ops of exit wave 4) go to the binding whatever the word says, and never to Supabase: with no binding they answer 404.

- Keep each file a one-line wrapper that passes `request` and `env`. The logic and its tests live in `server/http/`
  (`pagesForward.ts` holds the shared parts).
- The rules of the MCP forwarder (host list, 404 cases, dropped headers) are in `server/mcp/CLAUDE.md`. The api forwarder has
  the same host table, the same 404 cases and header drops. On the Worker path, both forwarders write `x-madar-client-address`
  from the incoming `cf-connecting-ip` (the Worker trusts only that header for the client address, and the limits of the own
  sign-in and OAuth routes count it).
- A new function here runs on every Pages host, production too. It needs a fixed host list and tests, like the forwarders.
- A same-host forwarder of `POST /api/batch` to the Supabase function was built and measured (2026-10-08, performance audit
  FET-10), then removed: it added 20 to 50 ms to every call. The api forwarder of 2026-10-16 is for the Worker host: the
  screens call their own page, never a workers.dev address (security vendors report phishing abuse of workers.dev, so office
  filters can flag it), and the Worker needs no public address. The owner rule: the Worker stays only if it measures faster
  (`scripts/proof/server-time.sh`).
- The forwarder builds a new request for the binding. Not proven yet: whether the Worker then sees a `request.cf`. Without
  one, its `x-madar-server` says `colo=unknown` (`checks.sh` only warns on that). The `cf-placement` answer header names the
  run place either way.
- Check a change with `npx wrangler pages functions build --outdir <scratch folder>`. It builds only code files, so this
  CLAUDE.md never reaches the build (checked 2026-10-05). The build of 2026-10-16 is about 24 KB for both functions.
