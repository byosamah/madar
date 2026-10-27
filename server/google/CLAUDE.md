# Google Calendar sync

One way sync of the meetings of Madar to the calendar "Madar" of each connected person. A change in Google never comes back.
The calls are in `server/calls/google.ts` (`google.status`, `google.connectStart`, `google.connect`, `google.disconnect`). The screen
part is in `src/api/CLAUDE.md`. The four calls are on the MCP deny list: an agent cannot connect, disconnect or read a connection.

## Files
- `api.ts`: the Google calls. `keys.ts`: the seal of the tokens. `state.ts`: the signed state with the PKCE verifier. `store.ts`: the three
  tables. `rows.ts`: the outbox producers. `sync.ts`: the effects. `register.ts`: the registration. `callback.ts`: the redirect route.
- `Config.google`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MADAR_GOOGLE_KEY`. All three or none (`keys.ts`): with some, the server
  refuses to start and names the absent ones.
- The scope is only `calendar.app.created` (`GOOGLE_SCOPE`): Madar makes its own calendar and writes only there.
- `GET /google/callback` has no sign-in, reads no database and writes nothing. It checks the signed state and answers 302 to
  `<APP_URL>/settings#google=<word>` with `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. On the office path it
  answers `#google=not_ready` and calls no object. The Pages forwarder passes the query and the 302 as they are.

## Timeouts
- A Google call has the 3 s limit of `server/CLAUDE.md` (`GOOGLE_TIMEOUT_MS`). The one exception is `google.connect`: its calls share a
  budget (`GOOGLE_CONNECT_BUDGET_MS`, at most `GOOGLE_CONNECT_CALL_MS` for one call), because the person waits on the screen. The
  budget and the 3 s revoke of a failure stay under the 20 s of the screen.
- A connect that a Google step ends writes one warn line, "A Google Calendar connect failed.", with `userId`, `step` (`token`,
  `calendar_read`, `calendar_make`), `code` and `status`. The answer to the person does not change.

## One calendar for each person
- The scope reaches every calendar that Madar made, but it cannot list calendars (`users/me/calendarList` gives 403). So Madar remembers
  the calendar id in `google_calendars`, one row for each person. A connect that gets an id upserts the row in the transaction that
  inserts the connection (`rememberCalendar`).
- Before it makes a calendar, `google.connect` reads the row and asks Google for that calendar with the new access token (`getCalendar`).
  200: use it, and write one `gcal.tidy { userId }` row after the sync rows. 404 or 410: make a new calendar and update the row. Any other
  answer (timeout, network error, 5xx, 429, 401, 403) ends the connect with `google_unreachable`, takes the new grant back and makes no
  calendar.
- A disconnect keeps the row on purpose. `users.remove` deletes it in its transaction (`revokeRowsOf`). A person who connects with another
  Google account gets 404 for the old id and a new calendar.

## The producers (`rows.ts`)
- After the save of the calls in `GCAL_CALLS` (`sync.ts`), `gcalRows` writes one `gcal.sync { userId, meetingId }` for each connected
  organizer or attendee and for each person who has a Google event for a touched meeting. It reads `SaveResult.meetingIds` (set by
  `data/save.ts`) and asks the database only when the save touched a meeting. The producers run in the transaction of the call.
- `users.remove` (`revokeRowsOf`) sets the live connection to `revoking` (`startRevoking`), deletes the `google_events` rows of the person
  and writes one `gcal.revoke { connectionId }`. A revoke that fails leaves no live token of a removed person. A person who is only
  turned off keeps the connection.
- Hidden projects: a meeting of a project syncs only for a person who views the project. `gcal.sync` asks `viewsProject` (`store.ts`,
  the rule `mayViewProject`, server/data/projectAudience.ts) and takes the Google event away from a person who does not (state `deleted`).
  A save that touches a project that not every active person views (`SaveResult.hiddenProjects`) names its scheduled meetings
  (`meetingIdsOfProjects`). A role change (`GCAL_VIEW_CALLS`: `roles.update`, `roles.delete`, `users.update`) queues one `gcal.sync` for each
  Google event row of a project meeting (`gcalViewRows`), so a person who lost the view loses the event. Leak test: `hiddenProject.test.ts`.

## The effects (`sync.ts`)
- They run after the answer (`AFTER_ANSWER_KINDS`) and write only `google_connections` and `google_events`, which are server-only rows
  (as the mail effects write `mail_log`): no event, no signal, no State table. `gcal.sync` reads again when it runs.
- The event id is the hex of `madar:<meeting id>` (`eventIdOf`). The body has the title, the place, the start, the end and the status
  only (`eventBodyOf`). The access token lives in memory for the life of the isolate, until 60 seconds before it ends. A 401 drops it and
  tries once more.
- Errors: `grant_gone`, a seal that does not open, or a deleted calendar (404 on an insert) ends the connection (state `broken`, token
  deleted, event rows gone). A timeout, a network error, a 5xx or a rate limit sets `not_synced` and throws, so the outbox tries again.
  Any other refusal sets `not_synced` with `last_error` `refused` and does not retry.
- An error text, a log line and an outbox error hold the code and the ids, never a token, a code, a title or a Google answer
  (`leaks.test.ts` proves it).
- `gcal.revoke` takes the refresh token back at Google (a 400 counts as done) and deletes the row. A row that a new connect replaced
  (`replaced: true`) makes no call: its grant is the grant of the new row. The cleanup job step deletes every `revoking` row after one day.
- The connect backfills the next `BACKFILL_DAYS` of meetings, at most `BACKFILL_MAX`. On the Worker a long chain can stop part way (about
  30 s after the answer). The 15-minute job retries the rest.
- `gcal.tidy` (`tidyOne`) runs after the backfill rows of a connect that reused a calendar, because old events of Madar stay in it. It lists
  the events from now on, then reads its keep set (after the list, so an event that sync writes meanwhile is never stale): the backfill
  meetings and the ids in `google_events`. It deletes every other event whose id starts with `MADAR_EVENT_PREFIX`. It never deletes an
  event without the prefix and writes no row. A revoked grant, a 401 after a new token, a bad seal, a gone calendar or a refusal ends it
  quietly. A timeout, a network error, a 5xx or a 429 throws, and the outbox tries again.

## Tests
- `fakeGoogle.ts` stands in for the token address, the revoke address and the Calendar API, behind `Deps.googleFetch`. No test reaches
  Google. `testOffice.ts` is the sample office on node:sqlite. `server/it/google.it.test.ts` runs the SQL on Postgres.
