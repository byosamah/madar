# Design system: tokens

`tokens.css` is the source of every colour, size, radius and shadow. `DESIGN.md` at the repo root is the readable copy of
the same system for people and for design tools (Google DESIGN.md format, alpha, spec 0.4.0). The rules of use are in
`src/CLAUDE.md` and in the prose of `DESIGN.md`.

## Files
- `tokens.css`: the CSS variables, light and dark. `tokens.test.ts` checks the contrast of the text pairs.
  `--phone-bar` is the room that the phone tab bar takes at the foot of the page: `calc(64px + max(16px, env(safe-area-inset-bottom)))` on `:root`,
  and 0 px under `:root[data-bar-hidden]` (the shell sets the mark while the bar hides: an open chat, the keyboard, Focus mode). The page padding and the
  toast lane use it. `tokens.test.ts` holds both values. `--chat-h` is not a token: `PhoneChatPage` sets it inline on the chat root, and the composer and the
  @ list read it with a `100dvh` fallback.
- `fonts/`: Thmanyah Sans 400, 500 and 700 (OTF, version 1.003), exactly as font.thmanyah.com ships them.
- `inter/`: the Inter subset of the digits, the square sign and the middle dot, with the OFL licence of Inter (`OFL.txt`). It is not in
  `fonts/`, because `tokens.test.ts` keeps `fonts/` to the three Thmanyah files.
- `motion.ts`: the motion times and curves. Motion respects "reduce motion" (`MotionConfig reducedMotion="user"`).

## When you change a token
1. Change `tokens.css`. Run `tokens.test.ts`.
2. Change the same value in the YAML front matter of `DESIGN.md`. A colour with alpha goes in as its composited hex value
   (the linter ignores alpha), and the prose names the rgba form.
3. Run `npm_config_cache="$TMPDIR/npm-cache" npx -y @google/design.md lint DESIGN.md` (the npm cache on this Mac has
   root-owned files). It must show 0 errors and 0 warnings.
4. Take screenshots of the changed screens (EN and AR, light and dark, 390 px).
- A new component style also needs its token group in `DESIGN.md` under `components`.

## Rules
- Phone parts take no new token. The sticky tab row of the project page is a solid `--c-bg` band with no blur. The `.hairline` class draws a line between
  the direct children of a `Group` body in the task panel. The press and hold classes are `touch-manipulation`, `pointer-coarse:select-none` and
  `pointer-coarse:[-webkit-touch-callout:none]`. A Me hub icon has no coloured tile, and a state is a word in ink, not a dot.
- Screens take colours from the tokens. A new colour starts as a token here and in `DESIGN.md`.
- No gradient on a button, and never a blue-to-violet gradient anywhere. The signature navy is always solid.
- No new font file or font family (see "Do's and Don'ts" in `DESIGN.md`). The one exception is the Inter subset in
  `inter/`: the same Inter glyphs in a smaller file. `tokens.test.ts` lists the exact font faces, so a new face fails it.
- The Thmanyah licence (font.thmanyah.com/licenses) allows the font in a web app only inside the built product. So:
  never convert, subset or rename the files, never put them in `public/`, and get a new version only from
  font.thmanyah.com. `tokens.test.ts` checks the file hashes; a new version needs new hashes there.
- Thmanyah Sans has no tabular figures. The `.tabular` class takes the digits 0 to 9 from `inter/inter-digits-dot.woff2`
  ("Madar Digits" in `tokens.css`), a 10,796 B Inter subset of 12 characters. The middle dot "·" and the square sign "²" (m²) also come from that file
  ("Madar Dot", first in every stack): the Thmanyah dot reads like an Arabic zero, and Thmanyah has no "²", which loaded the
  74 KB Inter Latin file on the first project page (speed audit 2026-10-21, LV-11). `scripts/fonts/subset-inter.ts`
  makes the file with pyftsubset (`pip install fonttools brotli`), and `scripts/fonts/subset-inter.test.ts` pins its bytes,
  characters, axes and tnum. Keep the Inter import in `main.tsx`: it is the Inter Variable fallback face.
- The remote index.html preloads the three Thmanyah files (`earlyLinks` in `vite.config.ts`, `FONT_WEIGHTS` in
  `scripts/check-bundles.ts`). A new or renamed Thmanyah file needs a change of `FONT_WEIGHTS`. The bundle check fails a
  preload whose bytes differ from `fonts/`.
- The font has no 600. The Medium face covers 500 to 600, so `font-semibold` renders Medium and only 700 renders Bold.
  Every `--text-*--font-weight` is a heading and asks 700 (a test checks this).
