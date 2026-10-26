# Words (English and Arabic)

Every visible word on a screen and in a mail has an English key and an Arabic key. The owner reads the Arabic as a native
speaker, so write it as natural Arabic, not as a word-for-word copy of the English.

## Files
- Base words: `en.json` and `ar.json`.
- Track files: `real/<track>.en.json` and `real/<track>.ar.json`, one pair for each build track (agents, auth, core,
  files, h, mail, notices, p, people, q, s, dash, office, fbnotices, fbadmin, push, teama, meetings, rr2sheet).
  `rr2screens` holds the few words of the screens track of role rights version 2 (2026-10-21): `agents.off` (Settings, Agents without `ai.connect`),
  `errors.reasons.ai_off` (the consent screen) and `chat.cannotSend` (a chat without `chat.direct`).
  `rr2sheet` holds the words of the role sheet of role rights version 2 (2026-10-21): the key tree `roleRights` (13 sections, the label and the line
  of each of the 84 powers, the scope words, the sheet texts, the lines of a role in the person sheet) and the What's new entry `2026-10-23-75`.
  The English labels and lines come word for word from the catalog JSON; the Arabic labels too; the Arabic lines are written for the sheet.
  `teama` holds the words of the team-requests batch of 2026-10-19 (fbk_024, fbk_025, fbk_027). `meetings` holds the words of the meetings
  (fbk_022): the refusals, the notices, the screens, and `feed.meeting.*`.
  `chatfind` holds the words of the chat search and the open-at-a-message screens of 2026-10-19 (Messages group, Message and Project chat
  buttons, Show newer messages). `chatmsg`, `chatread` and `chatnotify` are the other chat tracks. `series` holds the words of the repeating meetings (fbk_022, wave 3):
  Repeat and Until, the line "Repeats every week", the scope question, the toasts and the refusals `until_before_start`, `until_too_far` and `series_day_one_only`.
  `adminreach` holds the words of "What reaches me" (owner, 2026-10-23): the Settings section, the bell lines of a copy for an Admin
  (`adminReach.copy.*`, with `_female` forms), the plural `adminReach.others`, and the What's new entry `2026-10-23-69`.
  `space2` holds the words of the Open space levels (fbk_055, 2026-10-25): the Detail control (`space.detail`, `space.more`, `space.less`, the five
  `space.level*` names), the sentence `space.introDetail`, the deadline and checklist cards (`space.deadline`, `space.itemDone`, `space.itemOpen`, the
  plural `space.moreItems` with all six Arabic forms). The "No sub-company" card reuses `subCompanies.none`.
  `fbk050` holds the words of "Download all" (`zip.*`: the button, "Preparing n of N...", the failed-file and too-large toasts) and the What's new entry `2026-10-23-97` sits in `whatsnew`.
  `batchd4` holds the words of internal projects and the Team tab block (fbk_044): `project.internal`, `project.hiddenMark`, `projectForm.kind*`, `projectAccess.*`,
  `feed.project.access_changed`, and the reasons `internal_project` and `code_prefix_taken`.
  `batchc` holds the words of the Board view of Tasks (fbk_042): `workView.label` (the View button) and `workView.yourReview`, and the What's new entry `2026-10-23-91`
  sits in `whatsnew`.
  `batchb` holds the words of quiet hours and @everyone (2026-10-22): the `quietHours` section, the Admin block `admin.workHours`, the reasons
  `work_hours_lock` and `work_hours_default_lock`, the bell sentences `inbox.mentionEveryone*` (also read by the push line), `mentionEveryone.*` (the
  row of the mention list), `roleRights.powers.chatMentionEveryone` and the What's new entries `2026-10-23-88` to `-90`.
  `b26names` holds the words of the names batch of 2026-10-26: `projectForm.nameAr` (the field "Arabic name") and its error `projectForm.errors.nameArLong`, and the What's new entries `2026-10-23-110` and `-111`. The hint of "Only my work" (`adminReach.mine.hint`) was edited in place in `adminreach` to name Home and Projects.
  `mcpparity` holds the What's new entry `2026-10-23-116` (the AI assistant does more, MCP parity, 2026-10-26). The two new AI switches (`ai.admin`, `ai.myState`) and the new hints of the AI switches sit in `rr2sheet` (`roleRights.powers.aiAdmin`, `.aiMyState`), as the line `roleRights.aiNever`.
  `focuschat` holds the word of the chat in Focus mode (fbk_059): `focus.backToFocus`. The button and the panel reuse `project.chat`, `chat.taskThread` and `common.close`.
  `b26small` holds the words of the small fixes of 2026-10-26: `people.leaderName` (the leader ring of `AvatarStack`), `personMenu.mode` (the Mode row of the person menu)
  and the What's new entries `2026-10-23-108` and `-109`.
  `b26folders` holds the words of the folders of the Files & Links tab (fbk_066): `folders.*` (the button "+ Folder", the name field, the toasts, the folder
  menu, the count with the six Arabic forms, "Move to", the drag announcements), the reasons `folder_name_taken`, `folder_limit`, `folder_other_stage` and
  `folder_missing`, and the What's new entry `2026-10-23-112`.
