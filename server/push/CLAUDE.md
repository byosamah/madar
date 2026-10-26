# Browser push

Madar sends a push to the browsers of its people (owner, 2026-10-08). It is free: the browser API (a service worker and the
push service of the browser). There is no email, no WhatsApp, no SMS and no account with a vendor. It works in Chrome, Edge,
Firefox and Safari on a computer, on Android, and on an iPhone once Madar is on the Home Screen.

## The push line (owner, 2026-10-21, "Like WhatsApp"; it replaces the empty push of 2026-10-08)
- The push carries a line: a title, a body, a link in Madar, a tag and a language. A chat gives the name of the sender (a direct
  chat), of the group or of the project as the title, and "Name: first words" as the body (the words alone in a direct chat). A task
  comment gives the task title and "Name: words". A notice gives its project (or "Madar") and the sentence of the bell. The person's
  own language, with the Arabic name on Arabic screens (a person, and a project too, since fbk_062: `shownName` in `line.ts`). The body stops at 180 characters. A press opens that chat, task thread or
  notice. The lock screen shows it: the Settings hint says so.
- `line.ts` makes the line by reading AS THE PERSON who gets the push, with the read calls of the screens (`session.get`,
  `notifications.list`, `chats.list`, and `comments.list` with `tasks.get` for a task thread with no Inbox row): a chat or a task
  that the person may not open gives no line. The run is `deps.runCall ?? runCall`, as in the job steps. The bell sentence is one
  function for the bell and the line (`src/lib/noticeSentence.ts`). The words are `words.ts` (see "Files").
- `encrypt.ts` encrypts the line for that browser alone (RFC 8291 with aes128gcm, WebCrypto only; the test holds the vector of
  Appendix A). The push service carries bytes it cannot read. The browser gives its keys (p256dh, auth) at `push.register`.
- A device with no keys (saved before 2026-10-21), a line that cannot be made (`lineOrNull` logs the error name only, never its
  text), or keys of a wrong form get the EMPTY push, and the service worker (`public/sw.js`) shows ONE fixed line: title "Madar"
  and body "You have something new in Madar." (Arabic: "مدار" and "لديك جديد في مدار."). The worker also shows the fixed line for a
  line it cannot trust (a missing title or body, a tag that does not start with `madar-`, a link that is not a path of this site).
- The start check of the screens (`syncThisDevice`) saves a device again with its keys when the server lists it without them, so each
  phone gets the line after its first open of Madar after the release.
- Every push shows a line, except in front of a window of Madar that has the focus (see "Quiet while Madar is in front").

## Quiet while Madar is in front (owner, 2026-10-23, fbk_028)
Request: "each reply creates a desktop notification, even when the dm window is open". The push has no data, so the worker cannot tell a chat
message from a notice, and the server cannot know that a window is open. The fix is in `public/sw.js`, and it is small:
- When a window of Madar is visible and has the focus (`WindowClient.visibilityState === 'visible'` and `focused`), the worker shows no line. The
  person sees the new thing in the page (the Inbox badge, the bell, the open chat). A window that is hidden, or visible with no focus, gets the line.
