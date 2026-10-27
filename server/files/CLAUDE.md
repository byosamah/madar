# Files

Project files and feedback pictures. The browser sends a file straight to the store with a signed upload link. The
server checks the final object, then saves the record.

Commands: `npx vitest run server/files` runs the unit tests. `MADAR_IT=1 npx vitest run --project it server/it/files.it.test.ts`
needs MinIO (`server/it/minio.ts`; CI starts it in `ci-stack.yml`).

## Stores
- R2 behind the S3 interface (`r2.ts`) is the live store for both copies: 250 MB for each file, 10 GB in total.
  `MADAR_FILE_STORE=r2` picks it.
- Supabase Storage (`supabaseStorage.ts`): the private bucket `madar-files`, 50 MB for each file. It keeps the old files only,
  as a frozen copy. No delete without the owner's OK.
- The buckets: `madar-files-test` (test copy) and `madar-files` (production), both in the EU jurisdiction, path style on
  `https://<account>.eu.r2.cloudflarestorage.com`. A bucket made without the EU jurisdiction breaks every link, and the
  jurisdiction cannot change later. `scripts/deploy/secrets.ts` refuses the bucket of the other copy.
- The store is a switch of its own: it does not follow the server host. The Supabase functions (which also run the 15-minute
  jobs) and the Worker of one copy get the same `MADAR_FILE_STORE` and R2 values in one step. A mismatch signs an upload on one
  store and checks it on the other ("The file did not arrive. Upload it again."), and new files get links to the wrong store.
- No copy from R2 back to Storage exists. A way back to the Supabase functions keeps `MADAR_FILE_STORE=r2`. The runbook and the
  scripts of the switch: `scripts/deploy/CLAUDE.md`, "Switch the files to R2".
- The CSP of the screens follows the same setting (`scripts/deploy/headers.ts`). The R2 CORS rules are
  `config/r2-cors.<env>.json`: the browser upload (PUT with Content-Type) needs them, and so does "Download all". That button
  reads each file with a `fetch` GET of a signed link from the page, and the browser makes the ZIP file (`src/CLAUDE.md`). Keep
  `PUT` and `GET` in `AllowedMethods`: without `GET`, "Download all" fails on the real store.
- The 10 GB R2 free tier is one for both buckets. No meter counts the storage.
- The file backup is paused (`.github/CLAUDE.md`).

## Upload flow
1. `files.uploadStart` (or `feedback.uploadStart`) writes one upload intent and gives a signed upload link (`intents.ts`).
2. The browser uploads to a staging key (`up/<intent>/file`, `up/<intent>/thumb`). Storage upload links never upsert. On R2
   a second PUT to a staging key replaces the staged object: the head of the final key after the copy is the guard on both
   stores (`confirm.ts`). It sends the PUT of the small picture together with the PUT of the file, and `files.upload` goes
   only after both end.
   The small picture (`makeThumb`, `src/app/thumbs.ts`) is a WebP of at most 960 px. A browser that cannot write WebP
   (Safari, every browser on an iPhone or iPad) gives a JPEG for a JPEG photo, only when it is smaller than the photo.
   Other pictures get none. The server takes any inline-safe picture as the small picture.
3. The preflight of `files.upload` (or `feedback.send`) copies the object to its final key, before the lock. Then it checks
   the size and the type of the FINAL object (`confirm.ts`). A confirmed version never changes.
4. The prepare marks the intent used inside the lock. A retry with the same idempotency key gets the stored answer.
- The `uploads` job step removes staging objects older than 2 hours 10 minutes, and the copies of calls that failed.
- An agent over MCP uploads with `files.uploadContent` (`server/mcp/upload.ts`): the same steps 1 to 4, run on the server. It sends
  the file as base64 text, puts the bytes to the signed link itself, and never gets a key or a link back. It can upload into a
  direct chat or a group of its person with `conversationId`, as that person does.

## Rules
- Object keys hold only `[a-z0-9/-]` (`keys.ts`), so a key never leaves its folder. Each upload is a folder with `file`
  and, for a picture, `thumb`.
- A file has one owner, and the owner picks the key folder and the intent rule. The preflight takes an intent only for the
  owner that the call names (`checkIntent`):
  - an office task: `office/<task>/<intent>/`, `officeTaskId`;
  - a direct chat or a group: `chat/<conversation>/<intent>/` (`chatUploadKey`), `conversationId`;
  - a meeting with no project: `meeting/<meeting>/<intent>/` (`meetingUploadKey`), `meetingId`.
  The file record of a chat or a meeting names its owner in the jsonb doc (no migration) and has no project, stage or task.
- Chat file: who may start an upload is an active member of an open chat (`chatForUpload`, `assertMayUploadToChat`); a project
  chat uses the files of its project. Who gets a link is exactly the people who read the messages of that chat
  (`assertMayViewChatFile`, `canSeeConversation`). The Admin who is not a member, a person who left, and everyone when the chat
  is gone get not_found, as for a missing file. An agent has exactly the rights of its person: the agent of a person who is no
  member gets the same not_found on every path (upload start, upload, link, messages), with no file name.
- Meeting file: who may start an upload (`assertMayUploadToMeeting`) is a person who sees the meeting and may write its minutes
  now (`minutesRefusal`: after the end, not cancelled), for a meeting with no project only. Who gets a link
  (`assertMayViewMeetingFile`) is the people who see the meeting, the Admin only when invited. The rights read the row of the
  meeting with one statement (`readMeeting`, `MEETING_DOC_SQL`). A person who does not see it, an agent, and everyone when the
  meeting is gone get not_found.
- A chat file or a meeting file shows in no search, `files.list`, project page or History line, and writes no History event. It
  cannot go into another place (`file_chat`, `file_meeting`), and it is never deleted or shared. A second upload with the same
  name is a new file, not a new version. Its signals: `server/data/CLAUDE.md`, "Tables".
- A project file may sit in a folder (`FileRec.folderId`; the folders live in the project, `src/api/handlers/CLAUDE.md`). `files.upload`
  takes `folderId` next to the signed upload: the intent and the object keys know nothing of folders. `files.uploadStart` needs
  no folder, and the upload adapter sends `folderId` only on `files.upload`. A move changes the record only, never the stored
  object.
- Inline only for pictures, PDF, plain text, video and audio (`INLINE_SAFE`). Every other type is stored as
  `application/octet-stream`.
- Check `project.view`, and that the person is active, right before you sign any link (`rights.ts`). The start of an upload asks
  `file.upload` (`assertMayPost`, and `file.upload` on an office task in `server/calls/files.ts`); a chat upload asks
  `chat.direct` (`chatForUpload`); a meeting upload asks the minutes right (`minutesRefusal`). For a file of an office task:
  `task.view` on that task (`assertMayViewOfficeFile`), which answers not_found, as for a missing file.
- A screenshot link of a report needs `feedback.manage` (`assertMayReadReports`, `rights.ts`). A hook has no office snapshot, so it
  reads the roles from the settings row (`readRoles`, `records.ts`) and attaches the rights with `withOfficeRights`.
- Never put a signed link in a message or a mail.
- A run of adjacent `files.link` entries reads its file records with one statement (`readFiles`, `FILES_DOCS_SQL`) before the entries
  run side by side. The person check still comes before that read, and the view right and the signing stay in each link.

## Tests
- `server/it/files.it.test.ts` runs each runCall upload suite twice: on the local Storage, then on `r2FilesPort` over MinIO.
  The rules that differ are pinned for each store: the second PUT, the signed type, the intent life, the file limit.
