# Browser push

Madar sends a push to the browsers of its people (owner, 2026-10-08). It is free: the browser API (a service worker and the
push service of the browser). There is no email, no WhatsApp, no SMS and no account with a vendor. It works in Chrome, Edge,
Firefox and Safari on a computer, on Android, and on an iPhone once Madar is on the Home Screen.

The push is EMPTY. The server posts no text and no data, so it needs no message encryption. The service worker
(`public/sw.js`) shows ONE fixed line: title "Madar" and body "You have something new in Madar." (Arabic: "مدار" and
"لديك جديد في مدار."). The line carries no task, project, client or person, like the notice mail. A press on it focuses an open
Madar window, or opens `/`.

## Files
- `vapid.ts`: the ES256 token (RFC 8292) with WebCrypto only, so it runs on Deno Edge Functions and on Workers. No Node API and
  no package. `vapidConfigOf` reads the three secrets. `makeVapidKeys` makes a pair.
- `send.ts`: one push to one endpoint. `sendPush` tells `sent`, `gone` or `refused`, or throws `PushSendError` for a retry.
- `notify.ts`: the producer `pushRows`, the effects `sendPushNotify` and `sendChatPush`, and their SQL texts.
- `chatRule.ts`: the pure rule `planPushes` and its facts. `chatFacts.ts`: the fact readers with their SQL texts, Postgres and SQLite.
- `register.ts`, `effects.ts`: the registration, like `server/mail/register.ts` and `effects.ts`. `deps.ts` imports `effects.ts`.
- The calls (`push.register`, `push.remove`, `push.mine`) are in `src/api/handlers/push.ts`. The record is `PushDevice`.

## Who gets a push
- A new unread notice that does not point to a chat message or a task comment (`isChatItemNotice`) gives a `push.notify` row at
  once (the notices of requests, bugs and meetings too, fbk_022). A new chat message, a new task comment, and a mention or reply notice of one give a `push.chat` row, after the 10-second wait.
  `planPushes` (`chatRule.ts`) decides: a direct chat or a group pushes its members; a project chat pushes the people its message
  names (an @mention or a reply); a person who picked All messages (`ChatRead.notify`) gets every message; a task comment pushes the
  task lead and the maker of an office task, and other people only when named. Never the author or the person an agent writes for;
  never for a reaction, a delete, a quiet line or an Undo; an edit pushes only a person it names for the first time. One row for each
  person for each save: a `push.notify` row wins over a `push.chat` row. The mention switch of Settings does not stop a push that
  names a person.
- Only an active human with at least one device. A person with no device gets no row.
- The switches of the notices (`Preferences.notifications`) already decide whether a notice exists. There is no push switch
  for a kind. The one switch of a person is per device: "Notify me on this device" in Settings.

## The path
1. After the save of a write call, the producer (`pushRows`, registered for every shared write except `PUSH_FREE_CALLS`) reads the
   facts of the save (`chatFacts.ts`: at most five statements on Postgres, in the transaction of the call; the office lists and
   reads by key on SQLite), asks `planPushes`, and writes one outbox row for each person (`push.notify` or `push.chat`). A rollback
   sends nothing. A new notice is a row whose `xmin` is the id of the open transaction (the rule of `NEW_NOTICES_SQL` in the mail
   guide). A new message and a new comment are `SaveResult.messageIds` and `SaveResult.commentIds` (the ids that the save inserted).
   An Undo call (`UNDO_CALLS`) pushes nothing for the comments it brings back.
2. `push.notify` is in `AFTER_ANSWER_KINDS` (`server/core/effects.ts`), so on the hosted functions it runs right after the
   answer, on the chain of the mails of the batch. Without `after` (tests, scripts) it runs before the answer.
3. The 15-minute job writes the same rows after its own save (`jobs/steps/triggers.ts`) and retries a failed row (up to 5 times).
   A `push.chat` row (a chat message, a task comment, or a mention or reply notice of one) waits 10 s after the answer
   (`WAITED_KINDS`). Then `sendChatPush` asks `PUSH_STILL_NEW_SQL` which items the person has not read on any device
   (`chat_reads.lastReadAt`) and which are not deleted, and sends one push only when one is left.
4. The effect `sendPushNotify` reads the devices of the person again from the primary, and posts to each device at once.
   - 201 or 202: sent. The effect sets `lastPushAt` of the device.
   - 404 or 410: the browser dropped the subscription. The effect deletes the device.
   - 429, 5xx, a network error or a timeout (3 s): the effect handles the other devices, then throws `PushSendError`, and the
     outbox tries the row again. A retry posts to every device of the person again; the tag `madar-new` makes the browser show
     one line only.
   - Any other answer (400, 401, 403, 413, a redirect): `refused`. The effect logs a warning with the host and does not retry.
     The device stays.
