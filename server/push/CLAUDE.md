# Browser push

Madar sends an encrypted push line to the browsers of its people. It is free: the browser API (a service worker and the push service of
the browser). There is no email, no WhatsApp, no SMS and no account with a vendor. It works in Chrome, Edge, Firefox and Safari on a
computer, on Android, and on an iPhone once Madar is on the Home Screen.

## The push line
- The push carries a line: a title, a body, a link in Madar, a tag and a language. The words come from the person who gets it, in the
  language of that person (the Arabic name on Arabic screens, `shownName` in `line.ts`). The body stops at `BODY_MAX` (`line.ts`). The code of
  `line.ts` states what a chat, a task comment and a notice put in the title and the body. A press opens that chat, task thread or notice.
- `line.ts` makes the line by reading AS THE PERSON who gets the push, with the read calls of the screens (`session.get`, `notifications.list`,
  `chats.list`, and `comments.list` with `tasks.get` for a task thread with no Inbox row). A chat or a task that the person may not open gives
  no line. The run is `deps.runCall ?? runCall`, as in the job steps. Never build a line from SQL or from the state of another person. The
  bell sentence is one function for the bell and the line (`src/lib/noticeSentence.ts`). The words are `words.ts`.
- `encrypt.ts` encrypts the line for that browser alone (RFC 8291 with aes128gcm, WebCrypto only; the test holds the vector of Appendix A). The
  push service carries bytes it cannot read. The browser gives its keys (`p256dh`, `auth`) at `push.register`.
- A device with no keys, a line that cannot be made (`lineOrNull` logs the error name only, never its text), or keys of a wrong form get the
  EMPTY push. The service worker (`public/sw.js`) then shows ONE fixed line: title "Madar" and body "You have something new in Madar."
  (Arabic: "مدار" and "لديك جديد في مدار."). The worker also shows the fixed line for a line it cannot trust (a missing title or body, a tag
  that does not start with `madar-`, a link that is not a path of this site).
- The start check of the screens (`syncThisDevice`) saves a device again with its keys when the server lists it without them.

## Quiet while Madar is in front (`public/sw.js`)
- When a window of Madar is visible and has the focus (`WindowClient.visibilityState === 'visible'` and `focused`), the worker shows no line.
  A window that is hidden, or visible with no focus, gets the line.
- **WebKit never stays silent.** WebKit (Safari on a Mac, and every browser on an iPhone or iPad) revokes a push subscription when a push
  shows no visible notice. A person would then get no push at all. So `mayStaySilent(userAgent)` is true only for Chromium (`Chrome/`,
  `Chromium/`, so Edge and Samsung Internet too). It is false for `iPhone`, `iPad`, `CriOS`, `FxiOS`, `EdgiOS`, `OPiOS`, Safari, Firefox and
  any engine that is not known. For those the worker calls `showNotification` first, before it asks for the windows. A list of windows that
  cannot be read also shows the line. The wrong answer is always "show the line", never "stay silent".
- A person on Safari or Firefox still gets the line while the chat is open. The person can turn off "Notify me on this device" in Settings.
- The server wait works with this rule: a `push.chat` row waits `CHAT_WAIT_MS` and then skips each person who read the chat (`WAITED_KINDS`,
  see `server/CLAUDE.md`). The worker rule stays for what the wait does not catch.
- Test: `src/app/remote/serviceWorker.test.ts` (user agents, windows in front, hidden, without focus, a failed list of windows).

## Quiet hours
- `isQuiet` (`src/lib/quietHours.ts`, Riyadh time) is the one rule. Outside the work hours of a person there is no push and no email. The bell and
  the Inbox still collect everything. The office sets the default range and a lock: nobody is quiet inside the lock.
