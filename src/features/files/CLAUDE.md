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
  and `usePictureTest`) is a small rounded picture from the thumb link. Two or more sit in a grid. Every other file stays a chip. Posts and
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
