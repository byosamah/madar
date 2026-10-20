# Words (English and Arabic)

Every visible word on a screen and in a mail has an English key and an Arabic key. The owner reads the Arabic as a native
speaker, so write it as natural Arabic, not as a word-for-word copy of the English.

## Files
- Base words: `en.json` and `ar.json`.
- Track files: `real/<track>.en.json` and `real/<track>.ar.json`, one pair for each build track (agents, auth, core,
  files, h, mail, notices, p, people, q, s, usage, dash, office, fbnotices, fbadmin, push, teama, meetings, rolerights).
  `rolerights` holds the words of the 7 sections of rights, the All switch, and the 10 rights of role-rights (2026-10-23).
  `teama` holds the words of the team-requests batch of 2026-10-19 (fbk_024, fbk_025, fbk_027). `meetings` holds the words of the meetings
  (fbk_022): the refusals, the notices, the screens, and `feed.meeting.*`.
  `chatfind` holds the words of the chat search and the open-at-a-message screens of 2026-10-19 (Messages group, Message and Project chat
  buttons, Show newer messages). `chatmsg`, `chatread` and `chatnotify` are the other chat tracks. `series` holds the words of the repeating meetings (fbk_022, wave 3):
  Repeat and Until, the line "Repeats every week", the scope question, the toasts and the refusals `until_before_start`, `until_too_far` and `series_day_one_only`.
- A task adds new words only to its own track files.
- Server code reads the word files with plain JSON imports (no `import.meta.glob`).
- `words.en.ts` and `words.ar.ts` each merge one language (the base file plus the track files). `trees.ts` gives both trees,
  for the server and the tests. `index.ts` loads one language on demand (`loadWords`, `withWords`, `addWords`) and exports no
  word trees: tests and the server import `en` and `ar` from `i18n/trees`. `firstWords.ts` starts the words of the first
  language with the first script of the remote build, and `main.tsx` loads the other language right after the first render.
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
- Mail words have snapshot tests in `server/mail/templates/`. Update a snapshot only when the change is on purpose.
