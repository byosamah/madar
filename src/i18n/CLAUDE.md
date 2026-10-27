# Words (English and Arabic)

Rules for `src/i18n/`: the word files, the Arabic style, the What's new texts and the tests of the words.
Every visible word has an English key and an Arabic key (root rule). The owner reads the Arabic as a native speaker, so
write natural Arabic, not a word-for-word copy of the English.

## Files
- Base words: `en.json` and `ar.json`.
- Track files: `real/<track>.en.json` and `real/<track>.ar.json`, one pair for each build track. Run `ls src/i18n/real` for the
  list. A task adds new words only to its own track files. A new track needs no registration: `import.meta.glob` picks the
  files up, and `mergeWords` fails at load on a key that two files repeat or on a text where the tree has a group.
- A key may not exist twice, across all files. To change a word of an old track, edit it in place in its file.
- `rr2sheet` holds the role sheet: the key tree `roleRights` (the label and the hint of each power, the scope words, the
  sheet texts). The English texts and the Arabic labels come word for word from the catalog JSON (see "Add a switch" in
  `src/api/CLAUDE.md`). `real/mcpguard.*` holds the code mail of an agent act (`server/mcp/guard.ts` imports the two files by name).
- `words.en.ts` and `words.ar.ts` each merge one language (the base file plus the track files). `index.ts` loads one language
  on demand (`loadWords`, `withWords`, `addWords`). `firstWords.ts` starts the words of the first language with the first
  script of the remote build. `main.tsx` loads the other language after the first reads of the screen settle
  (`otherLanguage.ts`; the prototype loads it at once). A switch before that waits for the words. `firstLanguage.ts` holds
  `firstLanguage` and `browserLanguage`.
- `trees.ts` gives both trees to the screens' tests (`src/test/setup.ts`). The server never imports it: it calls
  `import.meta.glob`, and the Worker (esbuild) has none, so the Worker stops at start. Server code imports the JSON files by
  name: `server/mail/templates/words.ts` (the `mail.*` keys), `server/push/words.ts` (the `inbox`, `notices` and `push` parts).
  `server/workerGraph.test.ts` checks this.
- A new bell sentence (`inbox.*`) in a new track file needs a line in `server/push/words.ts`. `server/push/words.test.ts` fails
  without it.

## Rules
- A language switch calls `withWords(language, apply)`, so the direction and the words change together. The bundle check
  fails a remote first load that holds the words.
- A test refuses an em-dash in any word (`i18n.test.ts`). STE and the other style rules are in the root `CLAUDE.md`.
- An Arabic verb after a person's name needs a `_female` key beside the base key.
- Arabic plurals use `_one`, `_two`, `_few`, `_many`, `_other`. English plurals use `_one`, `_other`. No test checks that an
  Arabic plural has all six forms: check them by hand.
- A reason code or a key never ends with `_other` unless it is a plural form: i18next reads the suffix.
- Western digits and the Gregorian calendar in both languages (`ar-SA-u-ca-gregory-nu-latn`, `src/lib/dates.ts`).
- Office time is UTC+3. The work week is Sunday to Thursday.
- Gentle words: "3 days past due", not "Overdue". Known gap: `payments.status.overdue` still says "Overdue" (`PaymentsPanel.tsx`).
  Change it with its Arabic pair when you touch the payment sign.
- RTL: the layout uses logical classes only. Never put a left or right style next to a word.
- The word for a task: the English screens call one old task a "to-do". Only the tab (`nav.tasks`) and the screen title
  (`screens.myWork`) say "Tasks", because "Tasks" names the to-dos and the meetings together. The Arabic word «مهمة» covers
  both. Keys, calls, MCP tool names and code names keep "task". `todoWords.test.ts` pins this.

## What's new
- The list is `src/whatsNew/entries.ts`. The text of an entry is in `real/whatsnew.<lang>.json`
  (`whatsNew.items.<id>.title` and `.body`). Every feature or fix adds an entry before deploy (root rule).
- An id has the form `YYYY-MM-DD-N`. It is only a name: it never changes, because the seen mark and the words use it. Take a
  number above the newest id on main and on every open `rb/*` branch (`git show rb/<x>:src/whatsNew/entries.ts`). Sort ids as
  numbers (`sort -t- -k4 -n`): a text sort puts `-9` above `-82`. The ids of 2026-10-19 run in list order, so never order by
  the id number.
- A test finds its entry by id, never by `WHATS_NEW[0]`.
- The usage data entry (`2026-10-23-102`) stays first: `entries.test.ts` pins `WHATS_NEW[0]` to it. A new entry goes second
  (the header of `entries.ts` says "at the top": follow this rule instead).
- `day` is the day the production release goes live. Write the planned day before `all.sh test`. When production goes on
  another day, fix it in the release record commit. `entries.test.ts` fails on a day still to come or out of order (it leaves
  the first entry out of the order check). It also pins the set of release days and the list of rights that an entry may name:
  a new `day` or a new `right` adds its value there.
- The page sorts by day (`byAge`, `whatsNew/seen.ts`), then by list order. The word "New" and the seen mark follow the newest
  day (`newestId`, `isNewer`), never `WHATS_NEW[0]`.
- An entry may have `right` (the page shows it only to a person who holds it, by `can()`) and `to` (one quiet link "Open").
  Write no em-dash and no en-dash in an entry.

## Arabic style (Thmanyah)
🔴 Always: every Arabic text that you write follows the Thmanyah rules. This covers the screens, the mails, the push line,
What's new, the docs and your replies to the owner in Arabic.
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
- Run `npx vitest run src/i18n` after a word change. `keys.test.ts`, `i18n.test.ts` and `arabic.test.ts` check the keys, the
  placeholders, the Arabic script and the `_female` pairs. `trees.test.ts` checks the merge.
- Latin text in an Arabic word (a key name such as `Ctrl+Z`) goes into `ALLOWED` of `arabic.test.ts` as a whole name, never
  as one letter.
- Mail words have snapshot tests in `server/mail/templates/`. Update a snapshot only when the change is on purpose.
