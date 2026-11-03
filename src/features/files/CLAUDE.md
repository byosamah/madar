# Attachments and pictures

The parts that chats, comments, posts and the Tracker share to pick, upload, show and download files. The Files tab of a project:
`src/features/project/CLAUDE.md`. The upload flow and the safe types on the server: `server/files/CLAUDE.md`.

## Picture hooks
- A picture hook (`useFileLink`, `useScreenshotLink`, `app/files.ts`) keeps its signed link in the cache for `LINK_STALE_MS` after the
  screen closes (real build). Row pictures (Files rows, meeting drawings, report thumbnails) have `loading="lazy" decoding="async"`. A sheet
  or preview picture does not.
- A picture hook asks for one new link after an error. It gives up only when the new link breaks: an error of the old link while the new
  link loads is no strike. A screen checks `broken` before `url`.
- A report screenshot uses `useScreenshotLink`. A press opens it in a sheet, and a press on the big picture opens it in a new tab.
- A read with `wire.output` (`feedback.screenshot`, `files.link`) gives the screen the wire form in the real build. Test such a screen with
  `runtime.mode: 'remote'` (`FilesTab.remote.test.tsx` shows how, with an `IntersectionObserver` stub).

## Picture preview in a bubble or comment
- `AttachmentList` (`PictureAttachments.tsx`) replaces `FileChips` in `Thread.tsx` and `CommentThread.tsx`. A picture (`Attachment.mimeType`
  and `usePictureTest`) is a small rounded picture from the thumb link. Two or more sit in a grid. A PDF is a chip that previews (tsk_485, below). Every other file stays a chip that downloads. Posts and
  the Tracker keep `FileChips`. The chip list is `min-w-0 max-w-full`, so a long name is cut with an ellipsis.
- The box holds its place while the picture loads (the last known shape in `SHAPES`, else 4 to 3). The picture asks for its link only near
  the view (`useNearView`, `app/useNearView.ts`; the Files tab rows use it too). A picture that breaks, or that the store keeps as a download
  (an SVG in the real build), shows as a chip.
- A message with files and no words of its own gets the file names as its words. The bubble leaves them out when the words equal the joined
  names (`isFileNamesBody`). The list preview, search, push and the stored body keep them.
- `ImageViewer` (`components/ImageViewer.tsx`) zooms with `components/useImageZoom.ts` (math in `lib/zoom.ts`, Pointer Events and a CSS
  transform only). The stage is `touch-none` with `data-vaul-no-drag`, and the `gesturestart` default is stopped so Safari never zooms the
  page. A new picture and a viewer that opens again start at 1x. A press on the dark space closes only at 1x. `ImageViewer.zoom.test.tsx`
  plays the sizes. `MessageLog` keeps the newest message in view while a picture grows its box.

## PDF preview in a bubble or comment (tsk_485)
- A PDF (`mimeType` `application/pdf`) in `AttachmentList` is a chip named "Preview <name>". A press opens `PreviewSheet`
  (`features/project/files/PreviewSheet.tsx`), the preview of the Files tab: a frame on a desk, and on a phone a sheet with one real link
  (Safari for iPhone blocks a window that opens after a wait; do not change this). The chip list takes the `preview` prop
  (`FileChip`, `FileChips`). Posts and the Tracker pass none, so their PDF chips still download.
- The file saves only from the "Download" button inside the preview (`DownloadFoot` in `PreviewSheet.tsx`, desk and phone). The preview asks
  `files.link` as the person, as the download does. A refused link shows no frame and no link.
- `PreviewSheet` takes `PreviewView` (id, name, type, optional letter), so a message gives no version letter and the newest version
  opens. The preview loads in its own chunk (`lazyOverlay`, warmed at the first touch of the chip).
- Tests: `PdfPreview.test.tsx`. Words: `attachments.preview` in `src/i18n/real/chat-insert.*`.

