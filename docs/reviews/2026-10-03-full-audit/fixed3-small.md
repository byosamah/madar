# Wave 3, track "small": report

Branch `w3-small` in `/Users/osamakhalil/dev/madar-w3-small`, from `audit-fixes` (f97eddd). Last commit: fe5ffc9.

S-1 | done | c921041 | The Tracker entry sheet now opens and closes through `usePanelLink` (new `ENTRY_PANEL` in panelLink.ts), so a closed entry costs no extra Back, and Back from an open entry closes it.
S-2 | done | cd88540, fe5ffc9 | The stage-back reason box lost its `autoFocus` (one line in StageBack.tsx), so the Sheet rule applies: the title takes the focus on a phone, the reason box on a computer; fe5ffc9 only gives the new test a 3-second first-render wait.
S-3 | done | 932f951 | A new test plays all 53 animated icons with a re-render at start and stop; 10 icons wrote "undefined" (arrow-right, circle-dashed, circle, delete, home, languages, sparkles, sun, waypoints, x) and now name their start state, and link gets one too because it animates pathLength with no start state.
S-4 | done | 2254631 | No code reads `inbox.allRead` (the only built inbox key is `inbox.trigger.*`), so the key is gone from en.json and ar.json.

## Checks

- Full suite: 1546 tests (1489 before, plus 57 new). Two full runs at load average 100 to 144 had 5 and 7 first-render timeouts ("Unable to find") in ProjectAudit, TaskFeatures, Agenda, SearchScreen and the new StageBackFocus test. Each of those files passes alone.
- `npx tsc -p tsconfig.json --noEmit`: passes.
- `node scripts/check-rtl.ts`: "RTL check passed."
- The S-3 test catches the old V-31 sliders icon: with the pre-V-31 file put back, it fails; with the current file, it passes.

## Questions for the owner

None.

## Proposed, not done (adjacent)

- The link icon (Overview, project links) names its rest state "initial", but its stop asks for "normal", which does not exist. So a stop in the middle of the animation does nothing; the animation still ends at rest. A rename of the state to "normal" fixes it. I did not change it, because no finding asks for it.

## Screens that changed

- `/projects/prj_001?tab=tracker` (S-1): open an entry in History, press Close, then press the browser Back once. Madar leaves the project. Before, the first Back stayed on the Tracker tab.
- `/projects/prj_001?tab=tasks` at phone width (S-2): "From a template in Design Development", then "Material board". The sheet "This moves the project back to Design Development. Why?" opens with the focus on its title, so no keyboard opens. On a computer the Reason box still has the focus.
- Animated icons (S-3): no visible change at rest. Hover each one and check that it plays and the console shows no errors: the arrow on the Home "next" card, the Home icon in the navigation, the tick boxes on task rows (Tasks tab, task panel, Focus mode), the delete icon on the Schedule tab, the language and theme icons in the person menu, the Tracker type marks (waypoints), the X on sheets, the sparkles on an avatar, and the project links on the Overview.
- S-4: no screen change.