- Both effects (`sendPushNotify`, `sendChatPush`) read the work hours in the same statement as the devices (`PUSH_DEVICES_SQL`, `quietFromColumns`
  in `server/core/quiet.ts`), so quiet hours add no round trip. `sendChatPush` asks after the wait and after the still-new test. A quiet
  person gets no post: the effect marks the devices `heldAt` (`PUSH_HOLD_SQL`; a private field of the device row, so no event, no `chg`, no
  signal) and the row ends as done, with no retry.
- The job step `quietEnd` (`jobs/steps/quietEnd.ts`, `held.ts`) runs after `summary`. For each person with a held device who is no longer quiet
  it sends ONE empty push (the fixed line) to each device, then clears `heldAt` (`PUSH_RELEASE_SQL`). It sends nothing when the person has
  nothing unread (`notifications.list` and `chats.list` as the person; a copy for an Admin does not count; a read that fails counts as
  unread) and still clears the mark. A push service that fails keeps the mark of that device, and the step throws so the next run tries again.
- A device that takes any push loses `heldAt` (`PUSH_SENT_SQL`). `push.register` keeps the mark of the same person and drops it when the
  endpoint moves. Postgres and SQLite each have their statements (`PUSH_HOLD_*`, `PUSH_RELEASE_*`, `HELD_PEOPLE_*`).
- `server/it/push.it.test.ts` pins the exact row of `PUSH_DEVICES_SQL`: a new column fails only `test:it`. Tests: `quietPush.test.ts`.

## Files
- `vapid.ts`: the ES256 token (RFC 8292) with WebCrypto only, so it runs on Deno and on Workers. No Node API and no package. `vapidConfigOf`
  reads the three secrets. `makeVapidKeys` makes a pair.
- `send.ts`: one push to one endpoint. `sendPush` tells `sent`, `gone` or `refused`, or throws `PushSendError` for a retry. With `body` it
  posts the encrypted line with `Content-Encoding: aes128gcm`.
- `encrypt.ts`: `encryptPush`. `line.ts`: `noticeLine` and `chatLine`.
- `words.ts`: the words of the line in an i18next instance of its own. It imports only the `inbox`, `notices` and `push` parts of the word
  files BY NAME, to keep the api bundle small (`entries/bundles.test.ts` bounds it). `words.test.ts` checks that its `inbox` words are all the
  `inbox` words of the screens: a track that adds a bell sentence in a new word file adds that file to `words.ts`.
- `notify.ts`: the producer `pushRows`, the effects `sendPushNotify` and `sendChatPush`, and their SQL texts. `PUSH_DEVICES_SQL` reads the
  keys of each device.
- `chatRule.ts`: the pure rule `planPushes` and its facts. `chatFacts.ts`: the fact readers with their SQL texts, Postgres and SQLite.
- `register.ts`, `effects.ts`: the registration, like `server/mail/register.ts`. `deps.ts` imports `effects.ts`.
- The calls (`push.register`, `push.remove`, `push.mine`) are in `src/api/handlers/push.ts`. The record is `PushDevice`.

## Who gets a push
- A new unread notice that does not point to a chat message or a task comment (`isChatItemNotice`) gives a `push.notify` row at once. A new
  chat message, a new task comment, and a mention or reply notice of one give a `push.chat` row, after the wait. `planPushes` decides:
  - a direct chat or a group pushes its members;
  - a project chat pushes the people its message names (an @mention or a reply);
  - a person who picked All messages (`ChatRead.notify`) gets every message;
  - a task comment pushes the task lead and the maker of an office task, and other people only when named. A named person gets the push of an
    office task comment only when the person reads the task: the maker, the lead, a helper, or a holder of `task.officeAll`
    (`PushPerson.officeAll`, from `PUSH_PEOPLE_SQL`);
  - a holder of `chat.project.all` outside the team is no candidate of a project chat unless a message names the person.
- Never the author or the person an agent writes for. Never for a reaction, a delete, a quiet line or an Undo. An edit pushes only a person it
  names for the first time. One row for each person for each save: a `push.notify` row wins over a `push.chat` row. The mention switch of
  Settings does not stop a push that names a person. An @everyone notice (`Notification.everyone`) gives the push like any mention notice and no mail.
