# Wave 3, track "warn" (branch w3-warn, worktree ~/dev/madar-w3-warn)

Owner decision 2026-10-03 on API-7: Madar warns before it turns off a person with live work, then allows it. It never refuses.

API-7 warn sheet | done | 8ade7b8 | In Admin, People, Deactivate on a person who leads an active or paused project, or holds an open task as lead or helper, opens a sheet first: the name in the title, the calm sentence, the projects they lead (each a link to the project's Team tab), and the open tasks (count, the first 8 titles with their project, each a link to the task, then "N more tasks"); "Deactivate anyway" sits on the start side and Cancel takes the focus.
API-7 nothing open | done | 8ade7b8 | A person with no live work turns off at once with the usual Undo toast, as before; the old Admin test now uses Noura Al-Shammari, because Omar Haddad leads 2 projects in the sample office.
API-7 failed check | done | 8ade7b8 | When the read of the person's work fails, nobody turns off; the error toast offers Retry, and Retry asks again.
API-7 words | done | 8ade7b8 | English and Arabic words in the `admin` section next to `deactivated`, with all six Arabic plural forms for the two counts and a `_female` form for the sentence and the projects heading.
API-7 Management | done | e8b8e21 | A test proves that Management, who may also deactivate, gets the same warning.
API-7 server call | not-needed | none | The existing calls `projects.list` (status all) and `tasks.list` (ownerId, open only, all projects) give the data, so the contract did not change.

Tests: 7 new tests in `src/features/settings/admin/DeactivateWarning.test.tsx` (leader with tasks plus Cancel and focus, tasks only plus the first 8 plus Deactivate anyway plus Undo, leader of a paused project only, nothing live turns off at once, failed check plus Retry, Management, Arabic feminine and plural forms). Full suite: 1496 tests, 1494 passed in the full run; the 2 failures were in `src/features/project/tasks/TaskFeatures.test.tsx` (task templates, outside this track) and that file passed 16 of 16 alone, so machine load. `tsc` and `check-rtl` pass.

## Questions for the owner

1. The brief named the button "Turn off anyway". I wrote "Deactivate anyway" (Arabic "إيقاف الحساب رغم ذلك"), because the menu item says "Deactivate" and the toast says "deactivated": one word for one meaning. Keep it?
2. Only live work counts: active and paused projects, and open tasks on them. A person who led only completed or archived projects turns off at once, with no sheet. Keep it, or warn about finished projects too?

## Screens that changed

- `/admin`, People, "..." on Omar Haddad, Deactivate: the warning sheet with 2 projects (KH-26-003, KH-26-007) and 5 open tasks. Check the footer: "Deactivate anyway" on the start side, Cancel on the end side with the focus ring.
- `/admin`, People, "..." on Sara Al-Qahtani, Deactivate: tasks only, 8 titles with their project, then "2 more tasks".
- The same as Sara in Arabic (Hala's language set to Arabic): the feminine sentence, "10 مهام مفتوحة", "مهمتان أخريان", the RTL footer.
- The same sheet at phone width (bottom sheet).
- `/admin`, People, "..." on Noura Al-Shammari, Deactivate: no sheet, the person turns off at once with the Undo toast.

## Repair (after review)

Management dead end | Fixed | d0aca30 | Only an Admin or the project's own leader may change a leader (permissions.ts and projects.ts:197), so Management found no "Make leader" on the Team tab. When the viewer is not an Admin, the sheet now says "An Admin changes the leader." (Arabic "مدير النظام هو من يغيّر القائد.") under "Projects they lead". The links stay. Tests: Management sees the line, the Admin does not.
"Deactivate anyway" vs "Turn off anyway" | Not a bug | none | The word is a deliberate choice for one word for one meaning ("Deactivate" menu item, "X deactivated." toast), and this report already asks the owner about it in question 1. If the owner wants "Turn off anyway", change admin.deactivateAnyway in en.json and ar.json and the 3 tests that press the button.
Reviews sentence for a non-leader | Fixed | ad7c8c0 | Only a leader reviews (notify.ts reviewersOf). A leader still reads the owner's full sentence. A person with open tasks only, such as Sara Al-Qahtani, now reads "Nobody can give them new work." (Arabic with the feminine form "لا يمكن لأحد أن يسند إليها عملًا جديدًا."). Test: Sara's English sheet shows the short sentence and no word about reviews.
Test name "a done task does not count" | Fixed | db0a40f | Noura Al-Shammari had no task in the sample office. The test now makes her a helper on tsk_028, a done task on the active project prj_003. With done tasks counted on purpose, the test failed, so it now proves the done filter and the helper path.

Checks: full suite 152 files, 1496 tests, all passed. `tsc` and `check-rtl` pass.

### Question for the owner (repair)

3. The owner's sentence "Their reviews go to the Admins, and nobody can give them new work." now shows only for a project leader. A person with open tasks only reads "Nobody can give them new work." Keep it?

### Screens that changed (repair)

- `/admin` as Turki Al-Otaibi (Management), People, "..." on Omar Haddad, Deactivate: the line "An Admin changes the leader." under "Projects they lead".
- `/admin` as Hala Nasser (Admin), the same sheet: no such line.
- `/admin`, People, "..." on Sara Al-Qahtani, Deactivate: the sentence under the title now reads "Nobody can give them new work." In Arabic: "لا يمكن لأحد أن يسند إليها عملًا جديدًا."