## Word and Excel preview (tsk_495)
- A Word file (.docx) and an Excel file (.xlsx) open in the same preview, in the same places: the Files tab (desk and phone), the file
  chips of chats and of comments, and the to-do files. PowerPoint, .doc and .xls stay a download, and so do posts and the Tracker. Madar draws
  the file itself in the browser. No outside viewer, no upload of the file: never add one (owner, 2026-10-29).
- `office/officeKind.ts` decides (`officeKindOf`): the type first, the file name only when the type says nothing (octet-stream, zip, empty).
  It is small and sits in the first load (the chip and `canPreview` import it). It also holds the limits (`OFFICE_MAX_BYTES` 15 MB,
  `SHEET_LIMITS`). `PreviewSheet` loads `OfficeBody` in its own chunk (`lazyOverlay`).
- The reading runs in a Web Worker with a budget of 8 seconds (`officeRunner.ts`, `officeWorker.ts`, `officeWorkerCore.ts`). The worker holds
  mammoth, read-excel-file and fflate (361 kB, its own file). The page sends the bytes (no copy) and gets plain data back. Over the budget,
  on a worker error or with no worker, the page ends the worker and `OfficeBody` shows the quiet line "This file cannot show here" with
  Download: the tab never freezes. DOMPurify needs a DOM, so the cleaning of a Word file runs on the page (`docxClean.ts`, a chunk of its
  own, 30 kB); the worker refuses an HTML text above 20 million characters, so the cleaner has little to do. `scripts/check-bundles.ts` keeps
  the libraries out of the first load (`LAZY_MARKERS`). Keep `SHEET_LIMITS` out of `xlsxSheets.ts`.
- The remote build starts the worker in `spawnWorker.ts` (a module worker, `worker-src 'self'`; it runs on Chromium and on WebKit, checked
  on both with the real CSP). The prototype is one script file: it has no worker file and runs the same code in the page
  (`inlineWorker.ts`), where a timer cannot end a run, but the unpack limits and the grid scan still stop a bomb and a far cell. The flag is
  written `import.meta.env.VITE_MADAR_API === 'remote'` in `officeRunner.ts`, so the prototype never sees the worker URL. A test calls
  `setWorkerFactory(inlineWorker)` (jsdom has no Worker) and may give its own worker (a hung one, a broken one).
- The bytes: the real build asks `files.link` as the person (the rights, and the locked folder rule, are the same as a download) and reads the
  signed link with `fetch` and `credentials: 'omit'`. This needs `GET` in `config/r2-cors.*.json` and the store in `connect-src` of the
  CSP, as "Download all" does. The prototype reads `files.get`. A signed link is never opened in a window. A file above 15 MB is not read:
  the size of the version decides first, else the Content-Length of the store.
- `zipGuard.ts` trusts no number of the ZIP file (a zip bomb). It reads the central directory, compares each local header with it, inflates each
  part in 16 kB steps with fflate and counts the REAL output. It stops at 80 MB for one part or 150 MB in all, and 4,000 parts at most. The real
  size must equal the declared size. It keeps only the parts that the caller wants. The unpacked size of a limit is a `ZipLimits` argument,
  so a test makes a small bomb.
- Word: mammoth makes HTML (no outside file, pictures only as `data:` of png, jpeg, gif, webp or bmp), `sanitize.ts` cleans it with an
  allowlist (no style, class, id, event handler or link: a link keeps its text only), and `OfficeDoc.tsx` draws it in a frame with
  `sandbox=""` and its own CSP (`default-src 'none'; img-src data:`). Each block gets `dir="auto"`, so an Arabic and an English paragraph each
  read right.
- Excel: `xlsxSheets.ts` unpacks the XML parts itself (`unpackZip`), scans every sheet for its `<dimension ref>` and its `<c r>` and `<row r>`
  references (`gridOf`), and refuses ("too many cells") before the parse when the grids of all sheets pass 400,000 cells: read-excel-file builds
  a dense grid up to the farthest cell, so one cell at XFD1048576 would fill the memory. Then it gives the reader (`read-excel-file/universal`,
  which starts no worker of its own) a STORE copy of the XML parts (`storedZip`): fflate unzips a large deflated archive in blob workers, and
  the CSP refuses a blob worker. Every cell is React text (`OfficeSheets.tsx`), never HTML. The cut is 1,000 rows, 50 columns and 30 sheets.
  One quiet line says that the layout is close, not exact.
