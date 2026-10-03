# Wave 3: two owner decisions, small leftovers, and the review of group D

The brief `audit/FIX-BRIEF.md` applies in full (TDD, small commits, the commit trailer, no Co-Authored-By, no em-dash, STE writing, English + Arabic with plural and `_female` forms, the ADHD rule), with your worktree below in place of the old one. Each worktree is a fresh branch from the merged branch `audit-fixes` (commit f97eddd: all audit fixes, waves 1 and 2, 1489 tests pass).

## Track "balady" (worktree ../madar-w3-balady, branch w3-balady): owner decision 2026-10-03 on API-14

The owner approved on 1 Oct (decision D3, see `docs/reviews/2026-10-01-colleague-comments.md`) "an optional tick box logs it in the Tracker as a Balady update" for a move of the project back to an earlier stage. The tick box disappeared on 2 Oct when the stage tag became automatic (commit 0f2b7ec removed `projects.setStage` and its `logInTracker` input; read its diff with `git show 0f2b7ec` for the old wording and behavior). The owner said on 3 Oct: bring it back.

Build:
- In the sheet that asks why the project moves back (src/features/project/tasks/StageBack.tsx and its callers), add one optional tick box under the reason, unticked by default: English "Also log this in the Tracker as a Balady update", Arabic in the app's Tracker words (check the Tracker type name for Balady in ar.json and use it).
- Every call that passes a stage-back reason (`tasks.create`, `tasks.update`, `tasks.move`, `tasks.newVersion`, and any other that `watchStage` asks a reason for) takes an optional `logInTracker: boolean`. When true and the project really moves back, the API writes one Tracker entry of the Balady type with the reason as its text, the right side for the Balady type (third party), today's date, in the same story, so one Undo takes back the move and the entry together. When false or absent, nothing changes.
- Tests: the box is unticked by default; ticked, one Balady entry with the reason appears in the Tracker; Undo of the story removes it; the API refuses nothing new; a person without the Tracker posting right cannot log (check what rule the Tracker uses for logging and follow it: if the person may move the stage back but may not log, the box does not show for them).
- Add a short line to `docs/reviews/2026-10-01-colleague-comments.md` under D3: "2026-10-03: the owner confirmed the tick box after the automatic stage tag; built again."

## Track "warn" (worktree ../madar-w3-warn, branch w3-warn): owner decision 2026-10-03 on API-7

When an Admin (or Management, whoever may deactivate today) turns off a person who still leads one or more projects or has open tasks (as lead or helper), Madar warns first and then allows it. It never refuses.

Build:
- In Admin, People (src/features/settings/admin/PeopleSection.tsx and the deactivate action), a press on Deactivate for such a person opens a sheet first: the person's name, the projects they lead (each a link to the project's Team tab or header where the leader changes), and their open tasks (count and up to the first 8 titles with their project, each a link to the task). Two buttons: "Turn off anyway" (destructive, on the start side, away from the pointer, as the meeting restart confirm does) and "Cancel" (takes the focus). Explain in one calm sentence: "Their reviews go to the Admins, and nobody can give them new work."
- A person with no led project and no open task: keep today's flow (turn off at once, with the Undo toast).
- Data: prefer existing calls (`projects.list` with `status: 'all'` filtered by leader, `tasks.list` with `ownerId`, which already counts helper tasks). If a server call is cleaner, add a read-only one with tests and the same permission as deactivate.
- English and Arabic words, Arabic plural forms for the counts, the person's gender where a verb follows the name.
- Tests: the sheet shows for a leader and for a person with an open task; Cancel keeps the person active; "Turn off anyway" turns them off with the usual Undo; a person with nothing open turns off at once.

## Track "small" (worktree ../madar-w3-small, branch w3-small): leftovers the wave-2 fixers raised

- S-1: the Tracker entry sheet still costs an extra Back (the task panel and payment sheet no longer do). Use the new `usePanelLink` hook (src/features/project/panelLink.ts) for the entry sheet too.
- S-2: on a phone, the stage-back reason sheet puts the focus in its text box (autoFocus in src/features/project/tasks/StageBack.tsx), so the keyboard opens over the sheet; every other sheet focuses its title on a phone. Follow the Sheet rule (src/components/Sheet.tsx): on a phone the title takes the focus, on a computer the text box. NOTE: track "balady" also edits StageBack.tsx; keep your change to the autoFocus line only, so the merge stays clean.
- S-3: the animated arrow-right icon (src/components/icons/animated/arrow-right.tsx, check the exact file) has the same pattern as the sliders icon fixed in V-31 (an animated attribute with no start state). Fix it the same way, and check every other icon under src/components/icons/animated/ for the same pattern; fix each one you find.
- S-4: the key `inbox.allRead` ("All caught up.") is now used nowhere. Delete it from en.json and ar.json if no code uses it (check dynamic keys too).

## Track "drepair" (worktree ../madar-w3-drepair, branch w3-drepair): repair for the group D review

Group D of wave 2 (Dashboard, meeting, Home, Projects list; items V-6, V-7, V-12, V-18, V-32, V-37b, V-4c, see `audit/FIX2.md` and `audit/fixed2-D.md`) merged without a review. Two reviewers review its diff (`git diff 6d2c358...w2-dash`, the group's own changes) first; this track then repairs what they proved, in this worktree.
