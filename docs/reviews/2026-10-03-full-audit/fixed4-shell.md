# Wave 4, group "shell": report

Branch w4-shell in /Users/osamakhalil/dev/madar-w4-shell, from audit-fixes 8658de6. Last commit 986a3cf.
Full suite: 156 files, 1571 tests pass (1567 before, plus 4 new). `npx tsc -p tsconfig.json --noEmit` passes. `node scripts/check-rtl.ts` passes.
Two earlier full runs had load timeouts (12, then 1) while other groups ran tests. The one I traced (TaskFeatures.test.tsx, "From a template") passes alone, 16 of 16, and my branch does not touch it.

F-2 | fixed | 4785155 | On a phone a tab can no longer get narrower than its label plus room for the round ends of its highlight, so "لوحة المعلومات" makes its own tab wider and stays whole on one line at full size (src/app/TabPill.tsx: min-w-0 to min-w-fit, px-1 to px-1.5 and px-2.5 from 360 px).
F-3 | fixed | d205d30 | The language item in the person menu now calls the existing close() helper, so the focus goes back to the picture button (src/app/PersonMenu.tsx).
F-4 | fixed | 54a6edb | The search list gets a translated name from the new key search.suggestions ("Suggestions" / "الاقتراحات") in place of the cmdk English default.
F-6 | fixed | 986a3cf | Every person menu row now has text-start, so a label on two lines starts at the same edge as the others, next to its icon.

## Browser checks (Playwright, against `npx vite` on port 5461 in the worktree, stopped after)

- F-2, before: in Arabic the Dashboard label is 74 px of text in a 63 px tab (360) or 69 px tab (390), cut at both ends. In English at 360 the 62 px label touches the tab edges.
- F-2, after, at 360 and 390 px, Arabic and English, on #/dashboard and #/projects: every label is on one line, at least 8 px clear of each tab edge, and no tab leaves the bar. The Arabic Dashboard tab is 94 px; the other tabs are 51 to 63 px. The bar height stays 62 px. At 320 px (a safety width) every label is whole and 6 px clear of its tab edge, and the bar does not overflow. At 640 and 1440 px the desktop bar is unchanged (16 px padding).
- F-3: at 1440 and 390 px, with the real page-turn motion, the focus is on the picture button after Arabic and after English.
- F-4: in Arabic the list is "الاقتراحات" with an empty field and with a query; in English it is still "Suggestions".
- F-6: at 360 and 390 px every row has text-align start. With the label forced onto two lines, both lines start at the same x as the other rows (x 109 at 390).

## Questions for the owner

1. The phone tabs are no longer all exactly equal. A tab with a long label is wider: in Arabic the Dashboard tab is about 94 px and the others about 51 to 63 px; in English Dashboard is 82 px and the others 55 to 67 px. The word stays the same. Is this acceptable, or do you prefer the shorter Arabic word "اللوحة" from the build record, with equal tabs? I did not change the word, as the wave rules say.
2. The Arabic name for the search list is "الاقتراحات" (screen readers only). Keep it, or use a different word?

## Screens that changed

- Every screen, phone width (360 and 390 px), bottom tab bar, Arabic and English: look at #/dashboard (Dashboard is the current tab, check the whole label inside the dark pill) and #/projects (Dashboard not current). Reference shots: scratchpad/w4shell/after-tabbar-ar-360-dashboard.png, after-tabbar-ar-390-dashboard.png, after-tabbar-en-360-dashboard.png, before-tabbar-ar-390-dashboard.png.
- Person menu (tap the picture), phone width, English: every row label starts next to its icon. Reference: scratchpad/w4shell/after-person-menu-390.png and after-person-menu-wrap.png.
- No visible change: F-3 (focus after the language switch) and F-4 (screen-reader name of the list on #/search in Arabic).

## Repair

Last commit e1d47dc. Full suite: 156 files, 1572 tests pass (one new test). `npx tsc -p tsconfig.json --noEmit` passes. `node scripts/check-rtl.ts` passes.

F-2 narrow phones | fixed | e1d47dc | The reviewer was right: below about 310 px the five whole labels need about 275 px and the bar gives 242 (280 px) or 262 (300 px), so the Inbox tab and its badge ran off the screen in both languages. Now, below 320 px only, the label takes 11 px (11.9 px in Arabic), the tab padding is 4 px, the bar has no gaps between tabs, and each tab starts from its own width and can shrink (src/app/TabPill.tsx). From 320 px up the classes do not apply, so nothing changes there.

Browser check (Playwright against `npx vite` on port 5547 in the worktree, stopped after), #/dashboard and #/inbox, English and Arabic:

- Before: at 280 and 300 px the bar overflows (scrollWidth 278 or 281 against 254 or 274). The English Inbox tab spans x 248 to 294 on a 280 px screen; the Arabic one spans x -11 to 28.
- After, 280 and 300 px: the bar does not overflow (scrollWidth equals clientWidth). Every tab, label and Inbox badge is inside the bar, and every label is whole on one line, 5.3 px (280) or 7.3 px (300) from its tab edge. The bar height stays 62 px. A zoomed shot of the current Dashboard tab at 280 px shows the whole label inside the dark highlight in both languages (scratchpad/w4shell/zoom-repair-after-en-280-dashboard.png and zoom-repair-after-ar-280-dashboard.png). In English at 280 px the bottom of the "D" sits about 1 px inside the round end of the highlight.
- After, 320, 360 and 390 px: every tab and label measures the same as before the repair, in both languages.
- Extra, 240 and 260 px (a phone at 150% zoom): the bar still does not overflow and every label stays on one line. The room is tight there: at 260 px the current Dashboard label touches the round ends of its highlight, and at 240 px the labels touch their tab edges.
- The Inbox unread count also uses the caption size, so below 320 px its digit is 11 px. The badge circle stays 20 px.

Screens that changed: the bottom tab bar below 320 px only (Arabic and English). Shots: scratchpad/w4shell/repair-after-*-280-*.png and repair-after-*-300-*.png.
