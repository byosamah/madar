# Full product audit, 2026-10-03

The owner asked for a deep audit of the whole product: find bugs and gaps, and fix them. This folder is the record.

## How it ran

1. **Audit.** Six auditors: five read the code by area, one walked every screen in a browser. `BRIEF.md` is their brief. Reports: `api.md`, `project.md`, `shell.md`, `dashboard.md`, `personal.md`, `browser.md` (125 findings, 3 high).
2. **Fix wave 1.** Four parallel fixers (brief `FIX-BRIEF.md`; reports `fixed-*.md`) plus the personal-screen fixes (commits 540a094 and 4fd3f62).
3. **Verification.** Each finding re-tested against its repro, a five-lens review of the merged diff with two refuters per claim, and a browser sweep. Result in `verify-summary.txt`: 123 of 132 checks verified, 38 new issues.
4. **Fix wave 2.** `FIX2.md`, reports `fixed2-*.md`. Two reviewers per group, then a repair pass.
5. **Wave 3.** `FIX3.md`, reports `fixed3-*.md`: the two owner decisions (the Balady tick box on the move-back sheet, the warning before turning off a person with live work), small leftovers, and the review of group D.
6. **Final browser check.** 272 screens, no console errors, 23 confirmed problems in `final-findings.md`.
7. **Fix wave 4.** `FIX4.md`, reports `fixed4-*.md`. A targeted re-check found 22 of 23 fixed; the last one (the Arabic phone tab bar at 320 to 371 px) was fixed in commit 302fe9a and measured in a browser.

## Owner decisions taken during the audit (2026-10-03)

- Bring back the optional Balady tick box on the move-back reason sheet (D3).
- Turning off a person who leads projects or has open tasks: warn first, then allow.
- One meeting per browser tab in the prototype; the real build keeps it on the server.
- The Inbox count includes unread comments on the person's task threads.

## Open for later

- Paging the Activity feed past 200 items (real build).
- A "site stage" mark for Area in design when a project names its stages freely.
- The Arabic wording of the new sentences still needs a native speaker's read.