- Never add a second way to read a file: the preview must ask the same call as the download. A change to the allowlist or to the frame
  needs a hostile test in `sanitize.test.ts` or `docxHtml.test.ts` first (`officeFixtures.ts` builds a hostile Word file).
- Tests: `office/*.test.ts(x)`, `PdfPreview.test.tsx` (the chips). Words: `officePreview.*` in `src/i18n/real/officePreview.*`.

## Video in a bubble, a comment or the Files tab (owner, 2026-11-03)
- `isInlineVideo` (`app/files.ts`) takes the three video types that the server shows inline: MP4, WebM and QuickTime (`INLINE_SAFE` in
  `server/files/links.ts`). Both builds use it. Every other video (.mkv, .avi, .m4v) stays a chip that downloads. Keep the two lists equal.
- In `AttachmentList` a video is a `VideoTile` under the pictures, one under the other (a list named "Videos"). The tile asks the inline
  `full` link near the view (a video has no thumb) and loads only its first bytes (`preload="metadata"`). The `#t=0.1` start mark makes
  Safari for iPhone draw the first frame; the store never sees it, so the signature holds. A video that cannot load, or that the browser
  cannot play, turns into a chip after one new link (`onBroken`).
- A press opens `VideoViewer` (`components/VideoViewer.tsx`): the shell of `ImageViewer` (name, Download, X) with a `<video controls
  autoPlay playsInline>`. It asks the same query as the tile, so the press makes no call. A video that fails there shows `video.failed`,
  and Download stays. `PreviewSheet` opens the same player for a video of the Files tab and of the to-do files (`canPreview` takes it).
- The CSP needs `media-src 'self' {{FILES}}` (`config/headers.template`): without it `default-src 'self'` refuses the store link.
  A `<video>` without `crossorigin` needs no CORS rule. Playwright's own Chromium has no H.264: test an MP4 with `channel: 'chrome'` or WebKit.
- Tests: `VideoAttachments.test.tsx`, `PreviewSheet.test.tsx` ("the preview of a video"). Words: `src/i18n/real/video.*`.

## Download all
- `AttachmentList` ends with one quiet text button "Download all (N)" (`DownloadAll.tsx`, never a main button) when two or more files can be
  downloaded. A deleted file (`name === null`) does not count. The Files tab has its own buttons (`src/features/project/CLAUDE.md`).
- The ZIP is made in the browser (`downloadAll` in `app/files.ts`, the writer in `lib/zip.ts`): no server call, no new package, STORE only,
  UTF-8 names, no ZIP64 (a total over 4 GB refuses with a toast). The real build asks `files.link` for a signed link of each file, one after
  another, and reads it with `fetch`. That GET needs `GET` in the R2 CORS rules (`config/r2-cors.<env>.json`) and the file store host in the
  CSP `connect-src` (`server/files/CLAUDE.md`). The prototype reads `files.get`.
- The ZIP code loads at the first press (a dynamic import), so the first load stays small. One file that fails stops the run: the toast names
  the file and has Retry. The ZIP name is "<title> <YYYY-MM-DD>.zip", with the title from `ZipTitleContext` (`zipTitle.ts`, given by
  `ChatPane`, `TaskPane` and the to-do panel), else "Files". A path character becomes a dash. Two files with one name get " (2)", " (3)".
- Tests: `lib/zip.test.ts`, `app/downloadAll.test.ts`, `DownloadAll.test.tsx`. Words: `src/i18n/real/fbk050.*`.

## Upload progress, drop and paste
- `CallMeta.onProgress` reaches `xhrPut` through the upload adapter (screen only, never on the wire). `useAttachments` keeps a whole percent
  for each file. `PickedFiles` draws the bar (`UploadBar` in `Attachments.tsx`) and locks Remove while the uploads run. Every upload spot
  passes `progress` and `busy`. The prototype api drops `onProgress`, so a test plays the store (`UploadProgress.test.tsx`).
