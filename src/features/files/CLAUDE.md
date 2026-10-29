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
- The file saves only from the "Download" button inside the preview (`PdfFoot` in `PreviewSheet.tsx`, desk and phone). The preview asks
  `files.link` as the person, as the download does. A refused link shows no frame and no link.
- `PreviewSheet` takes `PreviewView` (id, name, type, optional letter), so a message gives no version letter and the newest version
  opens. The preview loads in its own chunk (`lazyOverlay`, warmed at the first touch of the chip).
- Tests: `PdfPreview.test.tsx`. Words: `attachments.preview` in `src/i18n/real/chat-insert.*`.

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
  takes only files of that project). A direct chat or a group lists only the projects that hold every person of the chat (owner, 2026-10-28): the
  picker asks `chats.insertProjects` once and keeps those ids from `projects.list`, so no call runs for each project. When no project is left, one
  plain line says why (`insert.noShared`), with no search field. An office to-do has none: its files stay on the task.
- `ProjectFilePicker.tsx` loads at the first press (`lazyOverlay`). Levels: projects (a search field, `projects.list` with status all), the
  stages of one project (`groupsOf` of `files/groupsOf.ts`, so "No stage" and the empty-stage rule are those of the Files tab; the folders of the
  whole project come first as the pseudo stage "Project folders"), then the folders (a folder with no file is left out; a tick takes all its
  files) and the files outside a folder. A file in a locked folder is left out: the server refuses it in a chat (`file_locked`). A file inside a folder is sent
  only with its folder. The ticks stay while the person steps back. One Send button with the count. A project chat starts at its own stages.
- Send makes no upload: `insertParts.ts` cuts the pick into messages of 10 files, with the file names as the words, and the box sends them
  with its own `onSend` (the outbox of a chat, `comments.create` for a to-do), in one tick, so the server keeps the order. The text and
  the picked files of the box stay. A refusal of the server shows as a toast. It is rare now: a project can stop holding a person between the list and Send.
- The lists are the reads of the Files tab and of `chats.insertProjects`, so a hidden project and a file that the person may not open never show. Tests:
  `ProjectFilePicker.test.tsx`, `InsertInTodo.test.tsx`, `ChatFileLimit.test.tsx` (`features/inbox`).