- Hidden projects: a person who may not view the project of a message or a comment gets no push, whatever the mention, the reply or the lead
  says, and not through a notice of the item. `planPushes` uses the rule of `mayViewProject` (`server/data/projectAudience.ts`): a holder of
  `project.hidden`, the leader, the team, a chosen person, and a holder of `project.seeAll` when the project is open. A chosen person is in
  `viewerIds`, never in `teamIds`. `PUSH_ITEMS_SQL` reads the team and the access; the SQLite reader reads the office lists. A fact with no
  project reads as everyone. Quiet hours (`held.ts`) send the fixed line with no data and name no project. Leak tests:
  `hiddenProjectPush.test.ts`, `hiddenProjectLeaks.test.ts`.
- A copy for an Admin who picked "Everything" (`Notification.forUserIds`) gives no push: `PUSH_NEW_NOTICES_SQL` and the SQLite reader skip it.
  `planPushes` reads the stored "Notify me" level and the default "named" of a project chat, never the Admin choice. Test: `adminCopies.test.ts`.
- Only an active human with at least one device. The switches of the notices already decide whether a notice exists. There is no push switch
  for a kind. The one switch of a person is per device: "Notify me on this device" in Settings.

## The path
1. After the save of a write call, the producer (`pushRows`, registered for every shared write except `PUSH_FREE_CALLS`) reads the facts of the
   save (`chatFacts.ts`: at most two statements on Postgres, in the transaction of the call; the office lists and reads by key on SQLite),
   asks `planPushes`, and writes one outbox row for each person (`push.notify` or `push.chat`). A rollback sends nothing. A new notice is a row
   whose `xmin` is the id of the open transaction (`NEW_NOTICES_SQL`, see the mail guide). A new message and a new comment are
   `SaveResult.messageIds` and `SaveResult.commentIds`. An Undo call (`UNDO_CALLS`) pushes nothing for the comments it brings back.
2. `push.notify` is in `AFTER_ANSWER_KINDS` (`server/core/effects.ts`), so on the hosted functions it runs right after the answer, on the chain
   of the mails of the batch. Without `after` (tests, scripts) it runs before the answer.
3. The 15-minute job writes the same rows after its own save (`jobs/steps/triggers.ts`) and retries a failed row (up to 5 times). A `push.chat`
   row waits `CHAT_WAIT_MS` (`WAITED_KINDS`). Then `sendChatPush` asks `PUSH_STILL_NEW_SQL` which items the person has not read on any device
   (`chat_reads.lastReadAt`) and which are not deleted, and sends one push only when one is left.
4. The effect `sendPushNotify` reads the devices of the person again from the primary (with their keys). When one has keys, it makes the line
   (`noticeLine`; `sendChatPush` makes `chatLine` for the chat of the newest item that is still new), then posts to each device at once: the
   encrypted line to a device with keys, the empty push to the others.
   - 201 or 202: sent. The effect sets `lastPushAt` of the device.
   - 404 or 410: the browser dropped the subscription. The effect deletes the device.
   - 429, 5xx, a network error or a timeout (3 s): the effect handles the other devices, then throws `PushSendError`, and the outbox tries the
     row again. A retry posts to every device of the person again; the tag `madar-new` makes the browser show one line only.
   - Any other answer (400, 401, 403, 413, a redirect): `refused`. The effect logs a warning with the host and does not retry. The device stays.
5. Headers: `Authorization: vapid t=<jwt>, k=<public key>`, `TTL: 86400` (a phone with no signal for some hours still gets the line), `Urgency: high`
   (Android holds a normal push in Doze) and `Topic: madar` (the push service keeps only the newest unsent push for each device). Set no
   `Content-Length`: a fetch POST with no body sends `Content-Length: 0` by itself. The fetch never follows a redirect. The VAPID token has `aud` =
   the origin of the endpoint, `exp` = `VAPID_LIFETIME_SECONDS` (under 12 hours) and `sub` = `VAPID_SUBJECT`.
   **Apple gets no Topic** (`topicFor` in `send.ts`). Apple answers `400 {"reason":"BadWebPushTopic"}` to any Topic, and the sender logs it only as
   "A push service refused a push" with the host. A `refused` warning for `web.push.apple.com` in the function logs is the first sign of this
   fault; the answer body of Apple names the reason (probe record: proof.md).