- `makeThumb` makes the small picture before the upload starts (the server signs its upload by its size). A file over `BIG_PICTURE_BYTES`
  decodes straight to 960 px wide (`createImageBitmap` with `resizeWidth`). A browser that refuses the options decodes the full picture.
- `ChatDropArea` (`features/inbox/ChatDrop.tsx`) wraps a loaded chat, a task thread and the comments of the task panel (with
  `className="relative"`, no flex item). The Tracker quick log, the project post box and the minutes sheet use `DropReceiver`,
  `onPastePictures` and `useBlockFileDrop` with their own `dropNote`. The frame shows only while the box registered a receiver
  (`useChatDropReceiver`). Files go to the picked chips and nothing sends until Send.
- A paste uses `pastedPictures` (`Attachments.tsx`): a paste that holds text stays text, and a paste of only pictures adds them.
  `useBlockFileDrop` stops the browser from an open of a file dropped anywhere else. It leaves a drag that a drop area took first
  (`defaultPrevented`).
- Every chat takes files. A project chat uploads into the files of its project. A direct chat and a group upload into the chat itself
  (`UploadTarget.conversationId`). A chat file shows in no Files tab and no search.
- The size limit follows the place (fbk_070): `useFileLimit(place)` and `useAttachments(max, initial, place)` give 500 MB for a project file
  (a project chat too, because its file joins the project) and 250 MB for a direct chat, a group, a meeting with no project and an office
  to-do. The upload adapter names the same limit in its refusal (`fileLimitOf` with the store limit of `session.get`). A person who needs a
  larger file in a chat inserts the project file.

## Attach menu and Insert from a project
- The clip of a chat box (`Composer.tsx`) and of the comments of a to-do (`CommentThread.tsx`) is `AttachMenu`: a short menu with "Upload a
  file" (`files.uploadOne`) and "Insert from a project" (a bottom sheet on a phone, as every `Menu` with `sheetOnPhone`). The menu shows only
  for a person with `file.share` and where the box has an `insert` scope. Else the clip is the plain `AttachButton`. The hidden file input
  stays beside the menu with the label "Attach files" (tests upload to it), and the item opens it, as the Files tab does.
- `insert` is `{ conversationId }` for a direct chat and a group, and `{ projectId }` for a project chat and a to-do of a project (the server
  takes only files of that project). A direct chat or a group lists only the projects that hold every active person of the chat (owner, 2026-10-28): the
  picker asks `chats.insertProjects` once and keeps those ids from `projects.list`, so no call runs for each project. When no project is left, one
  plain line says why (`insert.noShared`), with no search field. An office to-do has none: its files stay on the task.
- `ProjectFilePicker.tsx` loads at the first press (`lazyOverlay`). Levels: projects (a search field, `projects.list` with status all), the
  stages of one project (`groupsOf` of `files/groupsOf.ts`, so "No stage" and the empty-stage rule are those of the Files tab; the folders of the
  whole project come first as the pseudo stage "Project folders"), then the folders (a folder with no file is left out; a tick takes all its
  files) and the files outside a folder. A file in a locked folder is left out: the server refuses it in a chat (`file_locked`). A file inside a folder is sent
  only with its folder. The ticks stay while the person steps back. One Send button with the count. A project chat starts at its own stages.
- Send makes no upload: `insertParts.ts` cuts the pick into messages of 10 files, with the file names as the words, and the box sends them
  with its own `onSend` (the outbox of a chat, `comments.create` for a to-do), in one tick, so the server keeps the order. Only the first message carries a reply (`insertParts` takes it, and `onSend` gets it from the box), so the person answered gets one notice. The text and
  the picked files of the box stay. A refusal of the server shows as a toast. It is rare now: a project can stop holding a person between the list and Send.
- The lists are the reads of the Files tab and of `chats.insertProjects`, so a hidden project and a file that the person may not open never show. Tests:
  `ProjectFilePicker.test.tsx`, `InsertInTodo.test.tsx`, `ChatFileLimit.test.tsx` (`features/inbox`).
