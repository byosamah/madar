# Words (English and Arabic)

Every visible word on a screen and in a mail has an English key and an Arabic key. The owner reads the Arabic as a native
speaker, so write it as natural Arabic, not as a word-for-word copy of the English.

## Files
- Base words: `en.json` and `ar.json`.
- Track files: `real/<track>.en.json` and `real/<track>.ar.json`, one pair for each build track (agents, auth, core,
  files, h, mail, notices, p, people, q, s, usage, dash, office, fbnotices, fbadmin).
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

## Tests
- `keys.test.ts`, `i18n.test.ts` and `arabic.test.ts` check the keys, the placeholders, the Arabic script and the plural forms.
- Mail words have snapshot tests in `server/mail/templates/`. Update a snapshot only when the change is on purpose.
