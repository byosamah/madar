# A better chat, with lessons from Campfire: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the 23 items of the approved chat design (owner, 2026-10-19): calm reading, one message menu with Reply, edit, delete and reactions, instant send, drop and paste, message search, open at one message, and the new push, "Notify me", "Waits for your reply" and Admin count rules.

**Architecture:** One shared base first (contract fields, views, the naming helpers, the delete filter on every read path, the notice pointer, the reply on the server, and a pure split of `Thread.tsx`). Then four tracks in parallel, each in its own worktree: read (screens of reading and files), msg (the message actions), find (search and open at one message), notify (push, levels, waits, Admin count). A last wave does the three tasks that need two tracks at once.

**Tech Stack:** React + Vite + Tailwind v4 screens; zod contract in `src/api`; Hono server on Supabase Edge Functions (Postgres, Realtime, Storage) and the paused SQLite office path; Web Push; MCP at `/mcp`; Vitest (jsdom, server), Playwright for the deploy suite.

**Spec:** `docs/superpowers/specs/2026-10-19-madar-chat-campfire-design.md` (approved 2026-10-19). The look: `docs/superpowers/specs/2026-10-19-madar-chat-campfire-mockup.html` (the design wins where they differ). Study notes: `docs/superpowers/real-build/chat-campfire/`.

## Global Constraints

- Free plans only. No new vendor, no paid plan. The push stays one fixed line with no data (2026-10-08).
- Every write goes through `runCall`; handlers stay synchronous and pure; every shared call works in the prototype fake and on the server; contract changes are additive.
- Every new call follows the whole new-call checklist of `src/api/CLAUDE.md`. The pinned call counts are set by running the tests and reading the real number, never by adding deltas.
- MCP in the same commit as each change: `server/mcp/tools.ts`, `TOOL_DOCS`, `INSTRUCTIONS` when a rule changes. New writes for edit, delete and "Notify me" go on the deny list; `reactions.toggle` stays there. `search.query` finds for an agent what its person may open; chat files stay closed to agents.
- Every visible word: English (STE, no em-dash, no -ing verb form in a label) and Arabic (Thmanyah style), in the track's own words file `src/i18n/real/<chatread|chatmsg|chatfind|chatnotify>.{en,ar}.json`.
- What's new ids (day `2026-10-23`): read `-22` and `-23`, msg `-30`, find `-40`, notify `-50` and `-51`.
- Schema: only track find changes it (`LITE_SCHEMA_VERSION = 5`, migration `20261020000100_message_search.sql`). A later need takes version 6 and a higher migration number.
- Keep `test:lite` and `test:office` green. Rows pins move only with a reason in `docs/superpowers/real-build/proof.md`.
- Leak tests from each builder: an outsider on every read path, the error texts (`not_found`, never `forbidden`, for a hidden chat), and the Realtime signals (nameless office signal for private kinds, INT-16).
- Screens: tokens only, logical sides only, `natural-side` for chat text, names in `<bdi>`, 44 px press areas, nothing under 12 px, navy only on the main button, no face stacks, red only for Late and errors. Each screen task has jsdom tests in English and in Arabic (`dir="rtl"`).
- Commits: Simplified Technical English, no em-dash, no `Co-Authored-By` line, no `Claude-Session` line.
- No production change before Friday 2026-10-23, and only the owner deploys production.

## Review Focus

The five inputs a person will meet that the design does not name, most likely first. Each has its test in the owning task.

1. The change signal comes before the answer of a send, or a person sends the same words twice fast: the log shows each message once. (B14: "drops the faded copy when the saved message comes before the answer", "matches two same words one to one".)
2. A person reads the chat on another device, or the author deletes the message, inside the 10-second wait: no push and no mention mail. (E3: "skips a chat that the person read after the message", "skips a deleted message and a comment that is gone"; E5.)
3. A chat opens from a stale cached answer: the New line sits at the first message that was unread at the open, not at an old place. (A4: "waits for a fresh answer, then keeps the first one".)
4. A search of only one- or two-letter words, a typed `%` or `_`, or an Arabic word in another letter form: no full scan, no wildcard, and a match across forms. (D6: `search.query 'ri ab'` gives `messages: []`; D2: the escaped LIKE case; D1: the Arabic fold.)
5. An outsider opens, edits, deletes, reacts to, searches or replies into a chat that they may not open: the answer equals the one for an id that was never made, with no text of that chat. (D4: chatNotFound.test.ts; B6, B8, B9, B10 outsider tests.)

## Build order

| Wave | Who | Tasks | Where |
| --- | --- | --- | --- |
| 1 | one Sonnet builder | B1 to B7 (the base) | `~/dev/madar-rb/chat-campfire`, branch `rb/chat-campfire` |
| 2 | four Sonnet builders in parallel | read A1 to A12; msg B8 to B14 and B17; find D1 to D12; notify E1 to E10 | `~/dev/madar-rb/chat-<track>`, branch `rb/chat-<track>`, each from `rb/chat-campfire` after wave 1 |
| join | Opus merge lead | merge read, msg, find, notify into `rb/chat-campfire`, in that order; typecheck and the touched tests after each | `~/dev/madar-rb/chat-campfire` |
| 3 | one Sonnet builder | B15, B16, D13 (they need two tracks) | `~/dev/madar-rb/chat-campfire` |
| gate | Opus merge lead | typecheck, `npm test`, `npm run build`, `build:server`, `build:remote -- test`, `test:db`, `test:it`, `test:mcp`, `test:lite`, `test:office`, the prototype smoke, screenshots EN and AR, light and dark, 390 px and a computer; then the test copy | `~/dev/madar-rb/chat-campfire` |

Builders run only the type check and the tests of the files they touch (`npx vitest run <files> --no-file-parallelism --testTimeout=60000`). The full suites run once, at the gate. Tests marked "(merge lead runs)" need Docker.

## Agreements between the tracks

- `MessageBubble.tsx`: track read (A1) makes the side spot `<div data-part="side">` beside the bubble, the `group` class and `data-message-id`. Track msg (B11) puts `MessageTools` (the "..." button) inside that side spot. A msg builder that works before read is merged makes the same element with the same attribute, and the merge keeps one.
- `ConversationPane.tsx`, the ChatPane read effect: read (A6) makes it `visible && unread > 0`; notify (E10) adds `behind`. The merged form is `visible && (unread > 0 || behind)`.
- `src/components/Menu.tsx`: msg adds the optional `head` prop; notify adds the optional `checked`, `heading` and `note` fields of a menu item. Both stay.
- `server/mcp/docs.ts`: msg owns the docs of `chats.messages` (it leaves room for find's `around` line), `chats.send` and the comments; find owns `search.query`, `chats.openDirect` and `projects.get`, and adds its `around` sentence; notify owns `chats.waiting` and `chats.list`.
- Pinned counts (calls, tools, read kinds) move in every track: the merge lead sets the final numbers by running the tests.

---

## Track msg

**Track scope.** Track msg builds two parts. Part one is the shared base (wave 1, tasks B1 to B7, one builder, merged before
every other track): the new contract fields and views, the pure helpers of `src/api/chatNaming.ts`, the server fill of the views in
`chats.messages` and `comments.list`, the reply on the server (`chats.send` and `comments.create` take `replyToId`), a deleted message
that leaves every read path, the notice writer that stores `messageId` and `reply`, their `TOOL_DOCS`, and the pure split of
`Thread.tsx`. Part two (wave 2, tasks B8 to B17) builds design items 6, 9, 10, 11, 12 and 13: the message menu and the phone sheet with
Copy text (9), Reply with its strips and its bell line (10), edit and delete of a chat message with Undo and the Up key (11), reactions
on chat messages (12), instant send with "Not sent" and "Send again" (13), and one comment look in the Inbox task thread and the task
panel (6). Words go into `src/i18n/real/chatmsg.en.json` and `src/i18n/real/chatmsg.ar.json` only (`src/i18n/CLAUDE.md`, "A task
adds new words only to its own track files").

**Order and needs.**
- Wave 1 (the base): B1, B2, B3, B4, B5, B6, B7, in this order. The other tracks rebase on the base after its merge.
- Wave 2: B8 to B14 and B17 need the base only. B15 needs track read's focus task (MessageLog `focusId` and `onFocused`). B16
  needs track read's run task (`src/features/inbox/runs.ts` and the `runStart` prop of `MessageBubble`). Do B15 and B16 last, after
  `git rebase main` once track read is on main. If track read is not on main when B17 is done, stop and write "B15 and B16 wait for
  track read" in the report.

**What the other tracks take from this track (beyond the fixed base names).**
- `LIVE` (`server/data/loaders/steps.ts`, B3): the loader condition of a live message. Search (find) and the push check (notify) use it
  with `isLiveMessage`, so a deleted message is never found and never pushed.
- `firstLineOf` (`src/lib/text.ts`, B2): the one first line of a message, for a search hit or a strip.
- `Notification.messageId` on every new mention notice of a message or a comment, and `reply: true` on a notice of a reply (B4, B6):
  find builds the notice link from it; notify gives the reply notice the same wait as a mention notice.
- `requireMessage` (`src/api/handlers/chats.ts`, B8): `not_found` for a message of a chat the person may not open.
- `Message.reactions` (B10): notify reads a 👍 or ✅ of the person on the message that waits as an answer (design item 22).
- `BubbleActionsContext` (`src/features/inbox/bubbleActions.ts`, B11): the handlers of a bubble reach `MessageBubble` through it, so
  no track adds a handler prop to `MessageLog`. `ChatPane` keeps `focusId` state (B15) that find's route parameter also sets.

**Rules for every task of this track.**
- Run the tests of a task with `npx vitest run <files> --no-file-parallelism --testTimeout=60000`, then `npm run typecheck`. The full
  suite runs once, at the end of the wave (owner rule of 2026-10-07).
- Tests marked "(merge lead runs)" need Docker: `test:db` (the shadow run of each new handler test), `test:it`
  (`server/it/readIndexes.it.test.ts`), `test:lite` and `test:office` (the rows pins), `test:mcp` conformance.
- A commit message is Simplified Technical English, with no em-dash, no `Co-Authored-By` line and no `Claude-Session` line.
- Every write runs in `runCall`, and a handler stays synchronous and pure (`src/api/CLAUDE.md`, Rules). Every new field is optional
  or has a default, so older rows and answers parse (`src/api/CLAUDE.md`, "A contract change is additive"). The records are jsonb docs:
  no migration and no `STATE_VERSION` step (the precedent of `State.pushDevices`, `src/api/CLAUDE.md`, "Browser push devices").
- MCP changes go into the commit of the change (root `CLAUDE.md`, "Every feature change updates the MCP side in the same commit").
  `server/mcp/tools.test.ts` keeps each description between 40 and 600 characters.
- Screens: tokens only, logical sides only, `natural-side` for chat text, names in `<bdi>`, 44 px press areas, nothing under 12 px,
  navy only on the Send button, no face stacks, red only for Late and errors, icons through `AnimatedIcon` (`src/CLAUDE.md`, "Design
  rules"). Each screen task ends with jsdom tests in English and in Arabic (`dir="rtl"`).

### Files

Wave 1 (base):
- Modify `src/api/contract/limits.ts`: `NOTIFY_LEVELS` (a plain value, so a screen of the Inbox chunk reads it with no zod).
- Modify `src/api/contract/entities.ts`: the new optional fields of `Message`, `Comment`, `ChatRead` and `Notification`; `NotifyLevel`;
  the export of `NOTIFY_LEVELS` again.
- Modify `src/api/contract/views.ts`: `ReplyRef`; the new fields of `MessageView`, `CommentView` and `ChatThread`.
- Create `src/api/chatNaming.ts`: `isLiveMessage`, `namesPerson`, `notifyLevelOf`, `replyRefOf`.
- Modify `src/lib/text.ts`: `firstLineOf` (the first line of a body, for the reply strip and `ReplyRef.firstLine`).
- Modify `src/api/chatState.ts`: `messagesOf` and `unreadIn` read live messages only.
- Modify `src/api/handlers/chats.ts`: the view fill, `readUpTo`, `notify`, the reply of `chats.send`, the archive that keeps `notify`.
- Modify `src/api/handlers/content.ts`, `src/api/handlers/shared.ts`, `src/api/views.ts`: the reply of `comments.create`, the view fill.
- Modify `src/api/notify.ts`: `NotifyInput.messageId` and `NotifyInput.reply`.
- Modify `server/data/loaders/steps.ts`, `server/data/loaders/chat.ts`, `server/data/loaders/task.ts`: the live filter and the loads of
  the reply targets.
- Modify `server/mcp/docs.ts`: `TOOL_DOCS` of `chats.messages`, `chats.send`, `comments.list`, `comments.create`; the Messages line of
  `INSTRUCTIONS`.
- Create `src/features/inbox/MessageLog.tsx`, `src/features/inbox/MessageBubble.tsx`, `src/features/inbox/Composer.tsx`; modify
  `src/features/inbox/Thread.tsx` (the pure split).
- Create `src/i18n/real/chatmsg.en.json`, `src/i18n/real/chatmsg.ar.json`.

Wave 2:
- Modify `src/api/handlers/chats.ts`: `chats.editMessage`, `chats.deleteMessage`, `requireMessage`, `toggleMessageReaction`.
- Modify `src/api/handlers/content.ts`: `reactions.toggle` takes `messageId`.
- Modify `server/data/loaders/chat.ts`, `server/data/loaders/index.ts`, `server/data/loaders/sweep.ts`, `server/core/everyCall.ts`,
  `server/mcp/tools.ts`, `server/mcp/docs.ts`, `src/app/writeKinds.ts`, and the pinned call counts.
- Create `src/features/inbox/bubbleActions.ts`: the context of the bubble handlers (the panes give it; `MessageBubble` reads it, so no
  handler goes through `MessageLog`, which track read owns).
- Create `src/features/inbox/MessageMenu.tsx`: the "..." menu and the phone sheet. `src/features/inbox/ReactionPills.tsx`: the pills.
  `src/features/inbox/longPress.ts`: the long press of a finger. `src/features/inbox/ReplyStrip.tsx`: the strip of the box and the
  strip of a bubble. `src/features/inbox/MessageEditForm.tsx`: the edit in place. `src/features/inbox/deleteMessage.ts`: delete with
  Undo. `src/features/inbox/outbox.ts`: instant send.
- Modify `src/components/Menu.tsx`: an optional `head` above the items.
- Modify `src/app/runtime.tsx`: `useAction` also returns `retry`.
- Modify `src/features/inbox/MessageBubble.tsx`, `src/features/inbox/Composer.tsx`, `src/features/inbox/ConversationPane.tsx`,
  `src/features/inbox/earlier.ts`.
- Create `src/features/comments/TaskComments.tsx`; modify `src/features/comments/CommentThread.tsx` (task comments take the chat look;
  post comments stay).
- Modify `src/features/notifications/NotificationsScreen.tsx`: the line "X replied to you".
- Modify `src/whatsNew/entries.ts`, `src/i18n/real/whatsnew.en.json`, `src/i18n/real/whatsnew.ar.json`.

---

## Wave 1: the shared base (B1 to B7)

### Task B1: The contract fields and views of reply, reactions, delete and Notify me

**Files:** Modify `src/api/contract/limits.ts`, `src/api/contract/entities.ts` (Message near line 648, ChatRead near line 669, Comment
near line 593, Notification near line 780), `src/api/contract/views.ts` (MessageView line 238, CommentView line 189, ChatThread line
259). Test: Create `src/api/contract/chatFields.test.ts`.

**Interfaces.** Consumes: `MessageId`, `CommentId`, `UserId`, `Stamp`, `Reaction`, `UserCard`. Produces (exact):
- `limits.ts`: `export const NOTIFY_LEVELS = ['all', 'named'] as const;`
- `entities.ts`: `export { NOTIFY_LEVELS }`; `export const NotifyLevel = z.enum(NOTIFY_LEVELS); export type NotifyLevel`.
  `Message` gets `replyToId: MessageId.optional()`, `reactions: z.record(Reaction, z.array(UserId)).optional()` (a written record holds
  all three keys, from `emptyReactions()`), `deletedAt: Stamp.optional()` (set = deleted; Undo removes the key).
  `Comment` gets `replyToId: CommentId.optional()`. `ChatRead` gets `notify: NotifyLevel.optional()`.
  `Notification` gets `messageId: z.string().min(1).max(40).optional()` and `reply: z.literal(true).optional()`.
- `views.ts`: `export const ReplyRef = z.object({ id: z.string(), author: UserCard, firstLine: z.string().max(200), deleted: z.boolean() });
  export type ReplyRef`. `MessageView` and `CommentView` get `replyTo: ReplyRef.nullable().default(null)` and
  `namesMe: z.boolean().default(false)`. `ChatThread` gets `readUpTo: Stamp.nullable().default(null)` and
  `notify: z.enum(NOTIFY_LEVELS).default('all')`.

- [ ] **Step 1: Write the failing test** in `src/api/contract/chatFields.test.ts`, with an old message, comment, read mark and notice
  as they are stored today (copy the shapes of `src/test/factories.ts`):
  ```ts
  it('loads a message, a comment, a read mark and a notice saved before the new fields', () => {
    expect(Message.parse(OLD_MESSAGE)).toEqual(OLD_MESSAGE);
    expect(Comment.parse(OLD_COMMENT)).toEqual(OLD_COMMENT);
    expect(ChatRead.parse(OLD_READ)).toEqual(OLD_READ);
    expect(Notification.parse(OLD_NOTICE)).toEqual(OLD_NOTICE);
  });
  it('takes the new fields and refuses wrong values', () => {
    const msg = Message.parse({ ...OLD_MESSAGE, replyToId: 'msg_002', reactions: { '👍': ['usr_003'], '✅': [], '👀': [] }, deletedAt: STAMP });
    expect(msg).toMatchObject({ replyToId: 'msg_002', deletedAt: STAMP });
    expect(Comment.parse({ ...OLD_COMMENT, replyToId: 'cmt_002' }).replyToId).toBe('cmt_002');
    expect(ChatRead.parse({ ...OLD_READ, notify: 'named' }).notify).toBe('named');
    expect(() => ChatRead.parse({ ...OLD_READ, notify: 'none' })).toThrow();
    expect(Notification.parse({ ...OLD_NOTICE, messageId: 'msg_002', reply: true })).toMatchObject({ messageId: 'msg_002', reply: true });
    expect(() => Notification.parse({ ...OLD_NOTICE, reply: false })).toThrow();
    expect(NOTIFY_LEVELS).toEqual(['all', 'named']);
  });
  it('parses an older answer with the defaults', () => {
    expect(MessageView.parse(OLD_MESSAGE_VIEW)).toMatchObject({ replyTo: null, namesMe: false });
    expect(CommentView.parse(OLD_COMMENT_VIEW)).toMatchObject({ replyTo: null, namesMe: false });
    expect(ChatThread.parse(OLD_THREAD)).toMatchObject({ readUpTo: null, notify: 'all' });
  });
  it('refuses a reply first line over 200 characters', () => {
    expect(() => ReplyRef.parse({ id: 'msg_001', author: CARD, firstLine: 'x'.repeat(201), deleted: false })).toThrow();
  });
  ```
- [ ] **Step 2: Run it:** `npx vitest run src/api/contract/chatFields.test.ts --no-file-parallelism --testTimeout=60000`. Expected:
  FAIL, `NOTIFY_LEVELS` and `ReplyRef` are not exported.
- [ ] **Step 3: Implement** the fields above, with one doc comment on each field that says what it means and that it is optional so
  older rows load. Put `NOTIFY_LEVELS` in `limits.ts` beside `REACTIONS` and export it again from `entities.ts`, as `REACTIONS` is.
- [ ] **Step 4: Run it** again, then `npm run typecheck`. Expected: PASS. Run `npx vitest run src/api server/mcp --no-file-parallelism
  --testTimeout=60000`; a test that compares a whole `MessageView`, `CommentView` or `ChatThread` with `toEqual` now gets the default
  fields: add `replyTo: null, namesMe: false` (or `readUpTo`, `notify`) to its expected value.
- [ ] **Step 5: Commit:** `git add src/api/contract/limits.ts src/api/contract/entities.ts src/api/contract/views.ts src/api/contract/chatFields.test.ts`
  (plus any test file of Step 4); message: "Chats: the contract fields of reply, reactions, delete and Notify me (base B1)".

### Task B2: The naming helpers and the first line of a message

**Files:** Create `src/api/chatNaming.ts`; Modify `src/lib/text.ts` (beside `excerptOf`, line 38), `src/api/handlers/chats.ts`
(`chatsArchive`, line 332). Test: Create `src/api/chatNaming.test.ts`.

**Interfaces.** Consumes: B1. `principalOf` (`permissions.ts`), `chatReadKey` (`rowKeys.ts`), `cardOf` (`views.ts`),
`mentionedUserIds`, `plainText`, `excerptOf` (`lib/text.ts`). Produces (exact):
- `src/lib/text.ts`: `export function firstLineOf(body: string): string` = `excerptOf(firstLineOfPlainText, 100)`: the first line of
  `plainText(body)`, runs of white space as one space, at most 100 code points with "…". 100 code points keep it under the 200
  characters of `ReplyRef.firstLine`, also with emoji.
- `src/api/chatNaming.ts`:
  - `isLiveMessage(m: Message): boolean`: true when `m.deletedAt` is undefined.
  - `namesPerson(state: State, item: Message | Comment, personId: string): boolean`: false when the item's principal is the person (a
    message: `actingForId`; a comment: `principalOf(state, authorId)`). A message: `mentions.includes(personId)`. A comment:
    `mentionedUserIds(body).includes(personId)`, or `replyToId` names a comment in the state whose `principalOf(authorId)` is the person.
  - `notifyLevelOf(state: State, conversation: Conversation, userId: string): NotifyLevel`: the stored `ChatRead.notify` of
    `chatReadKey(conversation.id, userId)`, else `'named'` for a project chat and `'all'` for a direct chat or a group.
  - `replyRefOf(state: State, item: Message | Comment, viewerId: string): ReplyRef | null`: null with no `replyToId`. A live old item
    of the same chat (a message: same `conversationId`) or the same task (a comment: same `targetType` and `targetId`) gives
    `{ id, author: cardOf(state, principal of the old item), firstLine: firstLineOf(old.body), deleted: false }`. A deleted, missing or
    unreadable old item (another chat, another task) gives `{ id: item.replyToId, author: cardOf(state, item.authorId), firstLine: '',
    deleted: true }`: no text and no name of the other place. A message is told from a comment by `'conversationId' in item`.
  - `chatNaming.ts` imports `cardOf` from `./views`, and `views.ts` imports from `chatNaming.ts` in B5: the cycle holds only
    functions, and nothing runs at load.
- `chats.archive` keeps every other field of the read mark (`notify` too): it writes `{ ...read, conversationId, userId, lastReadAt,
  archivedAt }`.

- [ ] **Step 1: Write the failing test** in `src/api/chatNaming.test.ts` on `makeWorld()` (`src/test/factories.ts`: usr_002 Faisal
  leads prj_001, usr_003 Sara is on its team, usr_004 Omar is outside, usr_005 is the agent of Sara). Plant a project chat of prj_001, a
  direct chat Faisal and Sara, a group of Omar alone with Faisal, messages and comments.
  ```ts
  it('reads a deleted message as not live', () => {
    expect(isLiveMessage(msg({}))).toBe(true);
    expect(isLiveMessage(msg({ deletedAt: STAMP }))).toBe(false);
  });
  it('names a person by a mention or a reply, and never the author', () => {
    expect(namesPerson(state, msg({ mentions: ['usr_003'] }), 'usr_003')).toBe(true);
    expect(namesPerson(state, msg({ actingForId: 'usr_003', mentions: ['usr_003'] }), 'usr_003')).toBe(false);
    expect(namesPerson(state, comment({ body: '@[Sara Team](usr_003) look' }), 'usr_003')).toBe(true);
    expect(namesPerson(state, comment({ authorId: 'usr_002', replyToId: SARA_COMMENT }), 'usr_003')).toBe(true);
    expect(namesPerson(state, comment({ authorId: 'usr_003', replyToId: SARA_COMMENT }), 'usr_003')).toBe(false);
    expect(namesPerson(state, comment({ authorId: 'usr_002', replyToId: 'cmt_999' }), 'usr_003')).toBe(false);
  });
  it('gives the Notify me level of a person and a chat', () => {
    expect(notifyLevelOf(state, projectChat, 'usr_003')).toBe('named');
    expect(notifyLevelOf(state, directChat, 'usr_003')).toBe('all');
    state.chatReads[chatReadKey(projectChat.id, 'usr_003')] = { conversationId: projectChat.id, userId: 'usr_003', lastReadAt: STAMP, notify: 'all' };
    expect(notifyLevelOf(state, projectChat, 'usr_003')).toBe('all');
  });
  it('gives the reply link of a message, and no text of a deleted or foreign message', () => {
    expect(replyRefOf(state, msg({}), 'usr_003')).toBeNull();
    expect(replyRefOf(state, msg({ replyToId: OLD }), 'usr_003')).toEqual({ id: OLD, author: cardOf(state, 'usr_002'), firstLine: '@Sara Team the east wall needs a new footing', deleted: false });
    state.messages[OLD].deletedAt = STAMP;
    expect(replyRefOf(state, msg({ replyToId: OLD }), 'usr_003')).toMatchObject({ id: OLD, firstLine: '', deleted: true });
    const foreign = replyRefOf(state, msg({ replyToId: GROUP_SECRET_ID }), 'usr_003');
    expect(foreign).toMatchObject({ deleted: true, firstLine: '' });
    expect(JSON.stringify(foreign)).not.toContain('Secret 7731');
  });
  it('gives the reply link of a comment of the same task only', () => { /* same task: deleted false; comment of tsk_002: deleted true, firstLine '' */ });
  it('cuts the first line of a body', () => {
    expect(firstLineOf('@[Sara Team](usr_003) the east wall\nsecond line')).toBe('@Sara Team the east wall');
    expect(firstLineOf('a '.repeat(300)).length).toBeLessThanOrEqual(200);
    expect(firstLineOf('👍'.repeat(150)).length).toBeLessThanOrEqual(200);
  });
  it('keeps the Notify me choice when a person archives a chat', async () => {
    // usr_003 stores notify 'named' on the direct chat, then calls chats.archive { archived: true } through testApi(calls).
    expect(t.store.state.chatReads[chatReadKey(directChat.id, 'usr_003')].notify).toBe('named');
  });
  ```
  The old message `OLD` is by Faisal (`actingForId: 'usr_002'`) with the body `'@[Sara Team](usr_003) the east wall needs a new footing\nCan you approve?'`.
- [ ] **Step 2: Run it:** `npx vitest run src/api/chatNaming.test.ts --no-file-parallelism --testTimeout=60000`. Expected: FAIL,
  `src/api/chatNaming.ts` does not exist.
- [ ] **Step 3: Implement** the five functions and the archive change above.
- [ ] **Step 4: Run it** again with `src/api/handlers/chatsArchive.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit:** `git add src/api/chatNaming.ts src/api/chatNaming.test.ts src/lib/text.ts src/api/handlers/chats.ts`; message:
  "Chats: one rule for who a message names, the Notify me level and the reply link (base B2)".

### Task B3: A deleted message leaves every read path

**Files:** Modify `src/api/chatState.ts` (`messagesOf` line 92, `unreadIn` line 102), `server/data/loaders/steps.ts`
(`newestMessages`, line 192), `server/data/loaders/chat.ts` (`chatsOf` line 58, `chatsMessages` line 159, `chatsWaiting` lines 186 and
187). Test: Create `src/api/handlers/chatsDeleted.test.ts`; Modify `server/data/loaders/loaders.test.ts`,
`server/mcp/messageTools.test.ts`.

**Interfaces.** Consumes: B1, `isLiveMessage` (B2). Produces: `messagesOf` and `unreadIn` read live messages only; the loader
condition `const LIVE = { field: 'deletedAt', null: true } as const` (export it from `steps.ts`) in each message read above. So
`chats.messages`, `chats.list` (preview, order, unread), `chats.unreadCount`, `chats.waiting` and the read mark of `chats.send`
(`roomsForPost`) never read a deleted message. Search (track find) and the push check (track notify) use the same `isLiveMessage` and
`LIVE`.

- [ ] **Step 1: Write the failing test** in `src/api/handlers/chatsDeleted.test.ts` (pattern: `src/api/handlers/chatFiles.test.ts`).
  A direct chat Faisal and Sara: `m1` by Faisal "First", then `m2` by Faisal "Secret plan 7731" with `deletedAt`. A project chat of
  prj_001: `m3` by Faisal that names Sara, with `deletedAt`. Sara reads nothing.
  ```ts
  it('leaves a deleted message out of the page, the preview, the unread counts and the waits', async () => {
    t.as('usr_003');
    const page = await t.api.call('chats.messages', { conversationId: direct });
    expect(page.messages.map((v) => v.message.id)).toEqual([m1]);
    const row = (await t.api.call('chats.list', {})).find((r) => r.id === direct)!;
    expect(row).toMatchObject({ preview: 'First', unread: 1 });
    expect((await t.api.call('chats.unreadCount', {})).unread).toBe(1);
    const waits = await t.api.call('chats.waiting', {});
    expect(waits.find((w) => w.id === direct)?.body).toBe('First');
    expect(waits.find((w) => w.id === projectChat)).toBeUndefined();
    for (const name of ['chats.messages', 'chats.list', 'chats.waiting'] as const) {
      expect(JSON.stringify(await t.api.call(name, name === 'chats.messages' ? { conversationId: direct } : {}))).not.toContain('Secret plan 7731');
    }
  });
  it('marks a chat read up to its newest live message', async () => { /* chats.markRead, then the stored lastReadAt is the stamp of the call */ });
  ```
  In `server/data/loaders/loaders.test.ts`, add `it('chats reads: the scoped load leaves a deleted message out, as the handler does')`
  with `same(state, 'chats.list' | 'chats.messages' | 'chats.waiting' | 'chats.unreadCount', ...)` on the same planted rows, the newest
  message deleted. In `server/mcp/messageTools.test.ts`, add `it('never gives an agent the text of a deleted message')` on the
  `chats.messages` and `chats.list` tools (the pattern of the `SECRET` tests there).
- [ ] **Step 2: Run it:** `npx vitest run src/api/handlers/chatsDeleted.test.ts server/data/loaders/loaders.test.ts server/mcp/messageTools.test.ts --no-file-parallelism --testTimeout=60000`.
  Expected: FAIL, the page holds `m2` and the preview is "Secret plan 7731".
- [ ] **Step 3: Implement:** filter `isLiveMessage` in `messagesOf` and in the scan of `unreadIn`; add `LIVE` to the `where` of
  `newestMessages`, of the `countWhere` of `chatsOf`, of the page select of `chatsMessages`, and of the two project selects of
  `chatsWaiting`. Use the query condition `{ field, null: true }` (`server/data/loaders/query.ts`): it compiles on Postgres and on SQLite,
  so no `_LITE` text is needed (`server/data/CLAUDE.md`, "The SQLite path").
- [ ] **Step 4: Run it** again. Expected: PASS. (merge lead runs) `test:db`, `test:lite`, `test:office` (a rows pin that moves needs its
  reason in `docs/superpowers/real-build/proof.md`) and `server/it/readIndexes.it.test.ts` (the newest-message read still uses
  `messages_conversation_newest`).
- [ ] **Step 5: Commit:** `git add src/api/chatState.ts server/data/loaders/steps.ts server/data/loaders/chat.ts src/api/handlers/chatsDeleted.test.ts server/data/loaders/loaders.test.ts server/mcp/messageTools.test.ts`;
  message: "Chats: a deleted message leaves the page, the preview, the counts and the waits (base B3)".

### Task B4: A notice keeps the message it points to

**Files:** Modify `src/api/notify.ts` (`NotifyInput` line 12, `notify` line 76), `src/api/handlers/chats.ts` (`postMessage` line 282),
`src/api/handlers/shared.ts` (`insertComment` line 76), `src/api/handlers/content.ts` (`commentsUpdate` line 156). Test: Modify
`src/api/notify.test.ts`; Create `src/api/handlers/noticeMessage.test.ts`.

**Interfaces.** Consumes: B1. Produces: `NotifyInput.messageId?: string` and `NotifyInput.reply?: true`; `notify` writes
`...(input.messageId ? { messageId } : {})` and `...(input.reply ? { reply: true } : {})` on each notice. The mention notice of
`chats.send` carries the new message id; the mention notice of `comments.create` and of `comments.update` carries the comment id.
Track find builds the notice link from `Notification.messageId`.

- [ ] **Step 1: Write the failing test.** In `src/api/notify.test.ts`:
  ```ts
  it('keeps the message and the reply mark on the notice', () => {
    const [n] = notify(state, faisal, STAMP, { userIds: ['usr_003'], trigger: 'mention', targetType: 'chat', targetId: 'cnv_001', messageId: 'msg_009', reply: true });
    expect(n).toMatchObject({ messageId: 'msg_009', reply: true });
    const [plain] = notify(state, faisal, STAMP, { userIds: ['usr_003'], trigger: 'mention', targetType: 'chat', targetId: 'cnv_001' });
    expect(plain).not.toHaveProperty('messageId');
    expect(plain).not.toHaveProperty('reply');
  });
  ```
  In `src/api/handlers/noticeMessage.test.ts`: `chats.send` by Faisal with `'@[Sara Team](usr_003) see this'` gives Sara one notice with
  `messageId` equal to the sent `message.id` and no `reply`; `comments.create` on tsk_001 with the same mention gives `messageId` equal to
  the comment id; `comments.update` that adds the mention of usr_002 gives that notice the comment id.
- [ ] **Step 2: Run it:** `npx vitest run src/api/notify.test.ts src/api/handlers/noticeMessage.test.ts --no-file-parallelism --testTimeout=60000`.
  Expected: FAIL, the notice has no `messageId`.
- [ ] **Step 3: Implement** the two fields and pass `messageId` in the three calls of `notifyIn` named above.
- [ ] **Step 4: Run it** again with `src/api/handlers/content.test.ts src/api/handlers/chats.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit:** `git add src/api/notify.ts src/api/notify.test.ts src/api/handlers/chats.ts src/api/handlers/shared.ts src/api/handlers/content.ts src/api/handlers/noticeMessage.test.ts`;
  message: "Notices: a mention notice keeps the message or comment it points to (base B4)".

### Task B5: The views give the reply link, the names-you mark, the read time and the level

**Files:** Modify `src/api/handlers/chats.ts` (`messageViewOf` line 171, `chatsMessages` line 250), `src/api/views.ts`
(`commentViewOf` line 365), `server/data/loaders/chat.ts` (`chatsMessages`), `server/data/loaders/task.ts` (`commentCall` line 68),
`server/mcp/docs.ts` (`chats.messages`, `comments.list`). Test: Create `src/api/handlers/chatViews.test.ts`; Modify
`server/data/loaders/loaders.test.ts`, `server/mcp/messageTools.test.ts`.

**Interfaces.** Consumes: B1, B2, B3. Produces: `MessageView.replyTo = replyRefOf(state, message, viewer.id)`,
`MessageView.namesMe = namesPerson(state, message, viewer.id)`; the same two in `CommentView`; `ChatThread.readUpTo` = the
`lastReadAt` of the reader's read mark of this chat at this read, or null; `ChatThread.notify = notifyLevelOf(state, conversation,
viewer.id)`. Loader: `chatsMessages` also loads by key the `replyToId` of each message of the page; `commentCall` also loads the
`replyToId` comment of its comment.

- [ ] **Step 1: Write the failing test** in `src/api/handlers/chatViews.test.ts`:
  ```ts
  it('gives the reply link and the names-you mark of each message, for its reader only', async () => {
    // In the project chat of prj_001: OLD by Faisal names Sara; REPLY by Sara has replyToId OLD (planted rows).
    t.as('usr_003');
    const page = await t.api.call('chats.messages', { conversationId: projectChat });
    const reply = page.messages.find((v) => v.message.id === REPLY)!;
    expect(reply.replyTo).toMatchObject({ id: OLD, firstLine: '@Sara Team the east wall needs a new footing', deleted: false });
    expect(page.messages.find((v) => v.message.id === OLD)!.namesMe).toBe(true);
    t.as('usr_002');
    const forFaisal = await t.api.call('chats.messages', { conversationId: projectChat });
    expect(forFaisal.messages.find((v) => v.message.id === OLD)!.namesMe).toBe(false);
  });
  it('gives the read time before the mark, and the level of the reader', async () => {
    state.chatReads[chatReadKey(projectChat, 'usr_003')] = { conversationId: projectChat, userId: 'usr_003', lastReadAt: EARLIER };
    t.as('usr_003');
    expect(await t.api.call('chats.messages', { conversationId: projectChat })).toMatchObject({ readUpTo: EARLIER, notify: 'named' });
    expect((await t.api.call('chats.messages', { conversationId: direct })).readUpTo).toBeNull();
    expect((await t.api.call('chats.messages', { conversationId: direct })).notify).toBe('all');
  });
  it('gives the reply link and the names-you mark of each task comment', async () => { /* comments.list on tsk_001: a reply of Faisal to Sara's comment has replyTo with deleted false, and namesMe true for Sara */ });
  ```
  In `server/data/loaders/loaders.test.ts`: `it('chats.messages: the scoped load brings the old message of a reply that is older than the page')`
  with `limit: 2` and the old message three messages back: `same(...)` passes and `replyTo.firstLine` is not ''. Also
  `it('comments.update and reactions.toggle: the scoped load brings the comment a reply answers')`.
  In `server/mcp/messageTools.test.ts`:
  ```ts
  it('names the new message fields in chats.messages and comments.list', () => {
    const read = TOOL_DOCS['chats.messages'].description;
    for (const word of ['reactions', 'editedAt', 'replyTo', 'namesMe', 'readUpTo', 'Deleted messages are left out', 'direct or group chat', 'quiet lines']) expect(read, word).toContain(word);
    expect(read.length).toBeLessThanOrEqual(540);
    for (const word of ['replyTo', 'namesMe']) expect(TOOL_DOCS['comments.list'].description, word).toContain(word);
  });
  ```
  The limit 540 leaves 60 characters for the "around" input of track find.
- [ ] **Step 2: Run it:** `npx vitest run src/api/handlers/chatViews.test.ts server/data/loaders/loaders.test.ts server/mcp/messageTools.test.ts --no-file-parallelism --testTimeout=60000`.
  Expected: FAIL, `replyTo` is null and `readUpTo` is null.
- [ ] **Step 3: Implement** the fill and the loads above. Write these exact descriptions:
  - `chats.messages`: "Reads one page of a chat that your person may open: the newest messages, oldest first, up to limit (default 200,
    at most 500); before (a message id) reads the page before. A message has author, actingFor, files (id, name, type; a file of a direct
    or group chat is a name only), reactions (emoji: user ids), editedAt, replyTo (id, author, firstLine, deleted) and namesMe. Deleted
    messages are left out. readUpTo: the last read time of your person; notify: all or named. A group also gives its quiet lines. Reading
    marks nothing read."
  - `comments.list`: keep today's text and add "replyTo is the comment it answers (id, author, firstLine, deleted), and namesMe is true
    when it names your person."
- [ ] **Step 4: Run it** again. Expected: PASS. (merge lead runs) `test:db`, `test:lite`, `test:office`.
- [ ] **Step 5: Commit:** `git add src/api/handlers/chats.ts src/api/views.ts server/data/loaders/chat.ts server/data/loaders/task.ts server/mcp/docs.ts src/api/handlers/chatViews.test.ts server/data/loaders/loaders.test.ts server/mcp/messageTools.test.ts`;
  message: "Chats: the views give the reply link, the names-you mark, the read time and the Notify me level (base B5)".

### Task B6: A reply on the server names the author of the old message

**Files:** Modify `src/api/handlers/chats.ts` (`postMessage` line 260, `chatsSend` line 287), `src/api/handlers/content.ts`
(`commentsCreate` line 132), `src/api/handlers/shared.ts` (`insertComment` line 66), `server/data/loaders/task.ts` (`chatsSend` line
123, `commentsCreate` line 62), `server/mcp/docs.ts` (`chats.send`, `comments.create`, the Messages line of `INSTRUCTIONS`),
`src/i18n/real/chatmsg.en.json`, `src/i18n/real/chatmsg.ar.json` (create). Test: Create `src/api/handlers/chatsReply.test.ts`; Modify
`server/data/loaders/loaders.test.ts`, `server/mcp/messageTools.test.ts`.

**Interfaces.** Consumes: B1, B2, B4, B5. Produces:
- `chats.send` input gets `replyToId: MessageId.optional()`. `comments.create` input gets `replyToId: CommentId.optional()`.
- `postMessage(ctx, conversation, body, fileIds, replyToId?: string): MessageView` (one optional parameter at the end; `files.share`
  and the meeting summary keep their calls). `insertComment(..., kind?: CommentKind, replyToId?: string)` (a ninth optional parameter).
- The old item must be a live message of the same chat, or a message comment (not a quiet line, `isLine`) of the same task. Every
  other case (missing, deleted, another chat, another task, a post comment, a quiet line) answers one refusal with one text:
  `invalid('replyToId', 'Reply to a message of the same chat or task.', 'reply_not_here')`. So the answer never tells that an id exists
  elsewhere.
- The reply author is the principal of the old item (`old.actingForId` for a message, `principalOf(state, old.authorId)` for a
  comment). When it is not the sender (`ctx.authority.id`), is active and may open the chat (`canSeeConversation`), it joins
  `Message.mentions`. A comment keeps no list: `namesPerson` reads `replyToId` (B2).
- Notices: the people named in the text get the mention notice with `messageId` (B4). The reply author, when not named in the text,
  gets one more notice with trigger `'mention'`, `messageId` and `reply: true`. `notify` already skips the sender, agents, inactive
  people and an office task the person does not see.
- Words (create the track files): `errors.reasons.reply_not_here`: EN "You can reply only to a message in the same chat or task." AR
  "يمكنك الرد فقط على رسالة في المحادثة نفسها أو المهمة نفسها."

- [ ] **Step 1: Write the failing test** in `src/api/handlers/chatsReply.test.ts`:
  ```ts
  it('names the author of the old message, and gives that person one reply notice', async () => {
    t.as('usr_003');
    const sent = await t.api.call('chats.send', { conversationId: direct, body: 'Approved. Please book the lab.', replyToId: OLD_BY_FAISAL });
    expect(sent.message).toMatchObject({ replyToId: OLD_BY_FAISAL, mentions: ['usr_002'] });
    expect(sent.replyTo).toMatchObject({ id: OLD_BY_FAISAL, deleted: false });
    const notices = Object.values(t.store.state.notifications).filter((n) => n.userId === 'usr_002');
    expect(notices).toEqual([expect.objectContaining({ trigger: 'mention', targetType: 'chat', messageId: sent.message.id, reply: true })]);
  });
  it('names nobody for a reply to an own message', async () => { /* Sara replies to her own message: mentions [], no new notice */ });
  it('names the person of an agent, never the agent and never the sender', async () => { /* usr_005 (agent of Sara) replies to Faisal: mentions ['usr_002']; a reply of Faisal to the agent message names usr_003 */ });
  it('gives one plain mention notice when the text names the author too', async () => { /* body '@[Faisal Leader](usr_002) ok': one notice, no reply key */ });
  it('refuses a reply into another chat with the text of a missing message', async () => {
    t.as('usr_003');
    const elsewhere = await t.api.call('chats.send', { conversationId: direct, body: 'x', replyToId: GROUP_SECRET_ID }).catch((e) => e);
    const missing = await t.api.call('chats.send', { conversationId: direct, body: 'x', replyToId: 'msg_999' }).catch((e) => e);
    expect(elsewhere).toMatchObject({ code: 'invalid_input', details: { reason: 'reply_not_here' } });
    expect(elsewhere.message).toBe(missing.message);
    expect(JSON.stringify(elsewhere)).not.toContain('Secret 7731');
  });
  it('refuses a reply to a deleted message', async () => { /* same refusal */ });
  it('answers a task comment and names its author', async () => {
    t.as('usr_002');
    const view = await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'Done.', replyToId: SARA_COMMENT });
    expect(view.comment.replyToId).toBe(SARA_COMMENT);
    expect(view.replyTo).toMatchObject({ id: SARA_COMMENT, deleted: false });
    expect(Object.values(t.store.state.notifications).find((n) => n.userId === 'usr_003')).toMatchObject({ targetType: 'task', targetId: 'tsk_001', messageId: view.comment.id, reply: true });
  });
  it('refuses a comment reply to another task, a post comment or a quiet line', async () => { /* each gives reason 'reply_not_here' */ });
  ```
  In `server/data/loaders/loaders.test.ts`: `same(...)` for `chats.send` and `comments.create` with `replyToId`. In
  `server/mcp/messageTools.test.ts`: `TOOL_DOCS['chats.send']` and `TOOL_DOCS['comments.create']` contain `'replyToId'`; `INSTRUCTIONS`
  contains `'A reply (replyToId) names the author of the message it answers'`.
- [ ] **Step 2: Run it:** `npx vitest run src/api/handlers/chatsReply.test.ts server/data/loaders/loaders.test.ts server/mcp/messageTools.test.ts --no-file-parallelism --testTimeout=60000`.
  Expected: FAIL, `replyToId` is not in the input of `chats.send`.
- [ ] **Step 3: Implement** the rules above. The loaders load the old item by key (`L.byKey('messages', [input.replyToId])`,
  `L.byKey('comments', [input.replyToId])`). Docs:
  - `chats.send`: replace "and optionally files (fileIds; a file of another chat fails)" with "optionally files (fileIds; a file of
    another chat fails) and replyToId (a message of the same chat; its author is named)".
  - `comments.create`: add "On a task, replyToId answers one comment of the same task, and its author is named." and change the last
    sentence to "People named with @, and the author of the comment you answer, get a notification when they may see the task."
  - `INSTRUCTIONS`, Messages line, after the sentence of `chats.send`: "A reply (replyToId) names the author of the message it answers:
    that person gets a notice, as for an @mention."
- [ ] **Step 4: Run it** again with `src/i18n`. Expected: PASS. (merge lead runs) `test:db`, `test:lite`.
- [ ] **Step 5: Commit:** `git add src/api/handlers/chats.ts src/api/handlers/content.ts src/api/handlers/shared.ts server/data/loaders/task.ts server/mcp/docs.ts src/i18n/real/chatmsg.en.json src/i18n/real/chatmsg.ar.json src/api/handlers/chatsReply.test.ts server/data/loaders/loaders.test.ts server/mcp/messageTools.test.ts`;
  message: "Chats: a reply keeps a link to the old message and names its author (base B6)".

### Task B7: Split Thread.tsx into the log, the bubble and the box

**Files:** Create `src/features/inbox/MessageLog.tsx`, `src/features/inbox/MessageBubble.tsx`, `src/features/inbox/Composer.tsx`;
Modify `src/features/inbox/Thread.tsx`. Test: Create `src/features/inbox/threadSplit.test.ts`.

**Interfaces.** Consumes: today's `Thread.tsx`. Produces (a pure move, no change of behaviour):
- `MessageBubble.tsx`: `export type Bubble` (today's type), `export const MessageBubble = memo(function MessageBubble({ bubble, fresh }:
  { bubble: Bubble; fresh: boolean }))` (today's `BubbleItem`, with `GroupLineItem` and `ReasonLineItem` inside the file),
  `export function clockTime(stamp: string, lang: Lang): string`.
- `MessageLog.tsx`: `export type EarlierControl`, `export function MessageLog(props)` (today's props), and
  `export function useDayLabel(): (day: string) => string` (today's `dayLabel`: Today, Yesterday or the long day), which the task panel
  uses in B16.
- `Composer.tsx`: `export function Composer(props: ComposerProps)` with `ComposerBox` inside.
- `Thread.tsx`: only `export { MessageLog, type EarlierControl } from './MessageLog'; export { MessageBubble, clockTime, type Bubble }
  from './MessageBubble'; export { Composer } from './Composer';`. `ConversationPane.tsx` and `src/lib/dates.test.ts` keep their imports.

- [ ] **Step 1: Write the failing test** in `src/features/inbox/threadSplit.test.ts`:
  ```ts
  import * as Thread from './Thread';
  import { MessageLog, useDayLabel } from './MessageLog';
  import { MessageBubble, clockTime } from './MessageBubble';
  import { Composer } from './Composer';
  it('keeps every export of Thread.tsx as the same part of the new files', () => {
    expect(Thread.MessageLog).toBe(MessageLog);
    expect(Thread.MessageBubble).toBe(MessageBubble);
    expect(Thread.Composer).toBe(Composer);
    expect(Thread.clockTime).toBe(clockTime);
    expect(typeof useDayLabel).toBe('function');
  });
  ```
- [ ] **Step 2: Run it:** `npx vitest run src/features/inbox/threadSplit.test.ts --no-file-parallelism --testTimeout=60000`. Expected:
  FAIL, `./MessageLog` does not exist.
- [ ] **Step 3: Implement** the move. Move each comment with its code. Change no class, no word and no hook order.
- [ ] **Step 4: Run it** again with every existing test of the folder, unchanged:
  `npx vitest run src/features/inbox src/features/comments src/lib/dates.test.ts --no-file-parallelism --testTimeout=60000`. Expected: PASS.
- [ ] **Step 5: Commit:** `git add src/features/inbox/MessageLog.tsx src/features/inbox/MessageBubble.tsx src/features/inbox/Composer.tsx src/features/inbox/Thread.tsx src/features/inbox/threadSplit.test.ts`;
  message: "Inbox: split the thread into the log, the bubble and the box, with no change of behaviour (base B7)".

---

## Wave 2: items 6, 9, 10, 11, 12 and 13 (B8 to B17)

### Task B8: Edit an own chat message (chats.editMessage)

**Files:** Modify `src/api/handlers/chats.ts` (a new block at the end, before `chatCalls`), `server/data/loaders/chat.ts`,
`server/data/loaders/index.ts`, `server/core/everyCall.ts`, `server/mcp/tools.ts`, `server/mcp/docs.ts` (`INSTRUCTIONS`),
`src/app/writeKinds.ts`, `src/i18n/real/chatmsg.*.json`; the pins in `src/api/calls.test.ts`, `server/core/serverCallMap.test.ts`,
`server/http/health.test.ts`, `server/mcp/tools.test.ts`. Test: Create `src/api/handlers/chatsEdit.test.ts`; Modify
`server/data/loaders/loaders.test.ts`, `server/data/save.test.ts`, `server/mcp/messageTools.test.ts`.

**Interfaces.** Consumes: B1 to B6. Produces:
- `function requireMessage(ctx: Ctx, id: string, rules: { author: boolean; allowDeleted: boolean }): { message: Message; conversation: Conversation }`:
  a missing message, a message of a chat the person may not open, and (with `allowDeleted` false) a deleted message all answer
  `notFound('Message', id)`, never forbidden (design, Constraints: "the error texts"). With `author` true, a person who is not the
  author (`isMine` false) gets `forbidden('You can change only your own messages.', { messageId, reason: 'not_author' })`. B8 calls it
  with `{ author: true, allowDeleted: false }`, B9 with `{ author: true, allowDeleted: true }`, B10 with `{ author: false, allowDeleted: false }`.
- `chats.editMessage`: input `z.object({ id: MessageId, body: z.string().trim().min(1).max(MESSAGE_MAX) })`, output `MessageView`. The
  same body changes nothing. A new body sets `editedAt`, finds the names again (`mentionedUserIds` filtered as `postMessage` does) and
  keeps the reply author of B6 in `mentions` while that person stays active and in the chat. A person named for the first time gets
  the mention notice with `messageId`. A person whose name the edit removes loses the notices with that `messageId`. It works in a
  closed chat too: a closed chat refuses only new messages and files.
- Loader `chatMessageCall(L, input)` (in `chat.ts`): the message by key (`input.id` or `input.messageId`), its files
  (`attachedFiles`), its `replyToId` message, the chatReads of the sender for that chat, and its notices:
  `L.select({ c: 'notifications', where: [{ col: 'target_type', eq: 'chat' }, { col: 'target_id', in: [conversationId] }, { field: 'messageId', in: [id] }] })`.
  `LOADER_OF['chats.editMessage'] = chat(chatMessageCall)`.
- MCP: `chats.editMessage` in `MCP_DENY` (design, Constraints). `INSTRUCTIONS`, Messages line, adds: "Only your person edits, deletes
  or reacts to a message, in the screens." `WRITE_KINDS['chats.editMessage']`: the kinds that `server/core/writeKinds.test.ts` names
  (expected `['messages', 'notifications']`). `everyCall.ts`: an input on a sample message of its actor.
- Words: `errors.reasons.not_author`: EN "You can change only your own messages." AR "يمكنك تغيير رسائلك فقط."

- [ ] **Step 1: Write the failing test** in `src/api/handlers/chatsEdit.test.ts`:
  ```ts
  it('edits an own message, marks it edited, and tells only the person it names for the first time', async () => {
    t.as('usr_002');
    const { message } = await t.api.call('chats.send', { conversationId: projectChat, body: 'Check the wall' });
    const edited = await t.api.call('chats.editMessage', { id: message.id, body: '@[Sara Team](usr_003) check the wall' });
    expect(edited.message).toMatchObject({ body: '@[Sara Team](usr_003) check the wall', mentions: ['usr_003'], editedAt: expect.any(String) });
    expect(noticesOf('usr_003')).toEqual([expect.objectContaining({ trigger: 'mention', messageId: message.id })]);
    await t.api.call('chats.editMessage', { id: message.id, body: '@[Sara Team](usr_003) check the east wall' });
    expect(noticesOf('usr_003')).toHaveLength(1);
  });
  it('takes the notice from a person whose name the edit removes', async () => { /* edit back to 'Check the wall': noticesOf('usr_003') is [] */ });
  it('keeps the reply author named after an edit', async () => { /* a reply of Sara to Faisal, edited: mentions still ['usr_002'], no second notice */ });
  it('changes nothing for the same body', async () => { /* editedAt stays null */ });
  it('lets a person edit a message of their agent, and in a closed chat', async () => { /* usr_005 wrote for usr_003; usr_003 edits; a direct chat with an inactive person still takes the edit */ });
  it('refuses the message of another person with not_author', async () => { /* Sara edits Faisal's message: code forbidden, reason not_author */ });
  it('answers not_found for a message of a chat the person may not open, with no text of it', async () => {
    t.as('usr_004');
    for (const id of [GROUP_SECRET_ID, DIRECT_SECRET_ID, PROJECT_SECRET_ID, 'msg_999']) {
      const error = await t.api.call('chats.editMessage', { id, body: 'x' }).catch((e) => e);
      expect(error).toMatchObject({ code: 'not_found' });
      expect(JSON.stringify(error)).not.toContain('Secret 7731');
    }
  });
  it('answers not_found for a deleted message', async () => { /* deletedAt set: not_found */ });
  ```
  The project chat secret is in the chat of a project where usr_004 is not on the team (factory prj_001: usr_004 is outside).
  In `server/data/save.test.ts`, in the describe "the office signal of a private chat message":
  `it('names no actor and no story for an edit of a group message')` (body and `editedAt` change on `msg_901`: `diff.anonymous` is true,
  and the office signal has no `actorId` and no `storyId`). In `server/data/loaders/loaders.test.ts`: `same(...)` for `chats.editMessage`
  that adds and removes a name. In `server/mcp/messageTools.test.ts`: `chats.editMessage` is in `MCP_DENY` and in no tool list of an agent.
- [ ] **Step 2: Run it:** `npx vitest run src/api/handlers/chatsEdit.test.ts server/data/save.test.ts server/data/loaders/loaders.test.ts server/mcp/messageTools.test.ts --no-file-parallelism --testTimeout=60000`.
  Expected: FAIL, the call `chats.editMessage` does not exist.
- [ ] **Step 3: Implement** the call, `requireMessage`, the loader and the checklist of `src/api/CLAUDE.md` ("A new call: the
  checklist", items 1, 3, 4, 5, 7, 8, 9). Run `src/api/calls.test.ts server/core server/http/health.test.ts server/mcp/tools.test.ts`
  and raise each pinned count to the number the test reads (one more call, one more deny entry).
- [ ] **Step 4: Run it** again with `server/core/writeKinds.test.ts`. Expected: PASS. (merge lead runs) `test:db`, `test:lite`,
  `server/it/worker.it.test.ts`, `test:mcp`.
- [ ] **Step 5: Commit:** the files above; message: "Chats: the author edits a message, and the names are found again (B8)".

### Task B9: Delete an own chat message, with Undo (chats.deleteMessage)

**Files:** Same places as B8. Test: Create `src/api/handlers/chatsDelete.test.ts`; Modify `server/data/loaders/loaders.test.ts`,
`server/data/save.test.ts`, `server/mcp/messageTools.test.ts`.

**Interfaces.** Consumes: B3, B8 (`requireMessage` with `{ author: true, allowDeleted: true }`, `chatMessageCall`). Produces:
- `chats.deleteMessage`: input `z.object({ id: MessageId, deleted: z.boolean().default(true) })`, output
  `z.object({ deleted: z.boolean() })`. It writes no History event (messages write none); the Undo of the toast calls it again with
  `deleted: false`, as `chats.archive` does (design, "Left to the builder"). `requireMessage` here also finds a deleted message, so the
  Undo works.
- `deleted: true` on a live message sets `deletedAt` and removes every notice with that `messageId` (target `chat`). `deleted: false` on
  a deleted message removes `deletedAt` and writes the notices again for the people it names now (B6 rules: plain mention, and `reply:
  true` for a reply author named only by the reply), then sets `read: true` on each of them, so a restore sends no second push and no
  second mention mail (`NEW_NOTICES_SQL` reads unread notices only). The same value again changes nothing.
- The files of a deleted message stay (design item 11). It works in a closed chat.
- `LOADER_OF['chats.deleteMessage'] = chat(chatMessageCall)`; `MCP_DENY`; `WRITE_KINDS` (expected `['messages', 'notifications']`);
  `everyCall.ts` input; the pinned counts.

- [ ] **Step 1: Write the failing test** in `src/api/handlers/chatsDelete.test.ts`:
  ```ts
  it('deletes an own message for everyone, with its notices, and leaves no text on any read path', async () => {
    t.as('usr_002');
    const { message } = await t.api.call('chats.send', { conversationId: direct, body: '@[Sara Team](usr_003) Secret plan 7731' });
    expect(await t.api.call('chats.deleteMessage', { id: message.id })).toEqual({ deleted: true });
    expect(noticesOf('usr_003')).toEqual([]);
    t.as('usr_003');
    for (const [name, input] of [['chats.messages', { conversationId: direct }], ['chats.list', {}], ['chats.waiting', {}], ['notifications.list', {}]] as const) {
      expect(JSON.stringify(await t.api.call(name, input)), name).not.toContain('Secret plan 7731');
    }
    expect((await t.api.call('chats.unreadCount', {})).unread).toBe(0);
  });
  it('shows a reply to a deleted message as deleted', async () => { /* replyTo of a reply: { deleted: true, firstLine: '' } */ });
  it('brings the message back with Undo, and its notices come back read', async () => {
    await t.api.call('chats.deleteMessage', { id, deleted: false });
    expect(page().messages.map((v) => v.message.id)).toContain(id);
    expect(noticesOf('usr_003')).toEqual([expect.objectContaining({ messageId: id, read: true })]);
  });
  it('changes nothing for the same value', async () => { /* a second delete keeps the first deletedAt */ });
  it('keeps the files of a deleted message', async () => { /* state.files of its fileIds still there */ });
  it('refuses the message of another person with not_author, and answers not_found to an outsider', async () => { /* as in B8 */ });
  ```
  `server/data/save.test.ts`: `it('names no actor and no story for a delete of a group message')`. `loaders.test.ts`: `same(...)` for a
  delete and a restore. `messageTools.test.ts`: `chats.deleteMessage` is in `MCP_DENY`; the agent's `chats.messages` leaves the deleted
  message out.
- [ ] **Step 2: Run it:** `npx vitest run src/api/handlers/chatsDelete.test.ts server/data/save.test.ts server/data/loaders/loaders.test.ts server/mcp/messageTools.test.ts --no-file-parallelism --testTimeout=60000`.
  Expected: FAIL, the call does not exist.
- [ ] **Step 3: Implement** the call and the checklist steps, as in B8.
- [ ] **Step 4: Run it** again with `server/core/writeKinds.test.ts src/api/calls.test.ts server/mcp/tools.test.ts`. Expected: PASS.
  (merge lead runs) `test:db`, `test:lite`, `test:mcp`.
- [ ] **Step 5: Commit:** the files above; message: "Chats: the author deletes a message for everyone, and Undo brings it back (B9)".

### Task B10: Reactions on a chat message (reactions.toggle takes a message)

**Files:** Modify `src/api/handlers/content.ts` (`reactionsToggle` line 176), `src/api/handlers/chats.ts`, `server/data/loaders/index.ts`
(line 133), `server/data/loaders/sweep.ts`, `src/app/writeKinds.ts` (line 76). Test: Create `src/api/handlers/messageReactions.test.ts`;
Modify `server/data/loaders/loaders.test.ts`, `server/data/save.test.ts`.

**Interfaces.** Consumes: B1, B5, B8 (`requireMessage` with `{ author: false, allowDeleted: false }`, `chatMessageCall`). Produces:
- `reactions.toggle` input: `z.object({ commentId: CommentId.optional(), messageId: MessageId.optional(), emoji: Reaction }).refine(
  (i) => (i.commentId === undefined) !== (i.messageId === undefined), { message: 'Give commentId or messageId.' })`. Older inputs
  (`commentId` only) stay valid. Output: `z.union([CommentView, MessageView])`.
- `export function toggleMessageReaction(ctx: Ctx, messageId: string, emoji: Reaction): MessageView` in `chats.ts`: any person who may
  open the chat (closed chats too) toggles `ctx.authority.id` in `message.reactions[emoji]`, starting from `emptyReactions()`. No event,
  no notice, no `createdAt` change, so no unread mark and no push (design item 12).
- The loader of `reactions.toggle` runs `chatMessageCall` with a `messageId` and `commentCall` otherwise; its label stays `content`.
  `WRITE_KINDS['reactions.toggle']` adds `'messages'`. `sweep.ts` adds one line `['reactions.toggle', { messageId: <a message of the
  trap office>, emoji: '👍' }, <a member>]`. MCP: the call stays on `MCP_DENY`; no doc changes.

- [ ] **Step 1: Write the failing test** in `src/api/handlers/messageReactions.test.ts`:
  ```ts
  it('toggles my reaction on a message, with no notice and no unread mark', async () => {
    t.as('usr_003');
    const before = { notices: Object.keys(t.store.state.notifications).length, unread: await unreadOf('usr_002') };
    const on = await t.api.call('reactions.toggle', { messageId: FAISAL_MESSAGE, emoji: '👍' });
    expect(on).toMatchObject({ message: { id: FAISAL_MESSAGE, reactions: { '👍': ['usr_003'], '✅': [], '👀': [] } } });
    expect(Object.keys(t.store.state.notifications)).toHaveLength(before.notices);
    expect(await unreadOf('usr_002')).toBe(before.unread);
    const off = await t.api.call('reactions.toggle', { messageId: FAISAL_MESSAGE, emoji: '👍' });
    expect(off).toMatchObject({ message: { reactions: { '👍': [] } } });
  });
  it('keeps the reactions of comments as they were', async () => { /* commentId input: CommentView with the comment.reacted event */ });
  it('refuses an input with both ids or with none', async () => { /* code invalid_input */ });
  it('answers not_found for a message of a chat the person may not open, and for a deleted message', async () => { /* usr_004 on the group, direct and project secrets: not_found, no secret text */ });
  ```
  `server/data/save.test.ts`: `it('names no actor and no story for a reaction on a group message')`. `loaders.test.ts`: `same(...)` for
  `reactions.toggle` with `messageId`.
- [ ] **Step 2: Run it:** `npx vitest run src/api/handlers/messageReactions.test.ts src/api/handlers/content.test.ts server/data/save.test.ts server/data/loaders/loaders.test.ts --no-file-parallelism --testTimeout=60000`.
  Expected: FAIL, the input refuses `messageId`.
- [ ] **Step 3: Implement** the input, the branch (`input.messageId ? toggleMessageReaction(...) : today's code`), the loader and the
  `WRITE_KINDS` line.
- [ ] **Step 4: Run it** again with `server/core/writeKinds.test.ts`. Expected: PASS. (merge lead runs) `test:db`, `test:lite`.
- [ ] **Step 5: Commit:** the files above; message: "Chats: the three reactions on a chat message, with no push and no unread mark (B10)".

### Task B11: The message menu, the phone sheet and the reaction pills

**Files:** Create `src/features/inbox/bubbleActions.ts`, `src/features/inbox/MessageMenu.tsx`, `src/features/inbox/ReactionPills.tsx`,
`src/features/inbox/longPress.ts`; Modify `src/components/Menu.tsx`, `src/features/inbox/MessageBubble.tsx`,
`src/features/inbox/ConversationPane.tsx` (`bubbleOfMessage`, `ChatPane`, `TaskPane`), `src/i18n/real/chatmsg.*.json`. Test: Create
`src/features/inbox/MessageMenu.test.tsx`.

**Interfaces.** Consumes: B7, B10, `users.list` (the frame's query, for the names on a pill), `Sheet`, `Menu`, `useStableHandler`,
`useIsPhone`. Produces:
- `bubbleActions.ts`: `export type BubbleActions = { menuLabel: string; canReact: boolean; react(bubble: Bubble, emoji: Reaction): void; people: UserCard[] }`;
  `export const BubbleActionsContext = createContext<BubbleActions | null>(null)`; `export function useBubbleActions(): BubbleActions | null`.
  The panes give one stable object (`useMemo` over `useStableHandler` handlers), so a memo bubble renders again only when its own
  Bubble changes (`src/CLAUDE.md`, "Speed"). B12 to B15 add fields to this type.
- `Bubble` (in `MessageBubble.tsx`) gets `reactions?: Record<Reaction, string[]>`. `bubbleOfMessage` fills it from
  `view.message.reactions`; the comment mapper of `TaskPane` from `view.comment.reactions`. A group line and a reason line have none.
- `Menu.tsx`: `Menu` and `MenuList` take `head?: ReactNode`, drawn above the items with one hairline under it; a `Menu` with a `head`
  shows also with no visible item; the arrow keys move through `[role="menuitem"],[role="menuitemcheckbox"]`; `menuPlace` counts the
  head as one item.
- `MessageMenu.tsx`: `export function MessageTools({ bubble }: { bubble: Bubble })`: the "..." button (`Menu`, label
  `actions.menuLabel`, `triggerClassName` that hides it until the message row has hover or focus (`opacity-0 group-hover:opacity-100
  group-focus-within:opacity-100`) and on a touch screen (`pointer-coarse:hidden`). Its `head` is the reaction row: three 44 px round
  buttons, `role="menuitemcheckbox"`, `aria-checked` = my reaction, `aria-label` = `comments.react` (`{ emoji, n }`), in a group named
  `chat.reactions`. `export function MessageSheet({ bubble, open, onOpenChange })`: the phone sheet (`Sheet`): title
  `chat.yourMessage` + " · " + clock for my message, else the author's name + " · " + clock; description `firstLineOf(bubble.body)`; a row
  of three 56 px reaction buttons; then the items; "Copy text" (`chat.copyText`) copies `plainText(bubble.body)` with
  `navigator.clipboard.writeText` and shows the toast `chat.copied`. A browser with no `navigator.clipboard` has no Copy item.
  `export function menuItemsOf(bubble: Bubble, actions: BubbleActions, t: TFunction): MenuItem[]` returns `[]` in this task (B12 and B13
  add their items).
- `longPress.ts`: `export function useLongPress(onLongPress: () => void): Pick<HTMLAttributes<HTMLElement>, 'onPointerDown' |
  'onPointerMove' | 'onPointerUp' | 'onPointerCancel' | 'onClickCapture' | 'onContextMenu'>`: a finger only (`pointerType === 'touch'`),
  500 ms, cancel after 10 px of move (the values of `useContextMenu` in `Menu.tsx`), no click after it, and no browser context menu on
  a touch screen.
- `ReactionPills.tsx`: `export function ReactionPills({ bubble }: { bubble: Bubble })`: one pill for each emoji with one person or more:
  28 px high, `min-w-11`, a 44 px press area (`after:absolute after:-inset-y-2 after:inset-x-0`), the emoji and the count (`tabular`);
  my reaction has `bg-fill-strong ring-1 ring-inset ring-accent`; `title` and a long press (a small `role="tooltip"` until the next
  press) give the names (`listFormat` of `usePersonName` over `users.list`; a person not in the list is left out of the names, never of
  the count). With `canReact` false the pills are plain text, as in today's task panel. No faces.
- `MessageBubble.tsx`: the message row gets `group`; `MessageTools` sits beside the bubble (my message: on its start side; another
  message: on its end side); `ReactionPills` under it; the long press of the row opens `MessageSheet`. `user-select: none` only on a
  touch screen (`pointer-coarse:select-none`), as the long press takes the place of the phone's text selection.
- `ChatPane` gives `{ menuLabel: t('chat.messageActions'), canReact: true, react: (b, emoji) => react.mutate({ messageId: b.id, emoji }), people: data.people }`.
  `TaskPane` gives `{ menuLabel: t('comments.actions'), canReact: canPost, react: (b, emoji) => react.mutate({ commentId: b.id, emoji }), people }`.
- Words: `chat.messageActions` EN "Actions for this message" AR "إجراءات هذه الرسالة"; `chat.reactions` EN "Reactions" AR "التفاعلات";
  `chat.yourMessage` EN "Your message" AR "رسالتك"; `chat.copyText` EN "Copy text" AR "انسخ النص"; `chat.copied` EN "Text copied." AR
  "نُسخ النص.".

- [ ] **Step 1: Write the failing test** in `src/features/inbox/MessageMenu.test.tsx` (`renderApp` as Hala, the Admin; the test plants
  `msg_901` by Faisal Al-Harbi (usr_002) "The wall is 40 cm higher." in the chat of Corniche Office Tower and opens it from the list):
  ```ts
  it('opens the menu of a message with the three reactions, and a press on 👍 adds a pill with my ring', async () => {
    await userEvent.click(within(row()).getByRole('button', { name: 'Actions for this message' }));
    const menu = screen.getByRole('menu', { name: 'Actions for this message' });
    expect(within(menu).getAllByRole('menuitemcheckbox').map((b) => b.textContent)).toEqual(['👍', '✅', '👀']);
    await userEvent.click(within(menu).getByRole('menuitemcheckbox', { name: 'React with 👍, 0' }));
    const pill = await within(row()).findByRole('button', { name: 'React with 👍, 1' });
    expect(pill).toHaveAttribute('aria-pressed', 'true');
    expect(pill).toHaveAttribute('title', 'Hala Nasser');
    await userEvent.click(pill);
    await waitFor(() => expect(within(row()).queryByRole('button', { name: /React with 👍/ })).toBeNull());
  });
  it('opens the phone sheet on a long press, with the preview, the reactions and Copy text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    fireEvent.pointerDown(bubbleOf('The wall is 40 cm higher.'), { pointerType: 'touch', clientX: 10, clientY: 10 });
    await act(() => new Promise((r) => setTimeout(r, 550)));
    const sheet = await screen.findByRole('dialog', { name: /Faisal Al-Harbi · / });
    expect(within(sheet).getByText('The wall is 40 cm higher.')).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Copy text' }));
    expect(writeText).toHaveBeenCalledWith('The wall is 40 cm higher.');
    expect(await screen.findByText('Text copied.')).toBeInTheDocument();
  });
  it('names my own message "Your message" in the sheet, and opens no sheet for a short press or a moving finger', async () => { /* ... */ });
  it('shows no Copy text where the browser has no clipboard', async () => { /* navigator without clipboard */ });
  it('reacts to a task comment in the Inbox thread, and shows plain pills to a person who may not post', async () => { /* /inbox/tsk_... with a comment; Member outside the team sees "👍 1" as text, no menu */ });
  it('reads the menu and the sheet in Arabic, right to left', async () => {
    // Hala's language set to 'ar' in the saved office.
    expect(screen.getByRole('button', { name: 'إجراءات هذه الرسالة' })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    // long press: the sheet has 'انسخ النص'; my message title starts with 'رسالتك · '
  });
  ```
- [ ] **Step 2: Run it:** `npx vitest run src/features/inbox/MessageMenu.test.tsx --no-file-parallelism --testTimeout=60000`. Expected:
  FAIL, no button "Actions for this message".
- [ ] **Step 3: Implement** the parts above. Keep each new part in its own file, so `MessageBubble.tsx` gets four short lines (the
  `group` class, the tools, the pills, the long press), beside the lines of track read.
- [ ] **Step 4: Run it** again with `src/components/overlays.test.tsx src/features/inbox src/features/comments`. Expected: PASS.
- [ ] **Step 5: Commit:** the files above; message: "Inbox: one small menu for each message, a phone sheet with Copy text, and reaction
  pills (B11)".

### Task B12: Reply in the screens

**Files:** Create `src/features/inbox/ReplyStrip.tsx`; Modify `src/features/inbox/MessageMenu.tsx` (`menuItemsOf`),
`src/features/inbox/bubbleActions.ts`, `src/features/inbox/MessageBubble.tsx`, `src/features/inbox/Composer.tsx`,
`src/features/inbox/ConversationPane.tsx`, `src/i18n/real/chatmsg.*.json`. Test: Create `src/features/inbox/Reply.test.tsx`.

**Interfaces.** Consumes: B5, B6, B11, `firstLineOf`. Produces:
- `Bubble` gets `replyTo?: ReplyRef | null` (from `view.replyTo`). `BubbleActions` gets `canReply: boolean` and
  `reply(bubble: Bubble): void`. `menuItemsOf` adds `{ label: t('chat.reply'), onSelect: () => actions.reply(bubble) }` when `canReply`,
  first in the list, on the computer menu and in the phone sheet.
- `ReplyStrip.tsx`: `export function replyRefOfBubble(bubble: Bubble): ReplyRef` = `{ id: bubble.id, author: bubble.actingFor ??
  bubble.author, firstLine: firstLineOf(bubble.body), deleted: false }` (the person who gets named, as on the server).
  `export function ComposerReplyStrip({ replyTo, onCancel }: { replyTo: ReplyRef; onCancel: () => void })`: a grey strip (`bg-fill`,
  `rounded-xl`) with the `corner-up-left` icon (`rtl:-scale-x-100`), `chat.replyTo` (`{ name }` in `<bdi>`) and the first line
  (`dir="auto"`, truncated), and an X button named `chat.cancelReply`. `export function BubbleReplyQuote({ replyTo }: { replyTo: ReplyRef })`:
  above the text in the bubble, a grey box with a 3 px bar on its start side: the name (`<bdi>`, medium) and the first line, or only
  `chat.deletedMessage` when `deleted`. In this task it is plain text; B15 makes it a button.
- `Composer` props: `replyTo?: ReplyRef | null`, `onCancelReply?: () => void`. The strip shows above the field; Escape in the field with
  a strip (and no open mention list, `event.defaultPrevented` false) cancels the reply. A reply moves the focus into the field.
- `ChatPane` and `TaskPane` hold `const [replyTo, setReplyTo] = useState<ReplyRef | null>(null)`; `reply` sets it; a send passes
  `replyToId: replyTo.id` (`chats.send` or `comments.create`) and clears it. `canReply` is true where the box shows (a chat that is not
  closed; a task thread with `canPost`).
- Words: `chat.reply` EN "Reply" AR "رد"; `chat.replyTo` EN "Reply to {{name}}" AR "رد على {{name}}"; `chat.cancelReply` EN "Cancel the
  reply" AR "ألغِ الرد"; `chat.deletedMessage` EN "Deleted message" AR "رسالة محذوفة".

- [ ] **Step 1: Write the failing test** in `src/features/inbox/Reply.test.tsx` (the tower chat with `msg_901` of B11):
  ```ts
  it('replies to a message: the strip shows in the box, and the sent message shows it above its text', async () => {
    await userEvent.click(within(row()).getByRole('button', { name: 'Actions for this message' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Reply' }));
    const box = screen.getByRole('textbox', { name: 'Message' });
    expect(box).toHaveFocus();
    expect(screen.getByText('Reply to Faisal Al-Harbi')).toBeInTheDocument();
    await userEvent.type(box, 'Approved.{Enter}');
    await waitFor(() => expect(Object.values(store.state.messages).find((m) => m.body === 'Approved.')?.replyToId).toBe('msg_901'));
    expect(screen.queryByText('Reply to Faisal Al-Harbi')).toBeNull();
    const sent = await bubbleOf('Approved.');
    expect(within(sent).getByText('The wall is 40 cm higher.')).toBeInTheDocument();
  });
  it('cancels the reply with the X and with Escape', async () => { /* both remove the strip and send no replyToId */ });
  it('shows "Deleted message" in the strip of a reply to a deleted message', async () => { /* plant msg_901 deletedAt and a reply: 'Deleted message', no old text */ });
  it('has no Reply in a closed chat, and replies to a task comment in the Inbox thread', async () => { /* direct chat with an inactive person: no Reply item; tsk thread: comments.create gets replyToId */ });
  it('reads the strip in Arabic, right to left', async () => { /* 'رد على فيصل الحربي' and the X named 'ألغِ الرد' */ });
  ```
  The box label is the word of `chat.composer` ("Message"); read it from `en.json` if it differs.
- [ ] **Step 2: Run it:** `npx vitest run src/features/inbox/Reply.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: FAIL, no
  menu item "Reply".
- [ ] **Step 3: Implement** the parts above.
- [ ] **Step 4: Run it** again with `src/features/inbox`. Expected: PASS.
- [ ] **Step 5: Commit:** the files above; message: "Inbox: reply to a message, with a strip in the box and in the sent message (B12)".

### Task B13: Edit and delete in the screens, the Up key and Undo

**Files:** Create `src/features/inbox/MessageEditForm.tsx`, `src/features/inbox/deleteMessage.ts`; Modify
`src/features/inbox/MessageMenu.tsx`, `src/features/inbox/bubbleActions.ts`, `src/features/inbox/MessageBubble.tsx`,
`src/features/inbox/Composer.tsx`, `src/features/inbox/ConversationPane.tsx`, `src/features/inbox/earlier.ts`,
`src/i18n/real/chatmsg.*.json`. Test: Create `src/features/inbox/EditDelete.test.tsx`; Modify `src/features/inbox/EarlierMessages.test.tsx`.

**Interfaces.** Consumes: B8, B9, B11. Produces:
- `Bubble` gets `canEdit?: boolean`: `view.mine` for a message; `view.canEdit && view.kind === 'message'` for a task comment.
- `BubbleActions` gets `edit(bubble: Bubble): void`, `remove(bubble: Bubble): void`, `saveEdit(bubble: Bubble, body: string): void`,
  `endEdit(): void`. `export const EditingContext = createContext<string | null>(null)` (the id of the bubble in edit). `menuItemsOf` adds
  `{ label: t('comments.edit') }` and `{ label: t('comments.delete'), destructive: true }` when `bubble.canEdit`, after Reply (and after
  Copy text on the phone).
- `MessageEditForm.tsx`: `export function MessageEditForm({ bubble }: { bubble: Bubble })`: in place of the text, a `MentionField`
  (label `comments.edit`, value `plainText(bubble.body)`, `people` of the actions) with Cancel (`common.cancel`, plain) and Save
  (`comments.save`, secondary: the Send button stays the one navy button). A plain Enter saves `editedBody(draft.trim(), people,
  bubble.body)`; Escape cancels; the field takes the focus.
- `Composer` prop `onEditLast?: () => boolean`: ArrowUp in an empty box (no text, no picked file, `event.defaultPrevented` false) calls
  it, and a true answer prevents the key. The pane answers true after it opens the edit of its newest bubble with `canEdit` and no
  `status`.
- `deleteMessage.ts`: `export function useDeleteMessage(): (id: string) => void`: `chats.deleteMessage { id }`, then the toast
  `chat.messageDeleted` with Undo that calls `{ id, deleted: false }` and shows no toast of its own (the pattern of `useArchive`).
- `ChatPane`: edit, save with `chats.editMessage` (then `endEdit`), delete with `useDeleteMessage`; `endEdit` puts the focus back in
  the box. `TaskPane`: save with `comments.update`, delete with `useUndoable('comments.delete', { message: () => t('comments.deleted') })`.
- `earlier.ts`: a message that leaves the newest page stays in the earlier pages only when it is older than the oldest message of the
  new page. So a deleted message leaves the log also after "Earlier messages".
- Words: `chat.messageDeleted` EN "Message deleted." AR "حُذفت الرسالة.".

- [ ] **Step 1: Write the failing test** in `src/features/inbox/EditDelete.test.tsx` (Hala sends "Draft line" in the tower chat first):
  ```ts
  it('opens my last message for edit with the Up key, and saves it with Enter', async () => {
    await userEvent.click(screen.getByRole('textbox', { name: 'Message' }));
    await userEvent.keyboard('{ArrowUp}');
    const field = await within(await bubbleOf('Draft line')).findByRole('textbox', { name: 'Edit' });
    expect(field).toHaveFocus();
    await userEvent.clear(field);
    await userEvent.type(field, 'Final line{Enter}');
    expect(await bubbleOf('Final line')).toHaveTextContent('edited');
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus();
  });
  it('has Edit and Delete only on my own message', async () => { /* Faisal's msg_901 menu: Reply only */ });
  it('deletes my message with a toast, and Undo brings it back', async () => {
    // menu of 'Final line' > Delete: no question
    await waitFor(() => expect(screen.queryByText('Final line')).toBeNull());
    await userEvent.click(within(await screen.findByRole('status')).getByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('Final line')).toBeInTheDocument();
  });
  it('cancels an edit with Escape', async () => { /* the old text stays, no editedAt */ });
  it('edits and deletes my task comment in the Inbox thread, with the Undo of the comment', async () => { /* comments.update and comments.delete; toast 'Comment deleted.' */ });
  it('reads Edit, Delete and the toast in Arabic, right to left', async () => { /* 'حُذفت الرسالة.' */ });
  ```
  In `src/features/inbox/EarlierMessages.test.tsx`: `it('drops a deleted message also after an earlier page came')`.
- [ ] **Step 2: Run it:** `npx vitest run src/features/inbox/EditDelete.test.tsx src/features/inbox/EarlierMessages.test.tsx --no-file-parallelism --testTimeout=60000`.
  Expected: FAIL, the Up key opens nothing.
- [ ] **Step 3: Implement** the parts above. A bubble reads `useContext(EditingContext) === bubble.id`; an edit start or end renders
  the bubbles once, which is calm for an act this rare.
- [ ] **Step 4: Run it** again with `src/features/inbox src/features/comments`. Expected: PASS.
- [ ] **Step 5: Commit:** the files above; message: "Inbox: edit and delete an own message, the Up key, and Undo (B13)".

### Task B14: Instant send, "Not sent" and "Send again"

**Files:** Create `src/features/inbox/outbox.ts`; Modify `src/app/runtime.tsx` (`useAction` line 263),
`src/features/inbox/bubbleActions.ts`, `src/features/inbox/MessageBubble.tsx`, `src/features/inbox/ConversationPane.tsx`,
`src/i18n/real/chatmsg.*.json`, `src/test/heldRemoteApp.tsx` (the key of each call). Test: Create `src/features/inbox/outbox.test.ts`,
`src/features/inbox/InstantSend.test.tsx`.

**Interfaces.** Consumes: B7, B12 (`replyTo` of a send), `useRetryableMutate`, `renderHeldRemoteApp` (`src/test/heldRemoteApp.tsx`).
Produces:
- `useAction` returns `{ ...mutation, mutate, retry }`, where `retry(input)` is the Retry of the toast: the same input object and the
  idempotency key of its failed attempt (`AttemptKeys.again`).
- `outbox.ts`:
  - `export type Outgoing<I> = { key: string; input: I; body: string; replyTo: ReplyRef | null; at: string; seen: ReadonlySet<string>; failed: boolean; savedId?: string }`.
  - `export type SavedItem = { id: string; mine: boolean; body: string }`.
  - `export function matchOutbox<I>(outgoing: readonly Outgoing<I>[], saved: readonly SavedItem[]): { unsent: Outgoing<I>[]; claimed: string[] }`.
    The rule: an entry with `savedId` in `saved` is claimed by that item; then, oldest entry first, an entry is claimed by the oldest
    saved item that is `mine`, has the same `body`, is not in its `seen` set and is not claimed yet. So the faded copy goes when the
    saved message shows, whether the change signal or the answer comes first, and two same words ("ok", "ok") each find one copy.
  - `export function useOutbox<I>(saved: readonly SavedItem[]): { unsent: Outgoing<I>[]; claimed: ReadonlySet<string>; add(entry: Outgoing<I>): void; markFailed(input: I): void; markSaved(key: string, id: string): void; markRetry(key: string): void }`.
    `claimed` keeps every id it ever claimed for the life of the pane.
- `Bubble` gets `status?: 'pending' | 'failed'` and `fromOutbox?: true`. `export function bubbleOfOutgoing(entry: Outgoing<unknown>, me: UserCard): Bubble`
  (id `out-<key>`, mine, the body, the reply strip, no files). A saved message in `claimed` gets `fromOutbox: true`, and
  `MessageBubble` gives it no rise (`initial={fresh && !bubble.fromOutbox ? ... : false}`), so the swap from the faded copy shows no
  second motion. A pending bubble has `opacity-60` and `aria-busy="true"`. A failed bubble keeps `opacity-60` and shows a row under it:
  the `badge-alert` icon and `chat.notSent` in `text-late`, then a 44 px text button `chat.sendAgain` in `text-link`.
  `BubbleActions` gets `retry(bubble: Bubble): void`. A pending or failed bubble has no menu and no pills.
- `ChatPane` and `TaskPane`: the send adds an entry (`seen` = the ids shown now), clears the box at once, and calls `mutate(input, {
  onSuccess: (view) => markSaved(key, id) })`; `Composer` gets `pending={false}`, so the next message never waits. The `onRefused` of
  the hook marks the entry failed and returns true only while the pane is open (a mounted ref) and the error code is `failed` (the
  network or the server): a refusal also shows its toast with the reason, and a failure after the pane closed shows the toast as
  today. "Send again" calls `retry(entry.input)`.
- Words: `chat.notSent` EN "Not sent" AR "لم تُرسَل"; `chat.sendAgain` EN "Send again" AR "أرسلها مجددًا".

- [ ] **Step 1: Write the failing test.** `src/features/inbox/outbox.test.ts`:
  ```ts
  it('drops the faded copy when the saved message comes before the answer', () => {
    expect(matchOutbox([entry('k1', 'Hi', ['msg_1'])], [saved('msg_1', 'Hi'), saved('msg_2', 'Hi')])).toEqual({ unsent: [], claimed: ['msg_2'] });
  });
  it('drops the faded copy by the id of the answer', () => { /* savedId 'msg_2' */ });
  it('matches two same words one to one', () => {
    expect(matchOutbox([entry('k1', 'ok'), entry('k2', 'ok')], [saved('msg_7', 'ok')]).unsent.map((e) => e.key)).toEqual(['k2']);
  });
  it('takes no message of another person and no message that was there before', () => { /* mine false; id in seen */ });
  ```
  `src/features/inbox/InstantSend.test.tsx` (`renderHeldRemoteApp('/inbox/<tower chat id>', prepare, { fail })`; `fail` is
  `(name) => name === 'chats.send' && failing`, with a `let failing` that a test sets). First add `key: meta?.key` to each `Asked`
  record of `src/test/heldRemoteApp.tsx` (one additive field), and give the helper `keysOf(name)`, the keys of one call name in order:
  ```ts
  it('shows my message at once, faded, then once', async () => {
    hold();
    await send('Quick note');
    expect(await bubbleOf('Quick note')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('');
    await act(async () => { releaseHeld(); });
    await waitFor(() => expect(screen.getAllByText('Quick note')).toHaveLength(1));
    expect(await bubbleOf('Quick note')).not.toHaveAttribute('aria-busy');
  });
  it('shows Not sent and sends again with the same key', async () => {
    failing = true;
    await send('Lost note');
    expect(await screen.findByText('Not sent')).toBeInTheDocument();
    failing = false;
    await userEvent.click(screen.getByRole('button', { name: 'Send again' }));
    await waitFor(() => expect(screen.queryByText('Not sent')).toBeNull());
    const [first, again] = keysOf('chats.send');
    expect(again).toBe(first);
  });
  it('sends the next message while the first one waits', async () => { /* hold(), two sends: two faded bubbles, the box stays free */ });
  it('shows the toast of the failure when the chat closed before it', async () => { /* failing, send, go to /inbox: the error toast shows */ });
  it('sends a task comment the same way in the Inbox thread', async () => { /* comments.create */ });
  it('reads Not sent and Send again in Arabic, right to left', async () => { /* 'لم تُرسَل', 'أرسلها مجددًا' */ });
  ```
- [ ] **Step 2: Run it:** `npx vitest run src/features/inbox/outbox.test.ts src/features/inbox/InstantSend.test.tsx --no-file-parallelism --testTimeout=60000`.
  Expected: FAIL, `./outbox` does not exist.
- [ ] **Step 3: Implement** the parts above.
- [ ] **Step 4: Run it** again with `src/app src/features/inbox`. Expected: PASS.
- [ ] **Step 5: Commit:** the files above; message: "Inbox: my message shows at once, and a message that did not go has Send again (B14)".

### Task B15: A press on a reply strip goes to the old message (needs track read)

**Files:** Modify `src/features/inbox/ReplyStrip.tsx`, `src/features/inbox/bubbleActions.ts`, `src/features/inbox/ConversationPane.tsx`.
Test: Modify `src/features/inbox/Reply.test.tsx`.

**Interfaces.** Consumes: track read's focus task (the `MessageLog` props `focusId?: string | null` and `onFocused?: () => void`, and
its frame), B12. Produces: `BubbleActions.focusMessage(id: string): void`. `ChatPane` and `TaskPane` hold
`const [focusId, setFocusId] = useState<string | null>(null)` and pass `focusId={focusId} onFocused={() => setFocusId(null)}` to
`MessageLog`. `BubbleReplyQuote` is a button (its visible name is the name and the first line) when the link is live and
`focusMessage` exists; a deleted link stays plain text. Track find feeds the same `setFocusId` from its route parameter, and loads a
page at the old message when it is older than the loaded messages.

- [ ] **Step 1: Write the failing test** in `src/features/inbox/Reply.test.tsx`:
  `it('goes to the old message and frames it when the person presses the strip')`: press the strip of "Approved." and assert the frame
  on the bubble of `msg_901` with the same assertion as the focus test of track read. Add
  `it('has no button on the strip of a deleted message')`.
- [ ] **Step 2: Run it:** `npx vitest run src/features/inbox/Reply.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: FAIL,
  the strip is not a button.
- [ ] **Step 3: Implement** the parts above.
- [ ] **Step 4: Run it** again. Expected: PASS.
- [ ] **Step 5: Commit:** the files above; message: "Inbox: a press on a reply strip goes to the old message (B15)".

### Task B16: The task panel takes the chat look (needs track read)

**Files:** Create `src/features/comments/TaskComments.tsx`; Modify `src/features/comments/CommentThread.tsx`. Test: Create
`src/features/comments/TaskCommentLook.test.tsx`; Modify `src/features/comments/CommentThread.test.tsx` (the test "toggles a
reaction" now opens the menu first).

**Interfaces.** Consumes: B11 to B13, `useDayLabel` (B7), track read's run rule (`src/features/inbox/runs.ts`) and the `runStart` prop
of `MessageBubble`. Produces:
- `export function TaskComments({ targetId, list, people, canPost, onReply }: { targetId: string; list: CommentView[]; people: UserCard[]; canPost: boolean; onReply: (ref: ReplyRef) => void })`:
  the comments by day (`groupByDay` and `useDayLabel`), each message as `MessageBubble` with `runStart` from track read's run rule,
  inside its own `BubbleActionsContext` and `EditingContext` (react `reactions.toggle { commentId }`, reply `onReply`, edit
  `comments.update`, delete `useUndoable('comments.delete')`, `menuLabel` `comments.actions`). A quiet line keeps today's line look of
  `CommentItem` (the age, the moved dates, Edit for the author of a date reason). A press on a reply strip scrolls the old comment to
  the middle (`scrollIntoView({ block: 'center' })`) and gives it the focus. The comments stay in the scroll of the panel: no Newest
  button, no "New" line, and the panel layout stays (design item 6).
- `CommentThread` renders `TaskComments` for `targetType === 'task'` and today's `CommentItem` list for a post. The box of a task
  holds `ComposerReplyStrip` above its field and sends `replyToId`; the send stays as today (no faded copy in the panel).
- After an edit in the panel, the focus goes back to the menu button of that comment (`useEditFocus`), so
  `src/features/comments/EditFocus.test.tsx` stays green unchanged.

- [ ] **Step 1: Write the failing test** in `src/features/comments/TaskCommentLook.test.tsx` (`/projects/prj_001?tab=tasks&task=tsk_007&thread=1`
  as usr_006, with two comments of usr_002 one minute apart and one of usr_006):
  ```ts
  it('draws a task comment as a bubble with a run, pills and the menu', async () => {
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    const comments = within(within(sheet).getByRole('region', { name: 'Comments' }));
    expect(comments.getAllByText('Faisal Al-Harbi')).toHaveLength(1);
    await userEvent.click(within(commentOf('Second note')).getByRole('button', { name: 'Actions for this comment' }));
    expect(screen.getByRole('menu', { name: 'Actions for this comment' })).toBeInTheDocument();
  });
  it('replies to a task comment from the panel', async () => { /* Reply > strip 'Reply to Faisal Al-Harbi' > Send: comments.create with replyToId */ });
  it('keeps a quiet line of a date reason as a grey line with its Edit', async () => { /* a comment with dates */ });
  it('keeps the comments of a post as they are today', async () => { /* /projects/prj_001?tab=activity: three reaction buttons under a post comment */ });
  it('reads the panel in Arabic, right to left', async () => { /* the menu button 'إجراءات هذا التعليق' and dir rtl */ });
  ```
- [ ] **Step 2: Run it:** `npx vitest run src/features/comments --no-file-parallelism --testTimeout=60000`. Expected: FAIL, the name shows
  twice.
- [ ] **Step 3: Implement** the parts above.
- [ ] **Step 4: Run it** again with `src/features/project/tasks src/features/comments`. Expected: PASS.
- [ ] **Step 5: Commit:** the files above; message: "Task panel: a comment takes the look of the chat (B16)".

### Task B17: The bell line "X replied to you", and What's new

**Files:** Modify `src/features/notifications/NotificationsScreen.tsx` (`sentenceKey`, line 75), `src/whatsNew/entries.ts`,
`src/i18n/real/whatsnew.en.json`, `src/i18n/real/whatsnew.ar.json`, `src/i18n/real/chatmsg.*.json`. Test: Create
`src/features/notifications/ReplyNotices.test.tsx`.

**Interfaces.** Consumes: B4, B6. Produces: a notice with `trigger === 'mention'` and `reply === true` takes the sentence
`notices.repliedDirect` in a direct chat, `notices.repliedGroupGone` in a group the reader left (`target === ''`), and
`notices.repliedToYou` otherwise (a project chat, a group, a task: `{{target}}` is its name, between FSI and PDI for a group as today).
The link, the face and the row stay as for a mention. What's new: `{ id: '2026-10-23-30', day: '2026-10-23', to: '/inbox' }` at the top
(the merge lead gives another number if a track took 30).
- Words (with the `_female` form of each Arabic verb after a name, `src/i18n/CLAUDE.md`):
  - `notices.repliedToYou`: EN "{{actor}} replied to you in {{target}}" AR "{{actor}} ردّ عليك في {{target}}", `_female` "{{actor}} ردّت عليك في {{target}}".
  - `notices.repliedDirect`: EN "{{actor}} replied to you in a direct message" AR "{{actor}} ردّ عليك في رسالة مباشرة", `_female` "{{actor}} ردّت عليك في رسالة مباشرة".
  - `notices.repliedGroupGone`: EN "{{actor}} replied to you in a group" AR "{{actor}} ردّ عليك في مجموعة", `_female` "{{actor}} ردّت عليك في مجموعة".
  - `whatsNew.items.2026-10-23-30.title`: EN "Reply, react and edit in chats" AR "ردّ وتفاعل وعدّل في المحادثات".
  - `whatsNew.items.2026-10-23-30.body`: EN "Each message has a small menu. React to it, reply to it, or edit and delete your own message.
    A reply tells the person you answer. Your message shows at once, and a message that did not go has Send again." AR "لكل رسالة قائمة
    صغيرة: تفاعل معها، أو ردّ عليها، أو عدّل رسالتك واحذفها. الرد يصل إلى الشخص الذي ترد عليه. تظهر رسالتك فورًا، وإن لم تُرسَل تجد زر «أرسلها مجددًا»."

- [ ] **Step 1: Write the failing test** in `src/features/notifications/ReplyNotices.test.tsx` (`renderApp('/notifications')` as Hala with
  planted notices from Faisal and from Reem Al-Ghamdi, who is female):
  ```ts
  it('says "replied to you" for a reply notice in a project chat, a direct chat and a task', async () => {
    expect(await screen.findByText('Faisal Al-Harbi replied to you in Corniche Office Tower')).toBeInTheDocument();
    expect(screen.getByText('Faisal Al-Harbi replied to you in a direct message')).toBeInTheDocument();
    expect(screen.getByText('Faisal Al-Harbi replied to you in Stair details')).toBeInTheDocument();
  });
  it('keeps the mention line for a notice with no reply mark', async () => { /* 'Faisal Al-Harbi mentioned you in Corniche Office Tower' */ });
  it('reads the reply lines in Arabic, with the female verb after a woman', async () => {
    expect(await screen.findByText('ريم الغامدي ردّت عليك في رسالة مباشرة')).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
  });
  ```
  `src/whatsNew/entries.test.ts` checks the new entry (id form, words in both languages, no em-dash).
- [ ] **Step 2: Run it:** `npx vitest run src/features/notifications/ReplyNotices.test.tsx src/whatsNew src/i18n --no-file-parallelism --testTimeout=60000`.
  Expected: FAIL, the line says "mentioned you".
- [ ] **Step 3: Implement** the key choice and the entry above.
- [ ] **Step 4: Run it** again with `src/features/notifications`. Expected: PASS.
- [ ] **Step 5: Commit:** the files above; message: "Bell: a reply notice says replied to you, and What's new names the message menu (B17)".


---

## Track read

**Track scope.** Design items 1 (keep my place, the Newest button), 2 (runs), 3 (the "New" line), 4 (the "names you" mark and
its two tokens), 5 (read only while you look), 7 (links, drafts that survive a closed tab, Enter on a phone), 8 (the chat
title cuts at its end) and 14 (drop and paste files, the progress bar). It also builds the `focusId` frame of the shared
`MessageLog` props ("scroll to this message, put it in the middle, give it a soft frame for one second") that tracks msg and
find pass. Words file: `src/i18n/real/chatread.en.json` and `chatread.ar.json`. Prefix A. Track read adds no call, changes no
rule an agent reads and writes no SQL: no MCP change (`server/mcp/tools.ts`, `TOOL_DOCS`, `INSTRUCTIONS` stay), no
`_LITE` twin, no rows pin, no leak test (the track hides no record).

**Order.** Wave 2, rebased on the base of track msg (Tasks B1 to Bk). Every task below needs the base screen split
(`MessageLog.tsx`, `MessageBubble.tsx`, `Composer.tsx`, with `Thread.tsx` re-exporting what the panes import). A2 also needs
`MessageView.namesMe` and `CommentView.namesMe`; A4 needs `ChatThread.readUpTo`. No task needs a task of tracks find or notify.
Track read merges first, so A5 (the focus frame) is on main before tracks msg and find rebase.

**Run tests with** `npx vitest run <files> --no-file-parallelism --testTimeout=60000`. **Typecheck:** `npm run typecheck`.

### Files

| File | Change | Responsibility |
| --- | --- | --- |
| `src/features/inbox/runs.ts` | Create | `runStarts`: which bubble starts a run (item 2). Pure. |
| `src/features/inbox/newLine.ts` | Create | `firstUnreadId` (where the New line goes) and `useOpenMark` (the read state at the open). |
| `src/features/inbox/logScroll.ts` | Create | `scrollTopFor` and `isNearBottom`: the scroll math of the log. Pure. |
| `src/features/inbox/ChatDrop.tsx` | Create | `ChatDropArea` (the drop frame over an open chat) and `useChatDropReceiver` (the box takes the files). |
| `src/app/usePageVisible.ts` | Create | `usePageVisible()`: true while the tab shows. |
| `src/features/inbox/logHarness.tsx` | Create | Test helper: `renderLog`, `makeBubble`, `talk`, `measureLog`, `rowOf`, sample people cards. |
| `src/features/inbox/MessageLog.tsx` | Modify | Runs, keep the place, Newest button, New line, focus frame. |
| `src/features/inbox/MessageBubble.tsx` | Modify | Props `runStart`, `namesMe`, `framed`; `data-message-id`; the side spot for the hover time. |
| `src/features/inbox/Composer.tsx` | Modify | Enter on a phone, paste, the drop receiver, the progress bars. |
| `src/features/inbox/Thread.tsx` | Modify | `Bubble.namesMe?: boolean` (wherever the base defines `Bubble`; `Thread.tsx` exports it). |
| `src/features/inbox/ConversationPane.tsx` | Modify | Mark read only while visible, the open mark and its busy gate, `ChatDropArea`, the title string. |
| `src/features/comments/markRead.ts` | Modify | A task thread is marked once for each new count, only while visible. |
| `src/lib/text.ts`, `src/components/RichText.tsx` | Modify | Web addresses become links (item 7). |
| `src/app/drafts.ts` | Modify | Drafts in localStorage; sign-out clears both stores. |
| `src/features/files/Attachments.tsx` | Modify | `add` takes an array; `progress`; `PickedFiles` draws the bar and locks Remove while uploads run. |
| `src/api/client.ts`, `src/api/remote/upload.ts` | Modify | `CallMeta.onProgress`; the file upload reports its progress. |
| `src/design/tokens.css`, `DESIGN.md`, `src/design/tokens.test.ts` | Modify | `--c-mention-bg`, `--c-mention-bar`. |
| `src/i18n/real/chatread.en.json`, `chatread.ar.json` | Create | The words of track read. |
| `src/whatsNew/entries.ts`, `src/i18n/real/whatsnew.en.json`, `whatsnew.ar.json` | Modify | Two What's new lines. |
| `src/CLAUDE.md` | Modify | New section "Chat reading (track read, 2026-10-19)", one bullet for each task. |
| Tests | Create | `runs.test.ts`, `MessageLog.runs.test.tsx`, `MessageBubble.mark.test.tsx`, `logScroll.test.ts`, `MessageLog.place.test.tsx`, `newLine.test.ts`, `NewLine.test.tsx`, `MessageLog.focus.test.tsx`, `src/app/usePageVisible.test.tsx`, `ReadWhileVisible.test.tsx`, `src/components/RichText.test.tsx`, `src/app/drafts.test.ts`, `ComposerKeys.test.tsx`, `ChatTitle.test.tsx`, `ChatUpload.test.tsx`, `ChatDrop.test.tsx` (all in `src/features/inbox/` unless a path is given). |
| Tests | Modify | `src/lib/text.test.ts`, `src/api/remote/upload.test.ts`, the draft helpers of `src/features/auth/signOut.test.tsx`, `src/features/auth/AuthGate.test.tsx`, `src/features/inbox/InboxScreen.test.tsx`. |

Rules every screen task follows (cite them in review): tokens only (`src/design/CLAUDE.md`); logical sides only, `dir="auto"`
only on text, never on a flex or grid box (`src/CLAUDE.md`, RTL; `scripts/check-rtl.ts`); names in `<bdi>`; chat text keeps
`natural-side`; 44 px press areas, nothing under 12 px; navy only on the main button; no face stacks; red only for Late and
errors; icons through `AnimatedIcon`; every word an English (STE, no em-dash) and an Arabic key in the track's own files
(`src/i18n/CLAUDE.md`: a key may not exist twice). Each screen task ends with a jsdom test in English and one in Arabic
(`dir="rtl"`), with `expectCalm` (`src/features/auth/calmChecks.ts`) where a whole pane renders. App tests (`renderApp` from
`src/test/render.tsx`) copy the helpers `list`, `rowLink`, `settle` and `withTaskTalk` from the top of
`src/features/inbox/InboxScreen.test.tsx` (Hala, `usr_001`, is the reader; the tower chat holds 2 unread messages, the chat
with Faisal 1).

---

### Task A1: Runs of one person

**Files**
- Create: `src/features/inbox/runs.ts`, `src/features/inbox/runs.test.ts`, `src/features/inbox/logHarness.tsx`, `src/features/inbox/MessageLog.runs.test.tsx`
- Modify: `src/features/inbox/MessageLog.tsx` (the list render), `src/features/inbox/MessageBubble.tsx` (the bubble), `src/CLAUDE.md` (new section)

**Interfaces**
- Consumes (base): `Bubble` (exported by `Thread.tsx`), `MessageLog` with props `{ bubbles, resetKey, emptyText, earlier }`, the memo bubble component of `MessageBubble.tsx` (today's `BubbleItem`, props `{ bubble, fresh }`), `stampDay` (`src/lib/dates.ts`).
- Produces:
  - `export const RUN_GAP_MS = 300_000;`
  - `export type RunItem = { id: string; author: { id: string; kind: 'human' | 'agent' }; createdAt: string; line?: unknown; reason?: unknown };` (a `Bubble` fits it)
  - `export function runStarts(items: readonly RunItem[], breakBefore?: string | null): Set<string>`
  - `export type MessageLogProps` (exported from `MessageLog.tsx`; A3 to A5 add fields to it)
  - Bubble prop `runStart: boolean`; the root `<li>` of every item that the bubble component draws (bubble, group line, reason line) has `data-message-id={bubble.id}` and the class `group`; a side spot `<div data-part="side">` beside the bubble (end side for another person, start side for your own). Track msg puts its "..." button in this side spot.
  - Harness (`logHarness.tsx`): `FAISAL`, `OMAR`, `HALA`, `AGENT` (`UserCard`s: `usr_002` Faisal Al-Harbi, `usr_004` Omar Haddad, `usr_001` Hala Nasser, `usr_090` "Site notes agent" kind `agent`); `makeBubble(over: Partial<Bubble> & Pick<Bubble, 'id' | 'createdAt' | 'body'>): Bubble` (defaults: author `FAISAL`, `actingFor: null`, `files: []`, `mine: false`, `edited: false`); `talk(n: number): Bubble[]` (ids `msg_1` to `msg_n`, bodies `Note 1` to `Note n`, authors FAISAL and OMAR in turn, 10 minutes apart from `2026-09-29T09:00:00.000+03:00`); `renderLog(props: Partial<MessageLogProps> & { bubbles: Bubble[] }, o?: { lang?: 'en' | 'ar' }): { log: HTMLElement; rerender(next: Partial<MessageLogProps> & { bubbles: Bubble[] }): void }` (the runtime of `src/test/render.tsx`: `buildSeed(TODAY)`, `createApi(calls, { store, latencyMs: 0 })`, `RuntimeProvider`, `ToastProvider`, `initI18n(lang)`, `document.documentElement.dir = 'rtl'` for Arabic; defaults `resetKey: 'cnv_test'`, `emptyText: 'No messages'`); `measureLog(log)` (the `measure` of `MessageLog.stick.test.tsx`: scrollHeight 1000 that `grow(by)` raises, clientHeight 500, settable scrollTop; returns `{ at, top, grow }`); `rowOf(text: string): HTMLElement` (the closest `li` of the text).

- [ ] **Step 1: Write the failing tests.**

`src/features/inbox/runs.test.ts`:
```ts
const at = (hm: string, day = '2026-09-29') => `${day}T${hm}:00.000+03:00`;
const item = (id: string, authorId: string, createdAt: string, extra: Partial<RunItem> = {}): RunItem =>
  ({ id, author: { id: authorId, kind: 'human' }, createdAt, ...extra });
const starts = (items: RunItem[], breakBefore?: string) => [...runStarts(items, breakBefore)];

describe('runs of one person (design item 2)', () => {
  it('joins the messages of one person when each comes within 5 minutes of the one before', () => {
    expect(starts([item('a', 'usr_002', at('10:00')), item('b', 'usr_002', at('10:03')), item('c', 'usr_002', at('10:07'))])).toEqual(['a']);
  });
  it('counts 5 minutes as the same run, and 5 minutes and 1 second as a new run', () => {
    expect(RUN_GAP_MS).toBe(300_000);
    expect(starts([item('a', 'usr_002', at('10:00')), item('b', 'usr_002', at('10:05'))])).toEqual(['a']);
    expect(starts([item('a', 'usr_002', at('10:00')), item('b', 'usr_002', '2026-09-29T10:05:01.000+03:00')])).toEqual(['a', 'b']);
  });
  it('starts a new run for another person, after a quiet line or a reason line, and on a new office day', () => {
    expect(starts([item('a', 'usr_002', at('10:00')), item('b', 'usr_004', at('10:01'))])).toEqual(['a', 'b']);
    expect(starts([item('a', 'usr_002', at('10:00')), item('l', 'usr_002', at('10:01'), { line: {} }), item('b', 'usr_002', at('10:02'))])).toEqual(['a', 'l', 'b']);
    expect(starts([item('a', 'usr_002', at('10:00')), item('r', 'usr_002', at('10:01'), { reason: {} }), item('b', 'usr_002', at('10:02'))])).toEqual(['a', 'r', 'b']);
    expect(starts([item('a', 'usr_002', at('23:58', '2026-09-28')), item('b', 'usr_002', at('00:01'))])).toEqual(['a', 'b']);
  });
  it('gives each agent message its own run, and starts a run after it', () => {
    const agent = (id: string, time: string): RunItem => ({ id, author: { id: 'usr_090', kind: 'agent' }, createdAt: at(time) });
    expect(starts([agent('a', '10:00'), agent('b', '10:01'), item('c', 'usr_090', at('10:02'))])).toEqual(['a', 'b', 'c']);
  });
  it('starts a run at the message under the New line', () => {
    expect(starts([item('a', 'usr_002', at('10:00')), item('b', 'usr_002', at('10:01'))], 'b')).toEqual(['a', 'b']);
  });
});
```

`src/features/inbox/MessageLog.runs.test.tsx`:
```ts
describe('runs in the message log (design item 2)', () => {
  it('shows the face and the name once, and the time of a next message beside its bubble on hover or focus', () => {
    renderLog({ bubbles: [
      makeBubble({ id: 'msg_1', createdAt: '2026-09-29T10:00:00.000+03:00', body: 'First line.' }),
      makeBubble({ id: 'msg_2', createdAt: '2026-09-29T10:04:00.000+03:00', body: 'Second line.' }),
    ] });
    const first = rowOf('First line.');
    const second = rowOf('Second line.');
    expect(within(first).getByRole('img', { name: 'Faisal Al-Harbi' })).toBeInTheDocument();
    expect(within(first).getByText('Faisal Al-Harbi')).toBeInTheDocument();
    expect(within(second).queryByRole('img', { name: 'Faisal Al-Harbi' })).toBeNull();
    expect(within(second).queryByText('Faisal Al-Harbi')).toBeNull();
    expect(second).toHaveAttribute('data-message-id', 'msg_2');
    const time = second.querySelector('time');
    expect(time).toHaveAttribute('dateTime', '2026-09-29T10:04:00.000+03:00');
    expect(time?.closest('[data-part="side"]')).not.toBeNull();
    // Opacity, not visibility: a screen reader still reads the time.
    expect(time?.className).toMatch(/(^|\s)opacity-0(\s|$)/);
    expect(time?.className).toMatch(/group-hover:opacity-100/);
    expect(time?.className).toMatch(/group-focus-within:opacity-100/);
    expect(first.querySelector('[data-part="side"] time')).toBeNull();
  });
  it('keeps the Agent label and "for <name>" on each agent message', () => {
    renderLog({ bubbles: [
      makeBubble({ id: 'msg_1', author: AGENT, actingFor: OMAR, createdAt: '2026-09-29T10:00:00.000+03:00', body: 'Notes one.' }),
      makeBubble({ id: 'msg_2', author: AGENT, actingFor: OMAR, createdAt: '2026-09-29T10:01:00.000+03:00', body: 'Notes two.' }),
    ] });
    for (const text of ['Notes one.', 'Notes two.']) {
      expect(within(rowOf(text)).getByText('Agent')).toBeInTheDocument();
      expect(within(rowOf(text)).getByText('for Omar Haddad')).toBeInTheDocument();
    }
  });
  it('reads in Arabic right to left with the same runs', () => {
    renderLog({ bubbles: [
      makeBubble({ id: 'msg_1', createdAt: '2026-09-29T10:00:00.000+03:00', body: 'السطر الأول.' }),
      makeBubble({ id: 'msg_2', createdAt: '2026-09-29T10:02:00.000+03:00', body: 'السطر الثاني.' }),
    ] }, { lang: 'ar' });
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByRole('log', { name: 'الرسائل' })).toBeInTheDocument();
    expect(within(rowOf('السطر الثاني.')).queryByRole('img')).toBeNull();
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/features/inbox/runs.test.ts src/features/inbox/MessageLog.runs.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: FAIL with "Cannot find module './runs'" and, in the log test, the second row still shows the face and the name.

- [ ] **Step 3: Implement.**
  - `runStarts` in `src/features/inbox/runs.ts`. An item starts a run when one of these is true: it is the first item; it or the item before it has `line` or `reason`; the author ids differ; it or the item before it has `author.kind === 'agent'`; `stampDay` of the two `createdAt` differs; `Date.parse(item) - Date.parse(before) > RUN_GAP_MS`; `item.id === breakBefore`. The gap counts from the item before, not from the start of the run. The set keeps the list order.
  - `MessageLog` computes `const starts = useMemo(() => runStarts(bubbles), [bubbles])` (A4 adds the second argument) and passes `runStart={starts.has(bubble.id)}`. The list `ol` changes from `gap-2` to `gap-0.5`; a run start `li` gets `mt-1.5`, so the space between runs stays 8 px and the space inside a run is 2 px.
  - The bubble with `runStart` false: no `Avatar`, but a `<span aria-hidden className="w-7 shrink-0" />` keeps the face column for another person; no name line; no clock inside the bubble (the "edited" word stays inside, without the time); the corner on the start side of the top is small too (`rounded-ss-md` for another person, `rounded-se-md` for your own). The side spot `<div data-part="side" className="flex items-center gap-1.5 self-center">` holds `<time dateTime=… className="tabular text-caption text-ink-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">`. An agent message is always a run start, so it keeps `AgentLabel` and "for <name>" as today. Keep the bubble memoized: `runStart` is a boolean prop.
  - `src/CLAUDE.md`: add the section `## Chat reading (track read, 2026-10-19)` after "Inbox, groups and What's new", with the bullet: "Runs (`features/inbox/runs.ts`): the messages of one person within 5 minutes of the one before form a run; a new day, a quiet line, another person, an agent message or the New line starts a run. A next message shows no face and no name; its time sits in the side spot (`data-part="side"`) at opacity 0 until hover or focus."
- [ ] **Step 4: Run** the command of Step 2, then `npx vitest run src/features/inbox --no-file-parallelism --testTimeout=60000` (the base tests of the Inbox stay green). Expected: PASS.
- [ ] **Step 5: Commit.** `git add src/features/inbox/runs.ts src/features/inbox/runs.test.ts src/features/inbox/logHarness.tsx src/features/inbox/MessageLog.runs.test.tsx src/features/inbox/MessageLog.tsx src/features/inbox/MessageBubble.tsx src/CLAUDE.md` and `git commit -m "Chat: messages of one person within 5 minutes form a run with one face and one name (design item 2)"`.

---

### Task A2: The "names you" mark and its two tokens

**Files**
- Create: `src/features/inbox/MessageBubble.mark.test.tsx`, `src/i18n/real/chatread.en.json`, `src/i18n/real/chatread.ar.json`
- Modify: `src/design/tokens.css`, `DESIGN.md`, `src/design/tokens.test.ts`, `src/features/inbox/Thread.tsx` (the `Bubble` type), `src/features/inbox/MessageBubble.tsx`, `src/features/inbox/MessageLog.tsx`, `src/features/inbox/ConversationPane.tsx` (`bubbleOfMessage` and the comment bubble of `TaskPane`), `src/CLAUDE.md`

**Interfaces**
- Consumes (base): `MessageView.namesMe: boolean`, `CommentView.namesMe: boolean`.
- Produces: tokens `--c-mention-bg` (light `#F4EDFF`, dark `#2D2442`) and `--c-mention-bar` (light `#7E22CE`, dark `#C29BFF`), Tailwind colors `mention-bg` and `mention-bar` (`--color-mention-bg: var(--c-mention-bg)` and `--color-mention-bar: var(--c-mention-bar)` in `@theme inline`); `Bubble.namesMe?: boolean`; bubble prop `namesMe: boolean`; word `chat.namesYou`.

- [ ] **Step 1: Write the failing tests.**

`src/design/tokens.test.ts`, new describe:
```ts
describe('the names-you mark (chat design item 4)', () => {
  it('has its two tokens in light and dark', () => {
    expect(token(':root', '--c-mention-bg')).toBe('#F4EDFF');
    expect(token(':root', '--c-mention-bar')).toBe('#7E22CE');
    expect(token('[data-theme="dark"]', '--c-mention-bg')).toBe('#2D2442');
    expect(token('[data-theme="dark"]', '--c-mention-bar')).toBe('#C29BFF');
  });
  it('keeps the text 4.5:1 and the bar 3:1 on the tint, in light and dark', () => {
    for (const block of [':root', '[data-theme="dark"]']) {
      const tint = hex(token(block, '--c-mention-bg'));
      for (const name of ['--c-ink', '--c-ink-2', '--c-link']) expect(contrast(hex(token(block, name)), tint), `${name} in ${block}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(hex(token(block, '--c-mention-bar')), tint)).toBeGreaterThanOrEqual(3);
    }
  });
});
```

`src/features/inbox/MessageBubble.mark.test.tsx`:
```ts
describe('the names-you mark (design item 4)', () => {
  it('gives a message that names the reader a soft tint, a bar on its start side and a hidden sentence', () => {
    renderLog({ bubbles: [
      makeBubble({ id: 'msg_1', createdAt: '2026-09-29T08:20:00.000+03:00', body: 'Can you approve one more soil test?', namesMe: true }),
      makeBubble({ id: 'msg_2', author: OMAR, createdAt: '2026-09-29T08:30:00.000+03:00', body: 'The lab is free on Sunday.' }),
    ] });
    const named = rowOf('Can you approve one more soil test?');
    const hidden = within(named).getByText('This message names you.');
    expect(hidden).toHaveClass('sr-only');
    const bubble = hidden.parentElement as HTMLElement;
    expect(bubble.className).toMatch(/(^|\s)bg-mention-bg(\s|$)/);
    expect(bubble.className).not.toMatch(/(^|\s)bg-fill(\s|$)/);
    expect(bubble.querySelector('.bg-mention-bar')?.className).toMatch(/(^|\s)start-1\.5(\s|$)/);
    expect(within(rowOf('The lab is free on Sunday.')).queryByText('This message names you.')).toBeNull();
  });
  it('never marks your own message, and never moves or turns red', () => {
    renderLog({ bubbles: [makeBubble({ id: 'msg_1', author: HALA, mine: true, createdAt: '2026-09-29T08:40:00.000+03:00', body: 'Approved.', namesMe: true })] });
    expect(within(rowOf('Approved.')).queryByText('This message names you.')).toBeNull();
    expect(document.querySelector('.bg-mention-bg, [class*="animate-"], [class*="text-late"], [class*="bg-late"]')).toBeNull();
  });
  it('says the hidden sentence in Arabic', () => {
    renderLog({ bubbles: [makeBubble({ id: 'msg_1', createdAt: '2026-09-29T08:20:00.000+03:00', body: 'هل توافقين؟', namesMe: true })] }, { lang: 'ar' });
    expect(within(rowOf('هل توافقين؟')).getByText('هذه الرسالة تذكرك.')).toHaveClass('sr-only');
  });
});
```
Add one app test to the same file, "marks a message of the tower chat that names Hala": `renderApp('/inbox', prepare)` where `prepare` adds to the tower chat (`projectId === 'prj_001'`) the message `{ id: 'msg_998', conversationId: room.id, authorId: 'usr_005', actingForId: 'usr_005', body: '@[Hala Nasser](usr_001) please check the riser.', mentions: ['usr_001'], fileIds: [], createdAt: '2026-09-30T08:10:00.000+03:00', editedAt: null }`; open the tower chat; then `expect(within(screen.getByText(/please check the riser/).closest('li') as HTMLElement).getByText('This message names you.')).toHaveClass('sr-only')`. This proves that the pane passes `MessageView.namesMe` to the bubble.

- [ ] **Step 2: Run** `npx vitest run src/design/tokens.test.ts src/features/inbox/MessageBubble.mark.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: FAIL with "--c-mention-bg is missing in :root" and "Unable to find an element with the text: This message names you."

- [ ] **Step 3: Implement.**
  - `tokens.css`: the two tokens in `:root` and in `[data-theme="dark"]`, and the two `--color-*` lines in `@theme inline` (`src/design/CLAUDE.md`, "When you change a token", step 1).
  - `DESIGN.md` (step 2 of the same rule): colors `mention: "#F4EDFF"`, `mention-bar: "#7E22CE"`, `mention-dark: "#2D2442"`, `mention-bar-dark: "#C29BFF"`; components `message-names-you` (`backgroundColor: "{colors.mention}"`, `textColor: "{colors.on-surface}"`), `message-names-you-bar` (`backgroundColor: "{colors.mention-bar}"`, `width: 3px`), `message-names-you-dark` (`backgroundColor: "{colors.mention-dark}"`, `textColor: "{colors.on-surface-dark}"`), `message-names-you-bar-dark` (`backgroundColor: "{colors.mention-bar-dark}"`); one Colors bullet: "**Names you:** a chat message or a comment that names the reader sits on {colors.mention} with a 3 px {colors.mention-bar} bar on its start side ({colors.mention-dark} and {colors.mention-bar-dark} in dark). Only the reader sees it. No motion, no red." Then step 3: `npm_config_cache="$TMPDIR/npm-cache" npx -y @google/design.md lint DESIGN.md` shows 0 errors and 0 warnings.
  - `Bubble` gets `namesMe?: boolean`. `bubbleOfMessage` sets `namesMe: view.namesMe`; the comment bubble of `TaskPane` sets `namesMe: view.namesMe`. `MessageLog` passes `namesMe={bubble.namesMe ?? false}`.
  - The bubble with `namesMe` and not `mine`: the bubble `div` takes `relative ps-4 bg-mention-bg` in place of `bg-fill`, holds `<span aria-hidden className="absolute inset-y-2 start-1.5 w-[3px] rounded-full bg-mention-bar" />`, and starts with `<span className="sr-only">{t('chat.namesYou')}</span>`. Your own bubble keeps its blue and never draws the mark.
  - Words, `chatread.en.json`: `{ "chat": { "namesYou": "This message names you." } }`; `chatread.ar.json`: `{ "chat": { "namesYou": "هذه الرسالة تذكرك." } }`.
  - `src/CLAUDE.md` bullet: "Names you: `MessageView.namesMe` and `CommentView.namesMe` (a mention or a reply to you) give another person's bubble `bg-mention-bg`, a 3 px `bg-mention-bar` on its start side and the hidden sentence `chat.namesYou`."
- [ ] **Step 4: Run** the command of Step 2 and `npx vitest run src/i18n --no-file-parallelism --testTimeout=60000`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add src/design/tokens.css DESIGN.md src/design/tokens.test.ts src/features/inbox/MessageBubble.mark.test.tsx src/features/inbox/Thread.tsx src/features/inbox/MessageBubble.tsx src/features/inbox/MessageLog.tsx src/features/inbox/ConversationPane.tsx src/i18n/real/chatread.en.json src/i18n/real/chatread.ar.json src/CLAUDE.md` (add `src/features/inbox/MessageBubble.tsx` again if the base keeps `Bubble` there) and `git commit -m "Chat: a message that names the reader gets a soft lilac tint and a bar on its start side (design item 4)"`.

---

### Task A3: Keep my place, and the Newest button

**Files**
- Create: `src/features/inbox/logScroll.ts`, `src/features/inbox/logScroll.test.ts`, `src/features/inbox/MessageLog.place.test.tsx`
- Modify: `src/features/inbox/MessageLog.tsx`, `src/i18n/real/chatread.en.json`, `chatread.ar.json`, `src/CLAUDE.md`

**Interfaces**
- Produces:
  - `export const BOTTOM_ZONE = 80;` `export function isNearBottom(log: { scrollHeight: number; scrollTop: number; clientHeight: number }): boolean` (true when `scrollHeight - scrollTop - clientHeight < BOTTOM_ZONE`, the rule of today).
  - `export const START_GAP = 16;` `export function scrollTopFor(scrollTop: number, view: { top: number; height: number }, item: { top: number; height: number }, where: 'start' | 'center'): number` (A4 and A5 use it; never below 0).
  - Word `chat.newest`.

- [ ] **Step 1: Write the failing tests.**

`logScroll.test.ts`:
```ts
it('says the bottom zone is the last 80 px', () => {
  expect(isNearBottom({ scrollHeight: 1000, scrollTop: 430, clientHeight: 500 })).toBe(true);
  expect(isNearBottom({ scrollHeight: 1000, scrollTop: 420, clientHeight: 500 })).toBe(false);
});
it('puts an item 16 px under the top, or in the middle, and never above 0', () => {
  expect(scrollTopFor(500, { top: 100, height: 600 }, { top: 400, height: 80 }, 'start')).toBe(784);
  expect(scrollTopFor(500, { top: 100, height: 600 }, { top: 400, height: 80 }, 'center')).toBe(540);
  expect(scrollTopFor(0, { top: 100, height: 600 }, { top: 100, height: 40 }, 'start')).toBe(0);
});
```

`MessageLog.place.test.tsx` (harness; `const LATER = '2026-09-29T11:00:00.000+03:00'`; `newest = () => within(screen.getByRole('log', { name: 'Messages' })).queryByRole('button', { name: 'Go to the newest message' })`):
```ts
describe('the log keeps the place of the reader (design item 1)', () => {
  it('keeps a person who reads older messages still when a message of another person comes, and shows the Newest button', () => {
    const view = renderLog({ bubbles: talk(10) });
    const box = measureLog(view.log);
    box.at(100); fireEvent.scroll(view.log);
    view.rerender({ bubbles: [...talk(10), makeBubble({ id: 'msg_new', author: OMAR, createdAt: LATER, body: 'A new note.' })] });
    expect(box.top()).toBe(100);
    expect(newest()).toBeInTheDocument();
  });
  it('follows the newest message for a person at the bottom, and shows no Newest button there', () => {
    const view = renderLog({ bubbles: talk(10) });
    const box = measureLog(view.log);
    box.at(500); fireEvent.scroll(view.log);
    expect(newest()).toBeNull();
    view.rerender({ bubbles: [...talk(10), makeBubble({ id: 'msg_new', author: OMAR, createdAt: LATER, body: 'A new note.' })] });
    expect(box.top()).toBe(1000);
  });
  it('goes down for your own new message, also when you read older ones', () => {
    const view = renderLog({ bubbles: talk(10) });
    const box = measureLog(view.log);
    box.at(100); fireEvent.scroll(view.log);
    view.rerender({ bubbles: [...talk(10), makeBubble({ id: 'msg_mine', author: HALA, mine: true, createdAt: LATER, body: 'My answer.' })] });
    expect(box.top()).toBe(1000);
  });
  it('does not move when the last message goes (a delete), because that is no new message', () => {
    const view = renderLog({ bubbles: talk(10) });
    const box = measureLog(view.log);
    box.at(100); fireEvent.scroll(view.log);
    view.rerender({ bubbles: talk(10).slice(0, 9) });
    expect(box.top()).toBe(100);
  });
  it('goes to the newest message on a press of Newest, puts the focus in the log, and the button goes', async () => {
    const view = renderLog({ bubbles: talk(10) });
    const box = measureLog(view.log);
    box.at(100); fireEvent.scroll(view.log);
    await userEvent.click(newest()!);
    expect(box.top()).toBe(1000);
    expect(view.log).toHaveFocus();
    expect(newest()).toBeNull();
  });
  it('draws a still button: no count, no motion, not navy, a 44 px round press area', () => {
    const view = renderLog({ bubbles: talk(10) });
    measureLog(view.log).at(100); fireEvent.scroll(view.log);
    const button = newest()!;
    expect(button.textContent).toBe('');
    expect(button.className).not.toMatch(/signature|animate-/);
    expect(button.className).toMatch(/(^|\s)size-11(\s|$)/);
    expect(button.closest('[aria-live="off"]')).not.toBeNull();
  });
  it('names the button in Arabic', () => {
    const view = renderLog({ bubbles: talk(10) }, { lang: 'ar' });
    measureLog(view.log).at(100); fireEvent.scroll(view.log);
    expect(within(view.log).getByRole('button', { name: 'انتقل إلى أحدث رسالة' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/features/inbox/logScroll.test.ts src/features/inbox/MessageLog.place.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: FAIL with "Cannot find module './logScroll'" and "expected 1000 to be 100" (today every new last message scrolls).
- [ ] **Step 3: Implement.**
  - `MessageLog`: the layout effect on `[lastId, resetKey]` becomes two parts. On `resetKey` (the open) the log goes to the bottom (A4 and A5 add the other places). On a new last bubble, the log goes to the bottom only when the bubble before the change was at the bottom (`atBottom.current`), or the new last bubble is `mine`. A new last bubble counts only when its `createdAt` is later than the last `createdAt` that the log saw (keep it in a ref); a removed or restored last bubble moves nothing. Keep the ResizeObserver and the "Earlier messages" anchor as they are.
  - `onScroll` sets `atBottom.current = isNearBottom(log)` and `setAway(!atBottom.current)` (a `useState` that changes only at the edge, so a scroll renders nothing else). Every place where the log sets `scrollTop` itself also sets both.
  - The Newest button lives inside the scroll region, so `log.parentElement` stays the pane (the calm tests of `EarlierMessages.test.tsx` read it): after the `ol`, `<div aria-live="off" className="pointer-events-none sticky bottom-3 flex h-0 justify-end">`, and in it, while `away`, `<button type="button" aria-label={t('chat.newest')} title={t('chat.newest')} className="pressable pointer-events-auto grid size-11 -translate-y-full place-items-center rounded-full border border-hairline bg-panel text-ink shadow-float">` with `<AnimatedIcon icon={ChevronDownIcon} size={20} aria-hidden />`. A press sets `scrollTop = scrollHeight`, sets the bottom state, and calls `log.focus({ preventScroll: true })`. No count, no pulse, no navy.
  - Words: en `"newest": "Go to the newest message"`, ar `"newest": "انتقل إلى أحدث رسالة"` (under `chat`).
  - `src/CLAUDE.md` bullet: "Keep my place (`MessageLog`, `logScroll.ts`): a new message moves the log only when the reader is in the last 80 px or sent it. Else the round Newest button shows (sticky inside the log, `aria-live="off"`), still, with no count."
- [ ] **Step 4: Run** the command of Step 2, then `npx vitest run src/features/inbox/MessageLog.stick.test.tsx src/features/inbox/EarlierMessages.test.tsx src/features/inbox/InboxScreen.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add src/features/inbox/logScroll.ts src/features/inbox/logScroll.test.ts src/features/inbox/MessageLog.place.test.tsx src/features/inbox/MessageLog.tsx src/i18n/real/chatread.en.json src/i18n/real/chatread.ar.json src/CLAUDE.md` and `git commit -m "Chat: a new message moves the log only for a reader at the bottom, and a still Newest button goes down (design item 1)"`.

---

### Task A4: The "New" line

**Files**
- Create: `src/features/inbox/newLine.ts`, `src/features/inbox/newLine.test.ts`, `src/features/inbox/NewLine.test.tsx`
- Modify: `src/features/inbox/MessageLog.tsx`, `src/features/inbox/ConversationPane.tsx` (`ChatPane`, `TaskPane`), `chatread.en.json`, `chatread.ar.json`, `src/CLAUDE.md`

**Interfaces**
- Consumes (base): `ChatThread.readUpTo: string | null` (the reader's read time before this read); `ChatThread.chat.unread`; the `chats.list` row of a task thread (`ChatRow.unread`, read today in `TaskPane` with `queryClient.getQueryData`). Gap in the base: `comments.list` gives no read time, so a task thread places its line by the unread count (see `firstUnreadId`).
- Produces:
  - `export type NewMark = { unread: number; readUpTo?: string | null };`
  - `export function firstUnreadId(bubbles: readonly Bubble[], mark: NewMark): string | null`
  - `export function useOpenMark<T>(answer: { data: T | undefined; isStale: boolean; isFetchedAfterMount: boolean }, pick: (data: T) => NewMark): NewMark | null`
  - `MessageLogProps.readUpTo?: string | null` (the fixed shared name) and `MessageLogProps.unreadAtOpen?: number`. The New line `<li data-new-line>`. Word `chat.newLine`.

- [ ] **Step 1: Write the failing tests.**

`newLine.test.ts` (bubbles from `makeBubble`; `t(hm)` = `2026-09-29T${hm}:00.000+03:00`):
```ts
describe('where the New line goes (design item 3)', () => {
  it('goes above the first message of another person after the read time', () => {
    const list = [makeBubble({ id: 'a', createdAt: t('09:00'), body: 'a' }), makeBubble({ id: 'b', author: HALA, mine: true, createdAt: t('09:10'), body: 'b' }),
      makeBubble({ id: 'c', createdAt: t('09:20'), body: 'c' }), makeBubble({ id: 'd', author: OMAR, createdAt: t('09:30'), body: 'd' })];
    expect(firstUnreadId(list, { unread: 2, readUpTo: t('09:15') })).toBe('c');
  });
  it('skips a quiet line and your own message after the read time', () => {
    const list = [makeBubble({ id: 'l', createdAt: t('09:20'), body: '', line: { id: 'l', at: t('09:20'), type: 'renamed', actor: OMAR, people: [], name: 'Site' } }),
      makeBubble({ id: 'm', author: HALA, mine: true, createdAt: t('09:21'), body: 'm' }), makeBubble({ id: 'o', createdAt: t('09:22'), body: 'o' })];
    expect(firstUnreadId(list, { unread: 1, readUpTo: t('09:15') })).toBe('o');
  });
  it('draws no line when nothing was unread at the open', () => {
    expect(firstUnreadId([makeBubble({ id: 'a', createdAt: t('09:20'), body: 'a' })], { unread: 0, readUpTo: t('09:15') })).toBeNull();
  });
  it('goes above the first message of another person in the log for a chat never read', () => {
    expect(firstUnreadId([makeBubble({ id: 'a', author: HALA, mine: true, createdAt: t('09:00'), body: 'a' }), makeBubble({ id: 'b', createdAt: t('09:05'), body: 'b' })], { unread: 3, readUpTo: null })).toBe('b');
  });
  it('counts back over the messages of other people when there is no read time (a task thread)', () => {
    const list = [makeBubble({ id: 'c1', createdAt: t('09:00'), body: '1' }), makeBubble({ id: 'c2', author: HALA, mine: true, createdAt: t('09:05'), body: '2' }),
      makeBubble({ id: 'c3', createdAt: t('09:10'), body: '3' }), makeBubble({ id: 'r', createdAt: t('09:12'), body: 'x', reason: { kind: 'due_date' } }),
      makeBubble({ id: 'c4', author: OMAR, createdAt: t('09:15'), body: '4' })];
    expect(firstUnreadId(list, { unread: 2 })).toBe('c3');
    expect(firstUnreadId(list, { unread: 9 })).toBe('c3');
  });
});
describe('the read state at the open', () => {
  it('waits for a fresh answer, then keeps the first one', () => {
    const { result, rerender } = renderHook((answer) => useOpenMark(answer, (data: NewMark) => data), {
      initialProps: { data: { unread: 0, readUpTo: 'A' } as NewMark | undefined, isStale: true, isFetchedAfterMount: false },
    });
    expect(result.current).toBeNull();
    rerender({ data: { unread: 2, readUpTo: 'A' }, isStale: false, isFetchedAfterMount: true });
    expect(result.current).toEqual({ unread: 2, readUpTo: 'A' });
    rerender({ data: { unread: 0, readUpTo: 'B' }, isStale: false, isFetchedAfterMount: true });
    expect(result.current).toEqual({ unread: 2, readUpTo: 'A' });
  });
  it('takes a cached answer that no change made old at once', () => {
    const { result } = renderHook(() => useOpenMark({ data: { unread: 1, readUpTo: null } as NewMark, isStale: false, isFetchedAfterMount: false }, (data) => data));
    expect(result.current).toEqual({ unread: 1, readUpTo: null });
  });
});
```
`NewLine.test.tsx` (app; `rowLink` and `withTaskTalk` as in `InboxScreen.test.tsx`; Hala read the tower chat up to yesterday 11:00, so its two messages of today are unread):
```ts
const newLine = (log: HTMLElement) => log.querySelector('[data-new-line]');
describe('the New line (design item 3)', () => {
  it('opens the tower chat at its first unread message, under a thin blue line with the word New', async () => {
    await renderApp('/inbox');
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    const log = await screen.findByRole('log', { name: 'Messages' });
    await within(log).findByText(/The sprinkler riser clashes with beam B14/);
    const line = newLine(log) as HTMLElement;
    expect(line).toHaveTextContent('New');
    expect(line.className).toMatch(/text-link/);
    expect(line.nextElementSibling).toHaveTextContent(/The sprinkler riser clashes with beam B14/);
  });
  it('keeps the line after the open marks the chat read, and drops it when the person sends a message', async () => {
    await renderApp('/inbox');
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    const log = await screen.findByRole('log', { name: 'Messages' });
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Chats' })).queryByText('Unread: 2')).toBeNull());
    expect(newLine(log)).not.toBeNull();
    await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'Thanks.');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await within(log).findByText('Thanks.');
    expect(newLine(log)).toBeNull();
  });
  it('opens a chat with nothing unread at the bottom, with no line', async () => {
    await renderApp('/inbox');
    await userEvent.click(await rowLink(/Reem Al-Ghamdi/));
    const log = await screen.findByRole('log', { name: 'Messages' });
    await within(log).findByText(/Good news/);
    expect(newLine(log)).toBeNull();
  });
  it('opens a task thread at its first new comment', async () => {
    await renderApp('/inbox', withTaskTalk);
    await userEvent.click(await rowLink(/Room finish schedule/));
    const log = await screen.findByRole('log', { name: 'Messages' });
    await within(log).findByText('The finish codes are ready.');
    expect(newLine(log)?.nextElementSibling).toHaveTextContent('The finish codes are ready.');
  });
  it('reads جديد in Arabic and passes the calm checks', async () => {
    await renderApp('/inbox', (state) => { state.users.usr_001.preferences.language = 'ar'; });
    await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
    await userEvent.click(await within(await screen.findByRole('list', { name: 'المحادثات' })).findByRole('link', { name: /Corniche Office Tower|برج/ }));
    const log = await screen.findByRole('log', { name: 'الرسائل' });
    await waitFor(() => expect(newLine(log)).toHaveTextContent('جديد'));
    expectCalm(log.parentElement as HTMLElement, { titleLevel: 2 });
  });
});
```
Add to `MessageLog.place.test.tsx`:
```ts
it('opens at the New line: the line sits 16 px under the top of the log (design item 3)', () => {
  const setTop = vi.spyOn(Element.prototype, 'scrollTop', 'set');
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.getAttribute('role') === 'log') return DOMRect.fromRect({ y: 100, height: 600 });
    if (this.hasAttribute('data-new-line')) return DOMRect.fromRect({ y: 400, height: 24 });
    return DOMRect.fromRect({ y: 0, height: 0 });
  });
  const list = talk(10);
  renderLog({ bubbles: list, readUpTo: list[6].createdAt, unreadAtOpen: 3 });
  expect(setTop).toHaveBeenLastCalledWith(284);
  expect(rowOf('Note 8').previousElementSibling).toHaveAttribute('data-new-line');
});
```
(If jsdom lacks `DOMRect.fromRect`, return `{ top, height, bottom: top + height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON() {} }`. Restore the spies in `afterEach(() => vi.restoreAllMocks())`.)

- [ ] **Step 2: Run** `npx vitest run src/features/inbox/newLine.test.ts src/features/inbox/NewLine.test.tsx src/features/inbox/MessageLog.place.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: FAIL with "Cannot find module './newLine'" and no `[data-new-line]` in the log.
- [ ] **Step 3: Implement.**
  - `firstUnreadId`: `null` when `mark.unread <= 0`. A counted bubble has no `line`, no `reason` and is not `mine`. With `mark.readUpTo !== undefined` (a chat): the first counted bubble whose `createdAt` is later than `mark.readUpTo ?? ''`. With no `readUpTo` (a task thread): walk back from the end over the counted bubbles, stop at a `mine` bubble, and return the bubble where the count reaches `unread` (or the oldest one met).
  - `useOpenMark`: keeps the first `pick(data)` of an answer with data where `isFetchedAfterMount || !isStale`, taken during render (so it comes before the effect that marks the chat read). It never changes after that. The pane is keyed by the chat id, so a new chat starts again.
  - `ChatPane`: `const mark = useOpenMark(thread, (d) => ({ unread: d.chat.unread, readUpTo: d.readUpTo }))`; the busy branch becomes `if (!data || !mark)`; `<MessageLog … readUpTo={mark.readUpTo} unreadAtOpen={mark.unread} />`. `TaskPane`: `const mark = useOpenMark(comments, () => ({ unread: row?.unread ?? 0 }))`; busy until `mark`; `<MessageLog … unreadAtOpen={mark.unread} />` (no `readUpTo`).
  - `MessageLog`: `newLineId = sentSinceOpen ? null : firstUnreadId(bubbles, { unread: unreadAtOpen ?? 0, readUpTo })`, where `sentSinceOpen` is true when a `mine` bubble is later than `newestAtFirst` (the line goes when the person sends; it goes when the person leaves because the log is keyed by the chat). `runStarts(bubbles, newLineId)`. Inside its day group, right before the bubble `newLineId`: `<li data-new-line className="flex items-center gap-2.5 pt-3 text-footnote font-semibold text-link"><span aria-hidden className="h-px flex-1 bg-link/55" /><span>{t('chat.newLine')}</span></li>`. At the open (the `resetKey` effect) with a line, `region.scrollTop = scrollTopFor(region.scrollTop, regionRect, lineRect, 'start')`, then the bottom state from `isNearBottom`; with no line, the bottom as in A3. The line follows the first unread bubble when an earlier page arrives; only the open scrolls to it.
  - Words: en `"newLine": "New"`, ar `"newLine": "جديد"`.
  - `src/CLAUDE.md` bullet: "New line (`newLine.ts`): the pane keeps the read state of the first fresh answer (`useOpenMark`) and shows the log only then. A chat places the line by `ChatThread.readUpTo`, a task thread by the unread count of its `chats.list` row. The line goes when the person sends."
- [ ] **Step 4: Run** the command of Step 2, then `npx vitest run src/features/inbox --no-file-parallelism --testTimeout=60000`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add src/features/inbox/newLine.ts src/features/inbox/newLine.test.ts src/features/inbox/NewLine.test.tsx src/features/inbox/MessageLog.place.test.tsx src/features/inbox/MessageLog.tsx src/features/inbox/ConversationPane.tsx src/i18n/real/chatread.en.json src/i18n/real/chatread.ar.json src/CLAUDE.md` and `git commit -m "Chat: a chat with unread messages opens at the first one, under a thin New line (design item 3)"`.

---

### Task A5: Open at one message (the focus frame)

**Files**
- Create: `src/features/inbox/MessageLog.focus.test.tsx`
- Modify: `src/features/inbox/MessageLog.tsx`, `src/features/inbox/MessageBubble.tsx`, `src/CLAUDE.md`

**Interfaces**
- Produces (fixed shared names, used by tracks msg and find): `MessageLogProps.focusId?: string | null`, `MessageLogProps.onFocused?: () => void`; `export const FRAME_MS = 1000;`; bubble prop `framed: boolean` (the root `li` gets `data-framed` and the frame classes while true). A caller passes the id of a bubble (a `msg_` or `cmt_` id, also a reason line); `onFocused` runs once, right after the log scrolled to it; the caller then clears `focusId`, and the frame stays for `FRAME_MS` by itself.

- [ ] **Step 1: Write the failing test.** `MessageLog.focus.test.tsx` (same `getBoundingClientRect` and `scrollTop` spies as in A4, with `[data-message-id="msg_5"]` at `y: 500, height: 80`):
```ts
describe('open at one message (design items 10 and 17)', () => {
  it('puts the focus message in the middle of the log, frames it for one second, and calls onFocused once', async () => {
    const onFocused = vi.fn();
    const list = talk(10).map((b, i) => ({ ...b, id: `msg_${i + 1}` }));
    renderLog({ bubbles: list, focusId: 'msg_5', onFocused });
    expect(setTop).toHaveBeenLastCalledWith(140);
    expect(onFocused).toHaveBeenCalledTimes(1);
    const row = rowOf('Note 5');
    expect(row).toHaveAttribute('data-framed');
    await waitFor(() => expect(row).not.toHaveAttribute('data-framed'), { timeout: 2000 });
  });
  it('waits for a focus message that is not in the log yet, and centers it when it arrives', () => {
    const onFocused = vi.fn();
    const list = talk(10).map((b, i) => ({ ...b, id: `msg_${i + 1}` }));
    const view = renderLog({ bubbles: list.slice(5), focusId: 'msg_5', onFocused });
    expect(onFocused).not.toHaveBeenCalled();
    view.rerender({ bubbles: list, focusId: 'msg_5', onFocused });
    expect(onFocused).toHaveBeenCalledTimes(1);
    expect(rowOf('Note 5')).toHaveAttribute('data-framed');
  });
  it('wins over the New line at the open, and still draws the line', () => {
    const list = talk(10).map((b, i) => ({ ...b, id: `msg_${i + 1}` }));
    renderLog({ bubbles: list, focusId: 'msg_5', onFocused: () => undefined, readUpTo: list[6].createdAt, unreadAtOpen: 3 });
    expect(setTop).toHaveBeenLastCalledWith(140);
    expect(document.querySelector('[data-new-line]')).not.toBeNull();
  });
  it('frames a message in the Arabic log too, with no motion and no red', () => {
    const list = talk(3).map((b, i) => ({ ...b, id: `msg_${i + 1}` }));
    renderLog({ bubbles: list, focusId: 'msg_2', onFocused: () => undefined }, { lang: 'ar' });
    expect(rowOf('Note 2').className).toMatch(/outline-link\/40/);
    expect(rowOf('Note 2').className).not.toMatch(/late|red|animate-/);
  });
});
```
- [ ] **Step 2: Run** `npx vitest run src/features/inbox/MessageLog.focus.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: FAIL with "expected spy to be called 1 times, but got 0 times".
- [ ] **Step 3: Implement.** In `MessageLog`, a layout effect on `[focusId, focusPresent]` (`focusPresent = bubbles.some((b) => b.id === focusId)`): when both hold, find `[data-message-id="<id>"]` in the region, set `scrollTop = scrollTopFor(…, 'center')`, set the bottom state, `setFramedId(focusId)`, call `onFocused?.()`, and start a `FRAME_MS` timer that clears `framedId` (clear the timer on unmount). At the open, the focus place comes first, then the New line, then the bottom. Pass `framed={bubble.id === framedId}`; the root `li` with `framed` takes `data-framed` and `rounded-2xl outline outline-2 outline-offset-2 outline-link/40`. `src/CLAUDE.md` bullet: "Open at one message: `MessageLog` `focusId` centers that bubble (by `data-message-id`), frames it for 1 s and calls `onFocused` once. Tracks msg (reply strip) and find (notices, search, the route) pass it."
- [ ] **Step 4: Run** the command of Step 2. Expected: PASS.
- [ ] **Step 5: Commit.** `git add src/features/inbox/MessageLog.focus.test.tsx src/features/inbox/MessageLog.tsx src/features/inbox/MessageBubble.tsx src/CLAUDE.md` and `git commit -m "Chat: the log can open at one message, in the middle, with a soft frame for one second"`.

---

### Task A6: Read only while you look

**Files**
- Create: `src/app/usePageVisible.ts`, `src/app/usePageVisible.test.tsx`, `src/features/inbox/ReadWhileVisible.test.tsx`
- Modify: `src/features/inbox/ConversationPane.tsx` (the mark effect of `ChatPane`), `src/features/comments/markRead.ts`, `src/CLAUDE.md`

**Interfaces**
- Produces: `export function usePageVisible(): boolean` (`useSyncExternalStore` on `visibilitychange`; snapshot `!document.hidden`; server snapshot `true`).

- [ ] **Step 1: Write the failing tests.** Both files use the recipe of `src/CLAUDE.md` ("Before you call a screen change done"): `const show = (visible: boolean) => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => !visible }); document.dispatchEvent(new Event('visibilitychange')); };` and `afterEach(() => { Reflect.deleteProperty(document, 'hidden'); vi.restoreAllMocks(); })`.

`usePageVisible.test.tsx`:
```ts
it('follows the visibility of the tab', () => {
  const { result } = renderHook(() => usePageVisible());
  expect(result.current).toBe(true);
  act(() => show(false));
  expect(result.current).toBe(false);
  act(() => show(true));
  expect(result.current).toBe(true);
});
```

`ReadWhileVisible.test.tsx` (`marks = (call) => call.mock.calls.filter(([name]) => name === 'chats.markRead')`; `settle` as in `InboxScreen.test.tsx`):
```ts
describe('read only while you look (design item 5)', () => {
  it('marks an open chat read only after its tab shows', async () => {
    const { api } = await renderApp('/inbox');
    const call = vi.spyOn(api, 'call');
    show(false);
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    await within(await screen.findByRole('log', { name: 'Messages' })).findByText(/The sprinkler riser/);
    await settle();
    expect(marks(call)).toHaveLength(0);
    act(() => show(true));
    await waitFor(() => expect(marks(call)).toHaveLength(1));
  });
  it('keeps a message that comes while the tab is hidden unread, until the tab shows again', async () => {
    const { api, store } = await renderApp('/inbox');
    await userEvent.click(await rowLink(/Faisal Al-Harbi/));
    await within(await screen.findByRole('log', { name: 'Messages' })).findByText('I will bring the new stage dates.');
    const room = Object.values(store.state.conversations).find((c) => c.kind === 'direct' && c.memberIds.includes('usr_001') && c.memberIds.includes('usr_002'))!;
    const readAt = () => Date.parse(store.state.chatReads[chatReadKey(room.id, 'usr_001')]?.lastReadAt ?? '1970-01-01T00:00:00Z');
    await waitFor(() => expect(readAt()).toBeGreaterThanOrEqual(Date.parse('2026-09-30T07:40:00.000+03:00')));
    show(false);
    // The test clock stands still (setNow), so the new message must come 5 minutes after the mark of the open.
    setNow(new Date('2026-09-30T06:05:00Z'));
    store.state.session.currentUserId = 'usr_002';
    const sent = await api.call('chats.send', { conversationId: room.id, body: 'One more thing.' });
    store.state.session.currentUserId = 'usr_001';
    await waitFor(() => expect(within(screen.getByRole('log', { name: 'Messages' })).getByText('One more thing.')).toBeInTheDocument());
    await settle();
    expect(readAt()).toBeLessThan(Date.parse(sent.message.createdAt));
    act(() => show(true));
    await waitFor(() => expect(readAt()).toBeGreaterThanOrEqual(Date.parse(sent.message.createdAt)));
  });
  it('marks a task thread once for each new comment, and not again when the tab only shows again', async () => {
    const { api } = await renderApp('/inbox', withTaskTalk);
    const call = vi.spyOn(api, 'call');
    await userEvent.click(await rowLink(/Room finish schedule/));
    await waitFor(() => expect(marks(call)).toHaveLength(1));
    act(() => show(false));
    act(() => show(true));
    await settle();
    expect(marks(call)).toHaveLength(1);
  });
});
```
(`chats.send` returns a `MessageView`. `chatReadKey` comes from `src/api/chatState.ts`, `setNow` from `src/lib/dates.ts`; `test/setup.ts` sets the clock back after each test.)

- [ ] **Step 2: Run** `npx vitest run src/app/usePageVisible.test.tsx src/features/inbox/ReadWhileVisible.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: FAIL with "Cannot find module '../app/usePageVisible'" and "expected [ …(1) ] to have a length of 0".
- [ ] **Step 3: Implement.** `ChatPane`: `const visible = usePageVisible();` and the effect `if (visible && unread > 0) markRead.mutate({ conversationId: id })` with deps `[id, unread, visible]`. `useMarkTaskRead`: `const visible = usePageVisible();` and a ref of the last `{ taskId, count }` it marked; it calls `chats.markRead` only when `visible`, `count > 0`, `!newestMine`, and `{ taskId, count }` differs from the ref; a failed mark clears the ref, so the next show tries again. The task panel uses the same hook, so it follows the same rule. `src/CLAUDE.md` bullet: "Read only while you look: `ChatPane` and `useMarkTaskRead` mark read only while `usePageVisible()` is true. A task thread is marked once for each new count."
- [ ] **Step 4: Run** the command of Step 2, then `npx vitest run src/features/inbox src/features/comments src/features/project/tasks --no-file-parallelism --testTimeout=60000`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add src/app/usePageVisible.ts src/app/usePageVisible.test.tsx src/features/inbox/ReadWhileVisible.test.tsx src/features/inbox/ConversationPane.tsx src/features/comments/markRead.ts src/CLAUDE.md` and `git commit -m "Chat: an open chat marks new messages read only while its tab shows (design item 5)"`.

---

### Task A7: Web addresses become links

**Files**
- Create: `src/components/RichText.test.tsx`
- Modify: `src/lib/text.ts`, `src/lib/text.test.ts`, `src/components/RichText.tsx`, `src/CLAUDE.md`

**Interfaces**
- Produces: `Segment` gets `| { kind: 'url'; url: string }`; `segmentsOf` finds `http://` and `https://` addresses. `RichText` draws them as links in chats, comments, posts and task descriptions (every `RichText`).

- [ ] **Step 1: Write the failing tests.** `src/lib/text.test.ts`, new describe:
```ts
describe('web addresses in a message (design item 7)', () => {
  it('cuts a full stop, a comma and an Arabic comma off the end of an address', () => {
    expect(segmentsOf('The lab quote: https://drive.google.com/drive/folders/seaside-villa-soil-test-quote-october-2026.')).toEqual([
      { kind: 'text', text: 'The lab quote: ' }, { kind: 'url', url: 'https://drive.google.com/drive/folders/seaside-villa-soil-test-quote-october-2026' }, { kind: 'text', text: '.' }]);
    expect(segmentsOf('عرض السعر: https://drive.google.com/x، شكرًا')).toEqual([
      { kind: 'text', text: 'عرض السعر: ' }, { kind: 'url', url: 'https://drive.google.com/x' }, { kind: 'text', text: '، شكرًا' }]);
  });
  it('keeps a closing bracket that the address opened, and cuts one that it did not', () => {
    expect(segmentsOf('(see https://en.wikipedia.org/wiki/Mashrabiya_(window))')).toEqual([
      { kind: 'text', text: '(see ' }, { kind: 'url', url: 'https://en.wikipedia.org/wiki/Mashrabiya_(window)' }, { kind: 'text', text: ')' }]);
  });
  it('makes no link of another scheme', () => {
    expect(segmentsOf('ftp://files.test/a javascript:alert(1)')).toEqual([{ kind: 'text', text: 'ftp://files.test/a javascript:alert(1)' }]);
  });
  it('keeps mentions and project codes beside an address', () => {
    expect(segmentsOf('See #KH-26-014 at https://maps.google.com/?q=26.29,50.21 @[Sara Al-Qahtani](usr_005)')).toEqual([
      { kind: 'text', text: 'See ' }, { kind: 'project', code: 'KH-26-014' }, { kind: 'text', text: ' at ' },
      { kind: 'url', url: 'https://maps.google.com/?q=26.29,50.21' }, { kind: 'text', text: ' ' }, { kind: 'mention', name: 'Sara Al-Qahtani', userId: 'usr_005' }]);
  });
});
```
`src/components/RichText.test.tsx` (render inside `MemoryRouter`, `initI18n('en')`):
```ts
it('opens an outside address in a new tab, keeps its own direction, and wraps a long one', () => {
  render(<MemoryRouter><RichText body="الرابط: https://drive.google.com/drive/folders/seaside-villa-soil-test-quote-october-2026" /></MemoryRouter>);
  const link = screen.getByRole('link', { name: 'https://drive.google.com/drive/folders/seaside-villa-soil-test-quote-october-2026' });
  expect(link).toHaveAttribute('href', 'https://drive.google.com/drive/folders/seaside-villa-soil-test-quote-october-2026');
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  expect(link).toHaveAttribute('dir', 'ltr');
  expect(link).toHaveClass('break-all', 'text-link', 'underline');
});
it('opens a Madar address in the same tab', () => {
  const address = `${window.location.origin}/inbox`;
  render(<MemoryRouter><RichText body={`Open ${address}`} /></MemoryRouter>);
  const link = screen.getByRole('link', { name: address });
  expect(link).toHaveAttribute('href', address);
  expect(link).not.toHaveAttribute('target');
});
```
- [ ] **Step 2: Run** `npx vitest run src/lib/text.test.ts src/components/RichText.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: FAIL: the address comes back as text, and no link has that name.
- [ ] **Step 3: Implement.** `src/lib/text.ts`: add `(https?:\/\/[^\s<>"]+)` as a third group to `TOKEN`, so the earliest match wins and a `#` inside an address stays part of it. For an address match, cut the end again and again: one of `.,;:!?'"،؛؟»]}`, or a `)` while the address holds more `)` than `(`. The cut part goes back into the text (move `last` back by its length). `RichText`: a `url` segment draws `<a href={url} dir="ltr" className="break-all text-link underline underline-offset-2">`, plus `target="_blank" rel="noopener noreferrer"` when `new URL(url).origin !== window.location.origin` (a URL that does not parse counts as outside). A Madar address is a plain `<a>` in the same tab. `src/CLAUDE.md` bullet: "Links (`segmentsOf`, `RichText`): an `http://` or `https://` address is a link with `dir="ltr"` and `break-all`; an outside address opens in a new tab with `noopener noreferrer`."
- [ ] **Step 4: Run** the command of Step 2, then `npx vitest run src/features/comments src/features/project/overview src/features/inbox/InboxScreen.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add src/lib/text.ts src/lib/text.test.ts src/components/RichText.tsx src/components/RichText.test.tsx src/CLAUDE.md` and `git commit -m "Chat, comments and posts: a web address becomes a link that keeps its own direction (design item 7)"`.

---

### Task A8: Drafts that survive a closed tab

**Files**
- Create: `src/app/drafts.test.ts`
- Modify: `src/app/drafts.ts`, `src/features/auth/signOut.test.tsx` (line 11, the `savedDrafts` helper), `src/features/auth/AuthGate.test.tsx` (line 12 and the two checks at lines 117 and 137), `src/features/inbox/InboxScreen.test.tsx` (line 311, the `savedDrafts` helper), `src/CLAUDE.md`

**Interfaces**
- Produces: the same exports of `drafts.ts`; the text now lives in `window.localStorage` under `madar.draft.<userId>.<key>`. `keepDraftsOf('')` (the sign-out step of `useLeaveScreen`) clears both stores.

- [ ] **Step 1: Write the failing tests.** `src/app/drafts.test.ts`:
```ts
describe('drafts (design item 7)', () => {
  it('keeps a draft in the local store, so it stays after the tab closes', () => {
    writeDraft('usr_001', 'chat:cnv_001', 'Half a thought');
    expect(window.localStorage.getItem('madar.draft.usr_001.chat:cnv_001')).toBe('Half a thought');
    expect(window.sessionStorage.getItem('madar.draft.usr_001.chat:cnv_001')).toBeNull();
    expect(readDraft('usr_001', 'chat:cnv_001')).toBe('Half a thought');
  });
  it('moves a draft of the old session store on its first read', () => {
    window.sessionStorage.setItem('madar.draft.usr_001.chat:cnv_001', 'From before');
    expect(readDraft('usr_001', 'chat:cnv_001')).toBe('From before');
    expect(window.localStorage.getItem('madar.draft.usr_001.chat:cnv_001')).toBe('From before');
    expect(window.sessionStorage.getItem('madar.draft.usr_001.chat:cnv_001')).toBeNull();
  });
  it('drops every draft in both stores at sign-out', () => {
    writeDraft('usr_001', 'chat:cnv_001', 'One');
    window.sessionStorage.setItem('madar.draft.usr_002.task:tsk_001', 'Two');
    keepDraftsOf('');
    const left = [...Object.keys(window.localStorage), ...Object.keys(window.sessionStorage)].filter((key) => key.startsWith('madar.draft.'));
    expect(left).toEqual([]);
  });
  it('keeps only the drafts of the current person', () => {
    writeDraft('usr_001', 'chat:cnv_001', 'Mine');
    writeDraft('usr_002', 'chat:cnv_001', 'Not mine');
    keepDraftsOf('usr_001');
    expect(readDraft('usr_001', 'chat:cnv_001')).toBe('Mine');
    expect(window.localStorage.getItem('madar.draft.usr_002.chat:cnv_001')).toBeNull();
  });
});
```
In the three existing test files, the draft helpers read `window.localStorage` in place of `window.sessionStorage` (else they check an empty store and always pass).
- [ ] **Step 2: Run** `npx vitest run src/app/drafts.test.ts src/features/auth/signOut.test.tsx src/features/auth/AuthGate.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: FAIL with "expected null to be 'Half a thought'".
- [ ] **Step 3: Implement.** `readDraft`: `localStorage` first; when it has nothing, a value in `sessionStorage` moves to `localStorage` and leaves `sessionStorage`. `writeDraft`: `localStorage`. `keepDraftsOf`: the same filter over `localStorage` and `sessionStorage`. Each access stays in `try`/`catch` (a blocked store gives `''`). Picked files stay in memory, as today. Update the doc comment of the file (local storage, cleared at sign-out). `src/CLAUDE.md` bullet: "Drafts (`app/drafts.ts`): the text of a draft lives in localStorage for each person, so it stays after the tab closes. A sign-out (`keepDraftsOf('')`) and a change of person clear them. Picked files stay in memory only."
- [ ] **Step 4: Run** the command of Step 2 and `npx vitest run src/features/inbox/InboxScreen.test.tsx src/features/comments --no-file-parallelism --testTimeout=60000`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add src/app/drafts.ts src/app/drafts.test.ts src/features/auth/signOut.test.tsx src/features/auth/AuthGate.test.tsx src/features/inbox/InboxScreen.test.tsx src/CLAUDE.md` and `git commit -m "Chat: a half-written message stays after the tab closes, and sign-out clears every draft (design item 7)"`.

---

### Task A9: Enter makes a new line on a phone

**Files**
- Create: `src/features/inbox/ComposerKeys.test.tsx`
- Modify: `src/features/inbox/Composer.tsx` (the `onKeyDown` of the box), `src/CLAUDE.md`

**Interfaces**
- Consumes: `useIsPhone()` (`src/app/useIsPhone.ts`, under 640 px).

- [ ] **Step 1: Write the failing test.** `ComposerKeys.test.tsx` (the `phone()` stub of `src/features/settings/admin/AdminScreen.test.tsx`, `afterEach(() => vi.restoreAllMocks())`):
```ts
describe('the message box on a phone (design item 7)', () => {
  it('makes a new line with Enter, and sends only with the Send button', async () => {
    phone();
    const { store } = await renderApp('/inbox');
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    const box = await screen.findByRole('textbox', { name: 'Message' });
    await userEvent.type(box, 'Line one{Enter}Line two');
    expect(box).toHaveValue('Line one\nLine two');
    expect(Object.values(store.state.messages).some((m) => m.body.startsWith('Line one'))).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(Object.values(store.state.messages).some((m) => m.body === 'Line one\nLine two')).toBe(true));
  });
  it('does the same in Arabic', async () => {
    phone();
    await renderApp('/inbox', (state) => { state.users.usr_001.preferences.language = 'ar'; });
    await userEvent.click(await within(await screen.findByRole('list', { name: 'المحادثات' })).findByRole('link', { name: /Corniche Office Tower|برج/ }));
    const box = await screen.findByRole('textbox', { name: 'الرسالة' });
    await userEvent.type(box, 'سطر{Enter}سطر آخر');
    expect(box).toHaveValue('سطر\nسطر آخر');
  });
});
```
The computer case stays covered by "sends a message with the Send button and with Enter" in `InboxScreen.test.tsx`.
- [ ] **Step 2: Run** `npx vitest run src/features/inbox/ComposerKeys.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: FAIL with "expected 'Line two' to have value 'Line one\nLine two'" (Enter sent the first line).
- [ ] **Step 3: Implement.** `const phone = useIsPhone();` in the box; the `onKeyDown` returns at once when `phone`, so the textarea adds the line. The mention list keeps its own Enter. `src/CLAUDE.md` bullet: "On a phone (`useIsPhone`) Enter in the chat box adds a line; the Send button sends."
- [ ] **Step 4: Run** the command of Step 2 and `npx vitest run src/features/inbox/InboxScreen.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add src/features/inbox/ComposerKeys.test.tsx src/features/inbox/Composer.tsx src/CLAUDE.md` and `git commit -m "Chat: on a phone, Enter makes a new line and the Send button sends (design item 7)"`.

---

### Task A10: A long chat title cuts at its end

**Files**
- Create: `src/features/inbox/ChatTitle.test.tsx`
- Modify: `src/features/inbox/ConversationPane.tsx` (`Header` and its two callers), `src/CLAUDE.md`

**Interfaces**
- Produces: `Header` prop `title: string` (was a node). The callers pass the plain string (`ChatPane`: `title`, `TaskPane`: `task.data.task.title`).

- [ ] **Step 1: Write the failing test.** `ChatTitle.test.tsx`:
```ts
const cutter = (heading: HTMLElement) => heading.querySelector('bdi') as HTMLElement;
describe('the chat title (design item 8)', () => {
  for (const lang of ['en', 'ar'] as const) {
    it(`cuts a long English title at its end, not at its start, in ${lang}`, async () => {
      await renderApp('/inbox', (state) => {
        state.users.usr_001.preferences.language = lang;
        state.users.usr_002.nameAr = undefined;
        state.users.usr_002.name = 'Faisal Abdulrahman Al-Harbi of the Corniche Office Tower team';
      });
      if (lang === 'ar') await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
      await userEvent.click(await within(await screen.findByRole('list', { name: lang === 'en' ? 'Chats' : 'المحادثات' })).findByRole('link', { name: /Faisal Abdulrahman/ }));
      const heading = await screen.findByRole('heading', { level: 2, name: /Faisal Abdulrahman/ });
      // The element that cuts is the bdi: it takes the direction of its own text, so the ellipsis sits at the end of the words.
      expect(cutter(heading)).toHaveClass('block', 'truncate');
      expect(heading).not.toHaveClass('truncate');
      expect(heading).not.toHaveAttribute('dir');
    });
  }
});
```
- [ ] **Step 2: Run** `npx vitest run src/features/inbox/ChatTitle.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: FAIL with "expected element to have class block truncate" (the `h2` cuts today, with the page direction).
- [ ] **Step 3: Implement.** `Header` draws `<h2 className="min-w-0 text-headline text-ink"><bdi className="block truncate">{title}</bdi></h2>`. A `<bdi>` takes the direction of its own text and its side from the page (`tokens.css`, the 2026-10-05 rule), so an English title on an Arabic screen sits on the right and cuts at its end. No `dir` on the `h2` (`src/CLAUDE.md`: `dir="auto"` only on text). `src/CLAUDE.md` bullet: "A cut title: the `<bdi>` itself is `block truncate`, never its parent, so a title in the other language cuts at its end."
- [ ] **Step 4: Run** the command of Step 2 and `npx vitest run src/features/inbox --no-file-parallelism --testTimeout=60000`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add src/features/inbox/ChatTitle.test.tsx src/features/inbox/ConversationPane.tsx src/CLAUDE.md` and `git commit -m "Chat: a long title in the other language cuts off its end, not its start (design item 8)"`.

---

### Task A11: Upload progress on each picked file

**Files**
- Create: `src/features/inbox/ChatUpload.test.tsx`
- Modify: `src/api/client.ts` (`CallMeta`), `src/api/remote/upload.ts` (`PutSender`, `xhrPut`, `uploadAdapter`), `src/api/remote/upload.test.ts`, `src/features/files/Attachments.tsx` (`useAttachments`, `PickedFiles`), `src/features/inbox/Composer.tsx`, `chatread.en.json`, `chatread.ar.json`, `src/CLAUDE.md`

**Interfaces**
- Produces:
  - `CallMeta` gets `onProgress?: (sent: number, total: number) => void` (screen only: never on the wire; the fake client drops it with the other unknown keys of its `Meta` parse).
  - `export type PutSender = (put: SignedPut, body: Blob, onProgress?: (sent: number, total: number) => void) => Promise<PutResult>;` `xhrPut` reports `xhr.upload.onprogress` when `lengthComputable`. `uploadAdapter` passes `ctx.meta.onProgress` to the file upload only (never to the small picture).
  - `useAttachments()` adds `progress: ReadonlyMap<File, number>` (whole percents 0 to 100) and `uploading: boolean`; `add(list: FileList | readonly File[] | null)`. `PickedFiles` takes `progress?: ReadonlyMap<File, number>` and `busy?: boolean`.
  - Word `chat.uploading`.

- [ ] **Step 1: Write the failing tests.** `src/api/remote/upload.test.ts`, new describe:
```ts
describe('the progress of an upload (design item 14)', () => {
  it('passes the progress of the file upload to the screen, and not of the small picture', async () => {
    const { ctx, steps } = wire();
    const onProgress = vi.fn();
    ctx.meta = { onProgress };
    const put: PutSender = async (target, _body, report) => { steps.push(`PUT ${target.url}`); report?.(40, 80); return { status: 200, body: '' }; };
    await uploadAdapter({ makeThumb: async () => new Blob(['webp'], { type: 'image/webp' }), put })({ ...SCREEN_INPUT, blob: picture() }, ctx);
    expect(onProgress.mock.calls).toEqual([[40, 80]]);
  });
  it('reads the progress events of the browser upload', async () => {
    const onProgress = vi.fn();
    let xhr: { upload: { onprogress?: (e: ProgressEvent) => void }; onload?: () => void; status: number; responseText: string } | undefined;
    vi.stubGlobal('XMLHttpRequest', class { upload = {}; status = 200; responseText = ''; open() {} setRequestHeader() {} send() { xhr = this as never; } });
    const sent = xhrPut(PUT, new Blob(['x']), onProgress);
    xhr!.upload.onprogress!({ lengthComputable: true, loaded: 5, total: 10 } as ProgressEvent);
    xhr!.onload!();
    await sent;
    expect(onProgress).toHaveBeenCalledWith(5, 10);
    vi.unstubAllGlobals();
  });
});
```
`src/features/inbox/ChatUpload.test.tsx` (`PICKED = 'Files to send'`):
```ts
describe('upload progress in the chat box (design item 14)', () => {
  it('shows a thin grey bar on each chip while it uploads, keeps Send and Remove locked, and sends after the upload', async () => {
    const { api, store } = await renderApp('/inbox');
    let release = () => undefined as void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const original = api.call.bind(api);
    vi.spyOn(api, 'call').mockImplementation(async (name, input, meta) => {
      if (name === 'files.upload') { meta?.onProgress?.(30, 60); await gate; }
      return original(name, input, meta);
    });
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    await userEvent.type(await screen.findByRole('textbox', { name: 'Message' }), 'The door sketch.');
    await userEvent.upload(screen.getByLabelText('Attach files'), new File(['x'], 'Door sketch.pdf', { type: 'application/pdf' }));
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    const bar = await within(screen.getByRole('list', { name: PICKED })).findByRole('progressbar', { name: 'Door sketch.pdf: 50% uploaded' });
    expect(bar).toHaveAttribute('aria-valuenow', '50');
    expect(bar.className).toMatch(/bg-fill-strong/);
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove Door sketch.pdf' })).toBeDisabled();
    release();
    await waitFor(() => expect(Object.values(store.state.messages).some((m) => m.body === 'The door sketch.' && (m.fileIds?.length ?? 0) === 1)).toBe(true));
    await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull());
  });
  it('names the progress in Arabic', async () => {
    // The same steps as above, with state.users.usr_001.preferences.language = 'ar', the box «الرسالة», the attach input of
    // attachments.attach in Arabic and the list «ملفات للإرسال». Then:
    expect(await screen.findByRole('progressbar', { name: 'Door sketch.pdf: رُفع 50%' })).toHaveAttribute('aria-valuenow', '50');
  });
});
```
- [ ] **Step 2: Run** `npx vitest run src/api/remote/upload.test.ts src/features/inbox/ChatUpload.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: FAIL: `onProgress` gets no call, and no progress bar is found.
- [ ] **Step 3: Implement.**
  - `useAttachments.upload`: before each file, `progress` holds 0 for it; the call gets `{ ...meta, onProgress: (sent, total) => set(file, Math.round((sent / total) * 100)) }`; a resolved call sets 100; a failed one removes the entry, so the chip shows no bar. `uploading` is true while `upload` runs. `clear()` and `remove()` drop the entries. `add` takes an array as well as a `FileList`.
  - Uploads still start at Send, as today, so no file reaches the store before Send and a removed chip leaves nothing behind. `onSend(body, fileIds, clear)` keeps its order and its signature (uploads first, then `onSend`), so track msg can draw its pending bubble at `onSend`.
  - `PickedFiles`: a chip with a progress value shows its name and, under it, `<span role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p} aria-label={t('chat.uploading', { name: file.name, percent: p })} className="block h-[3px] w-full min-w-30 overflow-hidden rounded-full bg-fill-strong"><span className="block h-full rounded-full bg-ink-2" style={{ width: `${p}%` }} /></span>`. With `busy`, each Remove button is `disabled`. `Composer` passes `progress={attachments.progress}` and `busy={uploading}`; Send stays disabled while it uploads (today's `uploading` state).
  - Words: en `"uploading": "{{name}}: {{percent}}% uploaded"` (STE has no "-ing" verb form, so not "Uploading"), ar `"uploading": "{{name}}: رُفع {{percent}}%"`.
  - `src/CLAUDE.md` bullet: "Upload progress: `CallMeta.onProgress` reaches `xhrPut` through the upload adapter (screen only, never on the wire). `PickedFiles` draws a 3 px grey bar for each file and locks Remove while the uploads run; the uploads still start at Send."
- [ ] **Step 4: Run** the command of Step 2, then `npx vitest run src/api/remote src/features/files src/features/inbox src/features/comments --no-file-parallelism --testTimeout=60000`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add src/api/client.ts src/api/remote/upload.ts src/api/remote/upload.test.ts src/features/files/Attachments.tsx src/features/inbox/Composer.tsx src/features/inbox/ChatUpload.test.tsx src/i18n/real/chatread.en.json src/i18n/real/chatread.ar.json src/CLAUDE.md` and `git commit -m "Chat: each picked file shows a thin grey bar while it uploads, and Send waits for the uploads (design item 14)"`.

---

### Task A12: Drop and paste files, and What's new

**Files**
- Create: `src/features/inbox/ChatDrop.tsx`, `src/features/inbox/ChatDrop.test.tsx`
- Modify: `src/features/inbox/ConversationPane.tsx` (wrap the loaded render of `ChatPane` and `TaskPane`), `src/features/inbox/Composer.tsx` (the receiver and the paste), `chatread.en.json`, `chatread.ar.json`, `src/whatsNew/entries.ts`, `src/i18n/real/whatsnew.en.json`, `whatsnew.ar.json`, `src/CLAUDE.md`

**Interfaces**
- Produces:
  - `export function ChatDropArea({ note, children }: { note: string; children: ReactNode }): JSX.Element` (a `relative flex min-h-0 flex-1 flex-col` box around the whole loaded pane: header, log, box and sheets, so `log.parentElement` still holds the one `h2` for the calm checks).
  - `export function useChatDropReceiver(receive: ((files: File[]) => void) | null): void` (the box registers while it can take files; one receiver at a time).
  - Words `chat.dropToAttach`, `chat.dropProject`, `chat.dropChat`, `chat.dropOfficeTask`; What's new ids `2026-10-23-22` and `2026-10-23-23`.

- [ ] **Step 1: Write the failing tests.** `ChatDrop.test.tsx` (`files = (n) => Array.from({ length: n }, (_, i) => new File(['x'], `Sketch ${i + 1}.pdf`, { type: 'application/pdf' }))`; `drag = (list: File[]) => ({ dataTransfer: { types: ['Files'], files: list } })`):
```ts
describe('drop and paste files (design item 14, fbk_030)', () => {
  it('shows a soft frame that says where the files go, and adds the dropped files to the box without a send', async () => {
    const { store } = await renderApp('/inbox');
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    const log = await screen.findByRole('log', { name: 'Messages' });
    const before = Object.keys(store.state.messages).length;
    fireEvent.dragEnter(log, drag([]));
    expect(screen.getByText('Drop to attach')).toBeInTheDocument();
    expect(screen.getByText('The files also join the files of the project.')).toBeInTheDocument();
    fireEvent.drop(log, drag(files(1)));
    expect(screen.queryByText('Drop to attach')).toBeNull();
    expect(within(screen.getByRole('list', { name: 'Files to send' })).getByText('Sketch 1.pdf')).toBeInTheDocument();
    expect(Object.keys(store.state.messages)).toHaveLength(before);
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus();
  });
  it('says the files stay in a direct chat, and the files stay with an office task', async () => {
    await renderApp('/inbox');
    await userEvent.click(await rowLink(/Faisal Al-Harbi/));
    fireEvent.dragEnter(await screen.findByRole('log', { name: 'Messages' }), drag([]));
    expect(screen.getByText('The files stay in this chat.')).toBeInTheDocument();
  });
  it('says the files stay with an office task', async () => {
    // An office task that Faisal made and Hala leads, with one comment by Faisal (the fields of withOfficeTask in
    // src/features/work/OfficeTasks.test.tsx).
    const withOfficeTaskTalk = (state: State) => {
      state.tasks.tsk_950 = {
        id: 'tsk_950', projectId: null, stageId: null, title: 'Office keys', description: '', ownerId: 'usr_001', status: 'todo',
        dueDate: null, flagged: false, needsReview: false, checklist: [], createdBy: 'usr_002', createdAt: '2026-09-29T09:00:00.000+03:00', completedAt: null,
      };
      state.counters.tsk = Math.max(state.counters.tsk ?? 0, 950);
      state.comments.cmt_950 = {
        id: 'cmt_950', targetType: 'task', targetId: 'tsk_950', authorId: 'usr_002', body: 'The spare keys are in the top drawer.',
        reactions: { '👍': [], '✅': [], '👀': [] }, createdAt: '2026-09-29T10:00:00.000+03:00', editedAt: null,
      };
    };
    await renderApp('/inbox', withOfficeTaskTalk);
    await userEvent.click(await rowLink(/Office keys/));
    fireEvent.dragEnter(await screen.findByRole('log', { name: 'Messages' }), drag([]));
    expect(screen.getByText('The files stay with this task.')).toBeInTheDocument();
  });
  it('takes 10 files at most from one drop, as the attach button does', async () => {
    await renderApp('/inbox');
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    const log = await screen.findByRole('log', { name: 'Messages' });
    fireEvent.dragEnter(log, drag([]));
    fireEvent.drop(log, drag(files(11)));
    expect(within(screen.getByRole('list', { name: 'Files to send' })).getAllByRole('listitem')).toHaveLength(10);
    expect(await screen.findByText('You can attach 10 files at most.')).toBeInTheDocument();
  });
  it('refuses a drop in a closed chat, and the browser does not open the file', async () => {
    await renderApp('/inbox', (state) => { state.users.usr_002.active = false; });
    await userEvent.click(await rowLink(/Faisal Al-Harbi/));
    const log = await screen.findByRole('log', { name: 'Messages' });
    fireEvent.dragEnter(log, drag([]));
    expect(screen.queryByText('Drop to attach')).toBeNull();
    const event = createEvent.drop(log, drag(files(1)));
    fireEvent(log, event);
    expect(event.defaultPrevented).toBe(true);
    expect(screen.queryByRole('list', { name: 'Files to send' })).toBeNull();
  });
  it('adds a pasted picture, and keeps a paste that holds text as text', async () => {
    await renderApp('/inbox');
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    const box = await screen.findByRole('textbox', { name: 'Message' });
    const png = new File(['png'], 'image.png', { type: 'image/png' });
    fireEvent.paste(box, { clipboardData: { files: [png], getData: () => '' } });
    expect(within(screen.getByRole('list', { name: 'Files to send' })).getByText('image.png')).toBeInTheDocument();
    fireEvent.paste(box, { clipboardData: { files: [png], getData: (type: string) => (type === 'text/plain' ? 'Copied words' : '') } });
    expect(within(screen.getByRole('list', { name: 'Files to send' })).getAllByRole('listitem')).toHaveLength(1);
  });
  it('speaks Arabic and stays calm', async () => {
    await renderApp('/inbox', (state) => { state.users.usr_001.preferences.language = 'ar'; });
    await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
    await userEvent.click(await within(await screen.findByRole('list', { name: 'المحادثات' })).findByRole('link', { name: /Corniche Office Tower|برج/ }));
    const log = await screen.findByRole('log', { name: 'الرسائل' });
    expectCalm(log.parentElement as HTMLElement, { titleLevel: 2 });
    fireEvent.dragEnter(log, drag([]));
    expect(screen.getByText('أفلت الملفات لإرفاقها')).toBeInTheDocument();
    expect(screen.getByText('تنضم الملفات أيضًا إلى ملفات المشروع.')).toBeInTheDocument();
  });
});
```
`src/whatsNew/entries.test.ts` already checks the new ids, their words in both languages, the address and the dash rule: no new test there.
- [ ] **Step 2: Run** `npx vitest run src/features/inbox/ChatDrop.test.tsx src/whatsNew --no-file-parallelism --testTimeout=60000`. Expected: FAIL with "Unable to find an element with the text: Drop to attach".
- [ ] **Step 3: Implement.**
  - `ChatDropArea`: a context gives `useChatDropReceiver` its slot. `onDragEnter`: when `dataTransfer.types` holds `'Files'`, count one more enter, and show the frame only while a receiver is set. `onDragOver`: for `'Files'`, `preventDefault()` and `dropEffect = 'copy'` (also with no receiver, so the browser never opens the file and leaves Madar). `onDragLeave`: count one less; at 0 the frame goes. `onDrop`: for `'Files'`, `preventDefault()`, the count goes to 0, the frame goes, and the receiver gets `[...dataTransfer.files]`. The frame: `<div role="status" className="absolute inset-2 z-10 grid place-items-center rounded-2xl border-2 border-dashed border-link/60 bg-panel/85 text-center">` with a 56 px round `bg-fill text-link` circle around `<AnimatedIcon icon={UploadIcon} size={26} aria-hidden />`, `<p className="text-headline text-ink">{t('chat.dropToAttach')}</p>` and `<p className="text-footnote text-ink-2">{note}</p>`. No motion.
  - Panes: `ChatPane` wraps its loaded render in `<ChatDropArea note={chat.kind === 'project' ? t('chat.dropProject') : t('chat.dropChat')}>`; `TaskPane` in `<ChatDropArea note={where ? t('chat.dropProject') : t('chat.dropOfficeTask')}>`. A closed chat and a thread where the person may not post have no box, so no receiver: the drop does nothing.
  - `Composer`: `useChatDropReceiver(upload ? (files) => { attachments.add(files); field.current?.focus(); } : null)`. `onPaste` on the box wrapper: when `upload` is set, `clipboardData.getData('text/plain')` is empty and `clipboardData.files` holds files whose `type` starts with `image/`, `preventDefault()` and `attachments.add(thoseFiles)`; else the browser pastes the text. The limits stay those of `add` (10 files, the store limit; the server checks the safe types at Send).
  - Words, `chatread.en.json`: `"dropToAttach": "Drop to attach"`, `"dropProject": "The files also join the files of the project."`, `"dropChat": "The files stay in this chat."`, `"dropOfficeTask": "The files stay with this task."`; `chatread.ar.json`: `"dropToAttach": "أفلت الملفات لإرفاقها"`, `"dropProject": "تنضم الملفات أيضًا إلى ملفات المشروع."`, `"dropChat": "تبقى الملفات في هذه المحادثة."`, `"dropOfficeTask": "تبقى الملفات مع هذه المهمة."`.
  - What's new: at the top of `WHATS_NEW`, `{ id: '2026-10-23-23', day: '2026-10-23', to: '/inbox' }` then `{ id: '2026-10-23-22', day: '2026-10-23', to: '/inbox' }`. `whatsnew.en.json`, under `whatsNew.items`: `"2026-10-23-22": { "title": "A calmer chat", "body": "The chat keeps your place now. It opens at the first new message, under a thin New line. New messages do not move the chat while you read older ones; the round Newest button takes you down. The messages of one person in 5 minutes sit together. A message that names you has a soft color. A chat counts as read only while you look at it. Web addresses are links, and a half-written message stays after you close the tab." }` and `"2026-10-23-23": { "title": "Drop files into a chat", "body": "Drag files from your computer and drop them on an open chat, or paste a picture into the message box. Each file shows how much of it went up. Nothing goes until you press Send." }`. `whatsnew.ar.json`, under `whatsNew.items`: `"2026-10-23-22": { "title": "محادثة أهدأ", "body": "تحفظ المحادثة مكانك الآن. تفتح عند أول رسالة جديدة، تحت خط رفيع اسمه «جديد». لا تتحرك المحادثة مع الرسائل الجديدة وأنت تقرأ رسائل أقدم، وزر «الأحدث» الدائري ينزل بك إليها. رسائل الشخص الواحد خلال 5 دقائق تظهر معًا. الرسالة التي تذكرك لها لون هادئ. تُحسب المحادثة مقروءة فقط وأنت تنظر إليها. عناوين الويب صارت روابط، ورسالتك التي لم تكملها تبقى بعد إغلاق الصفحة." }` and `"2026-10-23-23": { "title": "أفلت الملفات في المحادثة", "body": "اسحب الملفات من جهازك وأفلتها في محادثة مفتوحة، أو الصق صورة في مربع الرسالة. يبيّن كل ملف كم رُفع منه. لا يُرسل شيء حتى تضغط «إرسال»." }`. (Merge order puts track read first, so it takes the numbers 22 and 23; the later tracks take the next numbers when they rebase.)
  - `src/CLAUDE.md` bullet: "Drop and paste (`ChatDrop.tsx`): `ChatDropArea` wraps a loaded chat or task thread and shows its frame only while the box registered a receiver (`useChatDropReceiver`). Files go to the picked chips; nothing sends until Send. A paste with text stays text; a paste of only pictures adds them."
- [ ] **Step 4: Run** the command of Step 2, then `npx vitest run src/features/inbox src/i18n src/whatsNew --no-file-parallelism --testTimeout=60000` and `npm run typecheck`. Expected: PASS. (The full suite, `test:db`, `test:it`, `test:mcp`, the builds and the prototype smoke run once at the merge gate; the merge lead runs them.)
- [ ] **Step 5: Commit.** `git add src/features/inbox/ChatDrop.tsx src/features/inbox/ChatDrop.test.tsx src/features/inbox/ConversationPane.tsx src/features/inbox/Composer.tsx src/i18n/real/chatread.en.json src/i18n/real/chatread.ar.json src/whatsNew/entries.ts src/i18n/real/whatsnew.en.json src/i18n/real/whatsnew.ar.json src/CLAUDE.md` and `git commit -m "Chat: drop files on an open chat or paste a picture into the box, and the What's new lines of the calmer chat (design item 14, fbk_030)"`.

---

### Screens for the merge lead (after the merge of track read)

Screenshots in English and Arabic, light and dark, at 390 px and on a computer (the merge lead takes them; Playwright only in a
subagent): the tower chat at the open (New line, runs, a names-you message, the Newest button after a scroll up), a
follow message on hover (its time), the drop frame in a project chat and in a direct chat, a chip with its bar, the long
English title in an Arabic phone header, and a chat text with a long link.


---

## Track find

**Track scope.** Track find builds design items 16 (search messages), 17 (open a chat at one message, and `not_found` for a chat a
person may not open) and 18 (the Message and Project chat buttons, and the first fix: a direct chat with no message shows only for
the person who opened it). It also builds the read limits of the Constraints section: one folded search column with a trigram index
on Postgres, at most 5 hits, no message search for a query with no word of 3 letters, a scan on the SQLite office path with its rows
pins raised and the reason in `proof.md`, and an `exit-handoff.md` item for an FTS5 index at the restart. Words go into
`src/i18n/real/chatfind.en.json` and `src/i18n/real/chatfind.ar.json` only (`src/i18n/CLAUDE.md`, "A task adds new words only to its
own track files"). Prefix D.

**The search method (the planner's choice, design "Left to the builder").**
- One fold for the body and for the query: `normalizeForSearch(plainText(body))` (`src/lib/text.ts`). It already folds أ إ آ ٱ to ا,
  ة to ه, ى to ي, and drops tashkeel and tatweel. Mentions fold as "@Name", so a search never matches `usr_` ids.
- The save writes the fold into a server column `search_text` of `messages` and `comments`, as `tasks` and `files` do today
  (`server/data/tables.ts`). A deleted message keeps `search_text` null, so no SQL read finds it, and Undo writes it again.
- Postgres: `pg_trgm` in the schema `extensions` (free on every Supabase plan), one GIN trigram index on each column, and the loader
  condition `contains` sends `like '%word%'` with its wildcards escaped, so the trigram index serves it (`strpos` cannot use it).
- A query matches when the folded text holds every word of the query, in any order. A query with no word of 3 letters or more
  finds no message: a 2-letter pattern has no trigram and would read the whole index on each key press.
- At most 5 hits for the group: the loader reads the newest 5 of each kind (chat messages, comments of project tasks, comments of
  office tasks), and the handler keeps the newest 5 of all. So the cut of the handler gives the same rows on the scoped load as on the
  whole office (`server/data/CLAUDE.md`, Loaders: "A read with a limit loads each kind with its own limit (search)").
- SQLite (the paused Supabase exit): `contains` stays `instr(...) > 0`, a scan. The rows pins of `search.query` go up, with the
  reason in `proof.md`, and `exit-handoff.md` gets the FTS5 item.

**Order and needs.**
- Every task starts from the base of track msg (B1 to B7 on main). D3, D6 and D9 use `LIVE` (`server/data/loaders/steps.ts`, B3) and
  the live `messagesOf` (B3). D5 uses `Message.deletedAt` (B1). D6 and D7 use `isLiveMessage` (B2). D8 uses `Notification.messageId`,
  which B4 stores on every mention notice of a message or a comment.
- D1 to D12 need no task of another track. Build them in number order.
- D13 needs track read A5 (`MessageLogProps.focusId` and `onFocused`, and the frame) and track msg B15 (the `focusId` state of
  `ChatPane` and `TaskPane`, and `BubbleActions.focusMessage`). Do D13 last, after `git rebase main` once tracks read and msg are on
  main. If they are not on main when D12 is done, stop and write "D13 waits for tracks read (A5) and msg (B15)" in the report.

**Rules for every task of this track.**
- Run the tests of a task with `npx vitest run <files> --no-file-parallelism --testTimeout=60000`, then `npm run typecheck`. The full
  suite runs once, at the merge gate (owner rule of 2026-10-07).
- `test:lite` needs no Docker: `MADAR_LITE=1 npx vitest run --project lite <files> --no-file-parallelism --testTimeout=60000`.
  `test:office` runs on local workerd: `MADAR_OFFICE=1 MADAR_PINS_MEASURE=1 npx vitest run --project office server/office/pins.wd.test.ts`.
  If the office project does not start in the builder's sandbox, the merge lead runs it and sets the pins. Steps marked
  "(merge lead runs)" need Docker: `test:db`, `test:it`, `test:mcp`.
- A commit message is Simplified Technical English, with no em-dash, no `Co-Authored-By` line and no `Claude-Session` line.
- Every write runs in `runCall`; a handler stays synchronous and pure; every shared call works in the prototype fake and on the server
  (root `CLAUDE.md`, "Rules that cross parts"). Each new contract field is optional or has a default (`src/api/CLAUDE.md`, "A contract
  change is additive"). No task adds a call, so the new-call checklist does not apply and no pinned call count moves.
- MCP in the commit of the change: `TOOL_DOCS` (`server/mcp/docs.ts`), and `INSTRUCTIONS` when a rule changes. `server/mcp/tools.test.ts`
  keeps each description between 40 and 600 characters.
- Screens: tokens only, logical sides only, `dir="auto"` only on text, `natural-side` for chat text, names in `<bdi>` ("Faisal:" as one
  `<bdi>`), 44 px press areas, nothing under 12 px, navy only on the main button, no face stacks, red only for Late and errors, icons
  through `AnimatedIcon` (`src/CLAUDE.md`, "Design rules"). Each screen task ends with jsdom tests in English and in Arabic (`dir="rtl"`):
  `renderApp(path, (state) => { state.users.usr_001.preferences.language = 'ar'; })` (`src/features/inbox/InboxScreen.test.tsx`).
- Leak tests come from this track (root `CLAUDE.md`, "A feature that hides a record..."): an outsider on every read path that this
  track changes, the error texts (`not_found`, never `forbidden`), and no text or id of a hidden chat in any answer.

### Files

| File | Change | Responsibility |
| --- | --- | --- |
| `src/lib/searchMatch.ts` | Create | `searchWords`, `searchesMessages`, `bodySearchText`, `holdsWords`, `hitLine`, `markedParts`: the one fold and the hit line. |
| `src/lib/params.ts` | Modify | `chatLink` and `messageParam`: the `?at=` mark of an Inbox link. |
| `server/data/loaders/query.ts` | Modify | The `after` condition, the ascending order, `search_text` columns of messages and comments. |
| `server/data/loaders/sqlSource.ts`, `memorySource.ts` | Modify | `after`, ascending order, `contains` as an escaped LIKE (Postgres only). |
| `server/data/lite/compile.ts`, `server/data/lite/source.ts` | Modify | `after` and ascending order on SQLite. |
| `src/api/chatAround.ts` | Create | `AROUND_BEFORE`, `messagePageAround`: the page that holds one message. |
| `src/api/handlers/chats.ts` | Modify | `around` and `newer` of `chats.messages`; `not_found` in `requireConversation`; the empty direct chat rule. |
| `src/api/contract/views.ts` | Modify | `ChatThread.newer`, `ProjectDetail.chatId`. |
| `server/data/loaders/chat.ts` | Modify | The `around` reads of `chatsMessages`. |
| `server/data/tables.ts` | Modify | The `search_text` server columns of `messages` and `comments`. |
| `supabase/migrations/20261020000100_message_search.sql` | Create | `pg_trgm`, the two columns, `search_fold`, the backfill, the two GIN indexes. |
| `server/data/lite/schema.ts` | Modify | SQLite schema version 5: the two columns and their step. |
| `src/api/messageSearch.ts` | Create | `MessageHit`, `MESSAGE_HITS`, `messageHits`: the Messages group of `search.query`. |
| `src/api/handlers/insights.ts` | Modify | `SearchView.messages` and the call of `messageHits`. |
| `server/data/loaders/overview.ts` | Modify | The message and comment reads of `searchQuery`, with the loop for a deleted task. |
| `src/api/handlers/notifications.ts` | Modify | The link of a notice that points to a message or a comment. |
| `server/data/loaders/chatOpen.ts` | Create | The loader of `chats.openDirect`. |
| `server/data/loaders/index.ts` | Modify | `chats.openDirect` takes `chat(chatsOpenDirect)`. |
| `src/api/views.ts` | Modify | `detailOf` fills `chatId`. |
| `src/app/readMap.ts` | Modify | The read kinds of `search.query` and `projects.get`. |
| `src/features/search/MessageHits.tsx` | Create | The Messages group of the Search screen. |
| `src/features/search/SearchScreen.tsx`, `PersonSheet.tsx` | Modify | The Messages group, the placeholder, the Message button. |
| `src/features/project/ProjectHeader.tsx` | Modify | The Project chat button. |
| `src/features/inbox/ConversationPane.tsx` | Modify | The `?at=` mark, the `around` page, Show newer messages, the focus (D13). |
| `src/features/inbox/NewerMessages.tsx` | Create | The plain "Show newer messages" button under a window of messages. |
| `server/mcp/docs.ts` | Modify | `TOOL_DOCS` of `search.query`, `chats.messages`, `chats.send`, `chats.list`, `chats.openDirect`, `projects.get`; one Messages sentence of `INSTRUCTIONS`. |
| `server/office/test/pins.ts` | Modify | The two `search.query` read pins. |
| `server/data/loaders/sweep.ts`, `loaders.test.ts` | Modify | `findTraps` and `findSweep`: the parity of the new reads. |
| `src/i18n/real/chatfind.en.json`, `chatfind.ar.json` | Create | The words of track find. |
| `src/whatsNew/entries.ts`, `src/i18n/real/whatsnew.en.json`, `whatsnew.ar.json` | Modify | One What's new line (D13). |
| Docs | Modify | `docs/superpowers/real-build/proof.md` (own section), `exit-handoff.md` (one item), `server/data/CLAUDE.md`, `supabase/CLAUDE.md`, `src/api/CLAUDE.md`, `server/mcp/CLAUDE.md`, `src/CLAUDE.md`. |

---

### Task D1: Search words, the hit line, and chat links

**Files:** Create `src/lib/searchMatch.ts`, `src/lib/searchMatch.test.ts`. Modify `src/lib/params.ts` (after `taskLink`, line 54),
`src/lib/params.test.ts`.

**Interfaces.** Consumes: `normalizeForSearch`, `plainText`, `excerptOf` (`src/lib/text.ts`). Produces:
- `export const SEARCH_WORDS_MAX = 5; export const MESSAGE_WORD_MIN = 3; export const HIT_LINE_MAX = 120;`
- `searchWords(text: string): string[]`: trim, drop a first run of `#` or `@`, fold, split on spaces, keep each word once, at most 5.
- `searchesMessages(words: readonly string[]): boolean`: true when one word has `MESSAGE_WORD_MIN` code points or more.
- `bodySearchText(body: string): string`: `normalizeForSearch(plainText(body))`. The server column and the handler both call it.
- `holdsWords(folded: string, words: readonly string[]): boolean`: every word is a substring of `folded`.
- `hitLine(plain: string, words: readonly string[], max = HIT_LINE_MAX): string`: the line of a hit (algorithm in Step 3).
- `markedParts(line: string, words: readonly string[]): { text: string; marked: boolean }[]`: each whole word whose fold holds a
  search word is one marked part; the text between marked words joins into one unmarked part.
- `chatLink(chatId: string, messageId?: string): string` and `messageParam(value: string | null): string | undefined` (a `msg_` or
  `cmt_` id with 3 digits or more, else undefined).

- [ ] **Step 1: Write the failing test** in `src/lib/searchMatch.test.ts`:
  ```ts
  describe('the words of a search (design item 16)', () => {
    it('folds the Arabic letter forms, drops tashkeel and tatweel, a first # or @, repeats, and words after the fifth', () => {
      expect(searchWords('  @أسعارُ  المـواد ')).toEqual(['اسعار', 'المواد']);
      expect(searchWords('#Riser riser RISER')).toEqual(['riser']);
      expect(searchWords('a b c d e f g')).toEqual(['a', 'b', 'c', 'd', 'e']);
    });
    it('searches messages only when one word has 3 letters or more', () => {
      expect(searchesMessages(searchWords('ab cd'))).toBe(false);
      expect(searchesMessages(searchWords('ab riser'))).toBe(true);
      expect(searchesMessages(searchWords('رسم'))).toBe(true);
    });
    it('folds a body with each mention as @Name and one space', () => {
      expect(bodySearchText('Ask @[Reem](usr_003) about the  RISER.')).toBe('ask @reem about the riser.');
      expect(bodySearchText('مدرسةٌ في الخُبَر')).toBe('مدرسه في الخبر');
    });
    it('holds a text only when it holds every word, in any order', () => {
      expect(holdsWords('the riser moved to level 2', ['level', 'riser'])).toBe(true);
      expect(holdsWords('the riser moved', ['riser', 'roof'])).toBe(false);
    });
    it('keeps a short body whole, and starts a long one 3 words before the first hit', () => {
      expect(hitLine('Short note on the riser.', ['riser'])).toBe('Short note on the riser.');
      const line = hitLine(`${'word '.repeat(60)}the new riser size is 150 mm`, ['riser']);
      expect(line).toBe('…word the new riser size is 150 mm');
      expect(Array.from(hitLine('x '.repeat(200), ['x'])).length).toBeLessThanOrEqual(HIT_LINE_MAX);
    });
    it('marks each whole word that holds a search word, so the Arabic letters stay joined', () => {
      expect(markedParts('سعر الأسعار اليوم', ['اسعار'])).toEqual([
        { text: 'سعر ', marked: false }, { text: 'الأسعار', marked: true }, { text: ' اليوم', marked: false },
      ]);
      expect(markedParts('The Riser, again', ['riser'])).toEqual([{ text: 'The ', marked: false }, { text: 'Riser,', marked: true }, { text: ' again', marked: false }]);
    });
  });
  ```
  In `src/lib/params.test.ts`:
  ```ts
  it('links a chat or a task thread, and one message in it', () => {
    expect(chatLink('cnv_001')).toBe('/inbox/cnv_001');
    expect(chatLink('cnv_001', 'msg_042')).toBe('/inbox/cnv_001?at=msg_042');
    expect(chatLink('tsk_007', 'cmt_013')).toBe('/inbox/tsk_007?at=cmt_013');
  });
  it('reads a message or a comment id from the link, and nothing else', () => {
    expect(messageParam('msg_042')).toBe('msg_042');
    expect(messageParam('cmt_013')).toBe('cmt_013');
    for (const bad of [null, '', 'msg_1', 'tsk_001', 'msg_042x', '<b>']) expect(messageParam(bad)).toBeUndefined();
  });
  ```
- [ ] **Step 2: Run it:** `npx vitest run src/lib/searchMatch.test.ts src/lib/params.test.ts --no-file-parallelism --testTimeout=60000`.
  Expected: FAIL, `./searchMatch` does not exist and `chatLink` is not exported.
- [ ] **Step 3: Implement** the signatures above. `hitLine`: make each run of white space one space and trim; split into words; find
  the first word whose fold holds a search word; when there is none, or the text before that word is shorter than `max / 2` code
  points, return `excerptOf(flat, max)`; else return `'…' + excerptOf(<the words from 3 before that word, joined>, max - 1)`.
  `markedParts`: split on `/(\s+)/`, fold each word with `normalizeForSearch`, then join the unmarked runs. The module imports no zod,
  so the Search screen chunk stays small (`src/api/CLAUDE.md`, the first-load rule).
- [ ] **Step 4: Run it** again. Expected: PASS.
- [ ] **Step 5: Commit:** `git add src/lib/searchMatch.ts src/lib/searchMatch.test.ts src/lib/params.ts src/lib/params.test.ts`;
  message: "Search: one fold for the words of a query and of a message, the hit line, and the link to one message in a chat".

### Task D2: Loader reads after one row, oldest first, and contains as an escaped LIKE

**Files:** Modify `server/data/loaders/query.ts` (`Cond` line 103, `Select.order` line 133, the doc comment of the conditions),
`server/data/loaders/sqlSource.ts` (`whereSql` lines 63 and 82, `selectSql` ordering line 142), `server/data/loaders/memorySource.ts`
(`holds` line 52, `compare` line 97), `server/data/lite/compile.ts` (line 66), `server/data/lite/source.ts` (`orderOf` line 42, `cut`
line 50), `server/data/CLAUDE.md` (Loaders). Test: Modify `server/data/loaders/sqlSource.test.ts`, `server/data/lite/compile.test.ts`,
`server/data/lite/source.test.ts`.

**Interfaces.** Produces:
- `Cond`: `| { after: { at: string; id: string } }`: `(created_at, id)` comes after this pair in text order (the mirror of `before`).
- `Select.order`: `{ col: string; desc: true; id?: true } | { col: string; asc: true; id?: true }`. An ascending order with `ties`
  throws `'An ascending read takes no ties.'` in all three sources.
- Postgres `contains`: `t.<col> like $n::text` with the value `%<word with \, % and _ escaped by \>%`. Memory and SQLite keep the
  plain substring test, so the three forms give the same rows.

- [ ] **Step 1: Write the failing test.** In `server/data/loaders/sqlSource.test.ts`:
  ```ts
  it('reads the rows after one row, oldest first (open at one message)', () => {
    const { text, values } = selectSql({
      c: 'messages', where: [{ col: 'conversation_id', in: ['cnv_001'] }, { after: { at: '2026-10-04T10:00:00.000+03:00', id: 'msg_010' } }],
      order: { col: 'created_at', asc: true, id: true }, limit: 479,
    });
    expect(text).toContain('(t.created_at collate "C" > $2::text or (t.created_at = $2::text and t.id collate "C" > $3::text))');
    expect(text).toContain('row_number() over (order by t.created_at collate "C" asc, t.id collate "C" asc, t.ord asc)');
    expect(values).toEqual([['cnv_001'], '2026-10-04T10:00:00.000+03:00', 'msg_010', 479]);
  });
  it('sends contains as LIKE with its wildcards escaped, so a trigram index can serve it', () => {
    const { text, values } = selectSql({ c: 'tasks', where: [{ col: 'search_text', contains: '50%_off\\' }] });
    expect(text).toContain('t.search_text like $1::text');
    expect(values).toEqual(['%50\\%\\_off\\\\%']);
  });
  it('refuses an ascending read with ties', () => {
    expect(() => selectSql({ c: 'messages', where: [], order: { col: 'created_at', asc: true }, limit: 2, ties: true })).toThrow('An ascending read takes no ties.');
  });
  ```
  In `server/data/lite/compile.test.ts`, add to `CASES`: `['a stamp and id after a pair', { c: 'events', where: [{ after: { at:
  '2026-10-16T09:00:00.000+03:00', id: 'evt_001' } }] }]` and `['a text that holds a LIKE wildcard', { c: 'tasks', where: [{ col:
  'search_text', contains: '%' }] }]` (the loop checks that SQLite and memory give the same ids). In `server/data/lite/source.test.ts`:
  `it('cuts an ascending read in SQL with order by asc and limit, as the memory source does')` on three events with `order: { col:
  'created_at', asc: true, id: true }, limit: 2`: the ids equal the ids of `memorySource(state).select` of the same Select.
- [ ] **Step 2: Run it:** `npx vitest run server/data/loaders/sqlSource.test.ts server/data/lite/compile.test.ts server/data/lite/source.test.ts --no-file-parallelism --testTimeout=60000`.
  Expected: FAIL, `after` is not a condition and the text holds `strpos`.
- [ ] **Step 3: Implement** the types and the three forms. Each ascending form flips each order term, the id term and the `ord` (or
  `rowid`) tie term. The LATERAL form of a `per` read takes the same ordering text. Write in `server/data/CLAUDE.md`, Loaders: "`after`
  is the mirror of `before`, and `order.asc` reads oldest first (no ties); `chats.messages` with `around` uses both. `contains` sends an
  escaped LIKE on Postgres, so a trigram index serves it; memory and SQLite keep the substring test."
- [ ] **Step 4: Run it** again, with `server/data/loaders/loaders.test.ts`. Expected: PASS. (merge lead runs)
  `MADAR_IT=1 npx vitest run --project it server/it/loaders.it.test.ts server/it/readIndexes.it.test.ts`.
- [ ] **Step 5: Commit:** `git add server/data/loaders/query.ts server/data/loaders/sqlSource.ts server/data/loaders/memorySource.ts server/data/lite/compile.ts server/data/lite/source.ts server/data/loaders/sqlSource.test.ts server/data/lite/compile.test.ts server/data/lite/source.test.ts server/data/CLAUDE.md`;
  message: "Data layer: a read of the rows after one row, oldest first, and contains as an escaped LIKE on Postgres".

### Task D3: chats.messages opens at one message

**Files:** Create `src/api/chatAround.ts`, `src/api/chatAround.test.ts`, `src/api/handlers/chatsAround.test.ts`. Modify
`src/api/handlers/chats.ts` (`chatsMessages`, line 231), `src/api/contract/views.ts` (`ChatThread`, line 259),
`server/data/loaders/chat.ts` (`chatsMessages`, line 159), `server/data/loaders/sweep.ts`, `server/data/loaders/loaders.test.ts`,
`server/mcp/docs.ts` (`chats.messages`), `server/mcp/messageTools.test.ts`, `src/api/CLAUDE.md`, `server/mcp/CLAUDE.md`.

**Interfaces.** Consumes: D2 (`after`, `order.asc`), `LIVE` (B3), the live `messagesOf` (B3), `MESSAGE_PAGE_MAX` (`chatState.ts`).
Produces:
- `src/api/chatAround.ts`: `export const AROUND_BEFORE = 20;` and `export function messagePageAround(state: State, conversationId:
  string, limit: number, aroundId: string): { page: Message[]; newer: boolean } | null` (null when the id is not a live message of
  this chat).
- `chats.messages` input `around: MessageId.optional()`; output `ChatThread.newer: z.boolean().default(false)` (true when newer
  messages exist after the page). `around` with `before` fails `invalid('around', 'Give around or before, not both.')`. An `around`
  that `messagePageAround` does not find gives the newest page, with no error.
- `findTraps(state: State): void` and `findSweep(office: State): SweepCall[]` in `server/data/loaders/sweep.ts` (D6 and D7 add to them).

- [ ] **Step 1: Write the failing test.** In `src/api/handlers/chatsAround.test.ts` (calls `chatCalls`; a group of usr_002, usr_003 and
  usr_004 made with `chats.createGroup`; `fill(n)` writes `n` messages "Line 1" to "Line n" with ids from `nextId` and the stamps
  `new Date(Date.UTC(2026, 8, 30, 6) + i * 60_000).toISOString()`; `ids` is their id list):
  ```ts
  it('opens the newest page when the message is in it', async () => {
    fill(250);
    const page = await t.api.call('chats.messages', { conversationId: group, around: ids[239] });
    expect(page.messages.map((v) => v.message.id)).toEqual(ids.slice(50));
    expect(page.newer).toBe(false);
  });
  it('opens 20 messages before an older message and every newer one, up to 500 in all', async () => {
    fill(250);
    const page = await t.api.call('chats.messages', { conversationId: group, around: ids[29] });
    expect(page.messages.map((v) => v.message.id)).toEqual(ids.slice(9));
    expect(page.newer).toBe(false);
  });
  it('cuts the page at 500 messages and says that newer messages exist', async () => {
    fill(600);
    const page = await t.api.call('chats.messages', { conversationId: group, around: ids[49] });
    expect(page.messages.map((v) => v.message.id)).toEqual(ids.slice(29, 529));
    expect(page.newer).toBe(true);
  });
  it('starts at the first message when fewer than 20 come before it', async () => {
    fill(600);
    expect((await t.api.call('chats.messages', { conversationId: group, around: ids[4] })).messages[0].message.id).toBe(ids[0]);
  });
  it('gives the newest page with no error for a message of another chat, a deleted message or an unknown id', async () => {
    fill(250);
    const other = (await t.api.call('chats.openDirect', { userId: 'usr_003' })).id;
    const foreign = (await t.api.call('chats.send', { conversationId: other, body: 'Not for the group 4471' })).message.id;
    t.store.state.messages[ids[10]].deletedAt = STAMP;
    for (const around of [foreign, ids[10], 'msg_999']) {
      const page = await t.api.call('chats.messages', { conversationId: group, around });
      expect(page.messages.at(-1)?.message.id).toBe(ids[249]);
      expect(JSON.stringify(page)).not.toContain('Not for the group 4471');
    }
  });
  it('refuses around and before together', async () => {
    fill(3);
    await expect(t.api.call('chats.messages', { conversationId: group, around: ids[1], before: ids[2] })).rejects.toMatchObject({ code: 'invalid_input' });
  });
  ```
  In `src/api/chatAround.test.ts`, the same four cuts on `messagePageAround` directly, plus `null` for a deleted target. In
  `server/data/loaders/sweep.ts`, `findTraps` adds a group of three people of the sample office with 540 messages, two of them deleted
  (the 100th and the 300th), and `findSweep` gives, for each member, `chats.messages` with `around` the 30th, the 300th, the 400th and
  the 530th message, and the id of a message of another chat. In `server/data/loaders/loaders.test.ts`:
  ```ts
  describe('the reads of track find on the scoped load', () => {
    it('gives the same answers as the whole office', async () => {
      const traps = office(findTraps);
      for (const [name, input, actor] of findSweep(traps)) await same(traps, name, input, actor);
    });
  });
  ```
  In `server/mcp/messageTools.test.ts`: `it('reads the page of a chat at one message with around')` (the agent of the Admin on `hala3`
  with `around` its message: `isError` undefined, the text holds `SECRET`, `structuredContent.newer` false), and
  `expect(TOOL_DOCS['chats.messages'].description).toContain('around')` with a length of 600 or less.
- [ ] **Step 2: Run it:** `npx vitest run src/api/chatAround.test.ts src/api/handlers/chatsAround.test.ts server/data/loaders/loaders.test.ts server/mcp/messageTools.test.ts --no-file-parallelism --testTimeout=60000`.
  Expected: FAIL, `around` is not an input of `chats.messages` (`invalid_input`).
- [ ] **Step 3: Implement.** `messagePageAround`: `live = messagesOf(state, conversationId)`; `i` = the index of `aroundId`; `i < 0` gives
  null; `i >= live.length - limit` gives the newest page (`live.slice(max(0, live.length - limit))`, newer false); else
  `start = max(0, i - AROUND_BEFORE)`, `end = min(live.length, start + MESSAGE_PAGE_MAX)`, and newer is `end < live.length`. The loader:
  add `LIVE` to the page select if the base did not; when `around` is a string and `before` is not, `byKey` the message; when it is a
  live message of this chat, read `[conversation_id = id, LIVE, before the target]` newest first with `limit: AROUND_BEFORE`, and
  `[conversation_id = id, LIVE, after the target]` with `order: { col: 'created_at', asc: true, id: true }, limit: MESSAGE_PAGE_MAX -
  AROUND_BEFORE - 1`, before the `attachedFiles` step. Add to the `chats.messages` description, at most 60 characters: "around: a message
  id; the page holds it (newer: more after)." Write one line in `src/api/CLAUDE.md` (Chats) and one in `server/mcp/CLAUDE.md` (Messages).
- [ ] **Step 4: Run it** again, and `MADAR_LITE=1 npx vitest run --project lite src/api/handlers/chatsAround.test.ts --no-file-parallelism --testTimeout=60000`.
  Expected: PASS. (merge lead runs) `npm run test:db`; `MADAR_IT=1 npx vitest run --project it server/it/loaders.it.test.ts`.
- [ ] **Step 5: Commit:** `git add src/api/chatAround.ts src/api/chatAround.test.ts src/api/handlers/chatsAround.test.ts src/api/handlers/chats.ts src/api/contract/views.ts server/data/loaders/chat.ts server/data/loaders/sweep.ts server/data/loaders/loaders.test.ts server/mcp/docs.ts server/mcp/messageTools.test.ts src/api/CLAUDE.md server/mcp/CLAUDE.md`;
  message: "Chats: chats.messages opens at one message, also when it is older than the first page (design item 17)".

### Task D4: A chat that the person may not open answers not_found

**Files:** Create `src/api/handlers/chatNotFound.test.ts`. Modify `src/api/handlers/chats.ts` (`requireConversation`, lines 29 to 38),
`src/api/handlers/chats.test.ts` (lines 30 to 32 and 50 to 53), `src/api/handlers/chatsArchive.test.ts` (line 97),
`src/api/handlers/attachments.test.ts` (line 122), `server/mcp/messageTools.test.ts` (line 155), `server/mcp/docs.ts` (`chats.send`),
`src/api/CLAUDE.md`, `server/mcp/CLAUDE.md`.

**Interfaces.** Consumes: D3 (`around`). Produces: `requireConversation` throws `notFound('Conversation', id)` for every chat that the
person may not open, whatever its kind ("Conversation <id> does not exist."). Every call that uses it (`chats.messages`, `chats.send`,
`chats.markRead`, `chats.archive`, the group writes) answers the same.

- [ ] **Step 1: Write the failing test** in `src/api/handlers/chatNotFound.test.ts` (world of `chats.test.ts`: Hala Admin, Faisal
  leader, Sara team, Omar outside; `room` the project chat of prj_001; `direct` the chat of Faisal and Sara with one message `m`):
  ```ts
  const probes = (id: string, around: string) => [
    ['chats.messages', { conversationId: id }], ['chats.messages', { conversationId: id, around }],
    ['chats.send', { conversationId: id, body: 'Hi' }], ['chats.markRead', { conversationId: id }],
    ['chats.archive', { conversationId: id, archived: true }],
  ] as const;
  it('answers a direct chat of two other people as a chat that does not exist, on every chat call, the Admin too', async () => {
    for (const person of ['usr_004', 'usr_001']) {
      t.as(person);
      for (const [name, input] of probes(direct, m)) {
        await expect(t.api.call(name, input as never)).rejects.toMatchObject({ code: 'not_found', message: `Conversation ${direct} does not exist.` });
      }
    }
  });
  it('answers a project chat off the team the same way, and the team and the Admin still open it', async () => { /* Omar: not_found on probes(room, ...); Sara and Hala: chats.messages works */ });
  // errorOf: a local helper that returns the error of a call that must fail.
  it('gives a hidden chat the same answer as an id that was never made', async () => {
    t.as('usr_004');
    const hidden = await errorOf(t.api.call('chats.messages', { conversationId: direct }));
    const never = await errorOf(t.api.call('chats.messages', { conversationId: 'cnv_999' }));
    expect({ ...hidden, message: hidden.message.replace(direct, 'X'), details: undefined }).toEqual({ ...never, message: never.message.replace('cnv_999', 'X'), details: undefined });
  });
  ```
  Change the five old expectations from `forbidden` to `not_found`. `server/mcp/messageTools.test.ts` line 155:
  `toMatchObject({ code: 'not_found', message: \`Conversation ${faisalAndTurki} does not exist.\` })`.
- [ ] **Step 2: Run it:** `npx vitest run src/api/handlers/chatNotFound.test.ts src/api/handlers/chats.test.ts src/api/handlers/chatsArchive.test.ts src/api/handlers/attachments.test.ts server/mcp/messageTools.test.ts --no-file-parallelism --testTimeout=60000`.
  Expected: FAIL, the direct chat answers `forbidden`.
- [ ] **Step 3: Implement:** one `notFound` for every kind in `requireConversation`; drop the `forbidden` import when it has no other
  use. `chats.send` description: replace "fails: forbidden for a direct or project chat, not_found for a group" with "fails with
  not_found". Update the line of `src/api/CLAUDE.md` and `server/mcp/CLAUDE.md` that names the old answer.
- [ ] **Step 4: Run it** again. Expected: PASS. (merge lead runs) `npm run test:db`.
- [ ] **Step 5: Commit:** `git add src/api/handlers/chatNotFound.test.ts src/api/handlers/chats.ts src/api/handlers/chats.test.ts src/api/handlers/chatsArchive.test.ts src/api/handlers/attachments.test.ts server/mcp/messageTools.test.ts server/mcp/docs.ts src/api/CLAUDE.md server/mcp/CLAUDE.md`;
  message: "Chats: a direct or project chat that the person may not open answers not_found, as a group does (design item 17)".

### Task D5: The search columns of messages and comments, and the trigram index

**Files:** Create `supabase/migrations/20261020000100_message_search.sql`, `server/data/searchColumns.test.ts`,
`server/it/messageSearch.it.test.ts`. Modify `server/data/tables.ts` (`comments` line 68, `messages` line 82),
`server/data/loaders/query.ts` (`COLUMNS`: `comments` line 38, `messages` line 49), `server/data/lite/schema.ts` (version, comment,
`LITE_STEPS`), `server/data/lite/schema.test.ts` (`PINNED_SHA256`, the version 4 pin, the steps test), `server/data/CLAUDE.md`
(Tables, The SQLite path), `supabase/CLAUDE.md` (Migrations).

**Interfaces.** Consumes: D1 (`bodySearchText`), D2 (LIKE), `Message.deletedAt` (B1). Produces:
- `messages.search_text`: `typeof rec.deletedAt === 'string' ? null : bodySearchText(rec.body)`; `comments.search_text`:
  `bodySearchText(rec.body)` (every comment; the loader picks the task comments). Both are loader columns `server('search_text')`,
  last in `COLUMNS`, so the SQLite tables get them in the same place.
- Postgres: the GIN indexes `messages_search` and `comments_search` (`extensions.gin_trgm_ops`), and `search_fold(body text)` for the
  backfill and the parity test. SQLite: `LITE_SCHEMA_VERSION = 5`, `LITE_STEPS[5]` = the two `alter table ... add column search_text
  text` texts. Another track that needs a schema change takes version 6 and a migration number after `20261020000100`.

- [ ] **Step 1: Write the failing test** in `server/data/searchColumns.test.ts`:
  ```ts
  it('folds the body of a message and of a comment into search_text', () => {
    expect(rowOf(tableOf('messages'), { ...message, body: 'Ask @[Reem](usr_003) about the RISER' }, state).columns.search_text).toBe('ask @reem about the riser');
    expect(rowOf(tableOf('comments'), { ...comment, body: 'أسعارُ المواد' }, state).columns.search_text).toBe('اسعار المواد');
  });
  it('keeps no search text for a deleted message, and writes it again after Undo', () => {
    expect(rowOf(tableOf('messages'), { ...message, deletedAt: STAMP }, state).columns.search_text).toBeNull();
    expect(rowOf(tableOf('messages'), { ...message }, state).columns.search_text).toBe(bodySearchText(message.body));
  });
  it('names search_text as the last loader column of messages and comments', () => {
    expect(columnNames('messages')).toEqual(['conversation_id', 'created_at', 'search_text']);
    expect(columnNames('comments')).toEqual(['target_type', 'target_id', 'created_at', 'project_id', 'search_text']);
  });
  ```
  In `server/data/lite/schema.test.ts`: the pin `{ version: 5, sha256: PINNED_SHA256 }` with the new hash; the steps test drops
  `search_text` from both tables first and expects `steps: [3, 4, 5]`; a new test `it('steps a version 4 office to the same messages
  and comments table texts as a new office')` (the pattern of the `sub_companies` test). In `server/it/messageSearch.it.test.ts` (merge
  lead runs; the pattern of `readIndexes.it.test.ts`: own schema, 6,000 messages and 6,000 comments, 30 of each with "riser" or
  "أسعار", `search_text` from `search_fold`, `analyze`):
  ```ts
  it('makes the two trigram indexes', ...);                      // pg_indexes holds messages_search and comments_search
  it('gives Arabic text its trigrams (the locale of the database)', async () => {
    const { rows } = await db.query('select extensions.show_trgm($1) as t', ['اسعار المواد']);
    expect(rows[0].t.length).toBeGreaterThan(4);
  });
  it('reads a message search on messages_search, with no scan of every message', async () => {
    const nodes = await planOf(selectSql({ c: 'messages', where: [{ col: 'conversation_id', in: chats }, { col: 'search_text', contains: 'riser' }], order: { col: 'created_at', desc: true, id: true }, limit: 5 }));
    expect(uses(nodes, 'messages_search')).toBe(true);
    expect(scans(nodes, 'messages')).toBe(false);
  });                                                            // and the same for comments_search
  it('folds a body in SQL as bodySearchText does in TypeScript', async () => {
    for (const body of SAMPLES) expect((await db.query('select search_fold($1) as f', [body])).rows[0].f, body).toBe(bodySearchText(body));
  });
  ```
  `SAMPLES`: English with capitals and NBSP, Arabic with tashkeel, tatweel, أ إ آ ٱ ة ى, Arabic-Indic digits, two mentions, tabs and new
  lines, an emoji, a 4,000-character body.
- [ ] **Step 2: Run it:** `npx vitest run server/data/searchColumns.test.ts server/data/lite/schema.test.ts --no-file-parallelism --testTimeout=60000`.
  Expected: FAIL, `search_text` is undefined.
- [ ] **Step 3: Implement.** The migration, in this order, with STE comments (`supabase/CLAUDE.md`: a new day number, no `public.`, no
  secret, a function gets no default EXECUTE):
  `create extension if not exists pg_trgm with schema extensions;` then `alter table messages add column search_text text;` and the
  same for `comments`; then `create function search_fold(body text) returns text language sql immutable strict set search_path = ''`
  with the body
  `select btrim(regexp_replace(translate(regexp_replace(lower(normalize(regexp_replace(body, '@\[([^]]{1,80})\]\((usr_[0-9]{3,})\)', '@\1', 'g'), nfkc)), '[ً-ٰٟـ]', '', 'g'), 'أإآٱةى', 'ااااهي'), '[\t\n\v\f\r    -     　﻿]+', ' ', 'g'), ' ')`
  (the steps of `normalizeForSearch` and `plainText`, in their order) and `revoke execute on function search_fold(text) from public;`;
  then `update messages set search_text = search_fold(doc->>'body') where doc->>'deletedAt' is null;` and
  `update comments set search_text = search_fold(doc->>'body');`; then `create index messages_search on messages using gin (search_text
  extensions.gin_trgm_ops);`, the same `comments_search`, and `analyze messages; analyze comments;`. The tables are no office lists, so
  the migration raises no office version (`server/data/CLAUDE.md`, Tables). No backfill step on SQLite: no real office exists below
  version 5, and the import of exit wave 4 computes the column (`rowOf`). Write the facts in `server/data/CLAUDE.md` (Tables: the two
  columns and indexes; The SQLite path: "Schema version 5 (chat search)") and `supabase/CLAUDE.md` (Migrations: `pg_trgm` lives in
  `extensions`, so an index names `extensions.gin_trgm_ops`; `search_fold` must stay in step with `bodySearchText`).
- [ ] **Step 4: Run it** again, and `MADAR_LITE=1 npx vitest run --project lite src/api/handlers/chats.test.ts --no-file-parallelism --testTimeout=60000`.
  Expected: PASS. (merge lead runs) under the Docker lock: `npx supabase db reset`, then
  `MADAR_IT=1 npx vitest run --project it server/it/messageSearch.it.test.ts server/data/schema.test.ts server/it/readIndexes.it.test.ts`,
  then `npm run test:db`. After the test deploy, run on madar-test (`POST /v1/projects/qdgwpnesxppnqsaabqzd/database/query`):
  `select current_setting('lc_ctype'), extensions.show_trgm('اسعار المواد')`, and write the answer in the proof section of D6.
- [ ] **Step 5: Commit:** `git add supabase/migrations/20261020000100_message_search.sql server/data/searchColumns.test.ts server/it/messageSearch.it.test.ts server/data/tables.ts server/data/loaders/query.ts server/data/lite/schema.ts server/data/lite/schema.test.ts server/data/CLAUDE.md supabase/CLAUDE.md`;
  message: "Data layer: a folded search column on messages and comments, with a trigram index on Postgres (design item 16)".

### Task D6: search.query finds chat messages

**Files:** Create `src/api/messageSearch.ts`, `src/api/handlers/messageSearch.test.ts`, `src/api/handlers/messageSearchLeaks.test.ts`.
Modify `src/api/handlers/insights.ts` (`SearchView` line 302, `searchQuery` line 317), `server/data/loaders/overview.ts` (`searchQuery`
line 119), `src/app/readMap.ts` (line 64), `server/data/loaders/sweep.ts` (`findTraps`, `findSweep`), `server/mcp/docs.ts`
(`search.query`, `INSTRUCTIONS` Messages line 41), `server/mcp/messageTools.test.ts`, `server/office/test/pins.ts` (lines 24 and 25),
`docs/superpowers/real-build/proof.md`, `docs/superpowers/real-build/exit-handoff.md` (section 7), `src/api/CLAUDE.md`,
`server/mcp/CLAUDE.md`.

**Interfaces.** Consumes: D1, D3 (the doc names `around`), D5, `isLiveMessage` (B2), `canSeeConversation`, `cardOf`, `principalOf`.
Produces:
- `src/api/messageSearch.ts`: `export const MessageHit = z.object({ id: z.string(), chatId: z.string(), kind: z.enum(['project',
  'direct', 'group', 'task']), title: z.string(), project: ProjectRef.nullable(), person: UserCard.nullable(), author: UserCard, mine:
  z.boolean(), line: z.string().max(200), at: Stamp })` and its type; `export const MESSAGE_HITS = 5;` and `export function
  messageHits(state: State, viewer: User, words: readonly string[]): MessageHit[]`: no hit unless `searchesMessages(words)`; the live
  messages of the chats that `canSeeConversation` allows whose `bodySearchText` holds every word; newest first by `(createdAt, id)`;
  the first `MESSAGE_HITS`. A project chat hit has the project name as title; a group its name; a direct chat the other person's name,
  with that person as `person`. `chatId` is the chat id. `mine` is `message.actingForId === viewer.id || principalOf(state,
  message.authorId) === viewer.id` (the rule of `isMine` in `chats.ts`; the module imports no handler). `line` is
  `hitLine(plainText(body), words)`.
- In `insights.ts`: `SearchView.messages: z.array(MessageHit).max(5).default([])`. The screens read the type as
  `CallOutput<'search.query'>['messages'][number]`.
- The loader reads `[conversation_id in <the chats the person may open>, contains for each word]`, newest first, `limit: MESSAGE_HITS`.

- [ ] **Step 1: Write the failing test.** `src/api/handlers/messageSearch.test.ts` (calls `insightCalls`, `chatCalls`, `contentCalls`;
  `say(conversationId, authorId, body, minute)` writes a message with the stamp `2026-09-30T10:<mm>:00.000+03:00`):
  ```ts
  it('finds the messages of a project chat that hold every word, newest first, at most 5', async () => {
    for (let i = 1; i <= 7; i++) say(room, 'usr_002', `Riser size ${i}`, i);
    t.as('usr_003');
    const { messages } = await t.api.call('search.query', { text: 'size riser' });
    expect(messages.map((h) => h.line)).toEqual(['Riser size 7', 'Riser size 6', 'Riser size 5', 'Riser size 4', 'Riser size 3']);
    expect(messages[0]).toMatchObject({ kind: 'project', chatId: room, title: 'Test Tower', project: { id: 'prj_001' }, author: { id: 'usr_002' }, mine: false, person: null });
  });
  it('matches across Arabic letter forms and tashkeel', async () => {
    say(room, 'usr_002', 'أسعارُ المواد ارتفعت', 1);
    t.as('usr_003');
    expect((await t.api.call('search.query', { text: 'اسعار' })).messages.map((h) => h.line)).toEqual(['أسعارُ المواد ارتفعت']);
  });
  it('finds no message for a query with no word of 3 letters', async () => {
    say(room, 'usr_002', 'ri ab', 1);
    expect((await t.api.call('search.query', { text: 'ri ab' })).messages).toEqual([]);
  });
  it('finds an own direct chat, with the other person as its picture', async () => { /* Sara opens and sends 'riser drawing'; as Faisal: kind 'direct', person.id 'usr_003', mine false; as Sara: mine true */ });
  it('leaves out a deleted message, and finds it again when deletedAt goes', async () => { /* set and delete deletedAt in the store */ });
  ```
  `src/api/handlers/messageSearchLeaks.test.ts` (the word "Riser 9031" in each chat):
  ```ts
  it('gives an outsider no hit of a project chat, and the team and the Admin every hit of it', ...);   // usr_004: [], usr_003 and usr_001: 1
  it('gives nobody else a hit of a direct chat, the Admin included', ...);                              // Faisal and Sara's chat: usr_004 and usr_001: []
  it('gives a hit of a group only to its members, and none after a person leaves', ...);               // chats.leaveGroup, then []
  it('gives an agent the hits of its person, and no more', ...);                                       // usr_005 (agent of Sara) equals Sara's hits
  it('leaves no text and no id of a hidden chat in the answer', async () => {
    t.as('usr_004');
    const text = JSON.stringify(await t.api.call('search.query', { text: 'Riser 9031' }));
    expect(text).not.toContain('9031');
    for (const id of [direct, group, room]) expect(text).not.toContain(id);
  });
  ```
  In `sweep.ts`, `findTraps` adds 7 project chat messages with "riser", a deleted message with "riser" newer than them, the word in a
  group and a direct chat, and an Arabic message "أسعار"; `findSweep` adds `search.query` with `riser`, `اسعار` and `ri` for every
  active human and agent. In `server/mcp/messageTools.test.ts`: `it('finds the messages of its person with search.query, and none of a
  chat its person may not open')` (text `private offer` gives one hit in `hala3`; `Admin may not open` and `other team text` give
  `messages: []`). In `src/app/readMap.test.ts` nothing changes: it fails until `search.query` names the kinds it now reads.
- [ ] **Step 2: Run it:** `npx vitest run src/api/handlers/messageSearch.test.ts src/api/handlers/messageSearchLeaks.test.ts server/data/loaders/loaders.test.ts server/mcp/messageTools.test.ts src/app/readMap.test.ts --no-file-parallelism --testTimeout=60000`.
  Expected: FAIL, the answer has no `messages`.
- [ ] **Step 3: Implement.** `searchQuery` returns `messages: messageHits(state, ctx.authority, searchWords(input.text))` (and
  `messages: []` in its early return). The loader reads after the existing reads: the chats from `L.office.conversations` filtered by
  `canSeeConversation(officeState(L), c, L.authority)`. `readMap.ts`: `search.query` gets `comments`, `conversations`, `members` and
  `messages` (keep the list sorted). `search.query` description (600 characters or less): add "messages: the newest 5 chat messages
  that hold every word (one word of 3 letters or more), each with chatId, kind, title, author, line and at; open one with chats.messages
  and around." Add to the Messages line of `INSTRUCTIONS`: "search.query also finds the messages of the chats your person may open."
  Measure the two `search.query` read pins (`MADAR_PINS_MEASURE=1`) and set each to the measured rows plus 10%. Write the proof section
  "### Chat search: the trigram index and the SQLite scan (track find)": the method above, the measured rows of both pins before and
  after, and "the office path scans `messages` and `comments` with `instr` until the restart". Add to `exit-handoff.md` section 7:
  "Chat search on the office path scans `messages` and `comments` (`instr`). At the restart, give both an FTS5 table with the trigram
  tokenizer, fed by the save, and lower the `search.query` pins." Write one line each in `src/api/CLAUDE.md` and `server/mcp/CLAUDE.md`.
- [ ] **Step 4: Run it** again; `MADAR_LITE=1 npx vitest run --project lite src/api/handlers/messageSearch.test.ts src/api/handlers/messageSearchLeaks.test.ts --no-file-parallelism --testTimeout=60000`;
  the office pins command of the rules. Expected: PASS. (merge lead runs) `npm run test:db`; `MADAR_IT=1 npx vitest run --project it
  server/it/loaders.it.test.ts server/it/messageSearch.it.test.ts`; `npm run test:mcp`.
- [ ] **Step 5: Commit:** `git add src/api/messageSearch.ts src/api/handlers/messageSearch.test.ts src/api/handlers/messageSearchLeaks.test.ts src/api/handlers/insights.ts server/data/loaders/overview.ts src/app/readMap.ts server/data/loaders/sweep.ts server/data/loaders/loaders.test.ts server/mcp/docs.ts server/mcp/messageTools.test.ts server/office/test/pins.ts docs/superpowers/real-build/proof.md docs/superpowers/real-build/exit-handoff.md src/api/CLAUDE.md server/mcp/CLAUDE.md`;
  message: "Search: search.query finds the chat messages that the person may open, with a trigram index (design item 16)".

### Task D7: search.query finds task comments

**Files:** Create `server/data/loaders/searchComments.test.ts`. Modify `src/api/messageSearch.ts`, `server/data/loaders/overview.ts`
(`searchQuery`, `OFFICE_TASK_PEOPLE` line 134), `server/data/loaders/sweep.ts`, `src/api/handlers/messageSearch.test.ts`,
`src/api/handlers/messageSearchLeaks.test.ts`, `server/mcp/docs.ts` (`search.query`), `server/mcp/messageTools.test.ts`,
`server/office/test/pins.ts`, `docs/superpowers/real-build/proof.md` (own section).

**Interfaces.** Consumes: D6, `taskResource`, `can`. Produces: `messageHits` also takes the task comments: `targetType === 'task'`, the
task is in the state, its project exists (a project task) or it is an office task, `can(viewer, 'comment.read', taskResource(state,
task, viewer.id))`, and `bodySearchText(body)` holds every word. A comment hit has `kind: 'task'`, `chatId` the task id, `title` the
task title, `project` the project of the task (null for an office task), `person` null. Quiet reason lines count as comments. Post
comments (`targetType: 'update'`) stay out. The loader adds `const OFFICE_TASK_HIT = [...OFFICE_TASK_PEOPLE, 'title'] as const` for the
pick of the seen office tasks.

- [ ] **Step 1: Write the failing test.** In `src/api/handlers/messageSearch.test.ts`:
  ```ts
  it('finds the comments of a project task and its reason lines, for every active person', async () => { /* comments.create "Riser moved" on tsk_001 and a comment with dates and body "Riser late"; usr_004 finds both, kind 'task', chatId 'tsk_001', title 'Ground floor plan', project.id 'prj_001' */ });
  it('keeps the newest 5 of messages and comments together', async () => { /* 3 messages and 3 comments with "riser" at alternating minutes: the 5 newest, in time order newest first */ });
  ```
  In `src/api/handlers/messageSearchLeaks.test.ts`:
  ```ts
  it('gives the comments of an office task only to its people and the Admin', ...);         // tasks.create with no projectId
  it('drops them for a helper whose place on the task ends', ...);                          // tasks.update helperIds: []
  it('never finds a comment on a project post', ...);                                       // comments.create targetType 'update'
  it('finds no comment of a deleted task, and finds it again after the Undo of the delete', ...); // tasks.delete, then events.undo
  ```
  In `server/data/loaders/searchComments.test.ts`: a `Source` that wraps `memorySource` and gives the first `comments` read one more row,
  a comment of `tsk_gone` (the stored `project_id` of a task that Postgres keeps after a delete):
  ```ts
  it('reads the comments again without a deleted task, until no read finds one', async () => {
    await searchQuery(new Load({ src, office: officeOf(state), actorId: 'usr_003', write: false }), { text: 'riser' });
    const reads = asked.filter((s) => s.c === 'comments' && s.where.some((cond) => 'col' in cond && cond.col === 'project_id' && 'in' in cond));
    expect(reads).toHaveLength(2);
    expect(reads[1].where).toContainEqual({ col: 'target_id', notIn: ['tsk_gone'] });
  });
  ```
  `findTraps` adds 6 project task comments with "riser", a deleted project task with the 2 newest "riser" comments, a "riser" comment
  on the office task of `officeTraps`, and a post comment with "riser". `messageTools.test.ts`: an agent finds a project task comment.
- [ ] **Step 2: Run it:** `npx vitest run src/api/handlers/messageSearch.test.ts src/api/handlers/messageSearchLeaks.test.ts server/data/loaders/searchComments.test.ts server/data/loaders/loaders.test.ts server/mcp/messageTools.test.ts --no-file-parallelism --testTimeout=60000`.
  Expected: FAIL, no comment hit.
- [ ] **Step 3: Implement.** The loader, after the message read: `projectIds = Object.keys(L.office.projects)`; read `[target_type in
  ['task'], project_id in projectIds, contains for each word]` newest first with `limit: MESSAGE_HITS`, `byKey` the tasks of the rows;
  when a row names a task that the load does not hold, add that task id to a `notIn` list on `target_id` and read again; stop when a
  read names no missing task (each round drops one task or more, so the loop ends). Then read `[target_type in ['task'], project_id eq
  null, target_id in <the seen office tasks>, contains for each word]` with the same order and limit. The seen office tasks come from
  the existing `officeTasks` read, now with `pick: OFFICE_TASK_HIT`, so an office comment hit has its title. The memory form gives a
  comment of a deleted task `project_id` null, so it never loops. `search.query` description: "messages: the newest 5 chat messages and
  task comments ... open one with chats.messages and around, or comments.list for kind task." Measure and set the two pins again, and
  update the numbers of the proof section.
- [ ] **Step 4: Run it** again; the lite command of D6 with the same files; the office pins command. Expected: PASS. (merge lead runs)
  `npm run test:db`; `MADAR_IT=1 npx vitest run --project it server/it/loaders.it.test.ts`.
- [ ] **Step 5: Commit:** `git add server/data/loaders/searchComments.test.ts src/api/messageSearch.ts server/data/loaders/overview.ts server/data/loaders/sweep.ts src/api/handlers/messageSearch.test.ts src/api/handlers/messageSearchLeaks.test.ts server/mcp/docs.ts server/mcp/messageTools.test.ts server/office/test/pins.ts docs/superpowers/real-build/proof.md`;
  message: "Search: search.query finds the comments of the tasks that the person may read, with the reason lines (design item 16)".

### Task D8: Notices open at their message

**Files:** Create `src/api/handlers/noticeLinks.test.ts`. Modify `src/api/handlers/notifications.ts` (`viewOf`, lines 105 and 127),
`src/api/CLAUDE.md`.

**Interfaces.** Consumes: D1 (`chatLink`), `Notification.messageId` (B1, B4). Produces: `NotificationView.link` is
`chatLink(chatId, messageId)` for a chat notice with a `messageId`, and `chatLink(task.id, messageId)` (the Inbox task thread) for a
task notice whose `messageId` starts with `cmt_`, while the task is live and the viewer sees it. A notice with no `messageId` (saved
before) keeps today's link. No MCP change: the `notifications.*` calls are on `MCP_DENY`.

- [ ] **Step 1: Write the failing test** in `src/api/handlers/noticeLinks.test.ts` (calls `chatCalls`, `contentCalls`,
  `notificationCalls`):
  ```ts
  it('opens a chat mention at its message', async () => {
    t.as('usr_002');
    const sent = await t.api.call('chats.send', { conversationId: room, body: '@[Sara Team](usr_003) see this' });
    t.as('usr_003');
    const [notice] = await t.api.call('notifications.list', {});
    expect(notice.link).toBe(`/inbox/${room}?at=${sent.message.id}`);
  });
  it('opens a task comment mention in the Inbox task thread at that comment', async () => { /* comments.create on tsk_001 names usr_004: link `/inbox/tsk_001?at=<cmt id>` */ });
  it('opens a name that a comment edit adds at that comment', async () => { /* comments.update adds usr_001: link `/inbox/tsk_001?at=<cmt id>` */ });
  it('keeps the old link of a notice with no message', async () => { /* a stored mention notice with no messageId: `/inbox/<room>` and `/projects/prj_001?tab=tasks&task=tsk_001` */ });
  it('gives no link for an office task that the viewer no longer sees', async () => { /* link '/notifications', as today */ });
  ```
- [ ] **Step 2: Run it:** `npx vitest run src/api/handlers/noticeLinks.test.ts --no-file-parallelism --testTimeout=60000`. Expected: FAIL,
  the link is `/inbox/<room>` with no `?at=`.
- [ ] **Step 3: Implement** the two link lines in `viewOf`. Write in `src/api/CLAUDE.md`: "A notice with `messageId` links to
  `/inbox/<chat or task>?at=<id>` (`chatLink`): a task comment opens in the Inbox task thread."
- [ ] **Step 4: Run it** again with `src/api/handlers/notifications.test.ts src/features/notifications`. Expected: PASS.
- [ ] **Step 5: Commit:** `git add src/api/handlers/noticeLinks.test.ts src/api/handlers/notifications.ts src/api/CLAUDE.md`;
  message: "Notices: a mention notice opens the chat or the Inbox task thread at its message (design item 17)".

### Task D9: A direct chat with no message shows only for the person who opened it

**Files:** Create `server/data/loaders/chatOpen.ts`, `src/api/handlers/directOpen.test.ts`. Modify `src/api/handlers/chats.ts`
(`chatsList` line 203, `chatsOpenDirect` line 371), `server/data/loaders/index.ts` (line 157 and the comment of line 25),
`server/data/loaders/sweep.ts` (`findSweep`), `server/mcp/docs.ts` (`chats.list`, `chats.openDirect`), `server/mcp/messageTools.test.ts`,
`src/api/CLAUDE.md`.

**Interfaces.** Consumes: the live `messagesOf` and `newestMessages` (B3). Produces:
- `chats.list` leaves out a direct chat whose row has no newest message (`row.previewAuthor === null`) unless the viewer has a read
  mark on it (`state.chatReads[chatReadKey(row.id, viewer.id)]`).
- `chats.openDirect`: when the chat has no live message, the actor is a human and the person has no read mark, it writes the read mark
  (`writeReadMark(ctx, id, undefined)`). An agent writes no mark: its person sees the chat after the first message.
- `server/data/loaders/chatOpen.ts`: `export async function chatsOpenDirect(L: Load, input: Record<string, unknown>): Promise<void>`
  (the existing direct chat of the person and `userId` from the office list: `newestMessages(L, [id])` and the read mark of the person).
  `LOADER_OF['chats.openDirect'] = chat(chatsOpenDirect)`. `WRITE_KINDS` already holds `chatReads` for it.

- [ ] **Step 1: Write the failing test** in `src/api/handlers/directOpen.test.ts`:
  ```ts
  it('shows a direct chat with no message only to the person who opened it', async () => {
    t.as('usr_003');
    const { id } = await t.api.call('chats.openDirect', { userId: 'usr_002' });
    expect((await t.api.call('chats.list', {})).some((row) => row.id === id)).toBe(true);
    t.as('usr_002');
    expect((await t.api.call('chats.list', {})).some((row) => row.id === id)).toBe(false);
    expect((await t.api.call('chats.openDirect', { userId: 'usr_003' })).id).toBe(id);
    expect((await t.api.call('chats.list', {})).some((row) => row.id === id)).toBe(true);
  });
  it('shows it to both people after the first message', async () => { /* Sara opens and sends: Faisal's list has the row with unread 1 */ });
  it('writes no read mark when an agent opens it', async () => { /* as usr_005: no chatReads key for usr_003; Sara's list has no row until chats.send */ });
  it('changes no read mark when the chat has messages', async () => { /* Faisal sends; Sara opens: her row keeps unread 1 */ });
  ```
  In `findSweep`: `chats.openDirect` for a pair with no chat, for a pair with an empty chat, and for a pair with messages, as writes. In
  `server/mcp/messageTools.test.ts`: `it('opens a direct chat that shows in chats.list after the first message')`.
- [ ] **Step 2: Run it:** `npx vitest run src/api/handlers/directOpen.test.ts server/data/loaders/loaders.test.ts server/mcp/messageTools.test.ts --no-file-parallelism --testTimeout=60000`.
  Expected: FAIL, Faisal's list holds the empty chat.
- [ ] **Step 3: Implement** the rule, the mark and the loader. `chats.list` description: add "A direct chat with no message shows only
  for the person who opened it." `chats.openDirect` description: add "It shows in chats.list after the first message." Write the rule in
  `src/api/CLAUDE.md` (Chats).
- [ ] **Step 4: Run it** again; `MADAR_LITE=1 npx vitest run --project lite src/api/handlers/directOpen.test.ts --no-file-parallelism --testTimeout=60000`.
  Expected: PASS. (merge lead runs) `npm run test:db`; `MADAR_IT=1 npx vitest run --project it server/it/loaders.it.test.ts`.
- [ ] **Step 5: Commit:** `git add server/data/loaders/chatOpen.ts src/api/handlers/directOpen.test.ts src/api/handlers/chats.ts server/data/loaders/index.ts server/data/loaders/sweep.ts server/data/loaders/loaders.test.ts server/mcp/docs.ts server/mcp/messageTools.test.ts src/api/CLAUDE.md`;
  message: "Chats: a direct chat with no message shows only for the person who opened it (design item 18)".

### Task D10: The Messages group of the Search screen

**Files:** Create `src/features/search/MessageHits.tsx`, `src/features/search/MessageHits.test.tsx`, `src/i18n/real/chatfind.en.json`,
`src/i18n/real/chatfind.ar.json`. Modify `src/features/search/SearchScreen.tsx` (`Results` lines 46 to 123, the placeholder line 147),
`src/CLAUDE.md`.

**Interfaces.** Consumes: D1 (`searchWords`, `markedParts`, `chatLink`), D6 and D7 (`SearchView.messages`). Produces:
`export function MessageHits({ hits, words }: { hits: CallOutput<'search.query'>['messages']; words: readonly string[] })`, with
`words = searchWords(query)`: one `Command.Group` with the heading
`search.messages`, last after Files. Each hit is a `Command.Item` (`value` `message-<id>`, at least 44 px high) that navigates to
`chatLink(hit.chatId, hit.id)`. It shows the chat picture at 32 px (`ProjectTile` for a project chat and a project task, `Avatar` of
`person` for a direct chat, `GroupPicture` of `chatId` for a group, the `ClipboardCheckIcon` circle for an office task), the chat name
in a `<bdi>` (a direct chat: `usePersonName()(person)`; a task: the title, then `projectKey(project.code)` or `office.word`), the date
`formatDay(stampDay(at), lang)` in a `<time>`, and the line: a `<bdi>` "<first name>:" (`chat.you` for `mine`), then the text with
`dir="auto"` and `natural-side`, each marked part in `<mark className="rounded-sm bg-fill-strong text-ink">`, two lines at most.
Words (`chatfind`): `search.messages` "Messages" / «الرسائل»; `search.placeholderAll` "Search projects, tasks, people, files and
messages" / «ابحث في المشاريع والمهام والأشخاص والملفات والرسائل».

- [ ] **Step 1: Write the failing test** in `src/features/search/MessageHits.test.tsx` (`renderApp('/search', prepare)`, where `prepare`
  adds to the tower chat of prj_001 a message by Faisal "The new riser size is 150 mm" and a message "تغيّرت الأسعار اليوم"):
  ```ts
  it('shows a Messages group last, with the chat, the person, the line and the date, and opens the chat at the message', async () => {
    await renderApp('/search', prepare);
    await userEvent.type(await box(), 'riser');
    const group = await screen.findByRole('group', { name: 'Messages' });
    const hit = within(group).getByRole('option', { name: /Corniche Office Tower.*Faisal:.*riser/ });
    expect(hit.querySelector('mark')?.textContent).toBe('riser');
    expect(hit.querySelector('mark')?.className).toContain('bg-fill-strong');
    expect(screen.getAllByRole('group').at(-1)).toBe(group);
    await userEvent.click(hit);
    await waitFor(() => expect(window.location.hash).toBe(`#/inbox/${room}?at=${riserId}`));
  });
  it('shows no Messages group for a query with no word of 3 letters', async () => { /* type 'ri': no group named Messages */ });
  it('marks the whole Arabic word on an Arabic screen', async () => {
    await renderApp('/search', (state) => { prepare(state); state.users.usr_001.preferences.language = 'ar'; });
    await userEvent.type(await box(), 'اسعار');
    const group = await screen.findByRole('group', { name: 'الرسائل' });
    expect(within(group).getByRole('option').querySelector('mark')?.textContent).toBe('الأسعار');
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
  });
  ```
- [ ] **Step 2: Run it:** `npx vitest run src/features/search/MessageHits.test.tsx src/features/search/SearchScreen.test.tsx --no-file-parallelism --testTimeout=60000`.
  Expected: FAIL, no group named Messages.
- [ ] **Step 3: Implement** `MessageHits`, the group after Files in `Results`, the hits in the empty check, and the new placeholder key.
  Write in `src/CLAUDE.md` (a Search bullet): "Search has a Messages group, last: the newest 5 messages and task comments with every word
  (a word of 3 letters or more); a hit opens `/inbox/<id>?at=<message>`; the mark is grey and covers the whole word."
- [ ] **Step 4: Run it** again with `src/i18n`. Expected: PASS.
- [ ] **Step 5: Commit:** `git add src/features/search/MessageHits.tsx src/features/search/MessageHits.test.tsx src/features/search/SearchScreen.tsx src/i18n/real/chatfind.en.json src/i18n/real/chatfind.ar.json src/CLAUDE.md`;
  message: "Search: the Messages group shows each hit with its chat, its person, its line and its date (design item 16)".

### Task D11: The Message button and the Project chat button

**Files:** Create `src/api/handlers/projectChatLink.test.ts`, `src/features/search/PersonMessage.test.tsx`,
`src/features/project/ProjectChatButton.test.tsx`. Modify `src/api/contract/views.ts` (`ProjectDetail`, line 113), `src/api/views.ts`
(`detailOf`, line 263), `src/app/readMap.ts` (`projects.get`), `src/features/search/PersonSheet.tsx`,
`src/features/project/ProjectHeader.tsx` (the button row), `src/i18n/real/chatfind.en.json`, `chatfind.ar.json`, `server/mcp/docs.ts`
(`projects.get`), `src/CLAUDE.md`.

**Interfaces.** Consumes: D9 (the open chat shows only for its opener), `canSeeConversation`. Produces: `ProjectDetail.chatId:
ConversationId.nullable().default(null)`: the project chat when the viewer may open it, else null. Words: `person.message` "Message" /
«أرسل رسالة»; `project.chat` "Project chat" / «محادثة المشروع».

- [ ] **Step 1: Write the failing test.** `src/api/handlers/projectChatLink.test.ts`: `projects.get` of prj_001 gives `chatId` the
  project chat for usr_001, usr_002 and usr_003, and null for usr_004. `src/features/project/ProjectChatButton.test.tsx`:
  ```ts
  it('shows a grey Project chat button that opens the project chat, for the people who may open it', async () => {
    await renderApp('/projects/prj_001');
    const link = await screen.findByRole('link', { name: 'Project chat' }, { timeout: 10_000 });
    expect(link).toHaveAttribute('href', `#/inbox/${room}`);
    expect(link.className).toContain('bg-fill');
    expect(link.className).not.toContain('signature');
  });
  it('shows no Project chat button to a person off the team', async () => { /* a member with projectRoleOf 'other' on prj_001 */ });
  it('names the button in Arabic', async () => { /* language 'ar': link 'محادثة المشروع', dir rtl */ });
  ```
  `src/features/search/PersonMessage.test.tsx`: search a person, open the sheet, press "Message": the hash is `#/inbox/<the direct chat
  id>` and the header names the person; the sheet of the own person and of an agent has no Message button; in Arabic the button is
  «أرسل رسالة».
- [ ] **Step 2: Run it:** `npx vitest run src/api/handlers/projectChatLink.test.ts src/features/project/ProjectChatButton.test.tsx src/features/search/PersonMessage.test.tsx src/app/readMap.test.ts --no-file-parallelism --testTimeout=60000`.
  Expected: FAIL, `chatId` is undefined and no button has the name.
- [ ] **Step 3: Implement.** `detailOf`: the project conversation of the project that `canSeeConversation` allows. `readMap.ts`:
  `projects.get` gets `conversations`. `ProjectHeader`: a `Link` to `/inbox/<chatId>` beside the main button, with the classes of a
  secondary button (`pressable inline-flex min-h-11 items-center gap-2 rounded-full bg-fill px-4 text-subheadline font-semibold
  text-ink hover:bg-fill-strong`) and `AnimatedIcon icon={MessageCircleIcon} size={18} aria-hidden`. `PersonSheet`: a secondary
  `Button` with the same icon, only for `person.kind === 'human'` and not the person of the session; it calls `chats.openDirect`, then
  closes the sheet and navigates to `/inbox/<id>`. `projects.get` description: add "chatId is the project chat when your person may
  open it, else null." Write one Shortcuts bullet in `src/CLAUDE.md`.
- [ ] **Step 4: Run it** again with `server/mcp/messageTools.test.ts src/i18n`. Expected: PASS.
- [ ] **Step 5: Commit:** `git add src/api/handlers/projectChatLink.test.ts src/features/search/PersonMessage.test.tsx src/features/project/ProjectChatButton.test.tsx src/api/contract/views.ts src/api/views.ts src/app/readMap.ts src/features/search/PersonSheet.tsx src/features/project/ProjectHeader.tsx src/i18n/real/chatfind.en.json src/i18n/real/chatfind.ar.json server/mcp/docs.ts src/CLAUDE.md`;
  message: "Chats: a Message button on the person sheet and a Project chat button on the project page (design item 18)".

### Task D12: The Inbox opens at one message

**Files:** Create `src/features/inbox/NewerMessages.tsx`, `src/features/inbox/OpenAtMessage.test.tsx`. Modify
`src/features/inbox/ConversationPane.tsx` (`ChatPane` line 92, `TaskPane` line 168, `ConversationPane` line 239),
`src/i18n/real/chatfind.en.json`, `chatfind.ar.json`, `src/CLAUDE.md`.

**Interfaces.** Consumes: D1 (`messageParam`, `chatLink`), D3 (`around`, `newer`). Produces:
- `ConversationPane` reads `at = messageParam(searchParams.get('at'))` and keys each pane by `` `${id}:${at ?? ''}` ``, so a new mark
  opens a new pane. `ChatPane({ id, focusFromRoute }: { id: string; focusFromRoute: string | null })` and
  `TaskPane({ id, focusFromRoute })`.
- `ChatPane` asks `chats.messages` with `around: focusFromRoute` when it is set. When the answer has `newer: true`, `NewerMessages`
  shows between the log and the box; its press, and a send that succeeds while `newer` is true, navigate to `chatLink(id)` with
  `replace: true`.
- `export function NewerMessages({ onShow }: { onShow: () => void })`: a centered `Button variant="plain"` with `chat.newerMessages`
  "Show newer messages" / «اعرض الرسائل الأحدث».

- [ ] **Step 1: Write the failing test** in `src/features/inbox/OpenAtMessage.test.tsx` (`prepare` writes 600 messages "Line 1" to
  "Line 600" into the tower chat of prj_001, one minute apart, after its sample messages):
  ```ts
  it('opens a chat at a message older than the first page, and offers the newer messages', async () => {
    await renderApp(`/inbox/${room}?at=${ids[49]}`, prepare);
    expect(await screen.findByText('Line 50', {}, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.queryByText('Line 600')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Show newer messages' }));
    await waitFor(() => expect(window.location.hash).toBe(`#/inbox/${room}`));
    expect(await screen.findByText('Line 600')).toBeInTheDocument();
  });
  it('shows no Show newer messages button when the page reaches the newest message', async () => { /* at = ids[400] */ });
  it('goes to the newest messages after a send in a window', async () => { /* type and press Send: the hash drops ?at= and 'Line 600' shows */ });
  it('opens an Inbox task thread with an at mark, with its Open task button', async () => { /* /inbox/tsk_x?at=cmt_y: the comment text and the link 'Open task' */ });
  it('offers the newer messages in Arabic', async () => { /* language 'ar': button 'اعرض الرسائل الأحدث', dir rtl */ });
  ```
- [ ] **Step 2: Run it:** `npx vitest run src/features/inbox/OpenAtMessage.test.tsx --no-file-parallelism --testTimeout=60000`.
  Expected: FAIL, "Line 50" is not in the log (the pane loads the newest page).
- [ ] **Step 3: Implement** the parts above. Write in `src/CLAUDE.md` (Inbox): "`/inbox/<id>?at=<msg_ or cmt_>` opens the chat at that
  message (`chats.messages` `around`); a window of an old message ends with Show newer messages."
- [ ] **Step 4: Run it** again with `src/features/inbox src/i18n`. Expected: PASS.
- [ ] **Step 5: Commit:** `git add src/features/inbox/NewerMessages.tsx src/features/inbox/OpenAtMessage.test.tsx src/features/inbox/ConversationPane.tsx src/i18n/real/chatfind.en.json src/i18n/real/chatfind.ar.json src/CLAUDE.md`;
  message: "Inbox: a link with a message opens the chat at that message, with Show newer messages under an old window (design item 17)".

### Task D13: The frame on the opened message, the off-page reply strip, and What's new (needs track read A5 and track msg B15)

**Files:** Modify `src/features/inbox/ConversationPane.tsx`, `src/features/inbox/OpenAtMessage.test.tsx`, `src/whatsNew/entries.ts`,
`src/i18n/real/whatsnew.en.json`, `src/i18n/real/whatsnew.ar.json`.

**Interfaces.** Consumes: D12; track read A5 (`MessageLogProps.focusId?: string | null`, `onFocused?: () => void`, the root `li` of a
framed bubble has `data-framed`); track msg B15 (`ChatPane` and `TaskPane` hold `const [focusId, setFocusId] = useState<string |
null>(null)` and pass `focusId={focusId} onFocused={() => setFocusId(null)}`; `BubbleActions.focusMessage(id: string): void`).
Produces: both panes start that state at `focusFromRoute` (`useState<string | null>(focusFromRoute)`). In `ChatPane`,
`focusMessage(target)` sets the state when the target is a loaded bubble, and else navigates to `chatLink(id, target)` (the page at an
old reply target). The query keeps `around: focusFromRoute` after `onFocused` clears the state, so the page stays.

- [ ] **Step 1: Write the failing test** in `src/features/inbox/OpenAtMessage.test.tsx`:
  ```ts
  it('frames the message of the link once', async () => {
    await renderApp(`/inbox/${room}?at=${ids[49]}`, prepare);
    const row = (await screen.findByText('Line 50', {}, { timeout: 10_000 })).closest('li')!;
    expect(row).toHaveAttribute('data-framed');
    await waitFor(() => expect(row).not.toHaveAttribute('data-framed'), { timeout: 2000 });
  });
  it('frames the comment of a task thread link', async () => { /* /inbox/tsk_x?at=cmt_y: its li has data-framed */ });
  it('opens the page of an old message when a reply strip points to it', async () => { /* a reply to ids[10] at the end: press its strip, the hash is `#/inbox/<room>?at=<ids[10]>` and 'Line 11' shows */ });
  ```
  `src/whatsNew/entries.test.ts` checks the new entry (id form, words in both languages, no em-dash, the address).
- [ ] **Step 2: Run it:** `npx vitest run src/features/inbox/OpenAtMessage.test.tsx src/whatsNew --no-file-parallelism --testTimeout=60000`.
  Expected: FAIL, the row has no `data-framed`.
- [ ] **Step 3: Implement** the parts above. What's new: `{ id: '2026-10-23-40', day: '2026-10-23', to: '/search' }` at the top of
  `WHATS_NEW` (tracks read and msg take 22, 23 and 30; the merge lead renumbers if the release day changes). `whatsnew.en.json`:
  `"2026-10-23-40": { "title": "Search messages", "body": "Search now finds the messages of your chats and the comments of tasks. Press a
  result to open the chat at that message. A person card has a Message button, and a project page has a Project chat button." }`.
  `whatsnew.ar.json`: `"2026-10-23-40": { "title": "ابحث في الرسائل", "body": "يجد البحث الآن رسائل محادثاتك وتعليقات المهام. اضغط
  على نتيجة لتفتح المحادثة عند تلك الرسالة. وفي بطاقة الشخص زر «أرسل رسالة»، وفي صفحة المشروع زر «محادثة المشروع»." }`.
- [ ] **Step 4: Run it** again with `src/features/inbox src/i18n src/whatsNew`, then `npm run typecheck`. Expected: PASS. The merge
  lead takes the screenshots of D10 to D13 (EN and AR, light and dark, 390 px and a computer).
- [ ] **Step 5: Commit:** `git add src/features/inbox/ConversationPane.tsx src/features/inbox/OpenAtMessage.test.tsx src/whatsNew/entries.ts src/i18n/real/whatsnew.en.json src/i18n/real/whatsnew.ar.json`;
  message: "Inbox: the opened message gets its frame, a reply to an old message opens its page, and the What's new line of search".


---

## Track notify

**Track scope.** Track notify builds design items 19, 20, 21, 22 and 23: the new push rules (19), the one 10-second wait with the
read skip for a chat message, a task comment, their mention or reply notice and their mention mail (20), at most one push for one
message, a read chat that marks its mention and reply notices read (20), "Notify me" for each chat with a new call and the part of the
chat header menu (21), the new "Waits for your reply" rules (22), the Admin's count and push (23), and the count rules for the paused
Track R in `docs/superpowers/real-build/exit-handoff.md`. Words go only into `src/i18n/real/chatnotify.en.json` and
`src/i18n/real/chatnotify.ar.json` (`src/i18n/CLAUDE.md`, "A task adds new words only to its own track files").

**Decisions of this section (the builder follows them, the design left them open).**
- **How the 10-second wait runs.** Two new outbox kinds: `push.chat` (the push of a chat message or a task comment) and
  `mail.chatNotice` (the mention or reply mail of one). Both are in `AFTER_ANSWER_KINDS` and in a new set `WAITED_KINDS`. On a host
  with `after` (the Worker `waitUntil`, Supabase `EdgeRuntime.waitUntil`), `runCall` hands them to `after` on a chain of their own that
  first waits `CHAT_WAIT_MS` (10,000 ms), then runs `processOutbox`. Sleep costs no CPU, so it fits the Free plans: the Worker keeps
  `waitUntil` work for about 30 s after the answer, a Supabase function for 150 s (`server/CLAUDE.md`, lines 33 to 35). If the work
  stops, the 15-minute job runs the row later (rows older than 2 minutes), and the effect checks again. With no `after` (tests, scripts)
  the rows run before the answer with no wait, as every kind does today. No new table, no new vendor, no Cron change.
- **The check after the wait** lives in the effects: `push.chat` sends nothing when the person read that chat or task thread on any
  device after the item (`chat_reads.lastReadAt`), when the message is deleted (`deletedAt`) or when the comment is gone.
  `mail.chatNotice` sends nothing when its notice is read by then. Item 20 makes a read of a chat mark its mention and reply notices
  read (Task E6), so "notice read" means "chat read or notice read".
- **One push for one message.** The producer writes at most one row for each person for each save, as today: a person with a new
  plain notice (any notice that does not point to a chat message or task comment) gets a `push.notify` row at once and no `push.chat`
  row from that save; every other person gets at most one `push.chat` row, which lists the items. The mention notice of a new message
  merges into the push of that message. An edit notice (a name added later) pushes only a person whom the chat did not push for every
  message already.
- **One rule, two databases.** The decision is one pure function, `planPushes` (`server/push/chatRule.ts`). Small fact readers feed it
  on Postgres (four statements at most, in the call's transaction) and on SQLite (the office lists in memory plus key reads), so
  `test:lite` and `test:office` keep the same rule.
- **No MCP tool change for items 19 and 20.** The push calls stay on the deny list, and no tool output changes (owner rule: "Every
  feature change updates the MCP side in the same commit": here the MCP side is unchanged and the commit says so). Item 21 adds
  `chats.setNotify` to the deny list. Items 22 and 23 change `TOOL_DOCS` of `chats.waiting` and `chats.list`.

**Order and needs.**
- E1 needs nothing new. E2 to E10 need the base (track msg B1 to B6): `NOTIFY_LEVELS`, `NotifyLevel`, `ChatRead.notify`,
  `Message.mentions` with the reply author (B6), `Message.reactions`, `Message.deletedAt`, `Comment.replyToId`, `Notification.messageId`
  and `reply` written by `notifyIn` at `chats.send`, `insertComment` and `comments.update` (B4), `isLiveMessage`, `namesPerson`,
  `notifyLevelOf` (B2), `ChatThread.notify` and `ChatThread.readUpTo` filled by `chats.messages` (B5), the `LIVE` condition of
  `server/data/loaders/steps.ts` (B3).
- Inside the track: E1, E2, E3 (needs E1), E4 (needs E2, E3), E5 (needs E1, E2), E6, E7, E8 (needs E7), E9, E10 (needs E7; it is the
  last task, with What's new).
- Other tracks: no task waits for another track's code. E10 changes one condition of the `ChatPane` read effect that track read (A6)
  also changes; the merged form is written in E10. E9 builds on msg's B3 (deleted messages leave the waits) and E4 on msg's B8 and B9
  (the edit writes notices only for new names; Undo of a delete writes its notices back as read, so it sends no push).

**Rules for every task of this track.**
- Tests: `npx vitest run <files> --no-file-parallelism --testTimeout=60000`, then `npm run typecheck`. A `src/api` test also runs on
  SQLite: `MADAR_LITE=1 npx vitest run --project lite <files> --no-file-parallelism --testTimeout=60000` (no Docker). The full suite runs
  once at the end of the wave (owner rule of 2026-10-07).
- "(merge lead runs)": `test:db` (the shadow run), `test:it` (`server/it/push.it.test.ts`, `server/it/email.it.test.ts`,
  `server/it/readIndexes.it.test.ts`), `test:office` (the rows pins of `server/office/test/pins.ts`; a moved pin gets a new ceiling of
  the measured rows plus 10% and one line of reason in `docs/superpowers/real-build/proof.md`, section "Wave 1: the rows pins"),
  `test:mcp` conformance.
- Every write runs in `runCall`; a handler stays synchronous and pure; a new field is optional (`src/api/CLAUDE.md`, Rules). The push
  and mail effects are the outbox work after the commit (`server/CLAUDE.md`, "Handlers stay synchronous and pure. Outside work goes
  through the outbox"). A module with its own SQL keeps each Postgres text and adds a `_LITE` twin (`server/data/CLAUDE.md`, "The
  SQLite path"): `?1` values, no `::` cast, at most 100 bound values, an id list through `json_each`.
- A commit message is Simplified Technical English, with no em-dash, no `Co-Authored-By` line and no `Claude-Session` line.
- Screens (E8, E10): tokens only, logical sides only, names in `<bdi>`, 44 px press areas, nothing under 12 px, navy only on the main
  button, red only for Late and errors, icons through `AnimatedIcon` (`src/CLAUDE.md`, design rules). jsdom tests in English and in
  Arabic (`dir="rtl"`). The merge lead takes the screenshots (EN and AR, light and dark, 390 px and a computer).

### Files

| File | Change | Responsible for |
| --- | --- | --- |
| `server/core/effects.ts` | Modify | `CHAT_WAIT_MS`, `WAITED_KINDS`, the two kinds in `AFTER_ANSWER_KINDS` (E1) |
| `server/core/runCall.ts` | Modify | `RunCallOptions.wait`; the waited chain after the answer (E1) |
| `server/push/chatRule.ts` | Create | The pure push rule `planPushes` and its types; `isChatItemNotice` (E2) |
| `src/api/chatState.ts` | Modify | `levelFromRead` (E2); `countsNamedOnly` and the named-only scan of `unreadIn` (E10) |
| `server/push/notify.ts` | Modify | `PUSH_CHAT_EFFECT`; `sendChatPush` and its SQL (E3); `pushRows` with both row kinds (E4) |
| `server/push/chatFacts.ts` | Create | The fact readers of the producer, Postgres and SQLite, with their SQL texts (E4) |
| `server/push/register.ts` | Modify | The `push.chat` handler (E3); `UNDO_CALLS` and the producer flag (E4) |
| `server/data/save.ts` | Modify | `SaveResult.commentIds` (E4) |
| `server/mail/notices.ts`, `server/mail/register.ts` | Modify | `CHAT_NOTICE_EFFECT`, the waited mail kind and its effect (E5); `NOTICE_FREE_CALLS` (E6, E7) |
| `src/api/handlers/chats.ts` | Modify | Read marks clear mention notices (E6); `chats.setNotify` (E7); the wait rules (E9) |
| `server/data/loaders/chat.ts`, `server/data/loaders/index.ts` | Modify | The loads of E6, E7, E9, E10 |
| `src/app/writeKinds.ts`, `server/core/everyCall.ts`, `server/mcp/tools.ts`, `server/mcp/docs.ts` | Modify | The new-call checklist (E7); the docs of E9 and E10 |
| `src/components/Menu.tsx` | Modify | Radio items, a heading and a note in a menu (E8) |
| `src/features/inbox/NotifyChoice.tsx` | Create | `useNotifyItems`: the "Notify me" items of the chat header menu (E8) |
| `src/features/inbox/ChatList.tsx`, `src/features/inbox/ConversationPane.tsx` | Modify | The extra items of the header menu (E8); the read trigger (E10) |
| `src/i18n/real/chatnotify.en.json`, `src/i18n/real/chatnotify.ar.json` | Create | The words of this track (E8, E10) |
| `src/whatsNew/entries.ts`, `src/i18n/real/whatsnew.en.json`, `src/i18n/real/whatsnew.ar.json` | Modify | Two What's new entries (E10) |
| `docs/superpowers/real-build/exit-handoff.md` | Modify | Section 10: the count and push rules for Track R (E10) |
| `server/CLAUDE.md`, `server/push/CLAUDE.md`, `server/mail/CLAUDE.md`, `server/data/CLAUDE.md`, `src/CLAUDE.md` | Modify | The guide lines that each task makes wrong, in the same commit |

---

### Task E1: The 10-second wait after the answer

**Files:** Modify `server/core/effects.ts` (lines 16 to 35), `server/core/runCall.ts` (`RunCallOptions` near line 86, the after-commit
block near lines 209 to 230), `server/push/notify.ts` (one constant), `server/mail/notices.ts` (one constant), `server/CLAUDE.md`
(lines 36 to 39). Test: Modify `server/core/runCall.test.ts` (describe "the mail effects after the answer", line 481),
`server/core/effects.test.ts` (line 39).

**Interfaces.** Consumes: `requestHost` (`server/core/after.ts`), `processOutbox`. Produces:
- `server/core/effects.ts`: `export const CHAT_WAIT_MS = 10_000;` and
  `export const WAITED_KINDS: ReadonlySet<string> = new Set(['push.chat', 'mail.chatNotice']);`. `AFTER_ANSWER_KINDS` also holds
  `'push.chat'` and `'mail.chatNotice'`. Add both kinds to the owner list of the head comment ("push.chat (notify), mail.chatNotice
  (notify)").
- `server/push/notify.ts`: `export const PUSH_CHAT_EFFECT = 'push.chat';`. `server/mail/notices.ts`:
  `export const CHAT_NOTICE_EFFECT = 'mail.chatNotice';`.
- `server/core/runCall.ts`: `RunCallOptions.wait?: (ms: number) => Promise<void>` (default: a `setTimeout` promise). After the commit,
  on a host with `after`: the waited rows (kind in `WAITED_KINDS`) leave the mail chain. Hand the mail chain to `after` first (as
  today), then `after(wait(CHAT_WAIT_MS).then(() => afterCommit(deps, waited)).then(() => undefined, warn))`. With no `after`, every
  row runs before the answer, in one `afterCommit` call, with no wait.

- [ ] **Step 1: Write the failing test.** In `server/core/runCall.test.ts`, inside the describe of line 481:
  ```ts
  it('waits CHAT_WAIT_MS after the answer for a push.chat or mail.chatNotice row, on a chain of its own (item 20)', async () => {
    undo.push(registerOutbox('clients.create', async () => [
      { kind: PUSH_CHAT_EFFECT, payload: { userId: 'usr_002', items: [] } },
      { kind: 'mail.notice', payload: { notificationId: 'ntf_900' } },
      { kind: CHAT_NOTICE_EFFECT, payload: { notificationId: 'ntf_901' } },
    ]));
    const ran: string[][] = [];
    const waits: number[] = [];
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const { call } = setup({ afterCommit: async (_deps, ids) => void ran.push(ids), wait: (ms) => { waits.push(ms); return gate; } });
    const later: Promise<unknown>[] = [];
    expect((await runInHost({ host: 'workers', after: (work) => void later.push(work) }, () => call(ADMIN, 'clients.create', { name: 'With a chat push' }))).ok).toBe(true);
    expect(waits).toEqual([10_000]);
    expect(later).toHaveLength(2);
    await later[0];
    expect(ran).toEqual([['2']]);
    open();
    await Promise.all(later);
    expect(ran).toEqual([['2'], ['1', '3']]);
  });

  it('runs a waited row before the answer, with no wait, when the host has no after', async () => {
    undo.push(registerOutbox('clients.create', async () => [{ kind: PUSH_CHAT_EFFECT, payload: { userId: 'usr_002', items: [] } }]));
    const ran: string[][] = [];
    const waits: number[] = [];
    const { call } = setup({ afterCommit: async (_deps, ids) => void ran.push(ids), wait: async (ms) => void waits.push(ms) });
    expect((await call(ADMIN, 'clients.create', { name: 'No host' })).ok).toBe(true);
    expect([waits, ran]).toEqual([[], [['1']]]);
  });
  ```
  In `server/core/effects.test.ts` line 39, the pinned set becomes
  `[LIMIT_WARNING_EFFECT, NOTICE_EFFECT, PUSH_EFFECT, QUOTA_WARNING_EFFECT, PUSH_CHAT_EFFECT, CHAT_NOTICE_EFFECT].sort()`, and add
  `it('waits 10 seconds only for the chat push and the chat mention mail', () => { expect([...WAITED_KINDS].sort()).toEqual([CHAT_NOTICE_EFFECT, PUSH_CHAT_EFFECT].sort()); expect(CHAT_WAIT_MS).toBe(10_000); for (const kind of WAITED_KINDS) expect(AFTER_ANSWER_KINDS.has(kind)).toBe(true); });`
- [ ] **Step 2: Run it:** `npx vitest run server/core/runCall.test.ts server/core/effects.test.ts --no-file-parallelism --testTimeout=60000`.
  Expected: FAIL, `PUSH_CHAT_EFFECT` is not exported and `wait` is not an option.
- [ ] **Step 3: Implement** the constants, the option and the split above. Keep the warning text of `warn` for both chains.
  `server/CLAUDE.md` line 36: add the two kinds, and the sentence "The kinds in `WAITED_KINDS` (`push.chat`, `mail.chatNotice`) wait
  `CHAT_WAIT_MS` (10 s) after the answer on a chain of their own, so the server can skip a person who read the chat (design item 20).
  The office object runs them with no wait (exit-handoff section 10)."
- [ ] **Step 4: Run it** again with `server/office/parts.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit:** `git add server/core/effects.ts server/core/runCall.ts server/push/notify.ts server/mail/notices.ts server/core/runCall.test.ts server/core/effects.test.ts server/CLAUDE.md`;
  message: "Server: the chat push and the chat mention mail wait 10 seconds after the answer (design item 20)".

### Task E2: One pure rule for who gets a push

**Files:** Create `server/push/chatRule.ts`, `server/push/chatRule.test.ts`; Modify `src/api/chatState.ts`. Test: Create
`src/api/chatState.test.ts`.

**Interfaces.** Consumes (base): `NotifyLevel`, `ChatRead.notify`, `notifyLevelOf`; `chatReadKey` (`src/api/rowKeys.ts`),
`mentionedUserIds` (`src/lib/text.ts`). Produces:
- `src/api/chatState.ts`: `export function levelFromRead(read: Pick<ChatRead, 'notify'> | undefined, kind: Conversation['kind']): NotifyLevel`
  = the stored level, else `'named'` for a project chat and `'all'` for a direct chat or a group. A loader and the push facts have no
  State, so they use this, and `notifyLevelOf` must agree with it.
- `server/push/chatRule.ts` (no import of `server/data` or a database):
  ```ts
  export type PushPerson = { id: string; kind: 'human' | 'agent'; active: boolean; admin: boolean; ownerId: string | null; device: boolean };
  export type MessageFact = { kind: 'message'; id: string; chatId: string; chatKind: 'project' | 'direct' | 'group'; memberIds: string[]; teamIds: string[]; authorId: string; actingForId: string; mentions: string[]; isNew: boolean };
  export type CommentFact = { kind: 'comment'; id: string; taskId: string; office: boolean; leadId: string | null; makerId: string; helperIds: string[]; authorId: string; body: string; replyAuthorId: string | null; line: boolean; isNew: boolean };
  export type PushNotice = { userId: string; targetType: string; targetId: string; messageId: string | null };
  export type PushFacts = { people: PushPerson[]; items: Array<MessageFact | CommentFact>; levels: Readonly<Record<string, NotifyLevel>>; notices: PushNotice[]; undo: boolean };
  export type ChatPushItem = { chatId: string; itemId: string };
  export type PushPlan = { now: string[]; waited: Array<{ userId: string; items: ChatPushItem[] }> };
  export function isChatItemNotice(n: { targetType: string; messageId?: string | null }): boolean;
  export function planPushes(facts: PushFacts): PushPlan;
  ```
  `teamIds`: the leader and the team of a project chat (empty for direct and group). `memberIds`: the people of a direct chat or a group.
  `makerId`: the raw `task.createdBy`. `levels` is keyed by `chatReadKey(chatId, userId)` and holds only stored levels. `notices` holds
  only the new unread notices of active humans with a device (the readers filter them). `isNew`: the save inserted the item. For a
  comment, `chatId` is the task id.

- [ ] **Step 1: Write the failing test.** `server/push/chatRule.test.ts`, with small makers: `person(id, over?)` (a reachable human by
  default), `msg(over?)` (a new direct message `msg_1` in `cnv_d`, members usr_002 and usr_003, by usr_002), `cmt(over?)` (a new comment
  `cmt_1` on project task `tsk_1`, lead usr_003, maker usr_001, by usr_002, body 'Done.'), `facts(over?)`. People: usr_001 (Admin),
  usr_002, usr_003, usr_004, usr_005 (agent of usr_003), usr_006 (no device), usr_007 (not active).
  ```ts
  const one = (chatId: string, itemId: string) => [{ chatId, itemId }];
  it('pushes a direct or group message to the other members after the wait, never to its author', () => {
    expect(planPushes(facts({ items: [msg()] }))).toEqual({ now: [], waited: [{ userId: 'usr_003', items: one('cnv_d', 'msg_1') }] });
  });
  it('skips a member who picked Only when I am named, unless the message names them', () => {
    const levels = { [chatReadKey('cnv_d', 'usr_003')]: 'named' as const };
    expect(planPushes(facts({ items: [msg()], levels })).waited).toEqual([]);
    expect(planPushes(facts({ items: [msg({ mentions: ['usr_003'] })], levels })).waited).toHaveLength(1);
  });
  it('pushes a project message only to the people it names: the team, the leader and the Admins start at named', () => {
    const project = msg({ chatId: 'cnv_p', chatKind: 'project', memberIds: [], teamIds: ['usr_002', 'usr_003', 'usr_004'], mentions: ['usr_004', 'usr_001'] });
    expect(planPushes(facts({ items: [project] })).waited.map((w) => w.userId)).toEqual(['usr_001', 'usr_004']);
  });
  it('pushes every project message to a person who picked All messages, an Admin outside the team too (item 23)', () => {
    const project = msg({ chatId: 'cnv_p', chatKind: 'project', memberIds: [], teamIds: ['usr_002', 'usr_003'], mentions: [] });
    const levels = { [chatReadKey('cnv_p', 'usr_003')]: 'all' as const, [chatReadKey('cnv_p', 'usr_001')]: 'all' as const };
    expect(planPushes(facts({ items: [project], levels })).waited.map((w) => w.userId)).toEqual(['usr_001', 'usr_003']);
  });
  it('never pushes the author, the person an agent wrote for, a person with no device or a person who left', () => {
    const group = msg({ chatKind: 'group', memberIds: ['usr_003', 'usr_005', 'usr_006', 'usr_007', 'usr_002'], authorId: 'usr_005', actingForId: 'usr_003' });
    expect(planPushes(facts({ items: [group] })).waited.map((w) => w.userId)).toEqual(['usr_002']);
  });
  it('pushes the task lead, and the maker of an office task, for a comment of another person (item 19, T)', () => {
    expect(planPushes(facts({ items: [cmt()] })).waited).toEqual([{ userId: 'usr_003', items: one('tsk_1', 'cmt_1') }]);
    expect(planPushes(facts({ items: [cmt({ office: true })] })).waited.map((w) => w.userId)).toEqual(['usr_001', 'usr_003']);
    expect(planPushes(facts({ items: [cmt({ authorId: 'usr_003' })] })).waited).toEqual([]);
  });
  it('pushes a person named in a comment, or the author of the comment it replies to, and nobody else', () => {
    // No lead, so only the names count. The old comment is by usr_005, the agent of usr_003: its person gets the push.
    const named = cmt({ leadId: null, body: '@[Omar](usr_004) see', replyAuthorId: 'usr_005' });
    expect(planPushes(facts({ items: [named] })).waited.map((w) => w.userId)).toEqual(['usr_003', 'usr_004']);
    expect(planPushes(facts({ items: [cmt({ leadId: null })] })).waited).toEqual([]);
  });
  it('pushes no named person who may not see an office task', () => {
    expect(planPushes(facts({ items: [cmt({ office: true, body: '@[Omar](usr_004) see' })] })).waited.map((w) => w.userId)).toEqual(['usr_001', 'usr_003']);
  });
  it('pushes nobody for a quiet line, or for a comment that an Undo brings back', () => {
    expect(planPushes(facts({ items: [cmt({ line: true })] })).waited).toEqual([]);
    expect(planPushes(facts({ items: [cmt()], undo: true })).waited).toEqual([]);
  });
  it('pushes a plain notice at once, and gives that person no waited push from the same save', () => {
    const notices = [{ userId: 'usr_003', targetType: 'task', targetId: 'tsk_1', messageId: null }];
    expect(planPushes(facts({ items: [cmt()], notices }))).toEqual({ now: ['usr_003'], waited: [] });
  });
  it('joins the mention notice of a new message to the push of that message: one push for one message', () => {
    const notices = [{ userId: 'usr_003', targetType: 'chat', targetId: 'cnv_d', messageId: 'msg_1' }];
    expect(planPushes(facts({ items: [msg({ mentions: ['usr_003'] })], notices }))).toEqual({ now: [], waited: [{ userId: 'usr_003', items: one('cnv_d', 'msg_1') }] });
  });
  it('pushes an edit notice only to a person whom the chat does not push for every message', () => {
    const old = msg({ isNew: false, mentions: ['usr_003'] });
    const notices = [{ userId: 'usr_003', targetType: 'chat', targetId: 'cnv_d', messageId: 'msg_1' }];
    expect(planPushes(facts({ items: [old], notices })).waited).toEqual([]);
    const levels = { [chatReadKey('cnv_d', 'usr_003')]: 'named' as const };
    expect(planPushes(facts({ items: [old], notices, levels })).waited).toHaveLength(1);
  });
  it('pushes a named person whose mention switch is off: the push reads the names, not the notices', () => {
    const project = msg({ chatId: 'cnv_p', chatKind: 'project', memberIds: [], teamIds: ['usr_002', 'usr_003'], mentions: ['usr_003'] });
    expect(planPushes(facts({ items: [project], notices: [] })).waited.map((w) => w.userId)).toEqual(['usr_003']);
  });
  it('tells a notice that points to a chat message or a task comment', () => {
    expect(isChatItemNotice({ targetType: 'chat', messageId: 'msg_1' })).toBe(true);
    expect(isChatItemNotice({ targetType: 'task', messageId: 'cmt_1' })).toBe(true);
    expect(isChatItemNotice({ targetType: 'update', messageId: 'cmt_2' })).toBe(false);
    expect(isChatItemNotice({ targetType: 'chat', messageId: null })).toBe(false);
  });
  ```
  `src/api/chatState.test.ts`:
  ```ts
  it('gives the default level of each chat kind, as notifyLevelOf does', () => {
    for (const kind of ['project', 'direct', 'group'] as const) {
      const c = conversationOf(kind);
      expect(levelFromRead(undefined, kind)).toBe(notifyLevelOf(state, c, 'usr_003'));
      for (const notify of NOTIFY_LEVELS) expect(levelFromRead({ notify }, kind)).toBe(notify);
    }
    expect(levelFromRead(undefined, 'project')).toBe('named');
    expect(levelFromRead(undefined, 'group')).toBe('all');
  });
  ```
- [ ] **Step 2: Run it:** `npx vitest run server/push/chatRule.test.ts src/api/chatState.test.ts --no-file-parallelism --testTimeout=60000`.
  Expected: FAIL, the modules do not export `planPushes` and `levelFromRead`.
- [ ] **Step 3: Implement.** `isChatItemNotice`: `messageId` is a non-empty string and `targetType` is `'chat'` or `'task'`.
  `planPushes`, in this order:
  1. `reach(u)`: a person of `people` with kind human, active and a device. `principal(u)`: the owner of an agent, else the id.
     `levelOf(u, item)`: `levelFromRead(levels[key] ? { notify: levels[key] } : undefined, item.chatKind)`.
  2. `now`: the sorted unique `userId` of the notices where `isChatItemNotice` is false.
  3. Each item, with `skip` = `principal(authorId)` (and `actingForId` of a message). Leave out an item with `line`, and a new item
     when `undo` is true. A new message: the members (direct, group) or `teamIds` plus every reachable Admin (project); push `u` when
     `levelOf(u) === 'all'` or `mentions` holds `u`. A new comment: `plain` = `leadId`, plus `principal(makerId)` when `office`;
     `named` = `mentionedUserIds(body)` plus `principal(replyAuthorId)`; push `u` of `plain` or `named` when `u` may read it (a project
     task: any reachable human; an office task: `principal(makerId)`, `leadId`, `helperIds` or an Admin).
  4. Each notice where `isChatItemNotice` is true: find its item by `messageId`; skip none found, a `line` item, and the author. A new
     item adds the person. An old item (an edit) adds the person only when not in the plain push of that item: a message when
     `levelOf(u) !== 'all'`; a comment when `u` is not `leadId` and not the office maker.
  5. Every person must pass `reach`. Leave out the people of `now`. `waited`: one entry for each person, sorted by `userId`, with the
     items unique by `itemId`, sorted by `itemId`.
- [ ] **Step 4: Run it** again, and `MADAR_LITE=1 npx vitest run --project lite src/api/chatState.test.ts --no-file-parallelism --testTimeout=60000`.
  Expected: PASS.
- [ ] **Step 5: Commit:** `git add server/push/chatRule.ts server/push/chatRule.test.ts src/api/chatState.ts src/api/chatState.test.ts`;
  message: "Push: one pure rule for who gets the push of a chat message or a task comment (design items 19 and 20)".

### Task E3: The chat push effect checks again after the wait

**Files:** Modify `server/push/notify.ts`, `server/push/register.ts`, `server/push/CLAUDE.md` ("The path"). Test: Modify
`server/push/notify.test.ts`; Create `server/push/chatPush.test.ts` (node:sqlite).

**Interfaces.** Consumes: E1 (`PUSH_CHAT_EFFECT`), E2 (`ChatPushItem`), `sendPushNotify`, `MESSAGE_LITE`, `freshLite`
(`server/data/lite/testDb.ts`). Produces:
- `export async function sendChatPush(payload: Record<string, unknown>, deps: Deps): Promise<void>`: payload
  `{ userId: string; items: ChatPushItem[] }`. It asks which items are still new for the person; with none it returns; else it calls
  `sendPushNotify({ userId }, deps)` (the same devices, the same empty push).
- `export const PUSH_STILL_NEW_SQL` ($1 the person, $2 the items as JSON text), on the primary (`'write'` mode, as `devicesOf`):
  ```sql
  select i."itemId" as item_id
  from jsonb_to_recordset($2::jsonb) as i("chatId" text, "itemId" text)
  left join messages m on m.id = i."itemId"
  left join comments k on k.id = i."itemId"
  left join chat_reads r on r.conversation_id = i."chatId" and r.user_id = $1
  where coalesce(m.created_at, k.created_at) is not null
    and (m.id is null or m.doc->>'deletedAt' is null)
    and (r.conversation_id is null or coalesce(m.created_at, k.created_at) collate "C" > (r.doc->>'lastReadAt') collate "C")
  order by 1
  ```
  The stamps compare as text with `collate "C"`, as the unread count does (`server/data/loaders/sqlSource.ts`, `BOUND_TERMS`).
- SQLite: `MESSAGE_LITE` (exists), `export const PUSH_COMMENT_LITE = 'select target_type, target_id, created_at, doc from comments where id = ?1'`,
  `export const CHAT_READ_LITE = 'select doc from chat_reads where conversation_id = ?1 and user_id = ?2'`; the same test in JavaScript
  (an item is still new when it exists, a message has no `deletedAt`, and there is no read mark or `createdAt > lastReadAt`).
- `registerPushEffects` also registers `registerEffect(PUSH_CHAT_EFFECT, sendChatPush)`.

- [ ] **Step 1: Write the failing test.** In `server/push/notify.test.ts`, a describe "sendChatPush: the push after the wait (item 20)",
  with the `setup` of the describe of `sendPushNotify` plus an answer for `PUSH_STILL_NEW_SQL`:
  ```ts
  const items = [{ chatId: 'cnv_013', itemId: 'msg_901' }];
  it('posts to each device of the person when an item is still new', async () => {
    const { deps, calls, seen } = setup({ devices: [device(1)], stillNew: ['msg_901'] });
    await sendChatPush({ userId: 'usr_002', items }, deps);
    expect(calls).toEqual([device(1)]);
    expect(seen(PUSH_STILL_NEW_SQL)).toEqual([['usr_002', JSON.stringify(items)]]);
  });
  it('sends nothing and reads no device when no item is still new', async () => {
    const { deps, calls, seen } = setup({ devices: [device(1)], stillNew: [] });
    await sendChatPush({ userId: 'usr_002', items }, deps);
    expect(calls).toEqual([]);
    expect(seen(PUSH_DEVICES_SQL)).toEqual([]);
  });
  it('keeps the rules in its SQL: the read mark of the person, deletedAt, and the stamps as text', () => {
    for (const part of ['chat_reads', "doc->>'deletedAt' is null", 'collate "C"', "doc->>'lastReadAt'"]) expect(PUSH_STILL_NEW_SQL).toContain(part);
  });
  it('is the handler of push.chat after registerPushEffects', () => { /* processOutbox runs a push.chat row through sendChatPush */ });
  ```
  `server/push/chatPush.test.ts` on node:sqlite (`freshLite`, the seed of `server/data/lite/producers.test.ts` with a device of usr_002,
  `fakeDeps({ db: lite.db, config: { push: vapid } })`, a stub `fetch`): a direct message `msg_901` by usr_001 in `cnv_013` at T.
  ```ts
  it('on SQLite, pushes a message that the person did not read', ...);           // no read mark of usr_002: 1 post
  it('on SQLite, skips a chat that the person read after the message', ...);     // lastReadAt T + 1 minute: 0 posts
  it('on SQLite, skips a deleted message and a comment that is gone', ...);      // doc.deletedAt set; cmt_999 missing: 0 posts
  ```
- [ ] **Step 2: Run it:** `npx vitest run server/push/notify.test.ts server/push/chatPush.test.ts --no-file-parallelism --testTimeout=60000`.
  Expected: FAIL, `sendChatPush` is not exported.
- [ ] **Step 3: Implement** the effect, the SQL, the two `_LITE` texts and the registration. `server/push/CLAUDE.md`, "The path": add
  "A `push.chat` row (a chat message, a task comment, or a mention or reply notice of one) waits 10 s after the answer (`WAITED_KINDS`).
  Then `sendChatPush` asks `PUSH_STILL_NEW_SQL` which items the person has not read on any device (`chat_reads.lastReadAt`) and which
  are not deleted, and sends one push only when one is left."
- [ ] **Step 4: Run it** again. Expected: PASS. (merge lead runs) `server/it/push.it.test.ts` with the case of E4.
- [ ] **Step 5: Commit:** `git add server/push/notify.ts server/push/register.ts server/push/CLAUDE.md server/push/notify.test.ts server/push/chatPush.test.ts`;
  message: "Push: the chat push checks after the wait and skips a chat that the person read (design item 20)".

### Task E4: The producer writes one push row for each person

**Files:** Create `server/push/chatFacts.ts`; Modify `server/push/notify.ts` (`pushRows`, line 111; remove `PUSH_NOTICE_PEOPLE_SQL`,
`PUSH_MESSAGE_PEOPLE_SQL`, `PUSH_NOTICE_PEOPLE_LITE`, `chatAudience` and `litePushRows`, which the new readers replace),
`server/push/register.ts`, `server/data/save.ts` (`Diff` line 49, `diffState` line 389, `writeDiff` line 428), `server/push/CLAUDE.md`
("Who gets a push"), `server/data/CLAUDE.md` (the `SaveResult.messageIds` line). Test: Modify `server/push/notify.test.ts` (describes
"pushRows" and "the SQL of the producer"), `server/data/lite/producers.test.ts`, `server/it/push.it.test.ts` (merge lead runs).

**Interfaces.** Consumes: E2 (`planPushes`, `PushFacts`, `isChatItemNotice`), E3, `readLiteOffice`, `liteDbOf`, `isLite`,
`mentionedUserIds` is used inside the rule only. Produces:
- `SaveResult.commentIds?: string[]` (the comments the save inserted, beside `messageIds`; left out when there are none).
- `server/push/chatFacts.ts`: `export async function readPushFacts(q: Query, saved: Pick<SaveResult, 'kinds' | 'people' | 'messageIds' | 'commentIds' | 'noticeIds'>, o: { undo: boolean }): Promise<PushFacts | null>`
  (null when the save wrote no notice, no message and no new comment: no statement runs). Postgres statements, in this order:
  1. `PUSH_NEW_NOTICES_SQL` ($1 the people of the save), only when the save wrote notices:
     ```sql
     select n.user_id, n.target_type, n.target_id, n.doc->>'messageId' as message_id
     from notifications n join users u on u.id = n.user_id
     where n.user_id = any($1::text[]) and not n.read
       and n.xmin::text::bigint = (pg_current_xact_id_if_assigned()::text::bigint % 4294967296)
       and u.kind = 'human' and u.active
       and exists (select 1 from push_devices d where d.user_id = n.user_id)
     order by n.user_id, n.ord
     ```
  2. The item ids: `messageIds`, `commentIds` (none when `o.undo`), and the `messageId` of each notice where `isChatItemNotice` is true
     (by prefix `msg_` or `cmt_`). With no item, stop here: the facts hold the notices only (one statement, as today).
  3. `PUSH_ITEMS_SQL` ($1 message ids, $2 comment ids):
     ```sql
     select 'message' as kind, m.id, m.conversation_id as chat_id, c.kind as chat_kind, c.project_id, m.doc, c.doc->'memberIds' as member_ids,
       (select coalesce(jsonb_agg(t.user_id order by t.user_id), '[]'::jsonb) from (select p.leader_id as user_id from projects p where p.id = c.project_id and p.leader_id is not null union select mb.user_id from members mb where mb.project_id = c.project_id) t) as team_ids,
       null::jsonb as task, null::text as reply_author_id
     from messages m join conversations c on c.id = m.conversation_id where m.id = any($1::text[])
     union all
     select 'comment', k.id, k.target_id, 'task', t.project_id, k.doc, null::jsonb, null::jsonb, t.doc, r.doc->>'authorId'
     from comments k join tasks t on t.id = k.target_id left join comments r on r.id = k.doc->>'replyToId'
     where k.id = any($2::text[]) and k.target_type = 'task'
     ```
  4. `PUSH_PEOPLE_SQL`: `select u.id, u.kind, u.active, u.doc->>'systemRole' as system_role, u.doc->>'ownerId' as owner_id, exists (select 1 from push_devices d where d.user_id = u.id) as device from users u order by u.id`.
  5. `PUSH_LEVELS_SQL` ($1 the chat ids of the message items), only with a message item:
     `select r.conversation_id, r.user_id, r.doc->>'notify' as notify from chat_reads r where r.conversation_id = any($1::text[]) and r.doc ? 'notify'`.
  SQLite: `PUSH_NEW_NOTICES_LITE = 'select user_id, doc from notifications where id in (select value from json_each(?1)) and read = 0'`
  (the save's `noticeIds`; keep a person who is an active human in the office lists and has a device by `PUSH_DEVICE_PEOPLE_LITE`);
  each message by `MESSAGE_LITE`, its chat and team from the office lists; each comment by `PUSH_COMMENT_LITE`, its task by
  `PUSH_TASK_LITE = 'select doc from tasks where id = ?1'`, the reply author by `PUSH_COMMENT_LITE` of `replyToId`; the people from the
  office lists and `PUSH_DEVICE_PEOPLE_LITE`; the levels by
  `PUSH_LEVELS_LITE = "select user_id, json_extract(doc, '$.notify') as notify from chat_reads where conversation_id = ?1 and json_extract(doc, '$.notify') is not null"`
  for each chat. `line` = `isLine(doc)` (`src/lib/commentLine.ts`). `office` = `task.projectId === null`.
- `server/push/notify.ts`: `export async function pushRows(q: Query, saved: Pick<SaveResult, 'kinds' | 'people' | 'messageIds' | 'commentIds' | 'noticeIds'>, o: { undo?: boolean } = {}): Promise<OutboxRow[]>`:
  `planPushes(readPushFacts(...))` as rows: first `{ kind: PUSH_EFFECT, payload: { userId } }` for each of `now`, then
  `{ kind: PUSH_CHAT_EFFECT, payload: { userId, items } }` for each of `waited`. The job (`server/jobs/steps/triggers.ts`) keeps its call.
- `server/push/register.ts`: `export const UNDO_CALLS: ReadonlySet<string> = new Set(['events.undo', 'events.undoStory']);` and the
  producer of each call is `(_output, saved, q) => pushRows(q, saved, { undo: UNDO_CALLS.has(name) })`.

- [ ] **Step 1: Write the failing test.** In `server/push/notify.test.ts` (a fake `q` that answers by the exact SQL constant and records
  the statements):
  ```ts
  it('asks nothing when the save wrote no notice, no message and no comment', async () => { /* the 3 calls of today's test, plus { kinds: new Set(['comments']), people: new Set(), commentIds: [] }: mem.statements is [] */ });
  it('reads only the new notices for a save with plain notices, and writes push.notify rows', async () => {
    const rows = await pushRows(q({ notices: [{ user_id: 'usr_003', target_type: 'task', target_id: 'tsk_001', message_id: null }] }), { kinds: new Set(['notifications']), people: new Set(['usr_003']) });
    expect(rows).toEqual([{ kind: PUSH_EFFECT, payload: { userId: 'usr_003' } }]);
    expect(statements).toEqual([PUSH_NEW_NOTICES_SQL]);
  });
  it('reads the items, the people and the levels of a new project message, and pushes only the named person after the wait', async () => {
    // The save holds no notice (kinds messages and chatReads, messageIds ['msg_010']), so PUSH_NEW_NOTICES_SQL does not run.
    // PUSH_ITEMS_SQL answers msg_010 in cnv_001 (project, team usr_002 usr_003, by usr_002, mentions ['usr_003']); PUSH_PEOPLE_SQL answers usr_001 admin, usr_002, usr_003, all with a device.
    expect(rows).toEqual([{ kind: PUSH_CHAT_EFFECT, payload: { userId: 'usr_003', items: [{ chatId: 'cnv_001', itemId: 'msg_010' }] } }]);
    expect(statements).toEqual([PUSH_ITEMS_SQL, PUSH_PEOPLE_SQL, PUSH_LEVELS_SQL]);
  });
  it('leaves the new comments out of an Undo call', async () => { /* pushRows(q, { ..., commentIds: ['cmt_9'] }, { undo: true }) gives [] and asks no PUSH_ITEMS_SQL */ });
  ```
  Describe "the SQL of the producer keeps the rules": `PUSH_NEW_NOTICES_SQL` holds the `xmin` test, `not n.read`, `u.kind = 'human'
  and u.active` and `push_devices`; `PUSH_ITEMS_SQL` holds `k.target_type = 'task'`, `members` and `leader_id`; `PUSH_LEVELS_SQL`
  holds `doc ? 'notify'`; `PUSH_PEOPLE_SQL` holds `push_devices`. Replace the three tests of `PUSH_NOTICE_PEOPLE_SQL` and
  `PUSH_MESSAGE_PEOPLE_SQL`, whose code this task deletes.
  In `server/data/lite/producers.test.ts` (the existing helpers; give usr_002, usr_003 and usr_001 a device where a case needs it):
  ```ts
  it('writes one push.chat row for the other member of a direct message, with the message as its item', ...);       // [{ kind: 'push.chat', payload: { userId: 'usr_003', items: [{ chatId: 'cnv_901', itemId: 'msg_901' }] } }]
  it('writes no row for a group member who picked Only when I am named, and one row when the message names them', ...); // chat_reads doc notify 'named'
  it('pushes a project chat message only to the people it names', ...);                                               // cnv_001, mentions ['usr_003']
  it('writes a push.chat row for the lead of a task when another person comments, and none for a quiet line', ...);    // a comment with `dates` gives []
  it('gives the comments that a save inserted in commentIds', ...);                                                    // liteSave(...).commentIds
  ```
  Update the existing cases of this file to the new kinds (a message row is now `push.chat` with its items).
  In `server/it/push.it.test.ts` (merge lead runs): `outboxOf` reads both kinds; the project chat case becomes "pushes a project chat
  message only to the people it names, never to its sender"; add "pushes a plain task comment to the task lead" and "sends no push for a
  direct message that the other person read before the push ran" (call `chats.markRead` as the other person between the send and
  `processOutbox`; with no host the rows run before the answer, so write the row with a stub `afterCommit` that holds the ids, then
  run `processOutbox` after the read).
- [ ] **Step 2: Run it:** `npx vitest run server/push/notify.test.ts server/data/lite/producers.test.ts server/jobs/steps/steps.test.ts --no-file-parallelism --testTimeout=60000`.
  Expected: FAIL, `PUSH_NEW_NOTICES_SQL` and `commentIds` do not exist.
- [ ] **Step 3: Implement** the readers, `pushRows`, `UNDO_CALLS` and `commentIds` (in `diffState`:
  `tables.find((change) => change.spec.collection === 'comments')?.inserted ?? []`; in `writeDiff` the same spread as `messageIds`).
  `server/push/CLAUDE.md`, "Who gets a push": replace the first bullet with: "A new unread notice that does not point to a chat message
  or a task comment (`isChatItemNotice`) gives a `push.notify` row at once. A new chat message, a new task comment, and a mention or
  reply notice of one give a `push.chat` row, after the 10-second wait. `planPushes` (`chatRule.ts`) decides: a direct chat or a group
  pushes its members; a project chat pushes the people its message names (an @mention or a reply); a person who picked All messages
  (`ChatRead.notify`) gets every message; a task comment pushes the task lead and the maker of an office task, and other people only
  when named. Never the author or the person an agent writes for; never for a reaction, a delete, a quiet line or an Undo; an edit
  pushes only a person it names for the first time. One row for each person for each save: a `push.notify` row wins over a
  `push.chat` row. The mention switch of Settings does not stop a push that names a person." `server/data/CLAUDE.md`: "`SaveResult.messageIds`
  and `SaveResult.commentIds` list the messages and comments a save inserted, for the push producer."
- [ ] **Step 4: Run it** again with `server/core/runCall.test.ts server/office/parts.test.ts`. Expected: PASS. (merge lead runs)
  `server/it/push.it.test.ts`, `test:office` (the write pins of `chats.send` and `comments.create` count rows written, not read; a
  read in the producer moves no write pin).
- [ ] **Step 5: Commit:** `git add server/push/chatFacts.ts server/push/notify.ts server/push/register.ts server/data/save.ts server/push/CLAUDE.md server/data/CLAUDE.md server/push/notify.test.ts server/data/lite/producers.test.ts server/it/push.it.test.ts`;
  message: "Push: a project chat pushes only the people it names, a task comment pushes its lead, one push for each person and save (design item 19)".

### Task E5: The mention mail of a chat waits and skips a read notice

**Files:** Modify `server/mail/notices.ts` (`NEW_NOTICES_SQL` line 37, `noticeRows` line 112, `liteNoticeRows` line 122),
`server/mail/register.ts`, `server/mail/CLAUDE.md` (line 28). Test: Modify `server/mail/notices.test.ts`,
`server/data/lite/producers.test.ts`, `server/it/email.it.test.ts` (merge lead runs).

**Interfaces.** Consumes: E1 (`CHAT_NOTICE_EFFECT`), E2 (`isChatItemNotice`), `sendNoticeMail`. Produces:
- `NEW_NOTICES_SQL` also selects `n.target_type, n.doc->>'messageId' as message_id`. `noticeRows` writes
  `{ kind: CHAT_NOTICE_EFFECT, payload: { notificationId } }` for a notice where `isChatItemNotice({ targetType: n.target_type,
  messageId: n.message_id })` is true, and `mail.notice` for every other notice. The SQLite path reads the same two fields from the doc.
- `export const NOTICE_UNREAD_SQL = 'select id from notifications where id = $1 and not read';` and
  `export const NOTICE_UNREAD_LITE = 'select id from notifications where id = ?1 and read = 0';`.
- `export async function sendChatNoticeMail(payload: Record<string, unknown>, deps: Deps): Promise<void>`: no row from
  `NOTICE_UNREAD_SQL` (the person read the chat or the notice, or a delete or an edit took the notice) sends nothing; else it calls
  `sendNoticeMail(payload, deps)` (the same quota, the same key `notice-<id>`). `registerMailEffects` registers it for
  `CHAT_NOTICE_EFFECT`.

- [ ] **Step 1: Write the failing test.** In `server/mail/notices.test.ts`:
  ```ts
  it('writes a mail.chatNotice row for a new mention notice of a chat message or a task comment, and mail.notice for any other', async () => {
    // NEW_NOTICES_SQL answers ntf_1 (mention, chat, msg_9), ntf_2 (mention, task, cmt_9), ntf_3 (mention, update, no messageId), ntf_4 (task_assigned), each with the mail switch on.
    expect(rows.map((r) => [r.kind, r.payload.notificationId])).toEqual([[CHAT_NOTICE_EFFECT, 'ntf_1'], [CHAT_NOTICE_EFFECT, 'ntf_2'], [NOTICE_EFFECT, 'ntf_3'], [NOTICE_EFFECT, 'ntf_4']]);
  });
  it('sendChatNoticeMail sends nothing for a notice that is read by now, or gone', async () => { /* NOTICE_UNREAD_SQL answers []: no mail in the port, no quota row */ });
  it('sendChatNoticeMail sends the notice mail with the key notice-<id> when the notice is still unread', async () => { /* one mail, idempotencyKey 'notice-ntf_1' */ });
  it('registers mail.chatNotice with registerMailEffects', () => { /* processOutbox runs a mail.chatNotice row */ });
  ```
  In `server/data/lite/producers.test.ts`: `it('writes a mail.chatNotice row on SQLite for a mention notice that points to a chat message')`.
  In `server/it/email.it.test.ts` (merge lead runs): `it('sends no mention mail when the person reads the chat before the mail runs')`.
- [ ] **Step 2: Run it:** `npx vitest run server/mail/notices.test.ts server/data/lite/producers.test.ts --no-file-parallelism --testTimeout=60000`.
  Expected: FAIL, every row is `mail.notice`.
- [ ] **Step 3: Implement** the two columns, the kind choice, the effect and the registration. `server/mail/CLAUDE.md` line 28: add
  "The mention or reply mail of a chat message or a task comment (`mail.chatNotice`) waits 10 s after the answer, and sends nothing
  when its notice is read by then (a read of the chat marks it read). Every other notice mail goes at once."
- [ ] **Step 4: Run it** again with `server/jobs/steps/steps.test.ts server/core/effects.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit:** `git add server/mail/notices.ts server/mail/register.ts server/mail/CLAUDE.md server/mail/notices.test.ts server/data/lite/producers.test.ts server/it/email.it.test.ts`;
  message: "Mail: the mention mail of a chat waits 10 seconds and skips a notice that the person read (design item 20)".

### Task E6: A read of a chat marks its mention and reply notices read

**Files:** Modify `src/api/handlers/chats.ts` (`chatsMarkRead` line 318, `chatsArchive` line 332), `server/data/loaders/chat.ts`
(`chatsArchive` line 122, `chatsMarkRead` line 130), `src/app/writeKinds.ts` (lines 88 and 89), `server/mail/notices.ts`
(`NOTICE_FREE_CALLS`). Test: Create `src/api/handlers/chatsNotices.test.ts`; Modify `server/core/chatsArchiveSignal.test.ts`.

**Interfaces.** Consumes (base): `Notification.reply`; `chatReadKey`. Produces:
- `function readMentionNotices(ctx: Ctx, chatId: string): void` in `chats.ts`: each notice of `ctx.authority.id` that is unread, has
  trigger `'mention'` (a reply notice has it too), `targetId === chatId` and `targetType === (chatId.startsWith('tsk_') ? 'task' :
  'chat')` gets `read = true`. `chats.markRead` calls it for a chat and for a task thread; `chats.archive` calls it when `archived` is
  true. `chats.send` does not call it (its loader does not load notices, and the open chat already marked them).
- Loader step `async function mentionNoticesOf(L: Load, chatId: string): Promise<void>` in `chat.ts`:
  `L.select({ c: 'notifications', where: [{ col: 'user_id', eq: me }, { col: 'read', eq: false }, { col: 'target_id', eq: chatId }] })`
  (the index `notifications_inbox`); `chatsMarkRead` and `chatsArchive` call it.
- `WRITE_KINDS['chats.markRead']` and `WRITE_KINDS['chats.archive']` become `['chatReads', 'notifications']`.
- `NOTICE_FREE_CALLS` adds `'chats.markRead'` and `'chats.archive'`: they change old notices and never make one, so no mail or push
  producer runs for them (`server/mail/notices.ts`, the rule of that set).

- [ ] **Step 1: Write the failing test.** `src/api/handlers/chatsNotices.test.ts` (calls: `chatCalls`, `contentCalls`,
  `notificationCalls`; the world of `chatsArchive.test.ts` with tsk_001 led by Sara):
  ```ts
  it('marks the mention notices of a chat read when the person reads the chat (item 20)', async () => {
    t.as('usr_002');
    await t.api.call('chats.send', { conversationId: t.room, body: `${mentionMarkup('Sara Team', 'usr_003')} and ${mentionMarkup('Hala Admin', 'usr_001')} check this` });
    t.as('usr_003');
    expect((await t.api.call('notifications.count', {})).unread).toBe(1);
    await t.api.call('chats.markRead', { conversationId: t.room });
    expect((await t.api.call('notifications.count', {})).unread).toBe(0);
    t.as('usr_001');
    expect((await t.api.call('notifications.count', {})).unread).toBe(1);
  });
  it('marks the mention notices of a task thread read when the person reads the thread', async () => { /* comments.create on tsk_001 by Faisal names Sara; Sara chats.markRead tsk_001; count 0 */ });
  it('marks a reply notice read too', async () => { /* a notice with trigger mention, reply true, targetId the room: read after chats.markRead */ });
  it('leaves the notices of another chat and an added_to_group notice unread', async () => { /* Sara is named in a direct chat and added to a group; she reads the group: both stay unread */ });
  it('marks them read when the person archives the chat, and changes none when the chat moves back', async () => { /* archive true: read; archive false on a new notice: stays unread */ });
  ```
  In `server/core/chatsArchiveSignal.test.ts`: `it('sends only a person signal when the archive also marks a mention notice read')`
  (plant an unread mention notice of usr_001 for `cnv_001`): one signal, `office: false`, kinds `['chatReads', 'notifications']`,
  channel `person:usr_001`.
- [ ] **Step 2: Run it:** `npx vitest run src/api/handlers/chatsNotices.test.ts server/core/chatsArchiveSignal.test.ts --no-file-parallelism --testTimeout=60000`.
  Expected: FAIL, the count stays 1.
- [ ] **Step 3: Implement** the helper, the two calls, the loader step, the two `WRITE_KINDS` lines and the two names in
  `NOTICE_FREE_CALLS`.
- [ ] **Step 4: Run it** again with `server/core/writeKinds.test.ts src/api/handlers/chatsArchive.test.ts server/push/notify.test.ts server/mail/notices.test.ts`,
  and `MADAR_LITE=1 npx vitest run --project lite src/api/handlers/chatsNotices.test.ts --no-file-parallelism --testTimeout=60000`.
  Expected: PASS. (merge lead runs) `test:db` (the shadow run of the new file), `server/it/readIndexes.it.test.ts`.
- [ ] **Step 5: Commit:** `git add src/api/handlers/chats.ts server/data/loaders/chat.ts src/app/writeKinds.ts server/mail/notices.ts src/api/handlers/chatsNotices.test.ts server/core/chatsArchiveSignal.test.ts`;
  message: "Chats: a read of a chat or a task thread marks its mention and reply notices read (design item 20)".

### Task E7: The call chats.setNotify

**Files:** Modify `src/api/handlers/chats.ts` (new `chatsSetNotify`; `chatCalls` line 587), `server/data/loaders/chat.ts`,
`server/data/loaders/index.ts` (line 155), `server/mcp/tools.ts` (the deny list, line 82), `server/core/everyCall.ts` (line 96),
`src/app/writeKinds.ts`, `server/mail/notices.ts` (`NOTICE_FREE_CALLS`), the pinned counts. Test: Create
`src/api/handlers/chatsNotify.test.ts`, `server/core/chatsNotifySignal.test.ts`; Modify `src/api/calls.test.ts` (line 39),
`server/core/serverCallMap.test.ts` (line 16), `server/http/health.test.ts`, `server/it/worker.it.test.ts` (merge lead runs), and the
MCP count tests that `npx vitest run server/mcp` names.

**Interfaces.** Consumes (base): `NOTIFY_LEVELS`, `ChatRead.notify`, `ChatThread.notify` (B5 fills it with `notifyLevelOf`).
Produces:
- `chats.setNotify`: input `z.object({ conversationId: ConversationId, notify: z.enum(NOTIFY_LEVELS) })`, output
  `z.object({ notify: z.enum(NOTIFY_LEVELS) })`. It checks the chat with `requireConversation` (a task thread id fails the input:
  design "P D G (not T)"), then writes the read mark of the person with every old field kept and `notify` set; with no mark it uses
  `lastReadAt: NEVER_READ`. No event, no notice, no message. A personal kind, so its save sends one person signal and no office signal
  (`chatReads` is in `PERSONAL_KINDS`, `server/data/save.ts`).
- Loader `export async function chatsSetNotify(L: Load, input: Input): Promise<void>`: `L.byKey('chatReads', [chatReadKey(id, me)])`
  (the chat is an office list). `LOADER_OF['chats.setNotify'] = chat(chatsSetNotify)`.
- `MCP_DENY` gets `'chats.setNotify'` after `'chats.archive'`, with the comment "A Notify me choice is screen state of one person, as
  an archive mark (design item 21)." No `TOOL_DOCS`.
- `everyCall`: `'chats.setNotify': [{ conversationId: 'cnv_001', notify: 'all' }]`. `WRITE_KINDS['chats.setNotify'] = ['chatReads']`.
  `NOTICE_FREE_CALLS` adds `'chats.setNotify'`. No new words (the refusals are today's texts).

- [ ] **Step 1: Write the failing test.** `src/api/handlers/chatsNotify.test.ts` (the world of `chatsArchive.test.ts`, a direct chat
  of usr_002 and usr_003, and a group of usr_002, usr_003 and usr_001):
  ```ts
  it('starts a project chat at named and a direct chat and a group at all', async () => {
    t.as('usr_003');
    expect((await t.api.call('chats.messages', { conversationId: t.room })).notify).toBe('named');
    expect((await t.api.call('chats.messages', { conversationId: direct })).notify).toBe('all');
    expect((await t.api.call('chats.messages', { conversationId: group })).notify).toBe('all');
  });
  it('saves the choice of one person for one chat', async () => {
    t.as('usr_003');
    expect(await t.api.call('chats.setNotify', { conversationId: t.room, notify: 'all' })).toEqual({ notify: 'all' });
    expect((await t.api.call('chats.messages', { conversationId: t.room })).notify).toBe('all');
    t.as('usr_002');
    expect((await t.api.call('chats.messages', { conversationId: t.room })).notify).toBe('named');
  });
  it('keeps the read mark and the archive mark', async () => { /* archive, then setNotify: archivedAt and lastReadAt stay */ });
  it('refuses a task thread id as input', async () => { expect(await codeOf(t.api.call('chats.setNotify', { conversationId: 'tsk_001', notify: 'all' } as never))).toBe('invalid_input'); });
  it('answers not_found for a group the person is not in, and stores nothing', async () => {
    t.as('usr_004');
    expect(await codeOf(t.api.call('chats.setNotify', { conversationId: group, notify: 'named' }))).toBe('not_found');
    expect(t.store.state.chatReads[chatReadKey(group, 'usr_004')]).toBeUndefined();
  });
  it('refuses an outsider of a direct chat and stores nothing', async () => { /* usr_004 on `direct`: not 'ok' (not_found once track find merges); no read mark */ });
  it('writes no event', async () => { /* events count unchanged */ });
  ```
  `server/core/chatsNotifySignal.test.ts` (the pattern of `chatsArchiveSignal.test.ts`): `chats.setNotify` for usr_001 on `cnv_001` gives
  one signal, `office: false`, kinds `['chatReads']`, channel `person:usr_001`, and no event.
- [ ] **Step 2: Run it:** `npx vitest run src/api/handlers/chatsNotify.test.ts server/core/chatsNotifySignal.test.ts --no-file-parallelism --testTimeout=60000`.
  Expected: FAIL, the call `chats.setNotify` does not exist.
- [ ] **Step 3: Implement** the call and the whole checklist of `src/api/CLAUDE.md` ("A new call: the checklist", steps 1, 3, 4, 5,
  7, 9). Raise each pinned count by running its test and reading the real number (`src/api/calls.test.ts`,
  `server/core/serverCallMap.test.ts`, `server/http/health.test.ts`, the MCP count tests).
- [ ] **Step 4: Run it** again with `src/api/calls.test.ts server/core/serverCallMap.test.ts server/http/health.test.ts server/core/writeKinds.test.ts server/mcp`,
  and `MADAR_LITE=1 npx vitest run --project lite src/api/handlers/chatsNotify.test.ts --no-file-parallelism --testTimeout=60000`.
  Expected: PASS. (merge lead runs) `test:db`, `server/it/worker.it.test.ts`, `test:office` (the `everyCall` parity).
- [ ] **Step 5: Commit:** `git add src/api/handlers/chats.ts server/data/loaders/chat.ts server/data/loaders/index.ts server/mcp/tools.ts server/core/everyCall.ts src/app/writeKinds.ts server/mail/notices.ts src/api/handlers/chatsNotify.test.ts server/core/chatsNotifySignal.test.ts src/api/calls.test.ts server/core/serverCallMap.test.ts server/http/health.test.ts server/it/worker.it.test.ts`
  plus the MCP test files with a new count; message: "Chats: chats.setNotify keeps the Notify me choice of one person for one chat (design item 21)".

### Task E8: "Notify me" in the chat header menu

**Files:** Modify `src/components/Menu.tsx` (`MenuItem` line 12, `MenuList` lines 14 to 85, `Menu` `openMenu`),
`src/features/inbox/ChatList.tsx` (`ArchiveMenu` line 45), `src/features/inbox/ConversationPane.tsx` (`GroupMenu` lines 77 to 91,
`ChatPane` header action lines 144 to 148), `src/CLAUDE.md` (section "Inbox, groups and What's new"); Create
`src/features/inbox/NotifyChoice.tsx`, `src/i18n/real/chatnotify.en.json`, `src/i18n/real/chatnotify.ar.json`. Test: Create
`src/components/Menu.test.tsx`, `src/features/inbox/NotifyChoice.test.tsx`.

**Interfaces.** Consumes: E7 (`chats.setNotify`), base `ChatThread.notify`, `useAction` (`src/app/runtime`), `CheckIcon`
(`src/components/icons/animated/check.tsx`). Produces:
- `MenuItem` gets three optional fields: `checked?: boolean` (the item draws as `role="menuitemradio"` with `aria-checked`; a checked
  item shows `AnimatedIcon icon={CheckIcon} size={18}` in `text-accent` at its end), `heading?: string` (a hairline and a small label
  `text-footnote font-semibold text-ink-2` above the item), `note?: string` (a line `text-footnote text-ink-2` under the item). The
  arrow keys and the first focus take `[role="menuitem"], [role="menuitemradio"]`. `menuPlace` counts each heading and note as one
  more item. Track msg adds a `head` prop to the same file; the two changes do not touch each other.
- `ArchiveMenu` gets `extra?: MenuItem[]`, drawn after the Archive item. `GroupMenu` gets `extra: MenuItem[]` after Archive.
- `src/features/inbox/NotifyChoice.tsx`: `export function useNotifyItems(chatId: string, level: NotifyLevel): MenuItem[]` gives
  `[{ label: t('chat.notifyAll'), heading: t('chat.notify'), checked: level === 'all', onSelect }, { label: t('chat.notifyNamed'),
  checked: level === 'named', note: t('chat.notifyNote'), onSelect }]`; a pick of the other level calls
  `chats.setNotify { conversationId: chatId, notify }`; a pick of the checked one sends nothing. `ChatPane` calls it next to its other
  hooks, before the early returns, with `data?.notify ?? 'all'`, and passes the items to `GroupMenu` or `ArchiveMenu`. `TaskPane`
  gets none (design: "P D G (not T)").
- Words (design table): `chat.notify` "Notify me" / «نبّهني»; `chat.notifyAll` "All messages" / «كل الرسائل»; `chat.notifyNamed`
  "Only when I am named" / «فقط عندما يذكرني أحد»; `chat.notifyNote` "The unread count still shows every message." / «يظل عدد غير
  المقروءة يحسب كل رسالة.». The files hold `{ "chat": { ... } }`.

- [ ] **Step 1: Write the failing test.** `src/components/Menu.test.tsx`:
  ```ts
  it('draws a radio item with aria-checked, and a check mark only on the checked one', async () => { /* Menu with two items checked true/false: getByRole('menuitemradio', { name: 'A' }) has aria-checked 'true' */ });
  it('draws the heading above its item and the note under it', async () => { /* the heading text comes before the item in the DOM order, the note after it */ });
  it('moves the focus over plain and radio items with the arrow keys', async () => { /* Archive, then A, then B */ });
  ```
  `src/features/inbox/NotifyChoice.test.tsx` (`renderApp`; Hala is usr_001; `cnv_001` is the Corniche Office Tower chat, `cnv_013` her
  direct chat with Faisal, `cnv_015` the group "Facade review"):
  ```ts
  it('shows Notify me under Archive, with Only when I am named checked, in a project chat', async () => {
    await renderApp('/inbox/cnv_001');
    await userEvent.click(await screen.findByRole('button', { name: 'Options for Corniche Office Tower' }));
    const menu = await screen.findByRole('menu');
    const items = [...menu.querySelectorAll('[role="menuitem"], [role="menuitemradio"]')];
    expect(items.map((i) => i.textContent)).toEqual(['Archive', 'All messages', 'Only when I am named']);
    expect(within(menu).getByRole('menuitemradio', { name: 'Only when I am named' })).toHaveAttribute('aria-checked', 'true');
    expect(within(menu).getByText('Notify me')).toBeInTheDocument();
    expect(within(menu).getByText('The unread count still shows every message.')).toBeInTheDocument();
  });
  it('starts a direct chat and a group at All messages', async () => { /* cnv_013 and cnv_015: 'All messages' aria-checked true; the group menu keeps Rename first */ });
  it('saves All messages for this person and this chat, and the menu shows it', async () => {
    const { store } = await renderApp('/inbox/cnv_001');
    // open the menu, press All messages
    await waitFor(() => expect(store.state.chatReads[chatReadKey('cnv_001', 'usr_001')]?.notify).toBe('all'));
    // open the menu again: All messages is checked
  });
  it('shows no Notify me in a task thread', async () => { /* /inbox/<tsk id> of withTaskTalk: the header menu has no menuitemradio */ });
  it('shows Notify me in Arabic, right to left', async () => {
    await renderApp('/inbox/cnv_001', (state) => { state.users.usr_001.preferences.language = 'ar'; });
    await userEvent.click(await screen.findByRole('button', { name: 'خيارات Corniche Office Tower' }));
    expect(await screen.findByRole('menuitemradio', { name: 'فقط عندما يذكرني أحد' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('نبّهني')).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('rtl');
  });
  ```
  (If the project name shows in Arabic in the Arabic screen, take the label from `t('chat.optionsFor', { title })` of the row.)
- [ ] **Step 2: Run it:** `npx vitest run src/components/Menu.test.tsx src/features/inbox/NotifyChoice.test.tsx --no-file-parallelism --testTimeout=60000`.
  Expected: FAIL, no `menuitemradio` shows.
- [ ] **Step 3: Implement** the three `MenuItem` fields, `useNotifyItems`, the `extra` items and the words. `src/CLAUDE.md`: "Notify me
  (design item 21): the header menu of a project chat, a direct chat or a group holds, under Archive, the heading Notify me and two
  radio items (`useNotifyItems`, `NotifyChoice.tsx`), saved by `chats.setNotify`. A `MenuItem` takes `checked`, `heading` and `note`."
- [ ] **Step 4: Run it** again with `src/features/inbox/InboxScreen.test.tsx src/features/inbox/ConversationPane.test.tsx src/i18n`.
  Expected: PASS. (merge lead) screenshots of the open menu: EN and AR, light and dark, 390 px and a computer.
- [ ] **Step 5: Commit:** `git add src/components/Menu.tsx src/components/Menu.test.tsx src/features/inbox/NotifyChoice.tsx src/features/inbox/NotifyChoice.test.tsx src/features/inbox/ChatList.tsx src/features/inbox/ConversationPane.tsx src/i18n/real/chatnotify.en.json src/i18n/real/chatnotify.ar.json src/CLAUDE.md`;
  message: "Inbox: Notify me in the chat menu, All messages or Only when I am named (design item 21)".

### Task E9: The new "Waits for your reply" rules

**Files:** Modify `src/api/handlers/chats.ts` (`waitingChat` line 504, `waitingThread` line 535), `server/data/loaders/chat.ts`
(`chatsWaiting` line 175, `threadsWaitingOf` line 198), `server/mcp/docs.ts` (`TOOL_DOCS['chats.waiting']`, line 99). Test: Modify
`src/api/handlers/chatsWaiting.test.ts`, `server/mcp/messageTools.test.ts`.

**Interfaces.** Consumes (base): `namesPerson`, `Message.reactions`, `Comment.replyToId`, `LIVE` (`server/data/loaders/steps.ts`),
`messagesOf` with live messages only (B3). Produces:
- `function answeredByReaction(state: State, reactions: Partial<Record<Reaction, string[]>> | undefined, viewerId: string): boolean`
  in `chats.ts`: true when a person on the 👍 or ✅ list has `principalOf(state, id) === viewerId`. 👀 is no answer.
- Rules (design item 22): a direct chat waits on its newest message when another person wrote it. A group or a project chat waits on the
  newest message of another person that names the viewer (`mentions` holds the viewer; a reply author is in `mentions`, B6) when it is
  newer than the viewer's newest message. A task thread keeps its rule, with `namesPerson(state, c, viewer.id)` in place of
  `mentionedUserIds(c.body).includes(viewer.id)`. In every kind, the row goes when `answeredByReaction` is true for the message that
  waits.
- Loader: the selects of the newest own message and the newest naming message (with `LIVE`) cover the project chats and the groups
  (rename `projectIds` to `namedIds`). `threadsWaitingOf` also loads by key the `replyToId` of each comment it loaded for the named
  threads (`L.byKey('comments', ids)`), so `namesPerson` sees the old comment.
- `TOOL_DOCS['chats.waiting'].description`: "Lists the chats and task threads that wait for the reply of your person, oldest first. A
  direct chat waits when its newest message came from someone else. A group or a project chat waits when a newer message names your
  person: an @mention or a reply to a message of your person. A task thread waits when its newest comment came from someone else, and
  your person leads the task or a newer comment names your person. A 👍 or ✅ of your person on the message that waits counts as a
  reply. Each row has the id, the sender (from), the first 280 characters in plain text (body) and the days it waited. A row of kind task
  has a task id: answer it with comments.create (targetType task). Archived chats are left out. Read only." (under 600 characters).

- [ ] **Step 1: Write the failing test.** In `src/api/handlers/chatsWaiting.test.ts`, rewrite "lists a group for each member except
  the one who wrote last" as:
  ```ts
  it('lists a group only when a newer message names the person (item 22, INT-26 changed)', async () => {
    t.as('usr_002');
    const { id } = await t.api.call('chats.createGroup', { name: 'Tower team', memberIds: ['usr_003', 'usr_001'] });
    await t.api.call('chats.send', { conversationId: id, body: 'Drawings are ready.' });
    t.as('usr_003');
    expect((await t.api.call('chats.waiting', {})).map((row) => row.id)).not.toContain(id);
    laterBy(1);
    t.as('usr_002');
    await t.api.call('chats.send', { conversationId: id, body: `${mentionMarkup('Sara Team', 'usr_003')} please check.` });
    t.as('usr_003');
    expect(await t.api.call('chats.waiting', {})).toEqual([expect.objectContaining({ kind: 'group', id, from: expect.objectContaining({ id: 'usr_002' }) })]);
    t.as('usr_001');
    expect((await t.api.call('chats.waiting', {})).map((row) => row.id)).not.toContain(id);
  });
  ```
  Add (plant the rows in `t.store.state`, as the file does with tasks, so no call of track msg is needed):
  ```ts
  it('lists a project chat or a group when a newer message replies to the person', ...);   // a message with replyToId and mentions ['usr_003']
  it('clears the message that waits when the person puts 👍 or ✅ on it, and keeps it for 👀', ...); // a direct message of Faisal with reactions { '👍': ['usr_003'] }: []; with { '👀': ['usr_003'] }: listed
  it('counts a reaction of the agent of the person as an answer', ...);                     // reactions { '✅': ['usr_005'] }
  it('never waits on a deleted message: a direct chat waits on the newest live message', ...); // m1 by Faisal live, m2 by Faisal deleted: body of m1
  it('lists a task thread for a person named by a reply to their comment', ...);            // Faisal's comment replyToId = Omar's comment; Omar is not the lead
  it('clears a task thread when the person reacts 👍 to the comment that waits', ...);      // reactions on the comment
  ```
  In `server/mcp/messageTools.test.ts`: `it('says the wait rules of item 22 in chats.waiting')`: the description contains `'A group or
  a project chat waits when a newer message names your person'` and `'👍 or ✅'`, and stays at 600 characters or fewer. Update the
  group case of the agent's `chats.waiting` tool in this file to the new rule.
- [ ] **Step 2: Run it:** `npx vitest run src/api/handlers/chatsWaiting.test.ts server/mcp/messageTools.test.ts --no-file-parallelism --testTimeout=60000`.
  Expected: FAIL, the group waits with no name.
- [ ] **Step 3: Implement** the rules, `answeredByReaction`, the loader changes and the docs.
- [ ] **Step 4: Run it** again with `src/features/inbox/InboxScreen.test.tsx server/data/loaders/loaders.test.ts`, and
  `MADAR_LITE=1 npx vitest run --project lite src/api/handlers/chatsWaiting.test.ts --no-file-parallelism --testTimeout=60000`.
  Expected: PASS. (merge lead runs) `test:db`, `test:office` (the pins of `chats.waiting`; a move gets its reason "item 22: the groups
  read their newest naming and own messages"), `server/it/readIndexes.it.test.ts`.
- [ ] **Step 5: Commit:** `git add src/api/handlers/chats.ts server/data/loaders/chat.ts server/mcp/docs.ts src/api/handlers/chatsWaiting.test.ts server/mcp/messageTools.test.ts`;
  message: "Chats: a group waits only when it names you, and a 👍 or ✅ answers a message that waits (design item 22)".

### Task E10: The Admin's count, the Track R rules and What's new

**Files:** Modify `src/api/chatState.ts` (`unreadIn` line 102), `server/data/loaders/chat.ts` (`chatsOf` line 52),
`server/mcp/docs.ts` (`TOOL_DOCS['chats.list']`, line 91), `src/features/inbox/ConversationPane.tsx` (the read effect of `ChatPane`,
near line 109), `docs/superpowers/real-build/exit-handoff.md` (new section 10 after section 9), `src/whatsNew/entries.ts`,
`src/i18n/real/whatsnew.en.json`, `src/i18n/real/whatsnew.ar.json`; the count pins of existing tests (below). Test: Modify
`src/api/chatState.test.ts`; Create `src/api/handlers/chatsAdminCount.test.ts`, `src/features/inbox/AdminChatRead.test.tsx`.

**Interfaces.** Consumes: E2 (`levelFromRead`), E7, base `ChatThread.readUpTo`, `projectRoleOf`. Produces:
- `export function countsNamedOnly(role: ProjectRole, conversation: Conversation, level: NotifyLevel): boolean` in `chatState.ts`:
  `conversation.kind === 'project' && role === 'other' && level !== 'all'`. Only an Admin opens a project chat with role `'other'`
  (`can`, `'chat.project'`), so this is the Admin's "other project chat" (design item 23: the leader or a team member; a task lead
  outside the team does not count).
- `unreadIn` (scan branch): for a chat where `countsNamedOnly(projectRoleOf(state, c.projectId, userId), c, notifyLevelOf(state, c,
  userId))` holds, it counts only the messages whose `mentions` hold the person. The count of `state.counts` still comes first.
- Loader `chatsOf`: after the read marks load, split the ids by the same rule (`projectRoleOf(officeState(L), ...)`, `levelFromRead(L.get<ChatRead>('chatReads', key), c.kind)`);
  run today's `countWhere` for the other ids and a second `countWhere` with the extra condition `{ has: 'mentions', value: userId }` for
  the named-only ids. Skip a `countWhere` with no ids.
- `ChatPane` read effect: mark read also when the newest message is newer than `data.readUpTo`:
  `const behind = (data?.messages.at(-1)?.message.createdAt ?? '') > (data?.readUpTo ?? '')`, and the condition `unread > 0 || behind`
  with `behind` in the deps. After track read (A6) the merged condition is `visible && (unread > 0 || behind)`. Reason: an Admin's other
  project chat counts 0 while plain messages are new, and the open must still move the read mark, so the New line of a later named
  message sits right (track read A4 places it by `readUpTo`) and A6's test on the tower chat still marks once.
- `TOOL_DOCS['chats.list'].description` adds: "For an Admin, the project chat of a project that the Admin does not lead and is not on
  the team of counts only the unread messages that name the Admin, unless your person picked All messages for it in Madar."
- What's new (ids `2026-10-23-50` and `2026-10-23-51`; the merge lead renumbers on a clash; tracks read, msg and find took 22, 23, 30 and 40):
  `{ id: '2026-10-23-51', day: '2026-10-23', right: 'admin.manage', to: '/inbox' }` and `{ id: '2026-10-23-50', day: '2026-10-23', to: '/inbox' }`
  at the top of `WHATS_NEW`.
  - `2026-10-23-50`: EN title "Fewer pushes", body "A project chat now sends you a push only when a message names you. In the menu of
    each chat, Notify me sets All messages or Only when I am named. Madar sends no push for a chat that you already read. A 👍 or ✅ on a
    message answers it." AR title «تنبيهات أقل», body «صارت محادثة المشروع ترسل لك تنبيهًا فقط عندما تذكرك رسالة. من قائمة كل محادثة
    تختار «نبّهني»: كل الرسائل، أو فقط عندما يذكرني أحد. لا يرسل مدار تنبيهًا عن محادثة قرأتها. ويكفي 👍 أو ✅ على الرسالة لتردّ
    عليها.»
  - `2026-10-23-51`: EN title "Project chats for the Admin", body "As the Admin, you see the unread count and get pushes of the project
    chats of your own projects. In other project chats, you see only the messages that name you. Pick All messages in the menu of a chat
    to see all of it." AR title «محادثات المشاريع لمدير النظام», body «بصفتك مدير النظام، ترى عدد غير المقروءة وتصلك التنبيهات في
    محادثات مشاريعك. في محادثات المشاريع الأخرى ترى فقط الرسائل التي تذكرك. اختر «كل الرسائل» من قائمة المحادثة لتصلك كلها.»
- `exit-handoff.md` section "## 10. Chat counts and pushes for Track R (chat campfire, 2026-10-19)", bullets: (1) the stored unread
  number counts every unread live message of a chat for each person who may open it, whatever `ChatRead.notify`; (2) the one exception:
  an Admin's project chat of a project that the Admin does not lead and is not on the team of counts only the unread messages whose
  `mentions` hold the Admin (a reply author is in `mentions`), unless the Admin stored `notify: 'all'`; (3) a deleted message, a
  reaction, an edit and a quiet line never count; (4) a task thread counts as today (`taskUnread`); (5) the push reads `ChatRead.notify`
  (`server/push/chatRule.ts`), so the stored row keeps it; (6) the office object runs `push.chat` and `mail.chatNotice` right after the
  answer with no 10-second wait: at the restart, `runEffects` waits `CHAT_WAIT_MS` for `WAITED_KINDS`; (7) the SQLite push producer
  reads the items by key and the levels for each chat (`PUSH_LEVELS_LITE`).

- [ ] **Step 1: Write the failing test.** `src/api/chatState.test.ts`: `it('counts only named messages for an Admin outside the
  project who did not pick All messages')`: `countsNamedOnly('other', project, 'named')` true; `('team', project, 'named')`,
  `('leader', project, 'named')`, `('other', project, 'all')` and `('other', group, 'named')` false.
  `src/api/handlers/chatsAdminCount.test.ts` (the world of `chatsArchive.test.ts`; Hala usr_001 is the Admin and is not on prj_001):
  ```ts
  it('counts for an Admin outside the project only the unread messages that name the Admin (item 23)', async () => {
    t.as('usr_002');
    await t.api.call('chats.send', { conversationId: t.room, body: 'Plain one.' });
    await t.api.call('chats.send', { conversationId: t.room, body: 'Plain two.' });
    await t.api.call('chats.send', { conversationId: t.room, body: `${mentionMarkup('Hala Admin', 'usr_001')} please approve.` });
    t.as('usr_001');
    expect((await t.api.call('chats.list', {})).find((row) => row.id === t.room)?.unread).toBe(1);
    expect((await t.api.call('chats.unreadCount', {})).unread).toBe(1);
  });
  it('counts every unread message when the Admin is on the team or leads the project', ...);   // add a member row of usr_001: 3
  it('gives the count back when the Admin picks All messages', ...);                            // chats.setNotify all: 3
  it('counts every unread message for a team member, whatever their choice', ...);              // usr_003 with notify 'named': 3
  it('treats an Admin who leads a task of the project but is not on the team as outside', ...); // a task with ownerId usr_001: 1
  it('clears the count when the Admin reads the chat', ...);                                    // chats.markRead: 0
  ```
  `src/features/inbox/AdminChatRead.test.tsx` (the helpers `rowLink` and `settle` as in `InboxScreen.test.tsx`):
  ```ts
  it('marks a project chat outside the Admin projects read when it opens, though its row counts nothing', async () => {
    const { store } = await renderApp('/inbox');
    const newest = Object.values(store.state.messages).filter((m) => m.conversationId === 'cnv_001').map((m) => m.createdAt).sort().at(-1)!;
    const row = await rowLink(/Corniche Office Tower/);
    expect(within(row).queryByText(/^Unread:/)).toBeNull();
    await userEvent.click(row);
    await screen.findByRole('log', { name: 'Messages' });
    await waitFor(() => expect(store.state.chatReads[chatReadKey('cnv_001', 'usr_001')].lastReadAt >= newest).toBe(true));
  });
  it('does the same in the Arabic screen, right to left', ...); // language 'ar'; document.documentElement.dir 'rtl'
  ```
  `server/mcp/messageTools.test.ts`: `it('says what unread means for an Admin in chats.list')`: the description contains
  `'counts only the unread messages that name the Admin'` and stays at 600 characters or fewer.
- [ ] **Step 2: Run it:** `npx vitest run src/api/chatState.test.ts src/api/handlers/chatsAdminCount.test.ts src/features/inbox/AdminChatRead.test.tsx server/mcp/messageTools.test.ts --no-file-parallelism --testTimeout=60000`.
  Expected: FAIL, the row counts 3 and the open sends no mark.
- [ ] **Step 3: Implement** the rule, the loader split, the `ChatPane` condition, the docs, the handoff section and What's new. Then run
  the tests that pin the Admin's sample counts and fix each one by its intent (the sample Admin, Hala, is not on prj_001, so the tower
  chat counts 0 for her now; the badge "Unread messages: 5" becomes 3):
  - a test that checks a count that clears or drops (`InboxScreen.test.tsx` "shows the unread count of a chat and clears it when the chat
    opens", "counts a new chat message and clears the count once the chat is read", "drops the unread number of the Inbox badge when a
    chat with unread messages is archived"): add Hala to the prj_001 team in its prepare step
    (`state.members[memberKey('prj_001', 'usr_001')] = { projectId: 'prj_001', userId: 'usr_001', discipline: 'Architect' }`) and keep
    its numbers;
  - a test that only reads the badge (`src/app/AppShell.test.tsx` line 185, `InboxScreen.test.tsx` "counts unread chat messages on the
    Inbox tab"): change the pinned number to the real one, with the comment "Item 23: the Admin's count of a project chat outside her
    projects holds only the messages that name her."
  - every other failing count test: the same choice, by its name.
- [ ] **Step 4: Run it** again with `src/features/inbox src/app/AppShell.test.tsx src/api/handlers src/whatsNew src/i18n
  server/data/loaders/loaders.test.ts`, and `MADAR_LITE=1 npx vitest run --project lite src/api/handlers/chatsAdminCount.test.ts --no-file-parallelism --testTimeout=60000`.
  Expected: PASS. (merge lead runs) `test:db`, `test:office` (the pins of `chats.unreadCount` and `chats.list` for usr_001; a move gets
  the reason "item 23: a second grouped count for the Admin's other project chats"), the prototype smoke and the deploy suite (their
  Admin counts), screenshots of the Inbox as the Admin.
- [ ] **Step 5: Commit:** `git add src/api/chatState.ts src/api/chatState.test.ts server/data/loaders/chat.ts server/mcp/docs.ts server/mcp/messageTools.test.ts src/features/inbox/ConversationPane.tsx src/api/handlers/chatsAdminCount.test.ts src/features/inbox/AdminChatRead.test.tsx docs/superpowers/real-build/exit-handoff.md src/whatsNew/entries.ts src/i18n/real/whatsnew.en.json src/i18n/real/whatsnew.ar.json`
  plus each count test it changed; message: "Chats: the Admin counts and gets pushes only for own projects or when named, and What's
  new (design item 23)".
