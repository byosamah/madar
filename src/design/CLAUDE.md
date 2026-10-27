# Design system: tokens

`tokens.css` is the source of every colour, size, radius and shadow. `DESIGN.md` at the repo root is the readable copy of
the same system for people and for design tools (Google DESIGN.md format, alpha, spec 0.4.0). The rules of use are in
`src/CLAUDE.md` ("Design rules") and in the prose of `DESIGN.md`. The Thmanyah licence rule is in the root `CLAUDE.md`.

## Files
- `tokens.css`: the CSS variables, light and dark. `tokens.test.ts` checks the contrast of the text pairs. It also pins the four
  exact font-family stacks, the font faces, and the `unicode-range` of Madar Dot and Madar Digits. A new family, a new face or
  a change to a stack or a range fails it.
- `--phone-bar` is the room of the phone tab bar. The shell sets `data-bar-hidden` on `<html>` while the bar hides (an open
  chat, the keyboard, Focus mode), and the token goes to 0. Use it for page padding and the toast lane. `--chat-h` is not a
  token: `PhoneChatPage` sets it inline on the chat root, and the composer and the @ list read it with a `100dvh` fallback.
- `fonts/`: Thmanyah Sans 400, 500 and 700 (OTF), exactly as font.thmanyah.com ships them.
- `inter/`: the Inter subset `inter-digits-dot.woff2`, with the OFL licence of Inter (`OFL.txt`). It is not in `fonts/`,
  because `tokens.test.ts` keeps `fonts/` to the three Thmanyah files.
- `motion.ts`: the motion times and curves. Motion respects "reduce motion" (`MotionConfig reducedMotion="user"`).

## When you change a token
1. Change `tokens.css`. Run `tokens.test.ts`.
2. Change the same value in the YAML front matter of `DESIGN.md`. A colour with alpha goes in as its composited hex value
   (the linter ignores alpha), and the prose names the rgba form.
3. Run `npm_config_cache="$TMPDIR/npm-cache" npx -y @google/design.md lint DESIGN.md` (the npm cache on this Mac has
   root-owned files). It must show 0 errors and 0 warnings. No test or workflow runs this lint, so `DESIGN.md` drifts
   silently if you skip it. Run it by hand in the same commit.
4. Take screenshots of the changed screens (root rule).
- A new component style also needs its token group in `DESIGN.md` under `components`.

## Rules
- Screens take colours from the tokens. A new colour starts as a token here and in `DESIGN.md`.
- Phone parts take no new token. The sticky tab row of the project page is a solid `--c-bg` band with no blur. The `.hairline`
  class draws a line between the direct children of a `Group` body in the task panel. The press and hold classes are
  `touch-manipulation`, `pointer-coarse:select-none` and `pointer-coarse:[-webkit-touch-callout:none]`. A Me hub icon has no
  coloured tile, and a state is a word in ink, not a dot.
- No new font file or font family (see "Do's and Don'ts" in `DESIGN.md`). The one exception is the Inter subset in `inter/`:
  the same Inter glyphs in a smaller file.
- Thmanyah files: never convert, subset or rename them, never put them in `public/`, and get a new version only from
  font.thmanyah.com. `tokens.test.ts` checks the file hashes; a new version needs new hashes there.
- Thmanyah Sans has no tabular figures. The `.tabular` class takes the digits 0 to 9 from `inter/inter-digits-dot.woff2`
  ("Madar Digits" in `tokens.css`). The middle dot "·" and the square sign "²" (m²) also come from that file ("Madar Dot",
  first in every stack): the Thmanyah dot reads like an Arabic zero, and Thmanyah has no "²", so the page would load the
  whole Inter Latin file. `scripts/fonts/subset-inter.ts` makes the file with pyftsubset (`pip install fonttools brotli`).
  `scripts/fonts/subset-inter.test.ts` pins its bytes, characters, axes and tnum. Keep the Inter import in `main.tsx`: it is
  the Inter Variable fallback face.
- The remote index.html preloads the three Thmanyah files (`earlyLinks` in `vite.config.ts`, `FONT_WEIGHTS` in
  `scripts/check-bundles.ts`). A new or renamed Thmanyah file needs a change of `FONT_WEIGHTS`. The bundle check fails a
  preload whose bytes differ from `fonts/`.
- The font has no 600. The Medium face covers 500 to 600, so `font-semibold` renders Medium and only 700 renders Bold.
  Every `--text-*--font-weight` is a heading and asks 700 (`tokens.test.ts` checks this).
