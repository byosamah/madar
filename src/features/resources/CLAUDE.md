# Resources page (fbk_078, owner 2026-11-05)

The files of the whole office, such as building codes and office policies, on one page inside Projects. The data rules, the switches and the
locked folders are in `src/api/CLAUDE.md`, "Resources". The Files tab of a project: `src/features/project/CLAUDE.md`.

## The page
- Route `/resources` (`ResourcesScreen.tsx`, its own chunk). A desk opens it from the quiet link at the end of the Projects controls; a phone from the 4th
  part of the Work switch, with the Work header. One title. The one main button is "Upload a file", only for a person with `viewerCan.manage`.
- The page reads `resources.list` (folders, files, `viewerCan: { manage, lock }`). The screen keeps no rule of its own: the controls follow the flags,
  and a file delete follows `FileView.canDelete`. A person without the manage switch gets the folders and files with Preview and Download only.
- A press on a folder opens it in place (`?folder=<id>`, a step in the history). A link from Search (`?file=<id>`) opens the preview of that file once,
  in its folder. A folder that the person does not see (a locked one) reads as none.
- A person with the switch also has "+ Folder", the file menu (Rename, Move to, Delete) and the folder menu (Rename, Delete; Lock and Unlock only with
  `viewerCan.lock`; a locked folder has no Delete). Every change shows a toast with Undo. A drop of files on the page uploads them (desk, fine pointer).
- Empty page: one line says what goes here. Preview, Download and the preview of a Word or Excel file are those of the Files tab (`PreviewSheet`, `useDownloadFile`).
- Files of Resources stay out of chats, posts, comments and the Tracker (`file_resource`). They have no stage, cover or delivered mark.

## Tests
- `ResourcesScreen.test.tsx`: the controls with and without the switch, the locked folder, the empty page, the link on Projects, the Work switch on a phone.
- Words: `resources.*` in `src/i18n/real/fbk078.*`. The Arabic name of the page is «المراجع». The first choice «ملفات المكتب» was cut in the Work switch of a phone (the word was wider than its part at 360 px and 390 px, in Chromium and WebKit).