6. On the office object, `sendPush` signs the VAPID token in the object and posts through `deps.pushFetch`, the network port of the Worker. The
   Worker posts only to a push service (`postPush`, `server/office/net.ts`). The producer reads the new notices from `SaveResult.noticeIds`
   in place of the `xmin` test, and the effect marks or removes the devices with one statement for each endpoint (`PUSH_SENT_LITE`, `PUSH_GONE_LITE`).

## Rules
- The effect is the one effect that writes a State table outside `runCall`: it deletes a gone device and sets `lastPushAt`. It touches
  `push_devices` only (private rows: no event, no `chg`, no signal).
- A device is private to its person. A call reads the own devices only (`server/data/loaders/push.ts`). `push.register` also reads the row of the
  endpoint, because a shared browser moves that row to the new person; it gives nothing back about the other person. The save adds no kind for a
  device (`server/data/save.ts`), so no signal names it. Agents never get a push call: all three are on the MCP deny list.
- The server posts only to a push service. `isPushEndpoint` (`src/api/contract/push.ts`) lists the hosts (`PUSH_HOSTS`). The record refuses any
  other address, https only, no login, no port. `sendPush` checks it again. A browser with a new push host needs a line in `PUSH_HOSTS`.
- An error text names the host and the status, never the address, the token or a key. The endpoint is a capability of that browser.
- The keys of a browser are as private as its endpoint: no view gives them, the person own included (`PushDeviceView.hasKeys` only says that they
  exist; `pushLeaks.test.ts`). The log never holds the words of a line.
- At most `PUSH_DEVICES_PER_PERSON` devices for each person. A new one pushes the oldest out.
- A sign-out removes the device of the browser and unsubscribes the browser (`removeThisDevice`, `src/app/remote/push.ts`), so the person who
  signed out gets no push.

## Keys and secrets
- Function secrets (`secrets/<env>.env`): `VAPID_PRIVATE_KEY` (raw 32 byte private value, base64url), `VAPID_PUBLIC_KEY` (65 byte uncompressed
  point, base64url) and `VAPID_SUBJECT` (`mailto:madar@vado.sa`). All three or none: with none, push is off and the effect logs a warning that
  names the three variables and sends nothing. With only some, the server refuses to start and names the missing ones (`server/core/deps.ts`).
  `scripts/deploy/secrets.ts` checks the same before it sends them.
- The screens need the public key at build time: `VITE_VAPID_PUBLIC_KEY` in `config/remote.<env>.env`.
- `npx tsx scripts/push/make-vapid.ts <test|production>` makes a pair, appends the three lines to `secrets/<env>.env`, sets the public value, and
  prints the public key only. It refuses to run when a VAPID line exists. A new pair makes every old subscription useless: the start check
  (`syncThisDevice`) makes the browser subscribe again with the new key when the permission is still granted. Test and production each have a pair.
- After `make-vapid.ts`: run `scripts/deploy/secrets.ts <env>` and deploy the screens, so both sides use the pair.

## Tests
- `vapid.test.ts`, `send.test.ts` (a stub fetch), `notify.test.ts` (the producer, the SQL rules, the effect, the registration),
  `encrypt.test.ts`, `line.test.ts` (the real calls on the sample office in memory), `notifyLine.test.ts` (the test decrypts the body as the
  browser does), `words.test.ts`. The SQL itself runs on the local database in `server/it/push.it.test.ts` (`test:it`).
- The phone itself shows the line only on a device check of the owner.
