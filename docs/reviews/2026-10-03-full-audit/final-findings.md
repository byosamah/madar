# Final browser check: confirmed findings

### F-1 [MEDIUM] Edit post and Edit comment drop keyboard focus onto the page body, both when the edit box opens and when it is cancelled
- Steps: Fresh context, 1440x900 and 390x844, English. Open #/projects/prj_003?tab=activity. Focus 'Actions for this post' on the Madar Assistant post, press Enter, choose 'Edit post'. document.activeElement is BODY (the edit box shows but has no focus). Press Cancel: activeElement is BODY again. Same for a comment: open task 'MEP coordination' from the Overview tab, Conversation, post a comment, 'Actions for this comment' > Edit gives BODY, then Cancel gives BODY. Cause: src/features/project/overview/FeedEntry.tsx:55 hides the menu button while editing (the button that held focus unmounts) and the MentionField at :80 does not take focus; src/features/comments/CommentThread.tsx:115 has the same pattern.
- Expected: Edit post / Edit (comment) moves focus into the edit box. Cancel and Save return focus to that item's 'Actions for this post' / 'Actions for this comment' button. Focus never lands on the page body, the same rule every sheet already follows.
- Screenshot: /private/tmp/claude-501/-Users-osamakhalil/5721f5d8-5441-480d-b8e1-5ea30aba78f8/scratchpad/audit/final/shots/sweep/edit-post-desk-2.png (also edit-post-phone-2.png, edit-comment-desk.png, focus/en-phone--project-activity--noDialog--Edit_post.png)
- Confirmer: Nothing blocked on you. The problem is real. I reproduced it in a fresh Playwright context (English) at 1440x900 and 390x844. The browser showed no console errors or warnings on any page.

What I saw (script: /private/tmp/claude-501/-Users-osamakhalil/5721f5d8-5441-480d-b8e1-5ea30aba78f8/scratchpad/audit/final/repro-edit-focus.mjs, log: repro-edit-focus.log in the same folder):
1. Post, both widths. I opened #/projects/prj_003?tab=activity and focused "Actions for this post" on the first Madar Assistant post. I pressed Enter, and the focus went to "Edit post". I pressed Enter again. The edit box opened, but document.activeElement was BODY. Cancel by keyboard gave BODY. Save by keyboard gave BODY too (the checker did not test Save).
2. Comment, desktop. I opened #/projects/prj_003, then "MEP coordination", then the Conversation tab. I sent a comment, then chose "Actions for this comment" and Edit. The result was BODY. Cancel gave BODY.
3. Comment, phone. Here the task sheet is a modal, so focus goes to the sheet container (DIV "radix-..."), not BODY. Cancel gives the same. This is a small correction to the checker's report. The item still loses focus.

The user cost is worse than "no focus":
- On desktop, one Tab after Edit on a comment lands in the "Add a comment" box below, not in the edit box. The menu button sat below the edit form, so the browser continues from that point. A keyboard user can type the correction into a new comment and send a duplicate. This breaks the own