5. The headers are `Authorization: vapid t=<jwt>, k=<public key>`, `TTL: 3600`, `Urgency: normal` and `Topic: madar`.
   The sender sets no `Content-Length`: a fetch POST with no body sends `Content-Length: 0` by itself. The token has `aud` = the origin of the endpoint, `exp` under 12 hours (11 hours) and `sub` = VAPID_SUBJECT.
   The fetch never follows a redirect.
6. On the office object (exit wave 3), `sendPush` signs the VAPID token in the object and posts through `deps.pushFetch`, the
   network port of the Worker. The Worker posts only to a push service (`postPush`, `server/office/net.ts`). The producer reads
   the new notices from `SaveResult.noticeIds` in place of the `xmin` test, and the effect marks or removes the devices with one
   statement for each endpoint (`PUSH_SENT_LITE`, `PUSH_GONE_LITE`).

## Rules
- The effect is the one effect that writes a State table outside `runCall`: it deletes a gone device and sets `lastPushAt`.
  It touches `push_devices` only (private rows: no event, no `chg`, no signal).
- A device is private to its person. A call reads the own devices only (`server/data/loaders/push.ts`). `push.register` also
  reads the row of the endpoint, because a shared browser moves that row to the new person; it gives nothing back about the other
  person. The save adds no kind for a device (`server/data/save.ts`), so no signal names it. Agents never get a push call: all
  three are on the MCP deny list.
- The server posts only to a push service. `isPushEndpoint` (`src/api/contract/push.ts`) lists the hosts: `fcm.googleapis.com`,
  `updates.push.services.mozilla.com`, `push.services.mozilla.com`, `*.push.apple.com` and `*.notify.windows.com`. The record
  refuses any other address, https only, no login, no port. `sendPush` checks it again. A browser with a new push host needs
  a line in `PUSH_HOSTS`.
- An error text names the host and the status, never the address, the token or a key. The endpoint is a capability of that
  browser.
- At most 10 devices for each person (`PUSH_DEVICES_PER_PERSON`). A new one pushes the oldest out.
- A sign-out removes the device of the browser and unsubscribes the browser (`removeThisDevice`, `src/app/remote/push.ts`), so the
  person who signed out gets no push. Push is on by default (owner, 2026-10-09): the permission stays in the browser, so the next
  sign-in saves the device again for that person, and `push.register` moves the endpoint to them (see `src/CLAUDE.md`).

## Keys and secrets
- Function secrets (`secrets/<env>.env`): `VAPID_PRIVATE_KEY` (raw 32 byte private value, base64url), `VAPID_PUBLIC_KEY` (65 byte
  uncompressed point, base64url) and `VAPID_SUBJECT` (`mailto:madar@vado.sa`). All three or none: with none, push is off and the
  effect logs a warning that names the three variables and sends nothing. With only some, the server refuses to start and names
  the missing ones (`server/core/deps.ts`). `scripts/deploy/secrets.ts` checks the same before it sends them.
- The screens need the public key at build time: `VITE_VAPID_PUBLIC_KEY` in `config/remote.<env>.env`.
- `npx tsx scripts/push/make-vapid.ts <test|production>` makes a pair, appends the three lines to `secrets/<env>.env`, sets the
  public value, and prints the public key only. It refuses to run when a VAPID line exists. A new pair makes every old
  subscription useless: the check at the start of the app (`syncThisDevice`) makes the browser subscribe again with the new key
  when the permission is still granted. Test and production each have a pair of their own (made 2026-10-08).
- After `make-vapid.ts`: run `scripts/deploy/secrets.ts <env>` and deploy the screens, so both sides use the pair.

## Tests
- `vapid.test.ts` (the token, checked with the public key), `send.test.ts` (a stub fetch), `notify.test.ts` (the producer, the SQL
  rules, the effect, the registration). The SQL itself runs on the local database in `server/it/push.it.test.ts`.
- The Docker lock and `test:it` run the integration suite. On 2026-10-08 the SQL and the migration were also run once on an
  in-memory Postgres 18 (pglite, outside the repo), because Docker was off. The local stack runs Postgres 17, so `test:it` stays the proof.
- Not proven on a real push service yet: only the owner's test on the test copy shows a notification on a device.
