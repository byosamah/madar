# Design system: tokens

`tokens.css` is the source of every colour, size, radius and shadow. `DESIGN.md` at the repo root is the readable copy of
the same system for people and for design tools (Google DESIGN.md format, alpha, spec 0.4.0). The rules of use are in
`src/CLAUDE.md` and in the prose of `DESIGN.md`.

## Files
- `tokens.css`: the CSS variables, light and dark. `tokens.test.ts` checks the contrast of the text pairs.
- `motion.ts`: the motion times and curves. Motion respects "reduce motion" (`MotionConfig reducedMotion="user"`).

## When you change a token
1. Change `tokens.css`. Run `tokens.test.ts`.
2. Change the same value in the YAML front matter of `DESIGN.md`. A colour with alpha goes in as its composited hex value
   (the linter ignores alpha), and the prose names the rgba form.
3. Run `npx @google/design.md lint DESIGN.md`. It must show 0 errors and 0 warnings.
4. Take screenshots of the changed screens (EN and AR, light and dark, 390 px).
- A new component style also needs its token group in `DESIGN.md` under `components`.

## Rules
- Screens take colours from the tokens. A new colour starts as a token here and in `DESIGN.md`.
- No gradient on a button, and never a blue-to-violet gradient anywhere. The signature navy is always solid.
- No new font file or font family (see "Do's and Don'ts" in `DESIGN.md`).
