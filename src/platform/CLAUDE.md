# The site Madar enterprises

Madar enterprises is a separate platform (design 12, 2026-11-08, D7 to D13). VADO is one of the companies on it. This folder is the whole
site: its own sign-in, its own accounts, its own small build. Read `docs/superpowers/specs/2026-11-08-madar-enterprises-design.md`, section 12,
and `server/enterprise/CLAUDE.md` first.

## What it is
- A third build of the repo: `platform.html` loads `src/platform/main.tsx`. `npm run build:platform` (`scripts/build-platform.ts`) runs the
  direction check, both type checks, `vite build -c vite.platform.config.ts` and `check-bundles.ts platform`. The output is `dist-platform/`
  with the page as `index.html` and `_headers` from `config/headers.platform` (the own origin only). There is no public folder: no manifest,
  no service worker, no app icons. The page says `noindex`.
- The Pages project is `madar-platform` (test `preview.madar-platform.pages.dev`; production `madar-platform.pages.dev`, later
  `platform.madar.vado.sa`). Its one Pages Function (`functions-platform/api/platform/[[path]].ts`, logic in
  `server/http/pagesPlatformProxy.ts`) hands `/api/platform*` to the Worker of the copy. The deploy and the owner steps:
  `scripts/deploy/CLAUDE.md`, "The platform site".

## Files
- `main.tsx`: the entry. Starts the words, the theme, the site client and the query client, then draws `PlatformApp`.
- `client.ts`: `createSessionStore` (the session in the own localStorage key `madar.platform.session`, in memory when the storage is blocked) and
  `createPlatformSite` (sign in, sign out, the eight `platform.*` calls). The wire is the one of the "Shared names" of
  `docs/superpowers/plans/2026-11-08-madar-enterprises-f-platform-site.md`: `POST /api/platform/auth/token` (password or refresh grant),
  `POST /api/platform/auth/logout`, `POST /api/platform` (one wire call each). The calls are a Proxy, not the list of the contract, so the zod
  schemas stay out of the build.
- `PlatformApp.tsx`: the sign-in screen or the page inside a small shell (title, theme switch, language switch, Sign out). No router. A session
  that ends clears the query cache. `SignInScreen.tsx`, `SiteControls.tsx`, `theme.ts`, `words.ts`, `queryClient.ts`.
- `EnterprisesScreen.tsx`, `EnterpriseSheet.tsx`, `NewEnterpriseSheet.tsx`, `MeterStrip.tsx`, `usePlatform.tsx`: the page (list, sheets, meter).
  The logo, the logo picker and the limits helpers stay in `features/enterprises/` because the Admin of a company uses them too.

## Rules
- Platform tokens and company tokens never mix (D10). The site sends only the platform token, and only to `/api/platform*`. It reads no company session
  and no company storage key. Its keys: `madar.platform.session`, `madar.platform.lang`, `madar.platform.theme`.
- A refresh token turns once and the server ends the session when an old one comes back. So one refresh runs at a time in a tab (one shared promise) and
  in all tabs (a Web Lock `madar.platform.refresh`), and a tab that waited for the lock uses the pair that another tab stored. A 401 on a call gives
  one refresh and one resend. A second 401 ends the session. A network failure keeps the session.
- The sign-in screen says one sentence for a wrong email, a wrong password, a turned-off account and a company login (`wrong_credentials`). It never
  shows the paused text of the companies. A session that ends shows `platformSite.signIn.ended` or `.off` above the form.
- No forgot link, no invite, no password change here (D13): a platform account is made, changed and turned off from the Mac with
  `scripts/office/platform-account.ts`.
- Import no runtime, route, shell, remote client, registry, store, sample office or company screen. `imports.test.ts` follows the imports of
  `main.tsx` and fails on one. `check-bundles.ts platform` checks the build: no Supabase, no zod, no company call name, one origin, a first load
  under `PLATFORM_FIRST_LOAD_MAX_*`. The companies' bundles hold none of `PLATFORM_MARKERS`.
- A new word goes into `src/i18n/real/ent-f2.*.json` (English and Arabic, Thmanyah rules, no em-dash). A key that a shared part reads needs a line in
  `words.ts` (`src/i18n/CLAUDE.md`).
- Screens: the root rules apply (ADHD test, one title, one main button, screenshots EN and AR, light and dark, 390 px). Take the shots on the
  test copy after `all.sh test`, with a platform account.

## Tests
- `client.test.ts` (the wire, the refresh, the 401 rules, sign out), `PlatformApp.test.tsx` (sign-in, session, sign out, language, theme),
  `EnterprisesScreen.test.tsx` (the page), `words.test.tsx` (every key found, in both languages), `imports.test.ts`.
  A test renders with `QueryClientProvider`, `ToastProvider` and `PlatformProvider`; it needs no company runtime.
