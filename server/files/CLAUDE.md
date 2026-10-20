# Files

Project files and feedback pictures. The browser sends a file straight to the store with a signed upload link. The
server checks the final object, then saves the record.

## Stores
- Supabase Storage first: the private bucket `madar-files`, 50 MB for each file, 1 GB in total (`supabaseStorage.ts`).
- R2 behind the S3 interface (`r2.ts`): 250 MB for each file, 10 GB in total. `MADAR_FILE_STORE=r2` switches to it. The
  owner decided the switch on 2026-10-16 (the test copy first, then production). R2 is not on yet: the owner turns it on.
- The buckets: `madar-files-test` (test copy) and `madar-files` (production), both in the EU jurisdiction, path style on
  `https://<account>.eu.r2.cloudflarestorage.com`. A bucket made without the EU jurisdiction breaks every link, and the
  jurisdiction cannot change later. `scripts/deploy/secrets.ts` refuses the bucket of the other copy.
- The store is a switch of its own: it does not follow the server host. The Supabase functions (which also run the 15-minute
  jobs) and the Worker of one copy get the same `MADAR_FILE_STORE` and R2 values in one step. A mismatch signs an upload on one
  store and checks it on the other ("The file did not arrive. Upload it again."), and new files get links to the wrong store.
- No copy from R2 back to Storage exists. A way back to the Supabase functions keeps `MADAR_FILE_STORE=r2`. The Storage
  bucket stays as the frozen copy of the files before the switch (no delete without the owner's OK).
- The CSP of the screens follows the same setting (`scripts/deploy/headers.ts`). The R2 CORS rules are
  `config/r2-cors.<env>.json`: only the browser upload (PUT with Content-Type) needs them.
- The scripts of the switch: `scripts/storage/move-to-r2.ts --env` (the copy; `--copy-only` after the switch) and
  `scripts/storage/verify-r2-keys.ts --env` (every record key has an object on R2). The runbook is in
  `scripts/deploy/CLAUDE.md`, "Switch the files to R2".
- The 10 GB R2 free tier is one for both buckets. No meter counts the storage since the usage feature went (owner, 2026-10-23).

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

## Rules
- Object keys hold only `[a-z0-9/-]` (`keys.ts`), so a key never leaves its folder. Each upload is a folder with `file`
  and, for a picture, `thumb`.
- A file of an office task (no project, owner 2026-10-06) sits under `office/<task>/<intent>/`. Its intent has no project, and
  the preflight takes it only for the task that the call names (`checkIntent`, `officeTaskId`).
- A file of a direct chat or a group (owner, 2026-10-19) sits under `chat/<conversation>/<intent>/` (`chatUploadKey`). Its intent has
  no project, and the preflight takes it only for the conversation that the call names (`checkIntent`, `conversationId`). The file
  record names its chat (`FileRec.conversationId`, in the jsonb doc: no migration) and has no project, stage or task. Who may start
  an upload: a member of that chat, active, in a chat that is not closed (`chatForUpload`, `assertMayUploadToChat`); a project chat
  uses the files of its project. Who gets a link: exactly the people who read the messages of that chat (`assertMayViewChatFile`,
  `canSeeConversation`). The Admin who is not a member, a person who left, an agent, and everyone when the chat is gone get
  not_found, as for a missing file. An agent never opens a chat file, and no search, `files.list`, project page or History line
  shows one. The file writes no History event. Its save sends the anonymous office signal of a private chat (`diffState`, kind
  `files` in `PRIVATE_CHAT_KINDS`): no actor, no story, no person, no file and no chat in it, and no person signal. It cannot go into
  another chat, a task, a post or the Tracker (`file_chat`), and it is never deleted or shared. A second upload with the same name
  is a new file, not a new version.
- A file of a meeting with no project (wave 2, owner 2026-10-19) sits under `meeting/<meeting>/<intent>/` (`meetingUploadKey`). Its intent has no
  project, and the preflight takes it only for the meeting that the call names (`checkIntent`, `meetingId`). The file record names its meeting
  (`FileRec.meetingId`, in the jsonb doc: no migration) and has no project, stage or task. A meeting is not an office list, so the rights read the row of
  the meeting with one statement (`readMeeting`, `MEETING_DOC_SQL`). Who may start an upload (`assertMayUploadToMeeting`): a person who sees the meeting
  and may write its minutes now (`minutesRefusal`: after the end, not cancelled), for a meeting with no project only. Who gets a link
  (`assertMayViewMeetingFile`): the people who see the meeting, the Admin only when invited. A person who does not see it, an agent, and everyone when the
  meeting is gone get not_found, as for a missing file. No search, `files.list`, project page or History line shows the file. The upload writes no event;
  its save is a private change of the meeting (`officeMeetings` in `data/save.ts`): person signals to the people of the meeting only, with the kind
  `files` and no name. It cannot go into another place (`file_meeting`), and it is never deleted or shared.
- Inline only for pictures, PDF, plain text, video and audio (`INLINE_SAFE`). Every other type is stored as
  `application/octet-stream`.
- Check `project.view`, and that the person is active, right before you sign any link (`rights.ts`). For a file of an
  office task: `task.view` on that task (`assertMayViewOfficeFile`), which answers not_found, as for a missing file.
- Never put a signed link in a message or a mail.

## Tests
- Storage and R2 integration suites need MinIO (`server/it/minio.ts`). CI starts MinIO in `ci-stack.yml`.
- `server/it/files.it.test.ts` runs each runCall upload suite twice: on the local Storage, then on `r2FilesPort` over MinIO.
  The rules that differ are pinned for each store: the second PUT, the signed type, the intent life, the file limit.
- The weekly file backup copies the store to Backblaze B2 (see `.github/CLAUDE.md`).
