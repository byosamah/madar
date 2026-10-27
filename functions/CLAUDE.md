# Cloudflare Pages Functions

`scripts/deploy/pages.sh` uploads this folder with the screens. It holds seven functions. Keep each file a one-line wrapper
that passes `request` and `env`. The logic and its tests live in `server/http/` (`pagesForward.ts` holds the shared parts).
- `mcp/[[path]].ts`: the short MCP address (https://madar.vado.sa/mcp), logic in `server/http/pagesMcpProxy.ts`.
- `api/[[path]].ts`: the page's own `/api`, logic in `server/http/pagesApiProxy.ts`.
- `.well-known/oauth-authorization-server/[[path]].ts` and `.well-known/openid-configuration/[[path]].ts`: the discovery of the
  own OAuth server, only for a copy with the word office (`server/http/pagesWellKnown.ts`); every other copy answers 404. Two
  narrow files, not one `.well-known/[[path]].ts`, so no other `/.well-known/` path of the site changes.
- `map/[[path]].ts`: unused route, kept for a later own map file (`server/http/pagesMap.ts`). It needs the R2 binding `MAP`;
  without it every request answers 404 `map_not_ready`. The screens read the free OpenFreeMap tiles.
- `maplink.ts`: `POST /maplink` follows a short Google Maps link (`maps.app.goo.gl`, `goo.gl/maps`) and answers the long address,
  logic in `server/http/pagesMapLink.ts`. It needs no key and no binding. It opens only the short link, follows a redirect only
  to a Google host, never opens the last address, and answers only a request from the same site.
- `satellite/[[path]].ts`: `GET /satellite/<z>/<y>/<x>`, one Esri World Imagery tile, logic in `server/http/pagesSatellite.ts`
  (the details are in its top comment). Only the page hosts of the two copies (any other host: 404). Only a person signed in to
  that copy (the browser token, no agent token): else 401. It adds the Pages secret `ESRI_KEY` and the one referrer of the key
  (`https://madar.vado.sa`, for both copies), passes only a picture, and stores nothing (Esri's terms forbid stored copies). No
  `ESRI_KEY` gives 404 `no_map`. Set the secret on both environments: `pbpaste | npx wrangler pages secret put ESRI_KEY
  --project-name madar --env preview` (then `--env production`). A secret reaches only the next deployment. Why a route and
  not a browser call: Esri's terms ask a business for an account, so the maps use Madar's own key of the office's Esri account
  (ArcGIS Location Platform, a free monthly tile quota shared with Kutla; the key ends on 2027-10-19: renew it before), and one
  Esri edge address never answers from Saudi networks. Each tile is one Functions request (about 30 for a view). The client
  side: `src/features/map/CLAUDE.md`.

## The forwarders (`/api` and `/mcp`)
- The api and mcp forwarders follow `config/server-host.json` (`server/core/serverHost.ts`), which Pages builds into the function.
  With `workers` or `office`, each request goes to the Worker of its copy through a Pages service binding (`MADAR_SERVER_TEST`
  on the preview environment, `MADAR_SERVER_PRODUCTION` on production), with the path and the query kept (the mcp request gets
  no `x-region`). With `supabase`, or when the binding is missing, it goes to the Supabase function of that copy (pinned to
  Frankfurt: `forceFunctionRegion` for the api, `x-region: eu-central-1` for the mcp function), and the Pages log gets one JSON
  line (`reason` `setting`, or `binding_missing` as a warning). Supabase then sees the address of the Pages Function, not of the
  person. A change of the setting reaches the functions only with a new Pages deploy (`pages.sh`).
- A fixed host list: `PAGE_HOSTS` in `server/core/serverHost.ts` (`MCP_TARGETS` names the Supabase function of each host). Any
  other host, any path outside its prefix, and any encoded dot, encoded slash or backslash gets 404, on both paths. A production
  host never reaches the test binding. A new function here runs on every Pages host, production too: it needs a fixed host list
  and tests, like the forwarders.
- The forwarders drop the `cf-*` headers and the client address headers. On the Worker path they then write
  `x-madar-client-address` from the incoming `cf-connecting-ip`. The Worker trusts only that header for the client address, and
  the limits of the own sign-in and OAuth routes count it (`server/auth/CLAUDE.md`).
- `/api/office` and every path under it (the office ops) go to the binding whatever the word says, and never to Supabase: with no
  binding they answer 404.
- The api forwarder passes `GET /api/google/callback` with its query, and gives the 302 and its `Location` back as they are
  (`redirect: 'manual'`). `pagesApiProxy.test.ts` checks it. The route itself is in `server/google/callback.ts`.
- Screens call their own page `/api`, never a workers.dev address: security vendors report phishing abuse of workers.dev, so office
  filters can flag it, and the Worker needs no public address.
- WebKit browsers send their batch calls through the page's own `/api`. Why: a call straight to the Supabase function needs a CORS
  preflight, and WebKit (Safari on a Mac and every browser on an iPhone or iPad) keeps the answer for 10 minutes at most, Chromium
  for 2 hours. Measured on the test copy with WebKit 26.6 and the iPhone 15 profile (15 rounds each): direct with a new preflight
  656 ms, direct with a cached preflight 370 ms, the page's own `/api` 383 ms. So the forwarder costs about 13 ms more than a cached
  preflight and about 275 ms less than a new one. A forwarder in front of every browser added 20 to 50 ms to each call, so only
  WebKit uses it. The client code: `src/CLAUDE.md`, "The API address".
- The forwarder builds a new request for the binding. Whether the Worker then sees a `request.cf` is not proven. Without one, its
  `x-madar-server` says `colo=unknown` (`checks.sh` only warns on that). The `cf-placement` answer header names the run place
  either way.
- Check a change with `npx wrangler pages functions build --outdir <scratch folder>`. It builds only code files, so this
  CLAUDE.md never reaches the build.
