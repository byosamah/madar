# Chat: who is here, Seen, typing and emoji: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the five parts of the approved chat design (owner, 2026-10-21): a status for each person (Online, Away, Offline, and Away by hand), "typing...", "Seen" and "Seen by N", an emoji list in the two message boxes, and reactions with any emoji.

**Architecture:** One base wave fixes the contract, the server and the screen interfaces (reactions with any emoji, the seen time, the Away field, the `chats.typing` server call, the live port and its hooks), and a proof task checks the Realtime facts on `madar-test` beside it. Then three tracks run in parallel: live (the three adapters of the live port: prototype, Supabase, office socket), faces (the dots, the head words, the Away switch, Seen, the typing line, What's new), and emoji (the data, the panel, the two boxes, the + of the reactions). The merge lead joins, runs the gate once and deploys to the test copy.

**Tech Stack:** React 19 + Vite 8 + Tailwind v4 screens; zod 4 contract in `src/api`; Hono server on Supabase Edge Functions (Postgres, Realtime Broadcast and Presence) and the paused SQLite office object; supabase-js 2.117.2; Vitest 5 (jsdom, server, db, lite, office, it); Playwright for the deploy suite.

**Spec:** `docs/superpowers/specs/2026-10-21-madar-chat-presence-design.md`. The look: `docs/superpowers/specs/2026-10-21-madar-chat-presence-mockup.html`, dot look A (the design wins where they differ).

## Global Constraints

- Free plans only. No new vendor, no paid plan, no font or image of emoji. New packages are dev tools of the data script only (task E1), at a version published at least two weeks ago.
- Every write goes through `runCall`; handlers stay synchronous and pure; every shared call works in the prototype fake and on the server; contract changes are additive (old stored three-key reaction records still load).
- The one new call (`chats.typing`) follows the whole new-call checklist of `src/api/CLAUDE.md` (copied in B5). Pinned counts are set by running the tests and reading the real number, never by adding deltas.
- MCP in the same commit as each change: `server/mcp/tools.ts`, `TOOL_DOCS` (`server/mcp/docs.ts`, 40 to 600 characters each). `chats.typing` goes on `MCP_DENY`; `chats.markRead` and `reactions.toggle` stay there.
- Status and typing never touch the Madar tables. The seen time (`ChatRead.seenAt`) and the Away switch (`Preferences.awayByHand`) are optional fields of the stored record (no column, no `STATE_VERSION` step).
- Status rules: Online = a device in view with input in the last 600,000 ms (10 minutes); Away = a device open and none Online, or `awayByHand` on a device that is open; Offline = no device. Typing: at most one signal every 3,000 ms for one chat, shown for 6,000 ms after the last signal.
- Every visible word: English (STE, no em-dash, no -ing form in a label except the fixed "typing..." words of the design) and Arabic (Thmanyah style), only in the track's own files `src/i18n/real/{presence,emoji}.{en,ar}.json`. Arabic gender forms use `actorContext` and a `_female` key; Arabic counts use `_one/_two/_few/_many/_other`.
- What's new: id `2026-10-23-80`, day `2026-10-23`, `to: '/inbox'`.
- Schema: one migration `supabase/migrations/20261022000100_chat_reads_conversation.sql` (an index) with `LITE_SCHEMA_VERSION = 10`; one platform migration `supabase/migrations/20261022000200_platform_presence.sql` (Realtime policies).
- Keep `test:lite` and `test:office` green. Rows pins move only with a reason in `docs/superpowers/real-build/proof.md`.
- Leak tests from each builder: an outsider on `chats.messages`, `chats.typing`, MCP, the error texts (`not_found`, the same text as an id that was never made) and the signals.
- Screens: tokens only, logical sides only, names in `<bdi>`, 44 px press areas, nothing under 12 px, no face stack, no blink, navy only on the main button, red only for Late and errors. Each screen task has jsdom tests in English and in Arabic (`dir="rtl"`).
- Commits: Simplified Technical English, no em-dash, no `Co-Authored-By` line, no `Claude-Session` line.
- No production change before Friday 2026-10-23, and only the owner deploys production.

## Review Focus

The five inputs a person will meet that the design does not name, most likely first. Each has its test in the owning task.

1. A phone locks, or loses the network: the device shows Away at once when the page hides, and Offline when its connection ends; it never stays Online. (L2: "tracks away at once when the page hides"; L3: "a closed socket makes its person offline for the office".)
2. One person on two devices (a phone in a pocket, a computer in use): Online; the computer closes, the person shows Away; both close, Offline. (B6: `combineStates` table; L1, L2, L3: "two devices of one person".)
3. A "stop" never arrives (a tab crashes, the network drops while a person types): the typing line goes away 6 s after the last signal. (B6: "drops a typist 6 s after the last signal"; F4: "hides the line after 6 s with no signal".)
4. A person leaves a group or a project team: they get no more typing signals, and their old seen time no longer counts in "Seen by". (B2: "counts only the members of today"; B5: "sends nothing to a person who left the chat".)
5. A reaction that is not one emoji (text, two emoji, HTML, a chain over 32 code units) from a screen or an API client: refused with `invalid_input`, nothing stored. (B1: the `isReactionEmoji` table and "refuses a reaction that is not one emoji".)

## Build order

| Wave | Who | Tasks | Where |
| --- | --- | --- | --- |
| 1 | one Sonnet builder (base) | B1 to B6 | `~/dev/madar-rb/chat-presence`, branch `rb/chat-presence` |
| 1 | one Sonnet builder (proof), beside base | P1 | `~/dev/madar-rb/chat-presence-proof`, branch `rb/chat-presence-proof` from `rb/chat-presence` |
| join 1 | Opus merge lead | merge proof into `rb/chat-presence`; typecheck; read the proof numbers against the Cost steps of the design | `~/dev/madar-rb/chat-presence` |
| 2 | three Sonnet builders in parallel | live L1 to L4; faces F1 to F5; emoji E1 to E4 | `~/dev/madar-rb/chat-presence-<track>`, branch `rb/chat-presence-<track>`, each from `rb/chat-presence` after join 1 |
| join 2 | Opus merge lead | merge live, faces, emoji into `rb/chat-presence`, in that order; typecheck and the touched tests after each | `~/dev/madar-rb/chat-presence` |
| gate | Opus merge lead | J1 | `~/dev/madar-rb/chat-presence` |

Each builder works in its own worktree with `node_modules` linked to `/Users/osamakhalil/dev/madar/.claude/worktrees/deploy-test/node_modules`, runs only the type check and the tests of the files it touches (`npx vitest run <files> --no-file-parallelism --testTimeout=60000`), and writes its report to `REPORT-<track>.md` in its worktree (untracked) before it returns. Tests marked "(merge lead runs)" need Docker. The full suites run once, at the gate.

## Agreements between the tracks

- `src/features/inbox/Composer.tsx`: B6 adds the prop `onTextChange?: (text: string) => void` and one inner function `change(next: string)` that sets the text and calls `onTextChange`. F4 passes `onTextChange` from `ChatPane`; E3 puts an emoji in with `change`. Neither track adds another setter.
- `src/features/inbox/ConversationPane.tsx`: only track faces edits it.
- `src/components/Avatar.tsx`: only track faces edits it (F1).
- `src/features/inbox/MessageMenu.tsx`, `ReactionPills.tsx`, `src/features/comments/CommentItem.tsx`, `src/features/comments/CommentThread.tsx`: only track emoji edits them.
- `src/app/remote/bootstrap.ts`, `src/app/bootstrap.ts`, `src/app/remote/channel.ts`, `src/api/remote/liveSocket.ts`, `server/office/*`: only track live edits them.
- `server/mcp/docs.ts` and `server/mcp/tools.ts`: only the base builder edits them.
- The live port (`src/app/live/types.ts`, B6) is fixed after wave 1. A track that needs a change writes it in its report, and the merge lead makes it.

---

## Wave 1: the base

### Task B1: Reactions take any one emoji

**Files:** Create `src/api/contract/emoji.ts`, `src/api/contract/emoji.test.ts`, `src/api/handlers/anyReaction.test.ts`. Modify `src/api/contract/limits.ts` (line 8), `src/api/contract/entities.ts` (`Reaction` line 84, `Comment.reactions` line 656, `Message.reactions` line 729), `src/api/handlers/content.ts` (`reactions.toggle` lines 182 to 201), `src/api/handlers/chats.ts` (`toggleMessageReaction` lines 771 to 779), `src/features/inbox/MessageBubble.tsx` (line 41, the type only), `src/features/inbox/bubbleActions.ts` (line 18, the type only), `src/features/inbox/ReactionPills.tsx` (the type and the order only), `server/mcp/docs.ts` (`chats.messages` line 105, `comments.list` line 314).

**Interfaces.** Produces:
- `emoji.ts`: `export const MAX_REACTION_KINDS = 20;` `export function isReactionEmoji(value: string): boolean`: true when the value is 1 to 32 UTF-16 units, is exactly one grapheme (`Intl.Segmenter`, granularity `grapheme`), and that grapheme is an emoji (`\p{Extended_Pictographic}` with the `u` flag, or two regional indicators, or a keycap `[#*0-9]️?⃣`). Do not use the `v` flag (older Safari). `export function orderReactions(keys: readonly string[]): string[]`: the members of `REACTIONS` first in their order, then the rest by code points (`[...a].map(c => c.codePointAt(0))` compared item by item).
- `entities.ts`: `export const Reaction = z.string().refine(isReactionEmoji, { message: 'A reaction is one emoji.' });` and `export type Reaction = string`. `Comment.reactions` and `Message.reactions` use `z.record(Reaction, z.array(UserId))` (a string key is not exhaustive, so the three-key records and any new key load). `emptyReactions()` stays.
- `REACTIONS` keeps the three quick ones (the menu reads it). `answeredByReaction` does not change (only 👍 and ✅).
- `reactions.toggle`: a comment reads `comment.reactions[emoji] ?? []`. A toggle that adds a new key when the record already has `MAX_REACTION_KINDS` keys with one person or more throws `ApiError('invalid_input', 'This message has the most reactions.')`. Keys with no people are dropped on write.
- `Bubble.reactions?: Record<string, string[]>`, `BubbleActions.react(bubble: Bubble, emoji: string): void`, `ReactionPills` shows `orderReactions` of the keys with people.
- `TOOL_DOCS`: `chats.messages` and `comments.list` say "reactions (any emoji: user ids)".

- [ ] **Step 1: Write the failing tests.** `emoji.test.ts`:
  ```ts
  it.each(['👍', '👍🏽', '👨‍👩‍👧', '🇸🇦', '1️⃣', '❤️', '🫨'])('takes %s', (e) => expect(isReactionEmoji(e)).toBe(true));
  it.each(['', 'a', 'ok', '👍👍', '👍 ', '<b>', '٣', '👍'.repeat(17)])('refuses %j', (e) => expect(isReactionEmoji(e)).toBe(false));
  it('puts the three quick ones first, then code point order', () => {
    expect(orderReactions(['🙏', '👀', '🎉', '👍'])).toEqual(['👍', '👀', '🎉', '🙏']);
  });
  ```
  `anyReaction.test.ts` (`testApi`, `makeWorld`, `addProjectConversation`): "puts 🎉 on a chat message and on a comment"; "refuses a reaction that is not one emoji" (`'ok'`, `'👍👍'`: code `invalid_input`, the record does not change); "refuses a 21st kind and takes a toggle of a kind that is there"; "loads a stored three-key record and a record with 🎉"; "does not count 🎉 as an answer for Waits for your reply" (`chats.waiting` keeps the message).
- [ ] **Step 2: Run them:** `npx vitest run src/api/contract/emoji.test.ts src/api/handlers/anyReaction.test.ts src/api/handlers/messageReactions.test.ts --no-file-parallelism --testTimeout=60000`. Expected: FAIL (`emoji.ts` does not exist).
- [ ] **Step 3: Implement** the interfaces above.
- [ ] **Step 4: Run them again**, with `src/api/handlers/content.test.ts src/features/inbox/MessageMenu.test.tsx server/mcp/tools.test.ts` and `npm run typecheck`. Expected: PASS. (merge lead runs) `test:db`, `test:lite`.
- [ ] **Step 5: Commit:** "Reactions: any one emoji, at most 20 kinds on one message, the three quick ones first (B1)".

### Task B2: The seen time and the seen information of a chat

**Files:** Create `src/api/handlers/chatsSeen.test.ts`, `supabase/migrations/20261022000100_chat_reads_conversation.sql`. Modify `src/api/contract/entities.ts` (`ChatRead` line 746), `src/api/contract/views.ts` (`ChatThread` lines 280 to 293), `src/api/chatState.ts`, `src/api/handlers/chats.ts` (`chats.markRead` lines 390 to 400, `chats.messages` lines 271 to 306), `server/data/loaders/chat.ts` (`chatsMessages` lines 201 to 229), `server/data/lite/schema.ts` (line 32 and `LITE_STEPS`, the index list line 59), `server/data/lite/schema.test.ts` (lines 11 and 233), `server/data/loaders/loaders.test.ts`, `server/mcp/docs.ts` (`chats.messages`).

**Interfaces.** Consumes: nothing new. Produces:
- `ChatRead.seenAt: Stamp.optional()` with the comment "The last time the person looked at the chat while it was open, in view and in use (chat design C4). Only `chats.markRead` with `seen: true` moves it, and only forward."
- `chatState.ts`: `export function chatMemberIds(state: Pick<State, 'users' | 'projects' | 'members'>, conversation: Conversation): string[]`: the active humans of today. A direct chat or a group: `memberIds` that are active. A project chat: the leader and the team (`projectRoleOf(state, projectId, id) !== 'other'`), active humans only. An Admin who is not on the team is not a member.
- `chats.markRead` input: `z.object({ conversationId: z.union([ConversationId, TaskId]), seen: z.boolean().optional() })`. With `seen: true`, a conversation id, and the authority in `chatMemberIds`: `seenAt = max(old seenAt, ctx.stamp)`. A task id or a non-member: the read mark only, as today.
- `ChatThread` adds `seenUpTo: Stamp.nullable().default(null)` (the reader's own `seenAt`), `seen: z.array(z.object({ userId: UserId, at: Stamp })).default([])` (each other member of today with a `seenAt`, newest first), `others: z.number().int().min(0).default(0)` (the count of the other members of today).
- The loader of `chats.messages` loads every `chat_reads` row of the conversation (`where conversation_id = $1`). The migration: `create index if not exists chat_reads_conversation on chat_reads (conversation_id);` with its SQLite step in `LITE_STEPS[10]` and `LITE_SCHEMA_VERSION = 10`; update `PINNED_SHA256` and the version pin.
- `TOOL_DOCS` of `chats.messages` adds: "seen: the members who looked at the chat and the last time (userId, at); seenUpTo: the time of your person; others: the count of the other members." Keep it at most 600 characters (shorten older words if needed, keep their meaning).

- [ ] **Step 1: Write the failing tests** in `chatsSeen.test.ts`: "moves the seen time with seen: true, only forward"; "keeps the seen time without the flag, and on an archive"; "gives the seen times of the other members only, with the count of the others" (a direct chat: `others` 1; the project chat of `prj_001` as `usr_002`: the team without the reader); "counts only the members of today" (take `usr_003` off the team: no entry for `usr_003` in `seen`, `others` one less); "gives no seen entry for an Admin outside the team, and the Admin's look moves no seen time"; "answers not_found to an outsider, with no seen data" (`usr_004` on a group and a direct chat: the same error as an id that was never made); "changes only the read mark of a task thread with seen: true". `loaders.test.ts`: `same(...)` for `chats.messages` with read marks of two members.
- [ ] **Step 2: Run them:** `npx vitest run src/api/handlers/chatsSeen.test.ts src/api/handlers/chats.test.ts server/data/loaders/loaders.test.ts server/data/lite/schema.test.ts --no-file-parallelism --testTimeout=60000`. Expected: FAIL.
- [ ] **Step 3: Implement** the interfaces above.
- [ ] **Step 4: Run them again** with `server/mcp/tools.test.ts` and `npm run typecheck`. Expected: PASS. (merge lead runs) `test:db`, `test:lite`, `test:office` (raise a rows pin only with a line in `proof.md`).
- [ ] **Step 5: Commit:** "Chats: the seen time of each member, moved only by a look in use, and the seen information of a chat (B2)".

### Task B3: A look signals the authors whose message it made seen

**Files:** Create `server/core/chatsSeenSignal.test.ts`. Modify `server/data/save.ts` (the `chatReads` case, lines 242 to 253), `server/data/loaders/index.ts` (line 165) and `server/data/loaders/chat.ts`.

**Interfaces.** Consumes: B2. Produces: in the `chatReads` case, when the new record has a `seenAt` later than the old one (no old record = `''`), the save also adds to `people` the principal of the author of each message in the saved state with the same `conversationId` and `old seenAt < createdAt <= new seenAt`, when that principal is not the owner of the record. The kind stays `chatReads` (personal: no office signal). The loader of `chats.markRead` loads those messages: the read mark of the person first, then at most the newest 200 messages of the conversation after its `seenAt`.

- [ ] **Step 1: Write the failing tests** in `chatsSeenSignal.test.ts` (the pattern of `server/core/chatsMarkUnreadSignal.test.ts`: `buildSeed`, `memoryData`, `fakeDeps`, `createRunCall`): "a look that makes Faisal's message seen signals person:usr_002 and the reader"; "a look with no new message of another person signals only the reader"; "a read without the flag signals only the reader"; "sends no office signal"; "names no author of another chat".
- [ ] **Step 2: Run it:** `npx vitest run server/core/chatsSeenSignal.test.ts server/data/save.test.ts --no-file-parallelism --testTimeout=60000`. Expected: FAIL.
- [ ] **Step 3: Implement** the save rule and the loader.
- [ ] **Step 4: Run them again** with `server/data/loaders/loaders.test.ts`. Expected: PASS. (merge lead runs) `test:db`, `test:it`.
- [ ] **Step 5: Commit:** "Data: a look signals the authors whose message it made seen, and nobody else (B3)".

### Task B4: The Away switch in the preferences

**Files:** Create `src/api/handlers/awayByHand.test.ts`. Modify `src/api/contract/entities.ts` (`Preferences` lines 109 to 123), `src/api/handlers/people.ts` (`me.updatePreferences` lines 343 to 367), and `server/mcp/docs.ts` only if `me.updatePreferences` is not on `MCP_DENY`.

**Interfaces.** Produces: `Preferences.awayByHand: z.boolean().optional()` (missing = off) with a comment that cites design A2. `me.updatePreferences` input adds `awayByHand: z.boolean().optional()`; an agent that sends it gets `forbidden('Only the person sets Away.', { action: 'me.away' })`; the field joins `next` as `adminReach` does.

- [ ] **Step 1: Write the failing tests:** "sets Away by hand and turns it off"; "refuses Away by hand from an agent"; "keeps the other preferences".
- [ ] **Step 2: Run it:** `npx vitest run src/api/handlers/awayByHand.test.ts --no-file-parallelism --testTimeout=60000`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it again** with `src/api/handlers/people.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit:** "People: Away by hand, a personal preference that only the person sets (B4)".

### Task B5: The `chats.typing` server call

**Files:** Create `server/calls/typing.ts`, `server/calls/typing.test.ts`, `server/signal/typing.ts`, `server/signal/typing.test.ts`, `src/api/chatState.test.ts` (or add to the chat state tests that exist). Modify `src/api/contract/server.ts` (`SERVER_CALL_NAMES`, `serverContracts`), `src/api/handlers/serverFakes.ts`, `src/api/chatState.ts`, `src/api/remote/wire.ts`, `src/api/remote/keys.ts` (`READ_CALLS`), `src/app/readMap.ts` (next to line 97), `server/calls/index.ts`, `server/core/ports.ts` (`Deps`, line 143), `server/core/deps.ts` (line 227), `server/core/everyCall.ts`, `server/mcp/tools.ts` (`MCP_DENY`, next to line 119), and the pinned counts of checklist step 9.

**The new-call checklist (`src/api/CLAUDE.md`), to follow in full:** (1) the call with tests; (2) a server-only call: its contract in `contract/server.ts`, its fake in `handlers/serverFakes.ts`, its body in `server/calls/`; (3) a loader entry if the sweep asks for one; (4) `MCP_DENY` in `server/mcp/tools.ts`; (5) an input in `server/core/everyCall.ts` if the sweep does not name it; (6) its read kinds in `src/app/readMap.ts` (`rule('none', [])`); (7) no `WRITE_KINDS` line (a read); (8) words: none (no new message on a screen); (9) raise the pinned counts in `src/api/calls.test.ts`, `server/core/serverCallMap.test.ts`, `server/http/health.test.ts`, `server/it/worker.it.test.ts`, `server/mcp/app.test.ts`, `server/mcp/tools.test.ts`, `server/mcp/oauth/sdk.test.ts`, `server/mcp/CLAUDE.md` and the `docs.ts` header, by running them and reading the real numbers.

**Interfaces.** Consumes: B2 (`chatMemberIds`). Produces:
- `wire.ts`: `export const TYPING_EVENT = 'typing';` `export type TypingSignal = { v: 1; conversationId: string; userId: string; typing: boolean; at: string };`
- `chatState.ts`: `export function typingRecipients(state: Pick<State, 'users' | 'projects' | 'members' | 'conversations'>, conversationId: string, userId: string): string[] | null`: `null` when the conversation does not exist, or the user may not see it (`canSeeConversation`); `[]` when the user is not a member (`chatMemberIds`); else the members without the user.
- Contract: `'chats.typing': { input: z.object({ conversationId: ConversationId, typing: z.boolean() }), output: z.object({ sent: z.number().int().min(0) }), readOnly: true }`.
- `ports.ts`: `export interface TypingPort { send(people: string[], signal: TypingSignal): Promise<void> }` and `Deps.typing?: TypingPort`.
- `server/signal/typing.ts`: `export function realtimeTyping(o: { db: Db; log: Logger }): TypingPort`. One statement, `select realtime.send($1::jsonb, $2::text, t.topic, true) from unnest($3::text[]) as t(topic)`, with the topics `person:<id>` and the event `TYPING_EVENT`. It never throws: an error logs once with the count of people and resolves. It runs only when `people.length > 0`. `deps.ts` sets `typing: realtimeTyping({ db, log })` on the Supabase and Workers hosts; the office host gets its own in L3.
- `server/calls/typing.ts`: `export const chatsTyping: ServerCall<'chats.typing'>`: an agent gets `forbidden('An agent does not type.', { action: 'chats.typing' })`; `typingRecipients(ctx.office, ...)` `null` gives the same `not_found` error as `requireConversation` for a hidden chat; else `await ctx.deps.typing?.send(people, { v: 1, conversationId, userId: <the person>, typing, at: ctx.now.toISOString() })` and `{ output: { sent: people.length }, changed: false }`. No transaction, no lock.
- The fake: the same checks over the store state, `{ sent }`, no send (the prototype adapter of L1 posts the signal itself).

- [ ] **Step 1: Write the failing tests.** `typing.test.ts` (`fakeDeps` with a recording `typing` port): "sends a direct chat's typing to the other member only, with the payload fields"; "sends a project chat's typing to the team without the typist"; "sends nothing for an Admin outside the team, and answers sent 0"; "answers an outsider and an unknown id with the same not_found text as chats.messages"; "sends nothing to a person who left the chat" (a group member taken off); "refuses an agent"; "works with no typing port". `server/signal/typing.test.ts`: "sends one statement with the topics of the people"; "logs and resolves when the statement fails"; "sends nothing for no people". `chatState.test.ts`: `chatMemberIds` and `typingRecipients` for the three kinds.
- [ ] **Step 2: Run them:** `npx vitest run server/calls/typing.test.ts server/signal/typing.test.ts src/api/chatState.test.ts --no-file-parallelism --testTimeout=60000`. Expected: FAIL.
- [ ] **Step 3: Implement** the interfaces and the checklist.
- [ ] **Step 4: Run them again** with every count test of checklist step 9, `server/mcp/tools.test.ts`, `src/api/remote/keys.test.ts`, `server/core/everyCall.test.ts` (or the sweep test that reads `everyCall`), and `npm run typecheck`. Expected: PASS. (merge lead runs) `test:it` (`worker.it.test.ts`), `test:mcp`.
- [ ] **Step 5: Commit:** "Chats: the chats.typing server call, which sends a typing signal to the members only (B5)".

### Task B6: The live port, its hooks, and the typing board on the screens

**Files:** Create `src/app/live/types.ts`, `src/app/live/activity.ts`, `src/app/live/typing.ts`, `src/app/live/hooks.ts`, `src/app/live/LiveProvider.tsx`, and their tests `src/app/live/activity.test.ts`, `src/app/live/typing.test.ts`, `src/app/live/hooks.test.tsx`. Modify `src/app/runtime.tsx` (`Runtime` line 25, `RuntimeProvider` lines 158 to 173), `src/test/render.tsx` (`renderApp` options), `src/features/inbox/Composer.tsx` (the `change` agreement).

**Interfaces.** Consumes: B4 (`preferences.awayByHand`), B5 (`TypingSignal`, `TYPING_EVENT`, `chats.typing`). Produces:
- `types.ts`:
  ```ts
  export type PersonState = 'online' | 'away' | 'offline';
  export type DeviceState = 'online' | 'away';
  export type LivePort = {
    setMine(state: DeviceState): void;            // this device; the port sends it when it changes
    watch(userIds: readonly string[]): void;       // the active humans whose states the screens show
    stateOf(userId: string): PersonState;
    subscribeStates(listener: () => void): () => void;
    subscribeTyping(listener: (signal: TypingSignal) => void): () => void;
    afterTypingCall?(signal: TypingSignal): void;  // the prototype only: hands the signal to other tabs
    stop(): void;
  };
  export function combineStates(devices: readonly DeviceState[]): PersonState; // any online: online; any: away; none: offline
  ```
- `Runtime.live?: LivePort`. `RuntimeProvider` stops the port on unmount. `renderApp(path, prepare, { live })` passes a fake port; with no port every person is `offline` and no typing shows.
- `activity.ts`: `export const ACTIVE_MS = 600_000;` `export function deviceStateOf(o: { visible: boolean; lastInputAt: number; now: number; awayByHand: boolean }): DeviceState`; `export function useActive(): boolean` (visible and an input in the last `ACTIVE_MS`; the inputs: `keydown`, `pointerdown`, `wheel`, `touchstart`, and `scroll` in capture, on `window`, passive); `export function useDeviceState(awayByHand: boolean): DeviceState`. A hidden page is Away at once.
- `typing.ts`: `export const TYPING_SEND_MS = 3_000; export const TYPING_SHOW_MS = 6_000;` `export function createTypingBoard(now: () => number): { apply(signal: TypingSignal): void; typers(conversationId: string): string[]; subscribe(listener: () => void): () => void }` (`typers` in the order of the first signal, without expired ones; a `typing: false` signal takes the person off). `export function useTypers(conversationId: string): string[]` (without the person's own id). `export function useTypingRows(): ReadonlyMap<string, string[]>`. `export function useTypingSender(conversationId: string): { changed(text: string): void; stop(): void }`: a non-empty change sends `typing: true` at once and then at most once each `TYPING_SEND_MS` while changes come; an empty text, `stop()`, a hidden page and the unmount send one `typing: false` when a `true` went out. It calls `api.call('chats.typing', ...)`, ignores its errors, and then `live.afterTypingCall?.(signal)`.
- `hooks.ts`: `export function usePersonState(userId: string): PersonState` (`useSyncExternalStore` on `subscribeStates` with `stateOf(userId)`, so a change renders only the faces of that person); `export function useMyState(): PersonState`.
- `LiveProvider.tsx`: inside `RuntimeProvider` when `runtime.live` is set: `watch(<the active humans of users.list>)`, `setMine(useDeviceState(<own preferences.awayByHand>))`, and one typing board fed by `subscribeTyping`.
- `Composer.tsx`: the prop `onTextChange?: (text: string) => void` and the inner `change(next: string)` (agreements). The `MentionField` `onChange` calls `change`. A restored draft calls nothing.

- [ ] **Step 1: Write the failing tests.** `activity.test.ts`: the `deviceStateOf` table (visible and input 9 min ago: online; 11 min: away; hidden: away; Away by hand and active: away); "turns away 10 min after the last input, and online at the next key" (fake timers). `typing.test.ts`: "drops a typist 6 s after the last signal"; "keeps the order of the first signal"; "takes a typist off at a stop"; the sender with fake timers: "sends once for 5 changes in 2 s, and again after 3 s"; "sends one stop for an empty text, and none when nothing went out"; "sends a stop at the unmount". `hooks.test.tsx`: "renders only the face of the person whose state changed" (a render count); `combineStates` table: `[]` offline, `['away']` away, `['away', 'online']` online.
- [ ] **Step 2: Run them:** `npx vitest run src/app/live --no-file-parallelism --testTimeout=60000`. Expected: FAIL.
- [ ] **Step 3: Implement** the interfaces above.
- [ ] **Step 4: Run them again** with `src/features/inbox/ComposerKeys.test.tsx src/features/inbox/ConversationPane.test.tsx` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit:** "Screens: the live port, the device state, the typing board and its sender (B6)".

### Task P1: Prove the Realtime facts on madar-test (beside the base)

**Files:** Create `supabase/migrations/20261022000200_platform_presence.sql`, `scripts/proof/presence.ts`. Modify `docs/superpowers/real-build/proof.md` (a new section), `docs/superpowers/real-build/platform-facts.md` (section 4: the presence facts).

**Rules.** Sandbox off for the network. Load secrets with `set -a; . ~/dev/madar/.env.local; set +a` and `secrets/test-accounts.env`; never print, log or commit a value. Use `SUPABASE_ACCESS_TOKEN` and `--project-ref qdgwpnesxppnqsaabqzd` (madar-test) only; never touch production `oprkvdjudjxxhvodkzgs`. Leave no probe policy, user or row behind.

**The migration (all `to authenticated`, beside the policies of `20261004000200_platform_realtime.sql`):**
```sql
create policy madar_status_track on realtime.messages for insert to authenticated
  with check (realtime.messages.extension = 'presence'
    and (select realtime.topic()) = 'status:' || (select madar_private.current_madar_user_id())
    and (select auth.jwt() ->> 'client_id') is null);
create policy madar_status_read on realtime.messages for select to authenticated
  using (realtime.messages.extension = 'presence'
    and (select realtime.topic()) like 'status:%'
    and (select madar_private.current_madar_user_id()) is not null
    and (select auth.jwt() ->> 'client_id') is null);
```

- [ ] **Step 1:** Apply the migration to madar-test (`npx supabase db push --project-ref qdgwpnesxppnqsaabqzd` with the token, or the SQL editor API that `scripts/proof/cloud.ts` uses).
- [ ] **Step 2:** Write `scripts/proof/presence.ts` (the sign-in of `scripts/proof/server-time.ts` lines 144 to 152 with the test accounts) and run it. It answers, each with a pass or a fail line: (1) the member tracks on `status:<own id>` and the admin account reads it; (2) a track on `status:<another id>` fails; (3) a token with `client_id` (if the probe can make one; else write "not probed") cannot track; (4) `select realtime.send('{"v":1}'::jsonb, 'typing', 'person:<member id>', true)` as `madar_server` reaches the member on `person:<id>` with the event `typing`, and a listener of only the event `changed` does not get it; (5) the time from a socket that stops answering (the probe drops its socket with no close frame) to the leave event at another client, three runs; (6) the count of presence events that one track, one untrack and one join give to each of 3 listeners.
- [ ] **Step 3:** Read the Realtime messages and the Edge Function calls of the current month on both projects (the Management API usage endpoint if one gives them; else write "not found by API" and the client counts of step 2).
- [ ] **Step 4:** Write the proof section `## Chat presence: the Realtime probe (2026-10-2x)` with **Project**, **Scripts**, **Run**, **Method**, **Cleanup**, a results table, and the cost check of the design (the steps of "Cost and the free plan" that the numbers ask for, or "none").
- [ ] **Step 5: Commit:** "Proof: presence on a status topic for each person, the typing event on the person topic, and the drop time (P1)". Write the numbers in `REPORT-proof.md` too.

---

## Wave 2, track live (`rb/chat-presence-live`)

### Task L1: The prototype adapter

**Files:** Create `src/app/live/prototypeLive.ts`, `src/app/live/prototypeLive.test.ts`. Modify `src/app/bootstrap.ts` (the runtime gets `live`).

**Interfaces.** Consumes: B6. Produces: `export const SAMPLE_STATES: Readonly<Record<string, DeviceState>> = { usr_002: 'online', usr_003: 'online', usr_007: 'away' };` `export function prototypeLive(o: { me: () => string; channel?: { postMessage(m: unknown): void; addEventListener(t: 'message', f: (e: { data: unknown }) => void): void; close(): void } | null }): LivePort`. The default channel is `new BroadcastChannel('madar-live')` inside a try (`null` when it fails). Messages: `{ t: 'state', tab, userId, state }`, `{ t: 'leave', tab, userId }` (on `pagehide`), `{ t: 'hello', tab }` (each tab answers with its state), `{ t: 'typing', signal }`. A person with a tab takes the states of the tabs (`combineStates`); a sample person with no tab takes `SAMPLE_STATES`, others `offline`. `afterTypingCall` posts the signal; a tab drops a signal of its own `me()`.

- [ ] **Step 1: Write the failing tests** with a pair of in-memory channels: "shows the sample states with no channel"; "shows the state of another tab and offline after its leave"; "joins two tabs of one person"; "hands a typing signal to the other tab, not back to the sender"; "previews as another person: the old person's tab state goes".
- [ ] **Step 2: Run it:** `npx vitest run src/app/live/prototypeLive.test.ts --no-file-parallelism --testTimeout=60000`. Expected: FAIL.
- [ ] **Step 3: Implement**, and give the prototype runtime `live: prototypeLive({ me: () => store.state.session.currentUserId })`.
- [ ] **Step 4: Run it again** with `src/app/bootstrap.test.ts` (if it exists) and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit:** "Prototype: status and typing between the tabs of one browser, and sample states (L1)".

### Task L2: The Supabase adapter

**Files:** Create `src/app/remote/presence.ts`, `src/app/remote/presence.test.ts`. Modify `src/app/remote/channel.ts` (`supabaseChangeSource` takes `onTyping?: (signal: TypingSignal) => void` and listens to `TYPING_EVENT` on `person:<me>` beside `changed`), `src/app/remote/channel.test.ts`, `src/app/remote/bootstrap.ts` (lines 188 to 224: the runtime gets `live`).

**Interfaces.** Consumes: B6, P1 (the topics and policies). Produces: `export function supabaseLive(supabase: SupabaseClient, me: string): LivePort & { typing(signal: TypingSignal): void }`. Each watched id gets `supabase.channel('status:' + id, { config: { private: true, presence: { key: <a random id of this tab> } } })`, `.on('presence', { event: 'sync' }, ...)`, joined after `supabase.realtime.setAuth()`, with the rejoin waits of `channel.ts` (`REJOIN_MS`) and its leave wait. A person's state = `combineStates` of the `state` of each presence entry on their topic. The own topic tracks `{ state }` at each `setMine` change (at once, also when the page hides). `watch` joins new ids and leaves gone ids. Typing signals come in through `onTyping` of the change source and go to `subscribeTyping`; a signal with `userId === me` is dropped. In `bootstrap.ts`, when the live kind is not `socket`, `live = supabaseLive(supabase, me)` and the change source gets `onTyping: live.typing`.

- [ ] **Step 1: Write the failing tests** with a fake client (the fakes of `channel.test.ts`): "joins one private status topic for each watched person, and leaves a person who is gone"; "tracks away at once when the page hides"; "joins two devices of one person" (two presence entries: online wins); "shows offline after the last leave"; "passes a typing signal from person:<me>, and drops its own"; "joins again after a close" (the `REJOIN_MS` waits); "the change source still ignores a typing payload on the changed listener".
- [ ] **Step 2: Run them:** `npx vitest run src/app/remote/presence.test.ts src/app/remote/channel.test.ts --no-file-parallelism --testTimeout=60000`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them again** with `src/app/remote/bootstrap.test.ts` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit:** "Live: status on a Realtime topic for each person, and typing on the person topic (L2)".

### Task L3: The office object (server)

**Files:** Modify `server/office/parts.ts` (the socket `message` handler, lines 432 to 435, and `closed`), `server/office/live.ts` (`SocketNote`, `acceptLive`), `server/office/office.ts` (the office deps get `typing`), `server/office/live.test.ts`, `server/office/socket.wd.test.ts`. Create `server/office/presence.ts`.

**Interfaces.** Consumes: B5 (`TypingPort`, `TypingSignal`, `TYPING_EVENT`), B6 (`combineStates`, as a copy of its one line in `server/office/presence.ts` if `server/` may not import `src/app`: check the import rules in `server/CLAUDE.md`; the rule wins). Produces:
- `SocketNote` gets `state?: DeviceState`. A socket message `{"t":"state","state":"online"|"away"}` (JSON; anything else is ignored; `ping` stays) stores the state with `serializeAttachment`, so it outlives a hibernation.
- `export function officeStates(sockets: LiveSockets): Record<string, PersonState>` (each person with a socket: `combineStates` of the states of their sockets; a socket with no state counts as away).
- When the combined state of a person changes (a state message, a close, an error, a sweep close, `closeOff`), every `office` socket gets `{"event":"presence","payload":{"v":1,"userId":"...","state":"..."}}`. A new socket gets one `{"event":"presence","payload":{"v":1,"states":{...}}}` after its accept.
- `export function officeTyping(o: { sockets: LiveSockets }): TypingPort`: sends `{"event":"typing","payload":<signal>}` to `sockets.list('person:' + id)` of each person. The office deps set `typing: officeTyping(...)`.

- [ ] **Step 1: Write the failing tests.** `live.test.ts` (`fakeSockets`, `openFor`): "stores the state of a socket and tells the office"; "a closed socket makes its person offline for the office"; "joins two devices of one person"; "gives a new socket the states of all"; "ignores a message that is not a state". `socket.wd.test.ts`: "keeps the state of a socket across a hibernation"; "a person's typing reaches only the sockets of the named people".
- [ ] **Step 2: Run them:** `npx vitest run server/office/live.test.ts --no-file-parallelism --testTimeout=60000`. Expected: FAIL. (merge lead runs) `npm run test:office`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them again** with `server/office/parts.test.ts` (if it exists) and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit:** "Office object: the state of each socket, the presence events, and typing to the sockets of the members (L3)".

### Task L4: The office socket adapter (screens)

**Files:** Create `src/app/remote/officeLive.ts`, `src/app/remote/officeLive.test.ts`. Modify `src/api/remote/liveSocket.ts` (lines 147 to 162: pass the events `presence` and `typing`; a new method `sendState(state)` that sends `{"t":"state","state":...}` when open, and sends the last state again after each open), `src/api/remote/liveSocket.test.ts`, `src/app/remote/bootstrap.ts`.

**Interfaces.** Consumes: L3 (the wire shapes), B6. Produces: `LiveSocketOptions` gets `onPresence?(payload: { v: 1; userId: string; state: PersonState } | { v: 1; states: Record<string, PersonState> }): void` and `onTyping?(signal: TypingSignal): void`. `export function officeLive(source: { sendState(state: DeviceState): void }, me: string): LivePort & { presence(payload): void; typing(signal: TypingSignal): void }`. `watch` keeps the list only (the object sends every state). In `bootstrap.ts`, when the live kind is `socket`, `live = officeLive(...)`.

- [ ] **Step 1: Write the failing tests:** "sends the state when the socket opens, and again after a new open"; "takes a snapshot and then each change"; "passes typing and drops its own"; "the change listener still gets only changed signals".
- [ ] **Step 2: Run them:** `npx vitest run src/app/remote/officeLive.test.ts src/api/remote/liveSocket.test.ts --no-file-parallelism --testTimeout=60000`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them again** with `npm run typecheck`. Expected: PASS. (merge lead runs) `test:office`, `test:lite`.
- [ ] **Step 5: Commit:** "Live: status and typing on the office socket (L4)".

---

## Wave 2, track faces (`rb/chat-presence-faces`)

Words go only into `src/i18n/real/presence.en.json` and `presence.ar.json` (the keys of the design's word table that are not `emoji.*` or `chat.addReaction`).

### Task F1: The dot on the face

**Files:** Create `src/components/PersonFace.tsx`, `src/components/PersonFace.test.tsx`, `src/features/inbox/ChatFaces.test.tsx`, `src/i18n/real/presence.{en,ar}.json`. Modify `src/components/Avatar.tsx` (line 50), `src/features/inbox/ChatList.tsx` (`Lead`, lines 29 to 35), `src/features/inbox/ConversationPane.tsx` (the head lead, line 211), `src/features/inbox/MessageBubble.tsx` (line 150), `src/components/MentionField.tsx` (line 116), `src/features/inbox/InboxScreen.tsx` (line 107), `src/features/inbox/GroupSheets.tsx` (lines 56 and 126), `src/app/PersonMenu.tsx` (lines 57 to 63).

**Interfaces.** Consumes: B6 (`usePersonState`, `useMyState`). Produces:
- `Avatar` props add `state?: PersonState` and `label?: string`. The dot: an `aria-hidden` span at the end-bottom corner (logical sides), with a ring of the panel color: 12 px at size 40, 11 px at 36, 9 px at 28, 8 px at 24. Online: the green token, filled. Away: the panel color with a 2 px inner ring of the Ink 2 token. Offline or no state: no dot. No motion. `label` replaces the name in the `aria-label` or the `alt`.
- `export function PersonFace({ user, size, mine }: { user: AvatarUser & { active?: boolean }; size: number; mine?: boolean })`: an agent or a person who is not active gets no state; else `usePersonState(user.id)` (`useMyState()` when `mine`), and the label `t('presence.faceLabel', { name, state: t('presence.' + state, { context }) })`.
- The faces of design A4 use `PersonFace`: a D row of the list, the D head, the faces next to messages, the @ list, the "New message" list, the group People and Add people lists, the person menu button and head (`mine`). Group and project rows keep their tile.

- [ ] **Step 1: Write the failing tests.** `PersonFace.test.tsx`: "draws a filled dot for online, a ring for away, and none for offline"; "gives no dot to an agent or a person who left"; "says the state in the label, in English and in Arabic with the female form" (`"Reem Al-Ghamdi, Online"`, `"ريم الغامدي، متصلة"`). `ChatFaces.test.tsx` (`renderApp('/inbox', ..., { live: <fake port with usr_003 online, usr_007 away> })`): the D row of Reem has the label with "Online"; the open D head shows the dot; a group message face shows Lina's ring; the own face in the person menu button shows the own state; Arabic `dir="rtl"`: the dot sits on the left-bottom corner (`inset-inline-end`).
- [ ] **Step 2: Run them:** `npx vitest run src/components/PersonFace.test.tsx src/features/inbox/ChatFaces.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them again** with `src/features/inbox/*.test.tsx src/components/MentionField*.test.tsx src/app/PersonMenu*.test.tsx` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit:** "Screens: the status dot on the faces of the chat (F1)".

### Task F2: The words in the head, and the Away switch

**Files:** Create `src/features/inbox/PresenceMenu.test.tsx`. Modify `src/features/inbox/ConversationPane.tsx` (the D subtitle, lines 215 to 221), `src/app/PersonMenu.tsx` (the head lines 62 to 68, one new row before Settings), `src/i18n/real/presence.{en,ar}.json`.

**Interfaces.** Consumes: F1, B4, B6. Produces: the D head subtitle is the person's state in words (`presence.online|away|offline` with the gender context), and keeps `chat.inactive` for a person who left. The person menu head shows the own dot and, under the name, `presence.online`, `presence.away`, or `presence.awayByYou` when `awayByHand` is on. One `Switch` row (`src/components/Switch.tsx`): label `presence.showAway`, `checked` = `awayByHand`, `onChange` calls `me.updatePreferences({ awayByHand: next })`.

- [ ] **Step 1: Write the failing tests:** "shows Online under the name in a direct chat head, and the inactive line for a person who left"; "turns Away on and off from the person menu" (the call input, then the own state `away` with the line "Away (set by you)"); "Arabic: the female forms for Hala" (`بعيدة عن الشاشة، باختيارك`).
- [ ] **Step 2: Run it:** `npx vitest run src/features/inbox/PresenceMenu.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it again** with the touched files' tests. Expected: PASS.
- [ ] **Step 5: Commit:** "Screens: the state in words in a direct chat, and Show me as Away (F2)".

### Task F3: Seen

**Files:** Create `src/features/inbox/SeenLine.tsx`, `src/features/inbox/SeenLine.test.tsx`, `src/features/inbox/SeenWhileActive.test.tsx`. Modify `src/features/inbox/ConversationPane.tsx` (the read effect, lines 174 to 198; `bubbleOfMessage` stays), `src/features/inbox/MessageLog.tsx` (props lines 32 to 48, the list lines 195 to 207), `src/i18n/real/presence.{en,ar}.json`.

**Interfaces.** Consumes: B2 (`seen`, `seenUpTo`, `others`, `chats.markRead` `seen`), B6 (`useActive`), F1. Produces:
- The read effect: `const active = useActive();` `seenBehind` = the newest message time is later than `data.seenUpTo` (or it is null). It calls `markRead.mutate({ conversationId: id, ...(active ? { seen: true } : {}) })` when `opened && visible && (behind || (first && unread > 0) || (active && seenBehind))`. `TaskPane` does not change.
- `MessageLog` prop `seen?: { kind: 'direct' | 'group' | 'project'; readers: { userId: string; at: string }[]; others: number }`. After the last own bubble with no `status`, it draws `<SeenLine>` (one `li`, end side, `text-caption text-ink-2`).
- `SeenLine`: k = the readers with `at >= createdAt` of that bubble. D: `chat.seen` (gender context of the other person) when k = 1. G and P: none at k = 0; `chat.seenByAll` when k = `others`; else `chat.seenBy` with `{ count: k }`. In G and P it is a button (44 px press area) that opens a `Popover` titled `chat.seenByTitle` with one row for each reader (`PersonFace` 24 and the name), no times. Arabic `chat.seenBy`: `_one` «قرأها شخص واحد», `_two` «قرأها شخصان», `_few` «قرأها {{count}} أشخاص», `_many` «قرأها {{count}} شخصًا», `_other` «قرأها {{count}} شخص».

- [ ] **Step 1: Write the failing tests.** `SeenLine.test.tsx`: "shows Seen in a direct chat once the other person looked, and nothing before"; "shows Seen by 3, then Seen by everyone"; "shows it only under the last own message, not under a message that is not sent yet"; "opens the names with Enter, with no times"; "Arabic: قرأتها for Reem, and the two form". `SeenWhileActive.test.tsx` (the visibility helper of `ReadWhileVisible.test.tsx`, fake timers): "an open chat in view and in use sends seen: true"; "an idle screen reads without the flag, and the next key sends seen: true"; "a hidden page sends nothing".
- [ ] **Step 2: Run them:** `npx vitest run src/features/inbox/SeenLine.test.tsx src/features/inbox/SeenWhileActive.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them again** with `src/features/inbox/ReadWhileVisible.test.tsx src/features/inbox/MessageLog*.test.tsx src/features/inbox/ConversationPane.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit:** "Screens: Seen and Seen by N under the last own message, moved only by a look in use (F3)".

### Task F4: The typing line and the typing row

**Files:** Create `src/features/inbox/TypingLine.tsx`, `src/features/inbox/TypingLine.test.tsx`, `src/features/inbox/ChatListTyping.test.tsx`. Modify `src/features/inbox/ConversationPane.tsx` (`ChatPane`: the line between `NewerMessages` and the `Composer`; `onTextChange` and the stop at send), `src/features/inbox/ChatList.tsx` (`ChatRowItem`, the preview lines 148 to 163), `src/i18n/real/presence.{en,ar}.json`.

**Interfaces.** Consumes: B6 (`useTypers`, `useTypingSender`, `useTypingRows`, `Composer.onTextChange`). Produces:
- `TypingLine({ conversationId })`: always one `h-6` row (so nothing jumps), `aria-live="polite"`; empty when nobody types. One typist: `chat.typingOne` (gender context); two: `chat.typingTwo`; three or more: `chat.typingMany`. Three 5 px dots that fade one after the other with `motion-safe:` classes only; still with reduced motion.
- `ChatPane`: `const typing = useTypingSender(id);` `onTextChange={typing.changed}`; `typing.stop()` in the `onSend` path. Not in `TaskPane`.
- `ChatRowItem`: `const typers = useTypingRows().get(row.id) ?? []` read inside the row (a change renders only that row). With typers: the preview becomes `chat.typingRow` (D, gender context) or `chat.typingOne` with the first name (G, P), in the link color, with no `by:` prefix.

- [ ] **Step 1: Write the failing tests.** `TypingLine.test.tsx`: "names one, two, and several typists, in English and in Arabic" (`ريم تكتب...`, `فيصل يكتب...`); "keeps its height when empty"; "hides the line after 6 s with no signal"; "uses no motion class with reduced motion". `ChatListTyping.test.tsx`: "shows typing... in a direct row and Reem is typing... in a project row, then the last message again". `ConversationPane` typing: "sends chats.typing once for fast keys, and a stop at Send" (`callsOf`).
- [ ] **Step 2: Run them:** `npx vitest run src/features/inbox/TypingLine.test.tsx src/features/inbox/ChatListTyping.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them again** with `src/features/inbox/ChatFilter.test.tsx src/features/inbox/InboxScreen.test.tsx src/features/inbox/ComposerKeys.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit:** "Screens: the typing line above the box and in the chat list (F4)".

### Task F5: What's new

**Files:** Modify `src/whatsNew/entries.ts` (line 15, the new entry first), `src/i18n/real/presence.{en,ar}.json` (`whatsNew.items["2026-10-23-80"].title` and `.body`).

**Interfaces.** Produces: `{ id: '2026-10-23-80', day: '2026-10-23', to: '/inbox' }`. Words (the builder may adjust them to STE and Thmanyah): title "Who is here, and who saw it" / «من هنا، ومن قرأ رسالتك»; body "The chat shows who is online, who saw your last message, and who is typing. Add emoji to your messages, and react with any emoji." / «تعرض المحادثة الآن من هو متصل، ومن قرأ رسالتك الأخيرة، ومن يكتب. أضف إيموجي إلى رسائلك، وتفاعل بأي إيموجي.»

- [ ] **Step 1: Run** `npx vitest run src/whatsNew --no-file-parallelism --testTimeout=60000` after the change. Expected: PASS (the id format, no em-dash, both languages).
- [ ] **Step 2: Commit:** "What's new: chat status, Seen, typing and emoji (F5)".

---

## Wave 2, track emoji (`rb/chat-presence-emoji`)

Words go only into `src/i18n/real/emoji.en.json` and `emoji.ar.json` (the `emoji.*` keys and `chat.addReaction`).

### Task E1: The emoji data and its search

**Files:** Create `scripts/emoji/build-data.ts`, `scripts/emoji/build-data.test.ts`, `src/features/emoji/data.generated.json`, `src/features/emoji/search.ts`, `src/features/emoji/search.test.ts`. Modify `package.json` (devDependencies only, and a script `"emoji:data": "node --import tsx scripts/emoji/build-data.ts"`).

**Interfaces.** Produces:
- Sources (devDependencies): `emojibase-data` (MIT; order, groups, versions, skins, English names and tags) and `cldr-annotations-full` with `cldr-annotations-derived-full` (Unicode License; the Arabic names and keywords in `annotations/ar` and `annotationsDerived/ar`). Pin exact versions that are at least two weeks old; write the versions and licenses in the report.
- `data.generated.json` (committed; at most 450 KB): `{ "v": 1, "max": "15.0", "groups": [{ "key": "people" | "nature" | "food" | "activities" | "travel" | "objects" | "symbols" | "flags", "items": [{ "e": "😀", "en": "grinning face", "ar": "وجه مبتسم", "k": ["face", "grin"], "ka": ["..."], "s": ["👋🏻", "👋🏼", "👋🏽", "👋🏾", "👋🏿"] }] }] }`. Smileys and People join into `people`; the Component group and every emoji above version 15.0 are left out; `s` only for an emoji with five one-tone forms.
- `search.ts`: `export function foldArabic(text: string): string` (drops U+064B to U+0652, U+0670 and U+0640; أ إ آ to ا; ة to ه; ى to ي; Latin to lower case). `export type EmojiItem = { e: string; en: string; ar: string; k: string[]; ka: string[]; s?: string[] }`. `export function searchEmoji(groups: { items: EmojiItem[] }[], query: string, limit = 80): EmojiItem[]`: each word of the folded query is the start of a word of the folded `en`, `ar`, `k` or `ka`; list order.

- [ ] **Step 1: Write the failing tests.** `build-data.test.ts` (on the committed file): "has the 8 groups"; "has 🫨 (15.0) and not 🙂‍↔️ (15.1)"; "has no skin tone item as its own entry"; "gives 👋 its five tones"; "is at most 450 KB". `search.test.ts`: `foldArabic('أَحْمَر') === 'احمر'`; "finds 🙏 for thanks"; "finds ❤️ for قلب and for احمر"; "finds nothing for zzzz"; "keeps the list order".
- [ ] **Step 2: Run them:** `npx vitest run scripts/emoji src/features/emoji/search.test.ts --no-file-parallelism --testTimeout=60000`. Expected: FAIL.
- [ ] **Step 3: Implement**, run `npm run emoji:data` once, and commit the file.
- [ ] **Step 4: Run them again.** Expected: PASS.
- [ ] **Step 5: Commit:** "Emoji: the data from Emojibase and CLDR in English and Arabic, and the search (E1)".

### Task E2: The emoji panel and the emoji button

**Files:** Create `src/features/emoji/EmojiPanel.tsx`, `src/features/emoji/EmojiButton.tsx`, `src/features/emoji/recent.ts`, `src/features/emoji/insert.ts`, `src/features/emoji/EmojiPanel.test.tsx`, `src/features/emoji/insert.test.ts`, `src/i18n/real/emoji.{en,ar}.json`. Modify `scripts/check-bundles.ts` (lines 48 to 55: the first load holds no `grinning face`).

**Interfaces.** Produces:
- `recent.ts`: `RECENT_KEY = 'madar.emoji.recent'`, `TONE_KEY = 'madar.emoji.tone'`, `DEFAULT_RECENT = ['👍', '🙏', '✅', '🎉', '😂', '🔥', '👀', '❤️']`, `readRecent(): string[]` (at most 16, the defaults when empty), `pushRecent(emoji: string): void`, `readTone(): 0 | 1 | 2 | 3 | 4 | 5`, `writeTone(tone)`. Every storage call sits in a try.
- `EmojiPanel({ onPick, layout }: { onPick(emoji: string): void; layout: 'panel' | 'sheet' })` (a lazy module: it imports `data.generated.json`): the search field (`emoji.search`), the row of 8 group buttons (each scrolls to its group; label `emoji.group.<key>`), `emoji.recent`, then the groups, each a labelled grid of 8 columns of 44 px buttons with `aria-label` = the name in the screen language; `emoji.none` when the search finds nothing; a tone button (`emoji.skinTone`) with 6 choices. Arrow keys move in the grid (right to left in Arabic), Enter picks. A pick applies the tone (`s[tone - 1]`), calls `pushRecent` and `onPick`. Groups use `content-visibility: auto`.
- `EmojiButton({ onPick, label }: { onPick(emoji: string): void; label?: string })`: a 44 px round button with a smiley icon of the icon set that the app uses, label `emoji.add` by default. On a computer it opens a `Popover` above; on a phone (`useIsPhone`) a `Sheet` (`title` `emoji.add`, not blocking). The first open loads the panel with `import()` and shows a quiet wait. The panel stays open after a pick; Esc, a press outside and `close()` end it, and the focus goes back to the button. It exposes `close` through `ref` (`useImperativeHandle`) for the Send path.
- `insert.ts`: `export function insertAt(value: string, start: number, end: number, text: string): { next: string; caret: number }`.

- [ ] **Step 1: Write the failing tests.** `insert.test.ts`: in the middle, at the end, over a selection. `EmojiPanel.test.tsx`: "shows the recent row first, with the defaults on a new device"; "finds ❤️ for heart and for قلب"; "says No emoji has this name."; "a pick calls onPick and puts the emoji first in Recent"; "the tone changes 👋 to 👋🏽"; "the arrow keys move in the grid, right to left in Arabic"; "the button loads the panel once and puts the focus back on Esc".
- [ ] **Step 2: Run them:** `npx vitest run src/features/emoji --no-file-parallelism --testTimeout=60000`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them again** and `npm run build` (the bundle check passes, first load under 1,350,000 bytes, no `grinning face`). Expected: PASS.
- [ ] **Step 5: Commit:** "Emoji: the panel on a computer, the sheet on a phone, recent emoji and skin tone (E2)".

### Task E3: The emoji button in the two message boxes

**Files:** Create `src/features/inbox/ComposerEmoji.test.tsx`. Modify `src/features/inbox/Composer.tsx` (the row of line 105: `AttachButton`, then `EmojiButton`, then the field), `src/features/comments/CommentThread.tsx` (the form lines 101 to 124: an `inputRef` on its `MentionField` and the button beside `AttachButton`).

**Interfaces.** Consumes: E2, B6 (`change`). Produces: a pick puts the emoji at the caret of the text box (`insertAt` with `selectionStart` and `selectionEnd`), through `change` in the Composer and through the field setter in `CommentThread`, then focuses the box with the caret after the emoji (the `requestAnimationFrame` pattern of `MentionField.pick`). Send closes the panel.

- [ ] **Step 1: Write the failing tests:** "puts the emoji at the caret in the chat box, and the caret after it"; "the emoji counts as typing" (`onTextChange` called); "Send closes the panel"; "the comment box of a task has the button too"; "Arabic: the button label أضف إيموجي".
- [ ] **Step 2: Run it:** `npx vitest run src/features/inbox/ComposerEmoji.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it again** with `src/features/inbox/ComposerKeys.test.tsx src/features/comments/*.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit:** "Emoji: the emoji button in the chat box and the comment box (E3)".

### Task E4: The + of the reactions

**Files:** Create `src/features/inbox/ReactionAny.test.tsx`. Modify `src/features/inbox/MessageMenu.tsx` (`ReactionRow` lines 38 to 62, `MessageSheet` lines 124 to 146), `src/features/inbox/ReactionPills.tsx`, `src/features/comments/CommentItem.tsx` (lines 104 to 128), `src/i18n/real/emoji.{en,ar}.json` (`chat.addReaction`).

**Interfaces.** Consumes: B1 (`orderReactions`, `react(bubble, emoji: string)`), E2. Produces: the reaction row of the menu adds a fourth round button, label `chat.addReaction`, after 👍 ✅ 👀. On a computer it closes the menu and opens the emoji panel in a `Popover` at the "..." button of that message. On a phone the message sheet closes first, and the emoji sheet opens in the next frame. One pick calls `actions.react(bubble, emoji)` and closes the list. `CommentItem` gets the same + button after its three. `ReactionPills` shows `orderReactions` of the keys with people. An error (the 21st kind) shows the error toast that the app uses for a failed write.

- [ ] **Step 1: Write the failing tests:** "+ opens the list and a pick of 🎉 calls reactions.toggle with 🎉"; "the pills show 👍 ✅ 👀 🎉 🙏 in that order"; "on a phone the message sheet closes before the emoji sheet opens"; "a post comment has the + too"; "Arabic: the label أضف تفاعلاً".
- [ ] **Step 2: Run it:** `npx vitest run src/features/inbox/ReactionAny.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it again** with `src/features/inbox/MessageMenu.test.tsx src/features/comments/*.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit:** "Emoji: react with any emoji from the + of the menu and of a comment (E4)".

---

## The gate (merge lead)

### Task J1: Join, gate, pictures, test copy

- [ ] **Step 1:** After join 2: `git rebase main` if main moved (none of these branches is pushed), then the merge gate once: `npm run typecheck`, `npm test`, `npm run build`, `npm run build:server`, `npm run build:remote -- test` (sandbox off), and under `scripts/dev/docker-lock.sh`: `npx supabase db reset`, `npm run test:db`, `npm run test:it`, `npm run test:mcp`, `npm run test:lite`, `npm run test:office`; then `npm run smoke` (87 of 87). A failure gets a fix and a run of that suite only.
- [ ] **Step 2:** Pictures (a Haiku agent with Playwright, no `name`, every shot moved to the scratchpad): the prototype with two tabs that preview Hala and Reem: the dots in the list and the head, typing in the line and the row, Seen and Seen by 3 with the names open, the emoji panel and the phone sheet, the + of a reaction, the Away switch on. English and Arabic, light and dark, 390 px and a computer.
- [ ] **Step 3:** The test copy: `scripts/deploy/all.sh test` (both migrations go out), then the deploy suite. A live check (a Haiku agent with two browser contexts on the test accounts, admin and member): the dot of the other person turns Online, then Away when that page hides; typing shows within 1 s and goes after Send; Seen shows within 2 s of the look. Write the times in `proof.md`.
- [ ] **Step 4:** Records: `TASKS.md` (tick and add), `proof.md` (the gate section with the counts), the part guides that a change made wrong (`src/CLAUDE.md` live port and faces, `server/CLAUDE.md` `chats.typing` and the office presence, `supabase/CLAUDE.md` the two migrations, `server/mcp/CLAUDE.md` the counts), and the last counts in the root `CLAUDE.md`.
- [ ] **Step 5:** Tell the owner the test copy is ready for his hand test with two phones. Production waits for Friday 2026-10-23 and the owner's word.
