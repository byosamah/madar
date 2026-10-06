# Files

Project files and feedback pictures. The browser sends a file straight to the store with a signed upload link. The
server checks the final object, then saves the record.

## Stores
- Supabase Storage first: the private bucket `madar-files`, 50 MB for each file, 1 GB in total (`supabaseStorage.ts`).
- R2 is built behind the S3 interface (`r2.ts`). `MADAR_FILE_STORE=r2` switches to it. The owner has not turned R2 on.
- The CSP of the screens follows the same setting (`scripts/deploy/headers.ts`).

## Upload flow
1. `files.uploadStart` (or `feedback.uploadStart`) writes one upload intent and gives a signed upload link (`intents.ts`).
2. The browser uploads to a staging key (`up/<intent>/file`, `up/<intent>/thumb`). Upload links never upsert.
3. The preflight of `files.upload` (or `feedback.send`) copies the object to its final key, before the lock. Then it checks
   the size and the type of the FINAL object (`confirm.ts`). A confirmed version never changes.
4. The prepare marks the intent used inside the lock. A retry with the same idempotency key gets the stored answer.
- The `uploads` job step removes staging objects older than 2 hours 10 minutes, and the copies of calls that failed.

## Rules
- Object keys hold only `[a-z0-9/-]` (`keys.ts`), so a key never leaves its folder. Each upload is a folder with `file`
  and, for a picture, `thumb`.
- A file of an office task (no project, owner 2026-10-06) sits under `office/<task>/<intent>/`. Its intent has no project, and
  the preflight takes it only for the task that the call names (`checkIntent`, `officeTaskId`).
- Inline only for pictures, PDF, plain text, video and audio (`INLINE_SAFE`). Every other type is stored as
  `application/octet-stream`.
- Check `project.view` (for a file of an office task: `task.view` on that task, `assertMayViewOfficeTask`), and that the
  person is active, right before you sign any link (`rights.ts`).
- Never put a signed link in a message or a mail.

## Tests
- Storage and R2 integration suites need MinIO (`server/it/minio.ts`). CI starts MinIO in `ci-stack.yml`.
- The weekly file backup copies the store to Backblaze B2 (see `.github/CLAUDE.md`).
