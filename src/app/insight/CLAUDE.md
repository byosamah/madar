# Insight (PostHog)

The owner sees how the team uses Madar, which errors they hit and replays of the screen. Design:
`docs/superpowers/specs/2026-10-25-madar-posthog-insight-design.md`.

## Rules
- Two modules. `index.ts` is in the first load and holds no PostHog code: `startInsight` (called in the idle step of `startIdlePrefetch` in
  `main.tsx`) and the forwarders `reportError`, `noteSlow` and `noteSheet` (in `notes.ts`, which imports nothing big, so `RouteError`,
  `bootstrap.ts` and the sheets import it with no import cycle). `client.ts` is a lazy chunk. Only `client.ts` imports `posthog-js`.
- The start rule: the real build only (`index.ts` folds `import.meta.env.VITE_MADAR_API === 'remote'` itself, so the prototype holds no
  PostHog code), the public key `VITE_POSTHOG_KEY` in `config/remote.<env>.env` (optional: with none, nothing starts), a signed-in person, and
  an address behind the gate (`screensAt(path, true).gated`). A sign-out stops it (`stop()`); the next sign-in starts it for the new person
  (`init` runs once). A failed import stays quiet and never reloads the page. `check-bundles.ts` fails when `$snapshot_data` reaches the
  first load, or `$snapshot_data` or `eu.i.posthog.com` reaches the prototype.
- `harmlessError` (`client.ts`) drops two kinds of error record: the ResizeObserver warning and the failure of the Arabic text plugin
  of the map (tsk_486).
- `posthogOptions` (`client.ts`) holds the privacy rules and `client.test.ts` pins them. `before_send` runs `scrubEvent` (`scrub.ts`), which
  fails closed (a record it cannot read is dropped). `src/lib/urlScrub.ts` keeps the pure parts, shared with the server.
- Put `PRIVATE` (`privateMark.ts`, `ph-no-capture`) on the smallest element that holds a chat message, an amount of money, or a file picture or
  link. `privateMark.test.ts` is a source test: a new file that calls `useFileLink`, `useScreenshotLink`, `useFileUrl` or `amountText` without
  `PRIVATE` fails it. Put the class on a new place of the same kind.
- A new main sheet adds its name to `SheetName` and calls `useSheetSteps(name, open)` (`sheetWiring.test.ts`).
- No proxy through the Pages Functions (the replay packets could use the free request quota). The CSP names only the two `eu` PostHog hosts
  in `connect-src`. The team sees one line in Settings (`UsageDataSection`) and in the Me hub (`UsageDataNote`).