- A task adds new words only to its own track files.
- Server code reads the word files with plain JSON imports (no `import.meta.glob`).
- The push line (2026-10-21) writes the bell sentences on the server: `server/push/words.ts` imports the `inbox`, `notices` and `push`
  parts of the base files and of the track files that hold them, by name. A new bell sentence (`inbox.*`) in a new track file needs
  a line there too: `server/push/words.test.ts` fails without it.
- `words.en.ts` and `words.ar.ts` each merge one language (the base file plus the track files). `trees.ts` gives both trees,
  for the server and the tests. `index.ts` loads one language on demand (`loadWords`, `withWords`, `addWords`) and exports no
  word trees: tests and the server import `en` and `ar` from `i18n/trees`. `firstWords.ts` starts the words of the first
  language with the first script of the remote build, and `main.tsx` loads the other language 3 s after the first reads of the
  screen settled (`otherLanguage.ts`, FL-7 of 2026-10-21; the prototype loads it at once). A switch before that waits for the words.
  `firstLanguage.ts` holds `firstLanguage` and `browserLanguage`. The prototype keeps its words in its one script file
  (performance audit BND-7).

## Rules
- A key may not exist twice, across all files.
- Write every English word in ASD-STE100 Simplified Technical English. Never use an em-dash (a test refuses one).
- An Arabic verb after a person's name needs a `_female` key beside the base key.
- Arabic plurals use `_one`, `_two`, `_few`, `_many`, `_other`. English plurals use `_one`, `_other`.
- Western digits and the Gregorian calendar in both languages (`ar-SA-u-ca-gregory-nu-latn`).
- Office time is UTC+3. The work week is Sunday to Thursday.
- Gentle words: "3 days past due", never "Overdue".
- RTL: the layout uses logical classes only. Never put a left or right style next to a word.
- A language switch calls `withWords(language, apply)`, so the direction and the words change together. The bundle check
  fails a remote first load that holds the words.

## Arabic style (Thmanyah, owner, 2026-10-20)
🔴 Always: every Arabic text that you write follows the Thmanyah rules. This covers the screens, the mails, the push line,
What's new, the docs and your replies to the owner in Arabic. The audit of 2026-10-20 rewrote 571 of 2,729 strings with them.
- Plain standard Arabic. No dialect. One idea in each sentence, 14 words or less.
- A button, a menu line and a title that names an action is a verb in the imperative: «احفظ», «احذف», «أضف», «افتح»,
  «عدّل», «أرسل», «حاول مرة أخرى». «إلغاء» and «تراجع» stay as they are. A name (tab, screen, column, right) stays a noun.
- A confirmation is a short passive verb with its vowel mark, never «تم» or «يتم»: «حُفظ ملفك.», «حُذف القالب.», «أُضيف الموعد.».
  Where the name of a person follows and the verb cannot agree, put the verb first: «أُضيف إلى الفريق: {{name}}».
  «نا» always means the office («ردنا», «رددنا»). The screen never says «حفظنا».
- After «غير», the next word is genitive: «رسالتان غير مقروءتين», «رسائل غير مقروءة», never «غير مقروءتان».
- Talk to the reader: «ملفك», «مهامك», «ارجع». A switch for a notice starts with «عندما».
- One word for one thing. Admin = «مدير النظام» (never «المدير»). Dashboard = «لوحة المعلومات». Workload = «عبء العمل».
  Menu of options = «خيارات» (never «إجراءات»). Filter = «تصفية». Acts for = «باسم». Meeting task = «مهمة».
  Past due = «تجاوزت موعدها». Lead of a task = «المسؤول الرئيسي». Resume (a paused project) = «استئناف».
- Digits are Western («3», never «٣» or «ثلاثة» for a count in the UI). Tanween sits before the alif («أولًا», «كاملًا»).
- Avoid «من خلال», «بواسطة», «يرجى», «الخاص بك», «إجراء», «عملية». Write «لا تحتاج إلى فعل شيء», not «لا يلزم أي إجراء».
- A text that names a button writes the same label as the button, between «». Check it after a rename.
- After a word change, search the tests for the old text, also for a part of a string that has a placeholder (a pin such as
  `` `تم إصلاح الخلل في بلاغك: «${x}»` `` has no whole old value to find). Run `src/features`, `src/app`, `src/lib`,
  `server/mail` and `server/auth`. A mail snapshot changes on purpose: `vitest run <file> -u`.
- A shared label start breaks a test that picks a button by `/^خيارات/`. Use the full label or a negative match.
- Edit Arabic with the Edit tool or a script file. `perl -pi -e` without `use utf8` writes garbled text, and `node -e` or a
  `bash` string with a quote or `'` cuts the text. After a patch script, search for `[ÙØ]{2}` in the word files.

## Tests
- `keys.test.ts`, `i18n.test.ts` and `arabic.test.ts` check the keys, the placeholders, the Arabic script and the plural forms.
- Latin text in an Arabic word (a key name such as `Ctrl+Z`) goes into `ALLOWED` of `arabic.test.ts` as a whole name, never as one letter.
- Mail words have snapshot tests in `server/mail/templates/`. Update a snapshot only when the change is on purpose.