### F-2 [MEDIUM] Arabic phone tab bar: the Dashboard label is wider than its tab and is cut to 'حة المعلوما' when Dashboard is the current tab
- Steps: 390x844, Arabic, light or dark. Open #/dashboard. In the bottom tab bar the label 'لوحة المعلومات' measures 81 px inside a 69 px tab (label spans x 84 to 165, tab spans x 90 to 159). On the current tab the white label runs past the dark pill and both ends vanish on the white bar, so it reads 'حة المعلوما'. In English the same label is 64 px in the 69 px tab and its first and last letters sit on the curved pill edges (see the crop).
- Expected: Every tab label fits inside its tab and its highlight pill in both languages: a shorter Arabic label (for example 'اللوحة'), a smaller font on the tab bar, or wider tabs.
- Screenshot: /private/tmp/claude-501/-Users-osamakhalil/5721f5d8-5441-480d-b8e1-5ea30aba78f8/scratchpad/audit/final/shots/sweep/tabbar-ar-light-dashboard.png (also ar-light-phone--dash-schedule.png, en-phone--tabbar-dashboard-label-crop.png)
- Confirmer: Reproduced in a fresh Playwright context (390x844, isMobile, language switched to Arabic with the Settings control, then #/dashboard). The measurements match the report exactly. The Dashboard tab spans x 90 to 159 (69 px). Its label 'لوحة المعلومات' spans x 84 to 165 (81 px), and the link scrollWidth is 75 against clientWidth 69. In light mode the label is white (--on-sig) and the pill is dark navy, so the 6 px past each pill edge are white on the white bar, and the label reads 'حة المعلوما'. In dark mode the label ends are dark ink on the dark bar and almost vanish. At 360 px the fault is worse: the label is still 81 px but the tab is 63 px, so 9 px are lost on each side. The cause in the code: src/app/TabPill.tsx gives each phone tab 'flex-1 min-w-0 px-1' and the label 'whitespace-nowrap' at text-caption, so the label never wraps or shrinks. src/design/tokens.css sets --boost: 1.08 for :root[lang="ar"], so the caption is 12.96 px in Arabic (12 px in English). src/i18n/ar.json sets nav.dashboard to 'لوحة المعلومات'. No 'owner, date' comment covers this. The only note is in docs/superpowers/reports/2026-09-30-madar-build-record.md line 194: 'nav.dashboardTab: اللوحة ... use the full term if it fits the phone tab bar'. The full term does not fit, so the build did not follow that condition. This breaks the owner rule on clear state words: the current tab is the 'you are here' signal, and its name is cut into a non-word. English is a near miss (64 px label in a 69 px tab, the fi

### F-3 [LOW] Language switch in the person menu closes the menu and leaves keyboard focus on the page body
- Steps: 1440x900 and 390x844, English. Open #/projects/prj_003. Focus the 'Hala Nasser' picture button, press Enter, Tab to 'العربية', press Enter. The page turns to Arabic, the menu closes, and document.activeElement is BODY, so the next Tab starts from the top of the page. Every other item in that menu returns focus to the picture. Cause: src/app/PersonMenu.tsx:57 calls setOpen(false) instead of the close() helper (lines 32 to 35) that focuses the button.
- Expected: After the language turns, focus is back on the person picture button, as after Escape, Admin, Settings and the feedback item.
- Screenshot: /private/tmp/claude-501/-Users-osamakhalil/5721f5d8-5441-480d-b8e1-5ea30aba78f8/scratchpad/audit/final/shots/sweep/person-menu-desk-after-arabic.png
- Confirmer: Reproduced in a fresh Playwright context at 1440x900, at 390x844, and at 1440x900 with reduced motion. Steps: open #/projects/prj_003 in English. Focus the 'Hala Nasser' picture button and press Enter. Tab to 'العربية' and press Enter. Result: the page turns to Arabic (lang=ar, dir=rtl), the menu closes, and document.activeElement is BODY. The next Tab lands on the first nav link 'الرئيسية' (Home) at the top of the page. The reverse direction does the same thing: the 'English' item also leaves focus on BODY. For comparison, Escape in the same menu returns focus to the picture button. Code cause: /Users/osamakhalil/dev/madar-fixes/src/app/PersonMenu.tsx line 57 calls setOpen(false) and then switchLanguage(nextLanguage). The close() helper (lines 32 to 35) also focuses the picture button, and the Admin, Settings and feedback items call close(). /Users/osamakhalil/dev/madar-fixes/src/components/Popover.tsx does not return focus when it unmounts, and src/app/languageTurn.ts does not move focus either. No 'owner, date' comment makes this intended, and the same kind of focus loss was already fixed in this menu (audit comments SHL-19 and SHL-20). This breaks the owner's rule of one obvious next step and consistent behavior: a keyboard user loses their place and has to Tab again from the top of the page. Severity LOW. Expected: after the language turns, focus returns to the person picture button, the same as after Escape. Fix direction: call close() instead of setOpen(false) on line 

### F-4 [LOW] Search suggestion list has the English screen-reader label 'Suggestions' in Arabic
- Steps: Any size, Arabic. Open #/search. The listbox under the search field has aria-label='Suggestions', so a screen reader announces English on an Arabic screen. Cause: src/features/search/SearchScreen.tsx:120 renders <Command.List> without a label prop, and the cmdk library falls back to its built-in English 'Suggestions'. This was the only English UI string on any Arabic screen: every other Latin text was sample data.
- Expected: Pass a translated label to Command.List (for example the existing search label or a new 'search.suggestions' key), so the list is announced in Arabic.
- Screenshot: /private/tmp/claude-501/-Users-osamakhalil/5721f5d8-5441-480d-b8e1-5ea30aba78f8/scratchpad/audit/final/shots/sweep/ar-light-desk--search.png
- Confirmer: Reproduced in a fresh Playwright context on the final build (http://127.0.0.1:5320/). Steps: open #/settings, choose العربية (the page gets lang="ar" dir="rtl"), open #/search. The accessibility tree reads: combobox "البحث", then listbox "Suggestions", then group "الأوامر" with Arabic options. The list keeps aria-label="Suggestions" with an empty field and with a query typed (the projects group also shows). On screen nothing is English (screenshot /private/tmp/claude-501/-Users-osamakhalil/5721f5d8-5441-480d-b8e1-5ea30aba78f8/scratchpad/audit/final/shots/verify-search-label/ar-search-empty.png, plus ar-search-with-query.png in the same folder). So only a screen-reader user hears the English word. Cause confirmed in code: /Users/osamakhalil/dev/madar-fixes/src/features/search/SearchScreen.tsx line 120 renders <Command.List className=...> with no label prop. The cmdk library (node_modules/cmdk/dist/index.mjs) sets the List default to label="Suggestions", so the app's i18n never touches it. The Command root gets t('search.label') and the input gets a translated placeholder, but the list does not. No "owner, <date>" comment or any other note allows this, and the project clearly intends Arabic-only text: src/i18n/arabic.test.ts fails on any Latin text in ar.json except real names. The library default goes around that test. Severity stays LOW: it is one mixed-language announcement for screen-reader users, not lost work or a wrong state. It does break the owner's rule of clear words

### F-5 [LOW] Meeting view on a phone still offers Timeline, which squeezes the bars into a sliver about 30 px wide
- Steps: 390x844. Open #/dashboard/meeting and pick 'Timeline' (or follow ?mode=timeline). The name column takes nearly all of the width. The stage bars, deadlines and the 'Today' chip sit in a cut-off strip at the edge, so nothing on the timeline can be read. The code knows this (MeetingView.tsx:203 to 205 opens Projects on a phone) but still offers the choice. In Arabic the earlier-period arrow also wraps onto the zoom row, away from 'اليوم' and the later-period arrow.
- Expected: On a phone, hide the Timeline choice (Projects only), or let the timeline scroll sideways with a readable width. Keep the earlier, Today and later controls on one row.
- Screenshot: /private/tmp/claude-501/-Users-osamakhalil/5721f5d8-5441-480d-b8e1-5ea30aba78f8/scratchpad/audit/final/shots/sweep/en-light-phone--meeting-timeline.png (also ar-light-phone--meeting-timeline.png)
- Confirmer: Reproduced in a fresh Playwright context at 390x844 (isMobile, touch) on http://127.0.0.1:5320/.

Steps: open #/dashboard/meeting. It opens on Projects, but the View switch still shows 'Timeline'. Press 'Timeline'. The link changes to ?mode=timeline. A fresh load of #/dashboard/meeting?mode=timeline gives the same screen.

What I measured: the panel is 342 px wide. The name column is 276 px wide and the timeline column is 0 px wide in English (x=345) and in Arabic (x=45). The checker said about 30 px, but the real width is 0 px. The stage bars only show as 24 px stubs (the bar padding) that hang past the column edge. The month labels overflow and are cut: 'Sept 2026' starts at x=345 and ends at 433 on a 390 px screen. In Arabic, 'سبتمبر 2026' starts at x=-48. The 'Today' chip is cut at the panel edge. The panel has overflow-x: hidden, so a person cannot swipe sideways to see the bars.

Arabic header: the earlier-period button ('شهر أبكر', the '>' arrow) wraps onto the end of the Zoom row, at the far left. 'اليوم' and the later-period button sit on the next row, at the right. So the two arrows sit on different rows, and they point away from the Today button.

Cause in the code (/Users/osamakhalil/dev/madar-fixes/src/features/dashboard/MeetingView.tsx):
- Line 54: COLUMNS = 'grid-cols-[minmax(14rem,24rem)_minmax(0,1fr)] gap-x-6'. The fixed name track grows toward 24rem before the 1fr track gets any space, so below about 24rem + gap + padding the bars get nothing.
- Lines 203 to

### F-6 [LOW] Phone person menu: 'Request a feature or report a bug' wraps to two centred lines, unlike the start-aligned items above it
- Steps: 390x844, English. Open any screen, tap the 'HN' picture. The last menu item wraps onto two lines and its text is centred, while Arabic, Dark mode, Admin and Settings are start-aligned.
- Expected: All menu rows are start-aligned (add text-start to the row class in src/app/PersonMenu.tsx), or the label is shortened so it fits on one line.
- Screenshot: /private/tmp/claude-501/-Users-osamakhalil/5721f5d8-5441-480d-b8e1-5ea30aba78f8/scratchpad/audit/final/shots/sweep/person-menu-phone.png
- Confirmer: Reproduced in a fresh Playwright context at 390x844, English, on #/projects. I tapped the 'Hala Nasser' (HN) picture. The last row, 'Request a feature or report a bug', breaks onto two lines (height 49px, the other rows are 44px). Both lines are centred: line 1 runs from x 123 to 351, line 2 ('bug') from x 222 to 252. The other labels start at x 109, next to their icons. The text therefore moves away from its icon and breaks the left edge that the eye follows down the list. At 1280x800 the label fits on one line, so the defect shows at phone width only. In Arabic at 390 the label 'اطلب ميزة أو أبلغ عن خلل' fits on one line and looks correct.

Cause, in /Users/osamakhalil/dev/madar-fixes/src/app/PersonMenu.tsx line 40: the shared row class 'pressable flex min-h-11 items-center gap-3 rounded-xl px-2 text-body text-ink hover:bg-fill' has no text-start. The browser gives each button text-align: center and each link inherits start. Computed styles prove it: the Arabic and Dark mode buttons are 'center', the Admin and Settings links are 'start', and the feedback button is 'center'. The one-line buttons hide the difference. The two-line feedback label shows it. The phone text size (--text-body = size-body x boost) is larger than the desktop size, so the label needs more than the 256px of text room in the 320px popover.

This is not intended. The owner note (owner, 2026-10-01, in src/features/feedback/FeedbackSheet.tsx line 22) covers the feature and its label, not the centring. Ever

### F-7 [MEDIUM] Arabic helper line hides the lead's name at phone width
- Steps: Fresh context. As Hala (Admin) open #/projects/prj_001?tab=tasks&task=tsk_007 (Stair details) and pick Sara Al-Qahtani in Add a helper. Preview as Sara, set language to العربية, viewport 390 x 844. Open #/work, then #/projects/prj_001?tab=tasks. The second line of the Stair details row reads 'مساعدة · المسؤول الرئيسي: aleh...' on Work and 'مساعدة · المسؤول الرئيسي: eh...' on the Tasks tab. Measured: the text needs 236 px, the box is 198 px (Work) and 182 px (Tasks), and the ellipsis cuts the start of the Latin name, so only the last letters of 'Yousef Saleh' show. English fits (170 px of 170 px).
- Expected: The line exists to name the lead, so the name must stay readable in Arabic on a phone: let the line wrap, put the lead name on its own line, or cut the name at its end (for example 'Yousef Sa...'), never at its start.
- Screenshot: /private/tmp/claude-501/-Users-osamakhalil/5721f5d8-5441-480d-b8e1-5ea30aba78f8/scratchpad/audit/final/shots/changed/helper-04-row-ar-390-tasks.png (also helper-04-row-ar-390-work.png and helper-03-work-ar-390.png in the same folder)
- Confirmer: I reproduced the problem in a fresh Playwright context on the final build at http://127.0.0.1:5320/. Steps: as Hala Nasser (Admin), I opened #/projects/prj_001?tab=tasks&task=tsk_007 (Stair details) and picked Sara Al-Qahtani in "Add a helper". Then I chose Sara in "Preview as", set the language to العربية and set the viewport to 390 x 844.

Measured result: the helper line text is "مساعدة · المسؤول الرئيسي: Yousef Saleh".
- On #/work, the text needs 236 px and the box is 198 px. The screen shows "مساعدة · المسؤول الرئيسي: aleh...".
- On #/projects/prj_001?tab=tasks, the box is 182 px. The screen shows "مساعدة · المسؤول الرئيسي: eh...".
- In English at the same width, the text fits (170 px of 170 px).
- I saw no console errors or warnings.

Screenshots are in /private/tmp/claude-501/-Users-osamakhalil/5721f5d8-5441-480d-b8e1-5ea30aba78f8/scratchpad/audit/final/shots/verify-helper-line/: 03-row-work-ar-390.png, 05-row-tasks-ar-390.png, 02-work-ar-390.png and 04-tasks-ar-390.png.

Cause: the line is drawn at src/features/project/tasks/TaskRowItem.tsx:113 as one span with dir="auto" and the Tailwind class "truncate" (no wrap, ellipsis). The Arabic label makes the span right-to-left, so the cut happens at the visual left edge. The Latin name sits at that edge, so the cut removes the start of the name ("Yousef Sa") and leaves only the last letters.

The comment above it (line 43, "audit 2026-10-03, V-35") says the line exists to tell a helper who leads the task. It is an audit fix

### F-8 [LOW] Send back with a note opens the panel with Approve as the main button and the note box not focused
- Steps: Preview as Faisal. #/projects/prj_001?tab=tasks, Filter, Task view: Board, Escape. Press 'Move Toilet details' (In review card), choose 'Send back with a note'. The task panel opens on its Review block, but the focus is on the panel itself (div role=dialog), the dark primary button is 'Approve', and the 'What needs to change?' box is empty and not focused.
- Expected: The person chose Send back, so the one next step is to write the note: put the focus in 'What needs to change?' and do not show Approve as the strongest button in that moment.
- Screenshot: /private/tmp/claude-501/-Users-osamakhalil/5721f5d8-5441-480d-b8e1-5ea30aba78f8/scratchpad/audit/final/shots/changed/board-03-send-back-opens-panel.png
- Confirmer: Reproduced in a fresh Playwright context at 1440x900. Steps: Settings, Preview as "Faisal Al-Harbi · Leader". Open #/projects/prj_001?tab=tasks, then Filter, Task view Board, Escape. Press "Move Toilet details" on the In review card. The menu shows "Done" and "Send back with a note". Choose "Send back with a note". Result: the URL becomes ?tab=tasks&task=tsk_010. document.activeElement is the panel itself (DIV role=dialog). The "What needs to change?" box (#task-note) is empty and does not have the focus. In the Review block, "Approve" is the dark primary button (rgb(31,42,85) fill, white text, shadow). "Send back" is a grey fill button and is disabled. A plain press on the card title gives exactly the same panel, URL and focus. So the menu choice changes nothing. Screenshots: /private/tmp/claude-501/-Users-osamakhalil/5721f5d8-5441-480d-b8e1-5ea30aba78f8/scratchpad/audit/final/shots/verify-sendback/03-send-back-opens-panel.png (the panel after Send back) and .../verify-sendback/04-plain-card-open-same-panel.png (the same panel after a plain card press). Also 01-board-as-faisal.png and 02-move-menu-open.png. Cause in the code: /Users/osamakhalil/dev/madar-fixes/src/features/project/tasks/TaskBoard.tsx line 106 gives the menu item onSelect: onOpen, the same handler as the card press. No intent goes to the panel. /Users/osamakhalil/dev/madar-fixes/src/features/project/tasks/TaskSheet.tsx lines 288-293 always draw Approve as variant="primary" first, then the note box, then Send 

### F-9 [LOW] Dropping a review card on To do or In progress snaps back with no visible reason
- Steps: Preview as Faisal, Board view of #/projects/prj_001?tab=tasks. Drag 'Toilet details' (In review) by its drag handle over the In progress column and release. While dragging, no column looks refused. After the drop the card goes back to In review. The only words are in the screen-reader live region: 'The move of Toilet details is cancelled.' (Arabic 'أُلغي نقل Toilet details.'). The refusal 'Use Send back and write a note for the lead' (review_send_back) never shows on screen.
- Expected: While dragging, mark To do and In progress as closed for this card, or after the drop show a short visible line such as 'Use Send back with a note' with a link to the review block.
- Screenshot: /private/tmp/claude-501/-Users-osamakhalil/5721f5d8-5441-480d-b8e1-5ea30aba78f8/scratchpad/audit/final/shots/changed/board-06-mid-drag-over-inprogress.png (after the drop: board-05-drag-review-to-inprogress-en.png)
- Confirmer: Reproduced in a fresh Playwright context in English and Arabic, with the same result both times. The steps were: preview as Faisal, open #/projects/prj_001?tab=tasks, choose Filter then Board, drag the grip of "Toilet details" (In review) over In progress, and release.

What I saw:
- While the card is over In progress, all four columns keep the same class ("... p-2 bg-fill"). No column is marked as closed. The page cursor stays "auto".
- When the card is over Done, only Done changes to bg-fill-strong. The only difference between an open column and a closed one is therefore a faint highlight that is absent on the closed one.
- After the drop, the card goes back to In review ("In review: 1"). No toast, line or message shows on screen.
- The only words are in the dnd-kit live region DndLiveRegion-0: "The move of Toilet details is cancelled." in English and "أُلغي نقل Toilet details." in Arabic. That region is 1 px wide and visually hidden.
- The refusal text "Use Send back and write a note for the lead" (errors.reasons.review_send_back) never shows.
- There were no console errors or warnings on either run.

Screenshots are in /private/tmp/claude-501/-Users-osamakhalil/5721f5d8-5441-480d-b8e1-5ea30aba78f8/scratchpad/audit/final/shots/review-drag-verify/:
- en-02-mid-drag-over-inprogress.png and ar-02-mid-drag-over-inprogress.png: no column looks refused.
- en-03-mid-drag-over-done.png and ar-03-mid-drag-over-done.png: Done darkens.
- en-04-after-drop.png and ar-04-after-drop.png:

### F-10 [LOW] Workload cell label says '1 tasks'
- Steps: #/dashboard?team=tm_003&view=people. Read the accessible name of a workload cell with one task, for example 'Faisal Al-Harbi, week of 4 Oct: 1 tasks'. The key dashboard.cell in src/i18n/en.json:820 has no plural forms and Workload.tsx:36 passes n, not count. Arabic avoids it ('عدد المهام: 1').
- Expected: '1 task' for one, '2 tasks' for more: give dashboard.cell _one and _other forms and pass count.
- Screenshot: /private/tmp/claude-501/-Users-osamakhalil/5721f5d8-5441-480d-b8e1-5ea30aba78f8/scratchpad/audit/final/shots/changed/dash-13-workload-1-tasks-label.png
- Confirmer: Reproduced in a fresh Playwright context on the final build at http://127.0.0.1:5320/#/dashboard?team=tm_003&view=people. Twelve workload cells with one task have an accessible name that ends in "1 tasks", for example "Faisal Al-Harbi, week of 4 Oct: 1 tasks". Cells with 0, 2 or 3 tasks read correctly ("0 tasks", "2 tasks"). Screenshot: /private/tmp/claude-501/-Users-osamakhalil/5721f5d8-5441-480d-b8e1-5ea30aba78f8/scratchpad/audit/final/shots/verify-workload-label/en-workload-1-tasks.png. The page showed no console errors or warnings.

Cause in /Users/osamakhalil/dev/madar-fixes: src/i18n/en.json line 820 has one form only, "cell": "{{name}}, week of {{week}}: {{n}} tasks". src/features/dashboard/Workload.tsx line 36 passes `n: count`, not `count`, so i18next cannot pick a plural form. No "owner, <date>" comment marks this as intended. The rest of en.json uses _one/_other keys with {{count}} for every other number label (openTasks_one "1 open task", inboxBadge_one, stageLate_one and others), so this key breaks the project's own convention.

Why it is real: "1 tasks" is a grammar error, not a style opinion. A screen-reader user hears a wrong state word on each one-task cell, and the owner's rule asks for clear state words. Severity stays LOW: the label is not visible on screen (the cell shows only the number), and the Arabic label avoids the problem ("عدد المهام: 1").

What should happen: give dashboard.cell the forms cell_one "{{name}}, week of {{week}}: 1 task" and cell_oth

### F-11 [LOW] Tracker entry 'Reply task' block cannot open the reply task
- Steps: Preview as Faisal. #/projects/prj_001?tab=tracker, open 'The client asked to move the lobby entrance', Assign a reply, Assign. The sheet now shows a 'Reply task' heading with only the avatar, the name and 'Due 5 Oct'. It shows no task title and has no link or button to open the task. The task exists in the Tasks tab as 'Reply: The client asked to move the lobby entrance'.
- Expected: The Reply task block opens the task panel for that task (one place to go next), and names the task.
- Screenshot: /private/tmp/claude-501/-Users-osamakhalil/5721f5d8-5441-480d-b8e1-5ea30aba78f8/scratchpad/audit/final/shots/changed/tracker-03-after-assign.png
- Confirmer: Reproduced in a fresh Playwright context on the final build at http://127.0.0.1:5320/. Steps: Preview as Faisal Al-Harbi (Leader), open #/projects/prj_001?tab=tracker, open the entry "The client asked to move the lobby entrance", press "Assign a reply", then press "Assign". The sheet then shows a "Reply task" block with only the avatar, "Faisal Al-Harbi" and "Due 5 Oct". The block has 0 links and 0 buttons. A click on the name or on the due date does nothing, and the URL stays at ?tab=tracker&entry=trk_006. The toast says "Reply task opened." and offers only "Undo", with no "Open" action. The task exists as "Reply: The client asked to move the lobby entrance". To reach it, the person must leave the sheet, go to the Tasks tab and find the task by its name. That route opens #/projects/prj_001?tab=tasks&task=tsk_145. No console errors or warnings appeared on any page.

Code: /Users/osamakhalil/dev/madar-fixes/src/features/project/tracker/EntrySheet.tsx lines 163-171 render the block as plain text (Person, due date, Done sign) with no Link. The row data has the task id (src/api/contract/views.ts:200, replyTask = {id, status, dueDate, owner}), so a link is possible now. The data does not include the task title, so the block cannot name the task without a contract change. Other places in the app already link to a task with /projects/<id>?tab=tasks&task=<taskId>: SearchScreen.tsx:58, notifications.ts:66, ConversationPane.tsx:114 ("Open task"), NewTaskSheet.tsx:34 (toast action "Open

### F-12 [LOW] Schedule tab paints the current stage in the project color, which reads as health
- Steps: #/projects/prj_005?tab=schedule (Tamr Boutique Hotel, On track): the current stage bar is amber (var(--p-amber-fg)), the same tone as At risk elsewhere. #/projects/prj_001?tab=schedule (Corniche Office Tower, Late): the current stage bar is green, while the header progress line on the same page is red and the Dashboard office schedule draws this row red. Code: ScheduleTab.tsx:150 passes the project hue. The calm redesign spec line 141 asks for the project color, so this needs an owner decision, not a silent fix.
- Expected: One meaning per color: either the current stage bar uses the health tones (grey, amber, red) as the Dashboard schedule does, or a neutral tone, so an On track project never shows amber and a Late project never shows green.
- Screenshot: /private/tmp/claude-501/-Users-osamakhalil/5721f5d8-5441-480d-b8e1-5ea30aba78f8/scratchpad/audit/final/shots/changed/proj-02-schedule-prj_005.png (also proj-01-schedule-en.png for the Late project)
- Confirmer: Nothing blocked on you. The problem is real: I saw it myself in a fresh browser, and it breaks the owner's "one color, one meaning" rule.

What I saw (Playwright, fresh contexts, 1440 px wide, light and dark):
- #/projects/prj_005?tab=schedule (Tamr Boutique Hotel). The header says "On track" and the header progress line is green, rgb(30,122,52). The current stage bar (Concept) is amber, rgb(161,98,7). In dark mode it is a bright yellow-amber, rgb(245,196,81). Amber is close to the At risk orange (#B54708 / --c-orange-text #C93400).
- #/projects/prj_001?tab=schedule (Corniche Office Tower). The header says "Late" and the header progress line is red, rgb(215,0,21). The current stage bar (Construction Documents) is green, rgb(4,120,87), almost the same green as the "On track" sign.
- #/dashboard?view=schedule (Office schedule). The legend says "Current stage: On track (grey), At risk (orange outline), Late (red)". It draws KH-26-001 Corniche red and KH-26-005 Tamr grey. So the same mark (the current stage bar on a timeline) has two meanings on two screens.

Screenshots in /private/tmp/claude-501/-Users-osamakhalil/5721f5d8-5441-480d-b8e1-5ea30aba78f8/scratchpad/audit/final/shots/schedule-color/:
- 01-schedule-prj_005-on-track-light.png (+ -chart.png)
- 02-schedule-prj_001-late-light.png (+ -chart.png)
- 04-schedule-prj_005-on-track-dark.png
- 05-dashboard-schedule-light.png

Code: /Users/osamakhalil/dev/madar-fixes/src/features/project/schedule/ScheduleTab.tsx line 150 passes `

### F-13 [LOW] Board cards at 1440 px wrap the due date over three lines and cut the waiting label
- Steps: Any person, #/projects/prj_001?tab=tasks, Board view, 1440 x 900. The To do card 'Specifications draft' shows 'Due' / '10' / 'Oct' on three lines next to 'Waiting f...'; the In progress card 'Structural drawings check' shows 'In 3' / 'days' and 'Waitin...'.
- Expected: The due words stay on one line and the waiting label stays readable (put it on its own line under the date).
- Screenshot: /private/tmp/claude-501/-Users-osamakhalil/5721f5d8-5441-480d-b8e1-5ea30aba78f8/scratchpad/audit/final/shots/changed/board-03-send-back-opens-panel.png
- Confirmer: Reproduced in a fresh Playwright context at 1440 x 900, #/projects/prj_001?tab=tasks, Board view (picked inside the Filter popover). Each board card is 247 px wide, but its date row gets only 137 px. English: 'Specifications draft' shows 'Due / 10 / Oct' on 3 lines next to 'Waiting f...'. 'Structural drawings check' shows 'In 3 / days' on 2 lines and 'Waitin...'. The task panel does not change the result, open or closed. Arabic is worse: 'In 3 days' takes 3 lines, the red '5 days past due' takes 2 lines, 'Starts Thursday, 15 October' wraps on cards with no waiting label, and the waiting label shows only '...ils'. A 1920 px window gives the same result, because the cards stay 247 px wide. Cause in /Users/osamakhalil/dev/madar-fixes/src/features/project/tasks/TaskBoard.tsx: line 42 puts pe-24 (96 px end padding) on the whole card, but the grip and menu buttons (lines 90-109, absolute at the top end) cover only the title row. Line 49: the due span has no whitespace-nowrap or shrink-0, so flex shrinks it word by word. Line 51: the waiting span uses min-w-0 truncate with no title attribute, so the board never says what the task waits for. No 'owner, <date>' comment covers this layout. This breaks the owner rule 'clear state words': the due date and the waiting state are the card's state words, and they become unreadable or cut. Expected: keep the 96 px end padding on the title line only, keep the date on one line, and put the waiting label on its own line with its full text availa

### F-14 [LOW] Dashboard Filter offers every person as a Leader
- Steps: #/dashboard, press Filter. The Leader list shows all 10 people, including Noura Al-Shammari (Accounting), Turki Al-Otaibi (Management) and members who lead no project (Khalid, Lina, Sara, Yousef). In the seed office only Hala, Faisal, Reem and Omar lead a project, so 6 of 10 choices give an empty Dashboard.
- Expected: Fewest controls: list only people who lead at least one project in the current Status (or show the others greyed with '(no projects)').
- Screenshot: /private/tmp/claude-501/-Users-osamakhalil/5721f5d8-5441-480d-b8e1-5ea30aba78f8/scratchpad/audit/final/shots/changed/dash-02-filter-schedule-en.png
- Confirmer: Reproduced in a fresh Playwright context at http://127.0.0.1:5320/#/dashboard (English, viewer Hala). Press Filter. The Leader list shows "Any leader" plus all 10 humans: Faisal, Hala, Khalid, Lina, Noura, Omar, Reem, Sara, Turki, Yousef. I picked each person in turn. The 6 people who lead no project (Khalid, Lina, Noura, Sara, Turki, Yousef) each give Active projects 0, At risk or late 0, Past-due tasks 0, Deadlines 0, Area 0 m², and "No data for these filters." in Projects per stage, Health mix and Tasks per week. Only Faisal (3 active), Hala (1), Omar (2) and Reem (3) give data. The seed confirms this: src/data/seed.ts:69-82 sets leader index 0 to 3 only (Hala, Faisal, Reem, Omar). Code: src/features/dashboard/DashboardScreen.tsx:82 builds the options from users.list filtered only by kind === 'human', with no check that the person leads a project. No "owner, <date>" comment covers this line. The specs (prototype spec 8.1, redesign spec 3.6) only say "leader" is a filter, they do not ask for every person. The line came unchanged from the first Dashboard commit 9aa79b3, so it is not a deliberate later decision. Under the owner's ADHD rule (fewest controls, one obvious next step), 6 of 10 choices are dead ends that blank every number, and the label "Leader" next to an Accounting or Management person who leads nothing is misleading. Severity LOW is right: no data loss, the person can reset to "Any leader". Expected: list only people who lead at least one project (the list can 

### F-15 [HIGH] Task sheet: Escape throws away a typed Title, Description or checklist item (the X button keeps it)
- Steps: English, any person who can edit the task (seen as Khalid, the lead, on Qatif Public Library > Tasks > 'Site survey and photos', URL #/projects/prj_013?tab=tasks&task=tsk_145). 1) Type in Description: 'Bring the drone and the tape. Check the north fence levels before 9.' 2) Press Escape while the cursor is still in the field. 3) Open the task again: the Description is back to the old text. The same happens to a new Title and to text in 'Add an item' (checklist). Control test: type, then press the X (Close) button, and the text IS saved, because the click blurs the field first. Cause: src/features/project/tasks/TaskSheet.tsx:302 and :364 save only in onBlur, and Escape closes the sheet before any blur fires. No toast, no 'Not saved' mark. Screenshots: en-19-description-typed-before-escape.png, en-19-description-lost-after-escape.png (folder .../audit/final/shots/flows/).
- Expected: Escape, the X button and a click outside should all behave the same: save the typed Title and Description (or keep them as a draft marked 'Not saved', as the New Project sheet and chat drafts already do). Owner rule: nothing loses work by accident.
- Screenshot: 
- Confirmer: Reproduced in a fresh Playwright context (1440x900, English). The checker's link (#/projects/prj_013, tsk_145, Khalid) does not exist in a fresh office, because a fresh office has only prj_001 to prj_011. The checker created that project itself. The defect does not depend on the project, so I used the seeded task 'Stair details' (tsk_007) in Corniche Office Tower, opened with a click on the task row. I ran it as Hala (Admin) and again as Faisal (Leader), and both runs gave the same result. Escape loses work: (1) I typed 'Bring the drone and the tape. Check the north fence levels before 9.' in Description, pressed Escape with the cursor still in the field, then opened the task again. The Description was empty (""). History showed only 'created the task', so no save happened. (2) A new Title plus Escape: the title went back to 'Stair details'. (3) Text typed in 'Add an item' (checklist) plus Escape: no item was added and the field was empty after reopen. There was no toast (role status or alert was empty) and no 'Not saved' mark. Control tests: the same Description followed by the X (Close) button WAS saved. A Title followed by a click outside the panel was also saved (the side panel stays open and the blur saves). No console errors or warnings. Cause in the code: src/features/project/tasks/TaskSheet.tsx saves the Title only in onBlur (lines 302-304) and the Description only in onBlur (lines 364-366). The checklist adds an item only on Enter (onSubmit, lines 101-108). On deskto

### F-16 [MEDIUM] Date reason sheet: Escape or one click outside loses the typed reason and silently undoes the date move
- Steps: English, Hala (Admin). Task sheet > change Due date from 8 Oct to 12 Oct > 'Why do the dates change?' opens. 1) Type the reason 'Client asked to add the north plot'. 2) Press Escape (or click anywhere outside the sheet, for example x=10,y=450). 3) The sheet closes, the Due date goes back to 8 Oct, no message. 4) Move the date again: the Reason box is empty, so the person types it all again. Arabic run behaves the same (sheet mirrored to the left). Cause: src/features/project/tasks/DateReason.tsx:68-74 (close() clears pending and calls onCancel) wired to the Sheet's onOpenChange, so an outside tap counts as Cancel. Screenshots: en-02-reason-escaped.png, en-02-reason-lost-after-outside-click.png, ar-02-reason-asked.png.
- Expected: A click outside should not close this small required step, and a closed sheet should keep the typed reason so the next date move opens with it filled in. Only the Cancel button should discard, and it should say the date stays as it was.
- Screenshot: 
- Confirmer: Nothing blocked on you. The problem is real and I reproduced it myself in English and in Arabic. The page logged no console errors or warnings.

What happens: a person moves the Due date of a task. The "Why do the dates change?" sheet opens, and the person types a reason. Three actions then drop the typed reason and quietly put the date back, with no message: Escape, one click outside the sheet, and the X button. When the person moves the date again, the Reason box is empty.

Steps (fresh browser context, 1440x900; the fresh office opens as Hala Nasser, Admin):
1. Open http://127.0.0.1:5320/#/projects/prj_003?tab=tasks&task=tsk_032. This is the task "Core layout", due 2026-10-07.
2. Set the Due date to 12 Oct and press Enter. The sheet opens with "Due date: from Wed 7 Oct to Mon 12 Oct".
3. Type "Client asked to add the north plot", then press Escape. The sheet closes, the Due date shows 07/10/2026 again, and no toast or message appears.
4. Move the date again. The Reason box is empty.
5. Type the reason, then click at x=10, y=450 on the dim layer. The result is the same.
6. The X button gives the same result.
7. After a page reload the date is still 7 Oct, so nothing was saved.

Arabic (dir=rtl, sheet on the left, click at x=1430) behaves the same way.

Screenshots are in /private/tmp/claude-501/-Users-osamakhalil/5721f5d8-5441-480d-b8e1-5ea30aba78f8/scratchpad/audit/final/shots/date-reason-verify/:
- en-01-reason-typed.png and ar-01-reason-typed.png: the reason is typed.
- 

### F-17 [MEDIUM] Add payment sheet loses the typed name and amount on Escape or a click outside
- Steps: English, Noura (Accounting). Qatif Public Library > Overview > Payments > 'Add payment'. 1) Type Name 'Concept design fee' and Amount '25000'. 2) Press Escape (or click outside the sheet). 3) Press 'Add payment' again: both fields are empty. The New Project sheet keeps typed values after the same Escape (src/features/projects/NewProjectSheet.tsx:29 says 'A sheet closed by accident keeps what the person typed'), but src/features/project/payments/PaymentSheet.tsx:32-36 keeps the values in component state that unmounts on close. Screenshot: noura-03-payment-after-escape.png.
- Expected: Keep the typed payment until the person saves or presses Cancel, the same rule the New Project sheet follows, so both sheets act the same way.
- Screenshot: 
- Confirmer: Nothing blocked on you. The problem is real: I reproduced it on the final build. It also hits edits to a saved payment, not only new ones.

Steps (fresh Playwright context, viewport 1280x900, English, Preview as "Noura Al-Shammari · Accounting"): I used Corniche Office Tower (http://127.0.0.1:5320/#/projects/prj_001), because "Qatif Public Library" is not in the sample data (src/data/seed.ts). The bug does not depend on the project.
1) In Overview > Payments, I pressed "Add payment" and typed Name "Concept design fee" and Amount "25000". Then I pressed Escape and pressed "Add payment" again. Both fields were empty.
2) I did the same with a click outside the sheet: both fields were empty again.
3) I did the same with the X (Close) button: both fields were empty again.
4) I opened the saved row "Construction documents fee", changed Amount from 360000 to 375000 and typed a Note. I pressed Escape and opened the row again. The Amount was back to 360000 and the Note was empty.
5) For comparison, I typed "Test keep me" in the New Project sheet and pressed Escape. When I opened it again, the text was still there.

Screenshots are in /private/tmp/claude-501/-Users-osamakhalil/5721f5d8-5441-480d-b8e1-5ea30aba78f8/scratchpad/audit/final/shots/payment-escape/:
- 01-noura-typed-before-escape.png
- 02-noura-reopen-after-escape-empty.png
- 03-noura-reopen-after-click-outside-empty.png
- 04-new-project-reopen-after-escape-kept.png
- 05-noura-edit-typed-before-escape.png
- 06-noura-edit-reope

### F-18 [MEDIUM] Meeting summary and the message shared to the project chat drop who owns an Action and when it is due
- Steps: English, Hala. Dashboard > Meeting view > Agenda > Al Waha Clinic Fit-out. Add a Decision. Switch to Action, write 'Update the permit tracker with the new set', Who = Yousef Saleh, Due date = 6 Oct, Add. The panel shows 'Action: Update the permit tracker with the new set · Yousef Saleh · Tue 6 Oct'. Open 'See the meeting summary' and press 'Share to the project chats'. The summary and the chat message (Inbox > Al Waha Clinic Fit-out) say only 'Hala Nasser added the task “Update the permit tracker with the new set”'. The owner and the due date are missing. (The plan says the summary reuses the Activity sentence, which causes this.) Leftover data from another auditor's earlier run shows the workaround people fall into: a task titled 'Yousef to update…'. Screenshots: en-15-meeting-action-added.png, en-18-meeting-summary.png, en-18-summary-in-chat.png.
- Expected: An Action line in the summary and in the shared message should name who does it and by when, for example 'Action: Update the permit tracker with the new set · Yousef Saleh · Tue 6 Oct', as the meeting panel already shows.
- Screenshot: 
- Confirmer: REAL. I reproduced it twice in a fresh Playwright context (English, Hala Nasser, which the fresh context selects by default).

Steps: Dashboard > Meeting view > Agenda > Al Waha Clinic Fit-out. In Decisions, add the decision "Keep the clinic waiting area as drawn". Switch to Action and write "Update the permit tracker with the new set". Set Who = Yousef Saleh and Due date = 2026-10-06, then press Add.

Result in the meeting panel: "Action: Update the permit tracker with the new set · Yousef Saleh · Tue 6 Oct". The toast says "Task added for Yousef Saleh."

Result after Agenda > See the meeting summary: the line says "13:20 Hala Nasser added the task "Update the permit tracker with the new set"". It has no owner and no due date. "Copy as a table" puts the same words in the What column.

Result after "Share to the project chats" (toast "The summary went to 1 chat."): Inbox > Al Waha Clinic Fit-out (#/inbox/cnv_006) shows "Meeting summary, Sat 3 Oct / Hala Nasser added the task "Update the permit tracker with the new set"". It also has no owner and no due date.

Screenshots in /private/tmp/claude-501/-Users-osamakhalil/5721f5d8-5441-480d-b8e1-5ea30aba78f8/scratchpad/audit/final/shots/meeting-action-summary/:
- en-01-meeting-action-added.png
- en-02-meeting-summary.png
- en-03-summary-shared.png
- en-04-summary-in-chat.png

The en-04 shot comes from the second run, which added only the action. Console: no errors and no warnings on #/dashboard/meeting or #/inbox. I did not see the

### F-19 [MEDIUM] The lead of a task in review can pick 'Done', and nothing happens, with no message
- Steps: English. Khalid (Member) is the lead of 'Site survey and photos' and sends it to review (toast: 'Sent to review. The leader checks it next.'). 1) In the same task sheet, open Status and pick 'Done'. 2) The select jumps back to 'In review'. No toast, no text. The API (src/api/handlers/tasks.ts:473-490, tasks.move) maps Done to 'in_review' for a non-reviewer, nothing changes, and src/app/actions.ts:40-43 shows no toast for a call that changed nothing. Reproduced on fresh data. Screenshots: en-04-khalid-picks-done-in-review.png, en-fresh-04-khalid-done-noop.png.
- Expected: While a task waits for review, the lead should not be offered 'Done' (show the status as text, as the leader already sees it), or the press should say 'Waiting for the leader to approve'. A control that silently does nothing reads as a broken app.
- Screenshot: 
- Confirmer: REAL. I reproduced it in a fresh Playwright browser on http://127.0.0.1:5320/, in English and in Arabic. The bug is in two places: the task sheet and the board's Move menu.

Steps (seeded data; the checker's own project is not needed):
1. Settings, Preview as "Khalid Al-Mutairi · Member".
2. Open #/tasks?task=tsk_032&project=prj_003 ("Core layout", Eastern Shore Primary School). Khalid is the lead and the status is In progress.
3. In Status, pick Done. The toast says "Sent to review. The leader checks it next." and the status becomes In review. This step is correct.
4. Wait for the toast to close. Status is still a menu with To do, In progress, In review and Done. Pick Done again. The menu stays on "In review", no toast or text shows, and the sheet text does not change.
5. Board: open the project Tasks tab, then Filter > View > Board. Open the "Move Core layout" menu on the In review card. It offers To do, In progress and Done. Pick Done: no toast, and the card stays in In review.
Arabic gives the same result: the second منجزة shows no toast, and the board menu offers منجزة with no result.

Screenshots in /private/tmp/claude-501/-Users-osamakhalil/5721f5d8-5441-480d-b8e1-5ea30aba78f8/scratchpad/audit/final/shots/lead-done-in-review/:
- en-10-first-done-sends-to-review.png
- en-11-in-review-lead-still-sees-done.png
- en-12-second-done-no-message.png
- en-13-four-seconds-after-second-done.png
- en-14-board-move-menu-offers-done.png
- en-15-board-done-no-message.png
- ar-10 to a

### F-20 [LOW] 'File shared.' toast does not say where the file went
- Steps: English, Hala. Qatif Public Library > Files > upload site-plan.pdf > '…' > 'Share in chat' > Share to: Project chat, message 'Latest site plan from the survey' > Share. Toast: 'File shared.' with no place named and no way to open the chat. The share sheet offers three targets (Project chat, Person, Task), so the toast should name the one chosen. The message did arrive in the project chat. Screenshots: en-07-shared-toast.png, en-fresh-07-shared.png, en-08-project-chat-open.png.
- Expected: Say where it went, for example 'Shared in the Qatif Public Library chat', ideally with an Open link to that chat.
- Screenshot: 
- Confirmer: Reproduced in a fresh Playwright context (Chromium, 1280x900) against http://127.0.0.1:5320/. Severity stays LOW.

Steps: Settings > Preview as "Hala Nasser · Admin". Qatif Public Library is not in the sample data, so I made it with Projects > New Project, name "Qatif Public Library", team Sara Al-Qahtani, Create project (it opened as #/projects/prj_013). Then Files > Upload files > site-plan.pdf > the "..." on the row (Actions for site-plan.pdf) > Share in chat.
1. Share to: Project chat, message "Latest site plan from the survey", Share. The toast says only "File shared." and has no button.
2. Same sheet again, Share to: Person, Sara Al-Qahtani, message "Plan for you, Sara", Share. The toast is the same "File shared." with no button. From the toast alone, Hala cannot tell which of the three targets got the file.
3. Both messages did arrive. The project page has no Chat tab, so Hala must know to open the Inbox icon. There she finds "Qatif Public Library / Project chat" (#/inbox/cnv_015) and a new direct chat with Sara.

Code: src/features/project/files/ShareFileSheet.tsx:28-29 calls toast.show({ message: t('files.shared') }) for every target. src/i18n/en.json:663 is "File shared.", and src/i18n/ar.json:744 is "تمت مشاركة الملف.". Neither string names a place.
- The API already returns the place. src/api/handlers/sharing.ts:22 has output { kind, id }, and the id is the conversation id or the task id. The screen drops it.
- The toast system already supports a non-undo action b

### F-21 [LOW] Meeting Skip gives no feedback; the counter stays the same and the project quietly moves to the end
- Steps: English, Hala, Meeting view on 'Corniche Office Tower' (2 of 10). Press Skip. The header still says '2 of 10', only the project name changes, there is no toast, and Corniche moves to place 10 marked 'Skipped' (visible only if the Agenda is opened). Done on the project before showed 'Al Waha Clinic Fit-out marked as discussed. Undo'. Skip is session-only (src/features/dashboard/meeting/session.ts:196), which explains the silence. Screenshots: en-17-meeting-after-skip.png, en-17-meeting-agenda-states.png.
- Expected: A short toast such as 'Corniche Office Tower moved to the end of the agenda' with Undo, so a person who mis-pressed Skip knows the project was not dropped.
- Screenshot: 
- Confirmer: I reproduced the problem in a fresh Playwright context at 1440x900, on the final build at http://127.0.0.1:5320. Hala Nasser (Admin) has 9 projects in today's agenda. The checker saw 10, and this does not change the result.

Steps (English):
1. Settings > Preview as > Hala Nasser.
2. Open #/dashboard/meeting?mode=projects. The screen shows Al Waha Clinic Fit-out, "Agenda 1 of 9".
3. Press Done. The toast "Al Waha Clinic Fit-out marked as discussed. Undo" shows, and the screen moves to Corniche Office Tower, "Agenda 2 of 9".
4. Wait 6 s for the toast to close, then press Skip.

Result: the screen changes to Nakhla Mall Extension. The header still says "Agenda 2 of 9". I checked at 100 ms, 500 ms and 1.5 s: no toast and no live-region text. Ctrl+Z does nothing. Corniche Office Tower is now place 9 of 9, and the word "Skipped" shows only inside the Agenda sheet.

Arabic gives the same result: "جدول الأعمال 2 من 9" stays, no toast, and the Agenda says "تم تخطيه".

The only way back is to press Corniche in the Agenda. It then shows as "9 of 9", with "Skipped · Now". It does not go back to place 2.

Code:
- src/features/dashboard/meeting/AgendaBar.tsx:56-60 wraps Done in a toast with Undo. Its comment says: "One wrong press of Done must have a way back (audit 2026-10-03, DSH-10)".
- AgendaBar.tsx:73 connects Skip directly to session.skip. There is no toast and no Undo.
- src/features/dashboard/meeting/session.ts:196-205 moves the project to the end of the stored order and adds it t

### F-22 [LOW] Handing a task to another person has no confirmation and no Undo
- Steps: English and Arabic, Hala. Task sheet > Lead > pick Khalid Al-Mutairi. The lead changes and Khalid gets a notification ('Hala Nasser gave you …'), but there is no toast and no Undo. When the person is outside the team they also join the project team (the option says '(joins the team)'), again with no confirmation. Send to review, Approve and Answered all show a toast with Undo. Screenshots: en-03-handed-to-khalid.png, en-fresh-03-handed.png, ar-03-handed-to-khalid.png.
- Expected: A toast such as 'Khalid Al-Mutairi now leads this task' with Undo, matching the other state changes that notify someone.
- Screenshot: 
- Confirmer: REAL, severity LOW. I reproduced it in fresh Playwright contexts in English and Arabic as Hala Nasser (Admin, the default person) on the final build at http://127.0.0.1:5320/.

Steps (case A, Khalid is already on the team):
1. Open #/projects/prj_001?tab=tasks.
2. Open "Stair details" (lead: Yousef Saleh).
3. In the Lead menu, pick Khalid Al-Mutairi.
Result: the lead changes and History says "Hala Nasser changed the lead". No toast appears and there is no Undo (a toast recorder saw 0 toasts in 3 s). On the same sheet, the Status menu shows "Moved to To do. Undo" (Arabic: "نُقلت إلى «للتنفيذ». تراجع").

Case B (Khalid is outside the team):
1. Open #/projects/prj_002?tab=tasks and open "Facade details".
2. The Lead menu option reads "Khalid Al-Mutairi (joins the team)" (Arabic: "(ينضم إلى الفريق)"). Pick it.
Result: no toast and no Undo. Khalid joins the Dune Line Townhouses team, and he gets two unread notices: "Hala Nasser gave you "Facade details"" and "Hala Nasser added you to Dune Line Townhouses".

Why this is wrong for the owner's rules and not only a style choice:
- A mis-pick cannot be taken back in one step. When Hala picks Sara back by hand, Khalid stays on the team, and both unread notices stay, including one for a task he does not lead (en-07, en-08, en-09). The fix needs a second place (the Team tab), and the notices cannot be taken back at all. This breaks "nothing that loses work by accident" and "one place for each thing". It also breaks spec 10.7 Agency: "Undo

### F-23 [LOW] Tracker entry sheet: 'From the client' is read twice
- Steps: English, Hala. Qatif Public Library > Tracker > open the logged item 'Client sent the land survey'. The sheet's text (and its accessibility tree) has 'From the client' twice in a row ('Message / From the client / From the client / 3 October 2026'), while the screen shows it once. A screen reader says it twice. Screenshot: en-06-tracker-answered.png (visual shows once; the duplicate is in the hidden label).
- Expected: Give the direction icon an empty label (aria-hidden) or drop the hidden copy, so the direction is read once.
- Screenshot: 
- Confirmer: Reproduced in a fresh Playwright context (English, Hala, the default person). The checker's project "Qatif Public Library" does not exist in the fresh sample office, so I used the seeded project Corniche Office Tower (prj_001) > Tracker. Test 1: I opened the seeded entry "The client asked to move the lobby entrance" (direction "in"). Test 2: I logged "Client sent the land survey" with "From the client" and opened it. In both sheets the accessibility tree reads "paragraph: Message From the client From the client 3 October 2026", while the screen shows "From the client" one time. Cause: src/features/project/tracker/EntrySheet.tsx line 159 renders <DirectionMark direction=.../> and then the visible text t(`tracker.direction.${entry.direction}`). DirectionMark (src/features/project/tracker/marks.tsx lines 27-36) already holds a <span className="sr-only"> copy of the same words. The icon already has aria-hidden, so the reporter's "aria-hidden on the icon" fix is not enough: the extra copy is the sr-only span. The sr-only text in marks.tsx is correct for the icon-only History rows (History.tsx line 23, which read the direction once). The sheet reuse is an oversight, and no "owner, <date>" comment marks it as intended. It breaks the owner's rule of clear state words said one time: a screen reader says the direction twice, and a copy of the sheet text gets the words twice. Severity LOW. Expected fix: in the sheet, render the icon without the sr-only copy (for example a prop on Direct