- **WebKit never stays silent.** WebKit (Safari on a Mac, and every browser on an iPhone or iPad, whatever its name) needs a visible notice for every
  push. "Violations of the `userVisibleOnly` promise will result in a push subscription being revoked" (WebKit blog, "Meet Web Push", and "Meet
  Declarative Web Push": "if an event handler doesn't show the user visible notification for any reason we revoke its push subscription").
  A person would then get no push at all. So `mayStaySilent(userAgent)` answers true only for Chromium (`Chrome/`, `Chromium/`, so Edge and Samsung
  Internet too), and false for every iPhone and iPad agent (`iPhone`, `iPad`, `CriOS`, `FxiOS`, `EdgiOS`, `OPiOS`), Safari, Firefox and any engine
  that is not known. For those the worker calls `showNotification` first, before it asks for the windows. A list of windows that
  cannot be read also shows the line. The wrong answer is always "show the line", never "stay silent".
- Why Chromium may: Chromium skips its "This site has been updated in the background" notice when a tab of the site is visible
  (`push_messaging_notification_manager.cc`, `IsTabVisible`, named in Chromium issue 549525847); the worker asks for more than that (visible and
  focused). Firefox is left out on purpose: its help page names a quota for pushes with no notice (Mozilla, "Web Push notifications in Firefox")
  but not the rule for a window in front, and a line too many costs nothing while a lost subscription costs every later push.
- A person on Safari or Firefox still gets the line while the chat is open. That is the price of a subscription that stays alive; the person can
  turn off "Notify me on this device" in Settings.
- **The server wait and this rule work together** (the join of 2026-10-20). The chat batch (design item 20) gave the server a wait: a
  `push.chat` row (a chat message, a task comment, or a mention or reply notice of one) waits `CHAT_WAIT_MS` (10 s) after the answer on a chain
  of its own (`WAITED_KINDS` in `core/effects.ts`, `runCall`), so it holds neither the answer nor the mail chain of the batch. After the wait the
  server skips each person who already read that chat or task thread on any device ("Who gets a push"). A `push.notify` row has no wait. The
  worker rule stays for what the wait does not catch: a `push.notify` row, and a chat push for a person who did not read the chat in the 10
  seconds but has a window of Madar in front. The office object runs the waited kinds with no wait (exit-handoff section 10).
- Tests: `src/app/remote/serviceWorker.test.ts` (user agents of Chrome, Edge, Firefox, Android, Safari on a Mac and an iPhone, Chrome and Firefox
  on an iPhone; windows in front, hidden, without focus; a failed list of windows).

## Quiet hours (owner, 2026-10-22, fbk_048)
A person sets work days and one time range (Settings, "Quiet hours"). Outside it Madar is quiet for that person: no push and no email. The bell and
the Inbox still collect everything. The rule is one pure function, `isQuiet` (`src/lib/quietHours.ts`, Riyadh time). The office sets the default range
and the lock (Sunday to Thursday, 8 AM to 5 PM since fbk_049, on by default): nobody is quiet inside the lock.
- Both effects (`sendPushNotify`, `sendChatPush`) read the work hours at send time with the statement of the devices (`readDevices`: `PUSH_DEVICES_SQL` also
  gives the work hours of the person and the office; `quietFromColumns` in `server/core/quiet.ts`), so quiet hours add no round trip. `sendChatPush` asks
  after the 10-second wait and after the still-new test. A quiet person gets no post: the effect marks the devices `heldAt` (`PUSH_HOLD_SQL`, once; a
  private field of the device row, so no event, no chg, no signal) and the row ends as done, with no retry.
- The job step `quietEnd` (`jobs/steps/quietEnd.ts`, `held.ts`) runs after `summary`. For each person with a held device who is no longer quiet it
  sends ONE empty push (the fixed line) to each device, then clears `heldAt` (`PUSH_RELEASE_SQL`). It sends nothing when the person has nothing unread
  any more (`notifications.list` and `chats.list` as the person; a copy for an Admin does not count; a read that fails counts as unread) and still
  clears the mark. A push service that fails keeps the mark of that device, the other people are handled, and the step throws so the next run tries again.
- A device that takes any push loses `heldAt` (`PUSH_SENT_SQL`). `push.register` keeps the mark of the same person and drops it when the endpoint moves.
- Both databases: `PUSH_HOLD_LITE`, `PUSH_RELEASE_LITE`, `HELD_PEOPLE_LITE`, `QUIET_LITE`. Tests: `quietPush.test.ts` (a real SQLite office),
  `server/it/push.it.test.ts` (Postgres, Docker).

## Files
- `vapid.ts`: the ES256 token (RFC 8292) with WebCrypto only, so it runs on Deno Edge Functions and on Workers. No Node API and
  no package. `vapidConfigOf` reads the three secrets. `makeVapidKeys` makes a pair.
- `send.ts`: one push to one endpoint. `sendPush` tells `sent`, `gone` or `refused`, or throws `PushSendError` for a retry. With
  `body` it posts the encrypted line with `Content-Encoding: aes128gcm`.
- `encrypt.ts`: `encryptPush` (RFC 8291). `line.ts`: `noticeLine` and `chatLine`, the line as the person reads it.
- `words.ts`: the words of the line in an i18next instance of its own (as `server/mail/templates/words.ts`). It imports only the
  `inbox`, `notices` and `push` parts of the word files BY NAME, so the bundle keeps those parts only (the api bundle has a bound of
  900,000 characters; 853,323 on 2026-10-22 after hidden projects). `words.test.ts` checks that its `inbox` words are all the `inbox` words of the screens:
  a track that adds a bell sentence in a new word file adds that file to `words.ts`.
- `notify.ts`: the producer `pushRows`, the effects `sendPushNotify` and `sendChatPush` (each takes `LineOptions` for tests), and
  their SQL texts. `PUSH_DEVICES_SQL` reads the keys of each device (`d.doc->'keys'`, null when none).
- `server/it/push.it.test.ts` pins the exact row of `PUSH_DEVICES_SQL`: a new column fails only `test:it` (2026-10-22, the work hours).
- `chatRule.ts`: the pure rule `planPushes` and its facts. `chatFacts.ts`: the fact readers with their SQL texts, Postgres and SQLite.
- `register.ts`, `effects.ts`: the registration, like `server/mail/register.ts` and `effects.ts`. `deps.ts` imports `effects.ts`.
- The calls (`push.register`, `push.remove`, `push.mine`) are in `src/api/handlers/push.ts`. The record is `PushDevice`.

## Who gets a push
- A new unread notice that does not point to a chat message or a task comment (`isChatItemNotice`) gives a `push.notify` row at
  once (the notices of requests, bugs and meetings too, fbk_022). A new chat message, a new task comment, and a mention or reply notice of one give a `push.chat` row, after the 10-second wait.
  `planPushes` (`chatRule.ts`) decides: a direct chat or a group pushes its members; a project chat pushes the people its message
  names (an @mention or a reply); a person who picked All messages (`ChatRead.notify`) gets every message; a task comment pushes the
  task lead and the maker of an office task, and other people only when named. A named person gets the push of an office task comment only when the person reads the
  task: the maker, the lead, a helper, or a holder of `task.officeAll` (`PushPerson.officeAll`, from the roles of the office settings in `PUSH_PEOPLE_SQL`). A holder
  of `chat.project.all` outside the team is no candidate of a project chat: the person gets a push only when a message names the person. Never the author or the person an agent writes for;
  never for a reaction, a delete, a quiet line or an Undo; an edit pushes only a person it names for the first time. One row for each
  person for each save: a `push.notify` row wins over a `push.chat` row. The mention switch of Settings does not stop a push that
  names a person.
- A hidden project (owner, 2026-10-22, wave D3): a person who does not view the project of a message or a comment gets no push, whatever the
  mention, the reply or the lead says, and also not through a notice of the item. `MessageFact.project` and `CommentFact.project` (`ProjectFact`:
  `hidden`, `teamIds`, `viewerIds`) carry the people of the project; `PushPerson.seesAll` and `seesHidden` carry `project.seeAll` and
  `project.hidden` (the Admin holds both). The view rule in `planPushes` is the one of `mayViewProject`: a holder of `project.hidden`, the
  leader, the team, a chosen person, and a holder of `project.seeAll` when the project is open. A chosen person is in `viewerIds`, never in `teamIds`,
  so a project chat pushes the person only when a message names the person. `PUSH_ITEMS_SQL` reads the team and `projects.doc->'access'` for a
  message and for a comment; the SQLite reader reads the office lists (`teamOf`). A fact with no project reads as the old rule, everyone. Quiet
  hours (`held.ts`) send the fixed line with no data and name no project. Tests: `hiddenProjectPush.test.ts`, `hiddenProjectLeaks.test.ts`.
- An @everyone notice (`Notification.everyone`, 2026-10-22) gives the push like any mention notice of a new item: `planPushes` adds the person from the
  notice. It sends no mail. A person in quiet hours gets it later ("Quiet hours" above).
- A copy for an Admin who picked "Everything" (`Notification.forUserIds`, owner 2026-10-23) gives no push: `PUSH_NEW_NOTICES_SQL` and the SQLite
  reader skip it. The choice does not change the push of a chat message either: `planPushes` reads the stored "Notify me" level and the default
  "named" of a project chat, never the Admin choice. Tests: `adminCopies.test.ts`.
- Only an active human with at least one device. A person with no device gets no row.
- The switches of the notices (`Preferences.notifications`) already decide whether a notice exists. There is no push switch
  for a kind. The one switch of a person is per device: "Notify me on this device" in Settings.

## The path
1. After the save of a write call, the producer (`pushRows`, registered for every shared write except `PUSH_FREE_CALLS`) reads the
   facts of the save (`chatFacts.ts`: at most two statements on Postgres, in the transaction of the call: the new notices, then `PUSH_FACTS_SQL`, which reads the items, the people with the device flag and the stored levels in one statement (SV-9, 2026-10-21; it was three); the office lists and
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
4. The effect `sendPushNotify` reads the devices of the person again from the primary (with their keys). When one has keys, it
   makes the line (`noticeLine`; `sendChatPush` makes `chatLine` for the chat of the newest item that is still new), then posts to
   each device at once: the encrypted line to a device with keys, the empty push to the others.
   - 201 or 202: sent. The effect sets `lastPushAt` of the device.
   - 404 or 410: the browser dropped the subscription. The effect deletes the device.
   - 429, 5xx, a network error or a timeout (3 s): the effect handles the other devices, then throws `PushSendError`, and the
     outbox tries the row again. A retry posts to every device of the person again; the tag `madar-new` makes the browser show
     one line only.
   - Any other answer (400, 401, 403, 413, a redirect): `refused`. The effect logs a warning with the host and does not retry.
     The device stays.
5. The headers are `Authorization: vapid t=<jwt>, k=<public key>`, `TTL: 86400`, `Urgency: high` and `Topic: madar` (owner,
   2026-10-20). One day of life: a phone with no signal for some hours still gets the line, and the topic keeps only the newest
   unsent push for each device. High: Android holds a normal push while the phone is in sleep mode (Doze) until it wakes.
   These fixes serve the Home Screen app until the store app comes.
   **Apple gets no Topic** (`topicFor`, 2026-10-21). Apple answers `400 {"reason":"BadWebPushTopic"}` to a push with
   `Topic: madar`, and the sender logs it only as "A push service refused a push" with the host. So no iPhone got a push from
   2026-10-08 to 2026-10-21. A probe on the test copy posted to a real iPhone: with the Topic 400 (also with the old TTL 3600,
   Urgency normal and a 1-hour token), with no Topic 201 (also with Urgency high and TTL 86400). A "refused" warning for
   `web.push.apple.com` in the function logs is the first sign of this kind of fault; the answer body of Apple names the reason.
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
- The keys of a browser (owner, 2026-10-21) are as private as its endpoint: no view gives them, the person's own included
  (`PushDeviceView.hasKeys` only says that they exist; `pushLeaks.test.ts`). The log never holds the words of a line.
- The line of a person comes only from reads AS that person (`line.ts`). Never build a line from SQL or from the state of another
  person: the read calls carry the rules of who may see a chat, an office task or a meeting.
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
- The line (2026-10-21): `encrypt.test.ts` (the vector of RFC 8291, Appendix A), `line.test.ts` (the real calls on the sample office
  in memory: a direct chat, a group, an outsider who gets null, a task comment for a helper, an office task, a notice, Arabic),
  `notifyLine.test.ts` (the effects; the test decrypts the body as the browser does), `words.test.ts`.
- The Docker lock and `test:it` run the integration suite. On 2026-10-08 the SQL and the migration were also run once on an
  in-memory Postgres 18 (pglite, outside the repo), because Docker was off. The local stack runs Postgres 17, so `test:it` stays the proof.
- Proven on a real push service: desktop Chrome (team report fbk_028, 2026-10-19) and, after the Topic fix, Apple on an iPhone
  (201 from web.push.apple.com, 2026-10-21). The phone itself shows the line only on the owner's device check.
