# API contract: records, views and limits

Rules for `src/api/contract/`: the zod records, the read shapes, the server-only calls and the plain limits.
The rules of all parts (additive contract, a table for a new collection) are in the root `CLAUDE.md`.

## Fields
- A new field is optional, so an old row and an old answer still parse. A list or a collection that is optional needs no
  `STATE_VERSION` step (see "A new record type" in `src/api/CLAUDE.md`).
- A change to the rule of a stored field keeps the old rule as one side of a union (`RECORD_CODE_PATTERN`), so stored records
  still load. Free text that names a record refuses hidden characters (`visibleTextPattern`, `lib/projectCode.ts`).
- zod 4 `z.record(enumKey, ...)` needs every key, so a new enum value refuses every stored doc. A stored map uses
  `z.partialRecord` (`Preferences.notifications`).
- A rule over two input fields: chain `.refine(fn, { path, message })` on the `z.object` of `defineCall`. zod 4 keeps a
  `ZodObject`, so the MCP inputSchema still builds, and `invalidInput` lists each path in `details.fields` (`reports.office`).
- A value that Undo must restore holds an empty value, never an absent key (JSON loses an absent key). Example:
  `Project.shape` is an empty text before the first set.
- A field that the contract no longer uses stays in the shape, so old rows parse: `Task.meetingId`, `Meeting.minutesTaskId`,
  `Meeting.minutesById`, and `MeetingDetail.minutesBy` and `minutesTask` (always null). Nothing sets them. The inputs of
  `meetings.create` and `meetings.update` lost `minutesById`: zod strips the key, so an old tab or agent still works.
- `ProjectSummary.viewerCan.post` and `.edit` stay for old screens (see `src/api/CLAUDE.md`, "Office rights").
- A reason code never ends with `_other`: i18next reads such a key as a plural form (`google_link_person`, not
  `google_link_other`).
- `User.avatarUrl` takes picture data (`PICTURE_DATA`) or an https address (`UserAvatarInput`). `userCard()` leaves the
  picture data out, so lists stay small. `User.nameAr` and `Project.nameAr`: an empty value means none.
- Caps of a stored rights list (`MAX_STORED_RIGHTS`, `MAX_OFF_RIGHTS`): see "Add a switch" in `src/api/CLAUDE.md`.

## Plain limits and the first load
- `limits.ts` holds the limits and marks that need no zod (`MAX_FILE_BYTES`, `MAX_ATTACHMENTS`, `MAX_HELPERS`,
  `MAX_PREREQUISITES`, `REACTIONS`, `PICTURE_DATA`, `GROUP_LOG_MAX`, `MAX_PROJECT_VIEWERS` and others). `entities.ts` and
  `server.ts` export them again under the same names.
- A screen file of the first load (the shell, Home, the sign-in gate and what they import) takes a plain limit from
  `limits.ts`, never from `entities.ts` or `server.ts`: those load the zod schemas. The bundle check fails a first load that
  holds `$ZodObject` (`ZOD_MARKER`, `scripts/check-bundles.ts`).
- `permissions.ts` and `store.ts` take no value from the schema files, because `can()` is in the first load
  (`limits.test.ts` checks it). `contract/push.ts` holds the limits and the endpoint rule of browser push, with no zod.
