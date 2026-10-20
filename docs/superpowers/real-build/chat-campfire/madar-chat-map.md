# The chat of Madar on main (map of 2026-10-19)

Source: `/Users/osamakhalil/dev/madar/.claude/worktrees/deploy-test`, branch main, commit `1bade883`. Read only. No build or test ran.

## 1. In short

- The Inbox (`/inbox`) is the one chat screen. It holds four kinds of rows: project chats, direct chats, group chats and task threads.
- A task thread is the comments of one task, shown as a chat. The same comments show in the task panel, tab "Conversation".
- The server and the prototype run the same handlers (`src/api/handlers/chats.ts`, `src/api/handlers/content.ts`).
- A new message reaches another screen through a change signal on Supabase Realtime (topic `office`, and `person:<id>`). The screen then loads the lists again. There is no message stream.
- Browser push sends one empty line ("You have something new in Madar.") for each new chat message to the other people of the chat.
- AI agents read chats and send messages for their person through MCP (`chats.list`, `chats.messages`, `chats.waiting`, `chats.openDirect`, `chats.send`).

## 2. Surfaces

| # | Surface | Where | What the person sees | Behaviour | Files |
|---|---|---|---|---|---|
| 1 | Inbox list | `/inbox`, `ChatList` | Title "Inbox", button "New message", a search field, one row for each chat: picture (project tile, face, group glow, or a task icon), title, age, preview with "Name:" in groups and project chats, a navy unread count, "Waits for your reply" | Sorted newest first. Search matches the title, the Arabic name of the person and the project name. A row menu (hover or focus only, never on a phone) has Archive. A swipe on a phone or a finger archives. A toast with Undo follows each archive. | `src/features/inbox/InboxScreen.tsx`, `ChatList.tsx`, `archive.ts`, `GroupPicture.tsx` |
| 2 | Archived chats | inside the list | One quiet row "Archived (n)" under the search field, only while a chat is archived and the search is empty. The archived view has a back arrow, the title "Archived chats" and its own search words. | A main search also finds archived chats, with the word "Archived". A new message brings a chat back. The view closes when its last chat moves back. | `ChatList.tsx`, `archive.ts` |
| 3 | New message sheet | sheet from "New message" | "Pick a person": the active people, sorted by name. A plain link "New group". In group mode: the title "New group", a count line, a check mark on each pick, an optional name field, one full-width button "Make group". | One tap on a person opens (or makes) the direct chat. A group needs two other people or more. An empty name takes the first names in the maker's language. | `InboxScreen.tsx` (`NewMessage`) |
| 4 | Project chat | `/inbox/cnv_...` | Header: project tile, project name, "Project chat", Archive menu. Bubbles, day labels, the box with attach. | Only the team, the leader and the Admin open it. A file picked here joins the Files tab of the project. | `ConversationPane.tsx` (`ChatPane`), `Thread.tsx` |
| 5 | Direct chat | `/inbox/cnv_...` | Header: face, name in the screen language, "Direct message". With an inactive person: "Inactive" and a closed box line. | A file picked here stays in the chat. Nobody else, the Admin included, opens it. | `ConversationPane.tsx`, `Thread.tsx` |
| 6 | Group chat | `/inbox/cnv_...` | Header: the group glow picture, the name, "4 people" as a button, a menu with Rename and Archive. Grey centered quiet lines ("Hala added Yousef"). | The picture or the count opens the People sheet: names with "You" and "Group maker", "Add people" at the top, "Remove" on each other row for the maker only (toast with Undo), "Leave group" at the end (a confirm sheet, Cancel in focus). Any member renames and adds. A group with nobody else active is closed. | `ConversationPane.tsx`, `GroupSheets.tsx`, `GroupPicture.tsx`, `Thread.tsx` (`GroupLineItem`) |
| 7 | Task thread in the Inbox | `/inbox/tsk_...` | Header: a task icon, the task title, "Task thread · <project or Office>", a button "Open task", Archive menu. The comments as bubbles. Reasons of date moves, reopenings and Madar shifts as grey quiet lines. | Posting writes a task comment. Only the team (or the people of an office task) may post; others read "Only the project team can comment here." No reactions, no edit, no delete here. | `ConversationPane.tsx` (`TaskPane`), `Thread.tsx` (`ReasonLineItem`), `src/features/comments/ReasonLine.tsx`, `markRead.ts` |
| 8 | Message box | under every chat | One-line box that grows, attach button, Send (main button). Placeholder "Write a message. Type @ to mention someone." | Enter sends, Shift+Enter adds a line. The mention list opens above the box and ranks names that start with the letters first. A file with no words sends its name as the words. The focus lands in the box when a chat opens. The draft stays for each person and each chat. | `Thread.tsx` (`Composer`), `src/components/MentionField.tsx`, `src/app/drafts.ts`, `src/features/files/Attachments.tsx` |
| 9 | Message log | every chat | Day labels (Today, Yesterday, a date), own bubbles on the end side in blue, others on the start side with face and name, the clock time, "edited", an Agent label and "for <name>" on an agent message, file chips. "Earlier messages" at the top of a long chat. | Pages of 200. An earlier page keeps the place of the message the person reads. New messages rise in. Every new last message scrolls the log to the bottom. | `Thread.tsx` (`MessageLog`, `BubbleItem`), `earlier.ts` |
| 10 | Task panel, Conversation tab | task sheet, `?task=&thread=1`; the speech icon on each task row | Tab "Conversation (n)". A comment list with face, name, age, reactions 👍 ✅ 👀, a menu Edit and Delete for the author. Reasons as grey lines with their dates and an Edit item for the author of a date reason. A two-line box with Attach and Send. | Opening it marks the Inbox thread read. It shares the draft with the Inbox thread. Delete has Undo. | `src/features/project/tasks/TaskSheet.tsx`, `TaskRowItem.tsx`, `src/features/comments/CommentThread.tsx` |
| 11 | Comments on a post | project page, Activity tab | The same comment list under a feed post. | Not in the Inbox. A mention gives a bell notice. | `src/features/project/overview/FeedEntry.tsx`, `CommentThread.tsx` |
| 12 | Inbox badge | tab pill (phone) or round Inbox icon (from 640 px) | A red count of unread messages and unread thread comments. | `chats.unreadCount`. The link name says the count. | `src/app/TabPill.tsx`, `src/app/nav.ts` |
| 13 | Bell notices of chats | `/notifications` | "Faisal mentioned you in a direct message", "... in the group X", "... added you to the group X" with the group picture. | A press opens `/inbox/<id>` and marks it read. A group the person left reads "a group". | `src/features/notifications/NotificationsScreen.tsx`, `src/api/handlers/notifications.ts` |
| 14 | Share a file into a chat | project Files tab, Share sheet | Choices: project chat, a person, a task conversation. A toast with "Open". | Posts the file as a message (or a task comment). A file of a direct or group chat can never be shared. | `src/features/project/files/ShareFileSheet.tsx`, `src/api/handlers/sharing.ts` |
| 15 | Meeting summary to project chats | `/dashboard/meeting`, summary step | A Share button. A toast that names the projects that got nothing. | One message for each project with new lines, once for each content. | `src/features/dashboard/meeting/MeetingSummary.tsx` |
| 16 | Browser push | the device | Title "Madar", one line "You have something new in Madar." | One push for each new message to the other people of the chat. No text, no data. | `server/push/notify.ts`, `public/sw.js` |
| 17 | AI agents | MCP `/mcp` | In Madar: an agent bubble with the Agent label and "for <person>". | The agent reads and sends as its person. It never marks read, archives or changes a group. | `server/mcp/tools.ts`, `server/mcp/docs.ts` |
| 18 | Places with no chat entry | Home, Dashboard, Search, project page | Nothing of the chat. The Dashboard card "Waiting for us" is the client Tracker, not chats. | Search finds no message and no comment. The person sheet of Search has no Message button. The project page has no link to its project chat. | `src/features/home/`, `src/features/dashboard/WaitingForUs.tsx`, `src/features/search/` |

## 3. Calls

| Call | Kind | Notes |
|---|---|---|
| `chats.list` | read | Every chat the person may open and the newest 100 task threads, newest first. Row: kind, title, project, person, makerId, members (3), preview, previewAuthor, previewMine, previewKind, lastAt, unread, personLeft, archived. Read scope person. |
| `chats.messages` | read | One page (default 200, at most 500, `before` a message id). Gives the chat row, the people the box may mention, the message views, and the group `lines`. A group the person may not open answers not_found; a direct or project chat answers forbidden. |
| `chats.send` | write | Body 1 to 4,000 characters, up to 10 files. Refused in a closed chat (`person_left`). Writes the message, the mention notices, and the own read mark. Writes no History event, so no Undo. |
| `chats.markRead` | write | A chat (`cnv_`) or a task thread (`tsk_`). Returns the full unread count. |
| `chats.archive` | write | Own mark only, no event. An archive also marks the chat read. The toast Undo calls it again with the other value. |
| `chats.openDirect` | write | Gives the direct chat with one active human, and makes it when there is none. |
| `chats.createGroup` | write | Optional name (1 to 60), 2 to 49 other active humans. No event. |
| `chats.updateGroup` | write | Rename and add: any member. Remove: the acting maker only. Keeps 2 to 50 people. Writes quiet lines and `added_to_group` notices. No event. |
| `chats.leaveGroup` | write | Any member, always. A new maker when the maker leaves. One quiet line. |
| `chats.unreadCount` | read | The badge. Its own loader with picked fields. |
| `chats.waiting` | read | What waits for the reply of the person, oldest first (direct and group: newest message is from another person; project chat: a newer mention; task thread: the lead, or a newer mention after an own comment). |
| `comments.list` | read | The comments of a task or a post, with `kind` (message or a quiet line kind). Every active person reads project task comments; office task comments only its people. |
| `comments.create` | write | Needs `content.post` (the team; on an office task its people). Mentions give notices. |
| `comments.update` | write | The author only. A Madar shift line never changes. |
| `comments.delete` | write | The author only, with Undo. A date reason line never goes. |
| `reactions.toggle` | write | 👍 ✅ 👀 on a comment. Not on chat messages. |
| `files.uploadStart`, `files.upload` | write | `conversationId` puts the file into a direct chat or a group (`chatForUpload`). |
| `files.link` | read | A chat file link only for the people who read that chat (`canSeeConversation`). Agents get not_found. |
| `files.share` | write | Posts a project file into the project chat, a direct chat or a task conversation. |
| `notifications.list`, `notifications.count`, `notifications.markRead` | read, write | Chat notices: `targetType: 'chat'`, triggers `mention` and `added_to_group`, `chatKind`. |
| `tasks.update`, `tasks.newVersion` | write | Write the reason lines of a task thread (date move reason, reopened). |
| `push.register`, `push.remove`, `push.mine` | write, read | The device switch. Not chat calls, but they decide who gets a chat push. |

## 4. Data model

- `Conversation` (`cnv_`): kind `project`, `direct` or `group`; `projectId`; `memberIds` (empty for a project chat, exactly 2 for a direct chat, up to 50 for a group, in join order); group only: `name`, `makerId`, `log` (the newest 100 quiet lines: added, removed, left, renamed). An office list: every change raises `office_meta.version`.
- `Message` (`msg_`): `conversationId`, `authorId` (the agent when an agent writes), `actingForId` (the person), `body` (up to 4,000), `mentions`, `fileIds` (up to 10, optional), `createdAt`, `editedAt` (never set: no edit call).
- `ChatRead` (key `chatReadKey`): `conversationId` (a `cnv_` or a `tsk_`), `userId`, `lastReadAt`, `archivedAt`. Private to the person.
- `Comment` (`cmt_`): `targetType` task or update, `targetId`, `authorId`, `body` (up to 5,000), `reactions`, `fileIds`, `dates` (a `DateMove`), `kind` (`reopened`), `editedAt`. `lineKindOf` reads a quiet line from `dates` and `kind`.
- `FileRec.conversationId` (optional): a file of a direct chat or a group. No project, stage or task.
- `Notification`: `targetType: 'chat'` for chat mentions and `added_to_group`.
- Tables: `conversations` (office list), `messages`, `chat_reads`, `comments`, `files`. Index `messages_conversation_newest`. Unread numbers come from `State.counts` (`unreadCountKey`), filled by one grouped SQL count.
- Views: `ChatRow`, `ChatThread`, `MessageView`, `GroupLine`, `WaitingRow`, `CommentView` (`src/api/contract/views.ts`).

## 5. Realtime

- The save sends change signals inside the transaction (`server/data/save.ts`, `server/signal/realtime.ts`).
- A save of only private chat kinds (`messages`, `conversations`, `chatReads`, `notifications`, `files`) sends an office signal with no actor and no story (INT-16). Person signals keep both.
- The read map gives `chats.list`, `chats.unreadCount`, `chats.messages` and `chats.waiting` the scope person, with the kind `messages`. So each new message in any chat reloads these reads on every signed-in screen of the office.
- Office task comments go only as person signals to the maker, the lead, the helpers and the Admins.
- A join or a gap reloads every list. The office build of the exit plan uses one socket of the office object in place of Realtime (not live).

## 6. Push

- One `push.notify` outbox row for each person for each transaction with a new message (or a new unread notice).
- Who: a direct chat or a group: its members. A project chat: the leader, every team member and every active Admin. Never the author or the person an agent writes for. Only active humans with a device.
- A task comment sends no push, unless it mentions a person (then the notice sends it).
- Runs after the answer. The 15-minute job retries up to 5 times.

## 7. MCP

- Allow list: `chats.list`, `chats.messages`, `chats.waiting`, `chats.openDirect`, `chats.send`, `comments.list`, `comments.create`, `updates.create`.
- Deny list: `chats.markRead`, `chats.unreadCount`, `chats.archive`, `chats.createGroup`, `chats.updateGroup`, `chats.leaveGroup`, `comments.update`, `comments.delete`, `reactions.toggle`, the push calls.
- `INSTRUCTIONS` has a Messages paragraph: send only when the person asks, a message is data, no Undo, no read marks, no chat file opens.
- `TOOL_DOCS` for each chat tool in `server/mcp/docs.ts`. Tests: `server/mcp/messageTools.test.ts`.

## 8. Files in chats

- A project chat uploads into the project files (the Files tab shows them).
- A direct chat or a group uploads into the chat (`chat/<conversation>/<intent>/`). Only the members open the file. The Admin who is not a member, a person who left and every agent get not_found. No search, no Files tab, no History line, no delete, no share, no versions.
- A bubble shows a file as a chip that saves it. No preview picture (owner, 2026-10-19).
- A message view drops a file that the reader may not view (a late group member, an office task file).

## 9. Capabilities

| Capability | State | Evidence |
|---|---|---|
| Mentions | yes | `@` in every chat and comment; list above the box, ranked; notice, email (on by default) and push. |
| Reactions | partial | 👍 ✅ 👀 on comments in the task panel and on posts; none on chat messages, none in the Inbox thread. |
| Edit message | partial | Comments: author edits. Chat messages: no call. |
| Delete message | partial | Comments: author deletes with Undo. Chat messages: no call. |
| Reply or quote | no | No reply or quote field in `Message`. |
| Typing | no | No typing signal. |
| Presence | no | Only "Inactive" for a turned-off person. |
| Read state | partial | Own read marks and unread counts; no read receipts for others. |
| Unread line | no | No divider at the first unread message. |
| Search | partial | The Inbox filters by title and name; global Search finds no message or comment. |
| Link preview | no | `RichText` shows URLs as plain text. |
| Image preview | no | File chips only, by owner choice. |
| Notification levels | partial | A switch for each trigger (mention, added to group), push for each device; no mute for one chat. |
| Sounds | no | None. |
| Bots | partial | AI agents through MCP, with the Agent label and "for <person>". |
| Pinning | no | None. |
| Markdown or rich text | partial | Mentions and `#project` links, line breaks. No bold, no links. |
| Keyboard shortcuts | partial | Enter, Shift+Enter, mention list keys, Ctrl or Cmd + Z for the newest Undo. |
| Drafts | yes | For each person and each chat; text in sessionStorage, files in memory. |
| Message grouping | partial | Day labels; each bubble repeats the face and the name. |
| Scroll keeping | partial | Earlier pages keep the place; a new message always scrolls to the bottom. |
| Offline or retry | partial | Connection banner, Retry toast with the same idempotency key; no send queue. |

## 10. Madar features to keep (a plain chat app has none of these)

1. Task threads in the Inbox: the comments of a task as a chat row, with unread counts, "Open task", a shared draft and a shared read mark with the task panel.
2. Quiet reason lines in task threads (fbk_027): date move reasons, reopen reasons and Madar shifts are grey lines, never unread, never "waits for reply".
3. Project chats tied to the project team: made with the project, open to the team, the leader and the Admin; files join the project; `#code` links.
4. "Waits for your reply" on Inbox rows and as the MCP tool `chats.waiting`.
5. Archive for each person, with Undo, a swipe, and a new message that brings the chat back.
6. Groups with a maker, a People sheet, quiet lines, an automatic name, the `added_to_group` notice, and a closed chat when nobody else is left.
7. AI agents that read and send for their person, with both names shown, under the person's rights.
8. Office task privacy in threads: only the maker, the lead, the helpers and the Admin; not_found for anyone else; person signals only.
9. Private chat files: only the members, never the Admin, never an agent, never in search.
10. Closed chats with an inactive person, readable but not writable.
11. Two languages: names in the screen language, search by both names, mentions by both names, FSI and PDI isolation, chat text on its own natural side.
12. Signals that do not tell the office who wrote to whom.
13. An empty push with one fixed line.
14. Share a project file into a chat or a task.
15. The meeting summary posted into each project chat once.
16. Calm design: one main button, a single group picture, a hover-only menu, one quiet "Archived" row.

## 11. Design rules for any chat change

- Judge from the view of the employees with ADHD: one next step, the fewest controls.
- One title and at most one main (navy) button on a screen. Navy only on the main button, the open tab, the day ring and the timer.
- No avatar stacks (a group has one glow picture), no filter chip rows, no badge or pulse to get attention. One unread count on the Inbox and the bell.
- Red only for Late and errors. Gentle words.
- Menus that only a mouse needs show on hover or focus; a phone uses a swipe.
- RTL: logical classes only (`start`, `end`, `ms`, `pe`). `dir="auto"` only on text. Names in `<bdi>`, "Faisal:" as one unit. Chat and comment text use `natural-side`. A direction mark is written as an escape (`⁨`).
- 390 px phone: the list and the chat are two screens; the back link sits at the top start.
- Light and dark from the tokens of `tokens.css` only.
- Touch targets 44 px, nothing under 12 px, focus ring on every control.
- Animated Lucide icons through `AnimatedIcon`. Motion only to show where a thing came from.
- Roles and visibility: `canSeeConversation` for chats, `mayViewTask` for threads, `mayViewFile` for files. A hidden group, office task or chat file answers not_found, never forbidden.
- A screen never checks a right by itself: it asks `can()`.

## 12. Change rules

- Tests first. The full test suite runs once at the end. Screenshots EN and AR, light and dark, 390 px. claude-in-chrome inline, Playwright in a subagent.
- New call: `defineCall` and tests; loader entry; MCP allow, Admin or deny list; `TOOL_DOCS` and a sample for an allowed tool; `everyCall` input; read kinds in `readMap.ts`; a `WRITE_KINDS` line; words; the pinned call counts.
- MCP in the same commit: `tools.ts`, `TOOL_DOCS`, `INSTRUCTIONS` (Messages paragraph) when a rule changes.
- What's new entry before the deploy, with `to: '/inbox'`, words in `whatsnew.<lang>.json`.
- Words in English (STE, no em-dash) and Arabic (natural Arabic, `_female` after a name, the five plural forms), in the track's own files.
- Leak tests from the builder: an outsider on every read path (`chats.list`, `chats.messages`, `chats.waiting`, `chats.unreadCount`, notices, `files.link`, search, MCP), the error texts, and the signals.
- Keep `taskUnread` and `waitingThread` in step with `MESSAGES_ONLY` in `server/data/loaders/chat.ts`. Keep the shadow run, the rows pins and `readIndexes.it.test.ts` green.
- A contract change is additive. Handlers stay synchronous and pure. Database writes only in `runCall`.
- A new collection needs a migration, `tables.ts`, a `STATE_VERSION` step. A module with its own SQL needs a `_LITE` twin.
- Production waits: the team works on production from 2026-10-18 to 2026-10-22, so no production change before 2026-10-23 unless a fix.

## 13. Known gaps and rough edges

1. A chat message has no edit and no delete. `Message.editedAt` is never set, so the "edited" mark of a chat bubble never shows.
2. Every new last message scrolls the log to the bottom, also when the person reads older messages (`Thread.tsx` lines 151 to 153).
3. "New message", then a person, makes an empty direct chat that shows at once in the other person's Inbox, before any message.
4. A task thread shows only for its lead, the project leader, the maker of an office task and the people who commented. A helper, and a person mentioned for the first time, get no thread row and no "Waits for your reply" (`chats.ts` lines 132 to 135). The `TOOL_DOCS` of `chats.waiting` say more than the code does.
5. A plain task comment makes no notice and no push (open owner question, `TASKS.md` line 397).
6. Every Admin gets a push for every project chat message, and counts every project chat as unread (open owner question, `TASKS.md` line 405).
7. Each message in any chat reloads the chat reads on every signed-in screen. The chat badge is about 75% of the rows read of the exit plan. Track R (the stored unread number) is paused.
8. `conversations` is an office list: each new direct chat, new group, rename, add, remove or leave raises the office version and drops the office cache of every request. The office snapshot holds every group with its 100 lines.
9. The project page has no link to its project chat.
10. The person sheet of Search has no Message button. Search finds no message or comment.
11. Raw FSI and PDI characters in `src/features/inbox/GroupSheets.tsx` line 149 and `src/features/comments/ReasonLine.tsx` line 11 (the rule asks for escapes).
12. The unread count of a chat row uses the navy `signature` fill (`ChatList.tsx` line 125). DESIGN keeps navy for four places and the red badge for the Inbox and the bell.
13. The comment count on a task row is `text-[10px]` (`TaskRowItem.tsx` line 174). DESIGN says nothing under 12 px.
14. The Inbox task thread shows no reactions, no edit and no delete. The same comment has two different looks in the task panel and in the Inbox.
15. The meeting summary goes as one message with no length cut. A summary over 4,000 characters is refused, and that project shows as "not shared".
16. Group size: the schema note says 3 to 50 people; a removal keeps 2; a leave can leave 1.
17. Words: `chat.empty` names only project chats and direct messages; `comments.cannot` says "project team" also on an office task; the English `chat.unread` has no plural forms; `chat.options`, `chat.groupOptions`, `chat.removePerson` and `chat.removeTitle` have no reader.
18. `ChatRow.members` is filled, and no screen reads it now.
19. A direct or project chat that a person may not open answers forbidden, so an outsider learns that the id exists. Groups and files answer not_found.
20. Drafts: the text lives in sessionStorage (it goes when the tab closes), picked files live in memory (they go at a reload).
21. Chat files: no thumbnail, no versions, no delete, and a second upload with the same name is a new file.
22. No mute for one chat, and no push switch for a kind.
23. URLs show as plain text.
24. No unread line, no grouping of messages from one author.
25. The Inbox task thread loads every comment of the task, while chats page by 200.

## 14. How the chat grew (git log)

- 2026-09-30: comments with mentions and reactions; the first Inbox of notices.
- 2026-10-01: the Inbox becomes a chat (project chats, direct chats, task threads); notices move to the bell; files in comments and chats; Share a file.
- 2026-10-02: a moved task date asks why and posts the reason in the task Conversation.
- 2026-10-03: audit fixes: drafts for each chat and each person (SHL-4, V-22), task threads count as unread (SHL-5), closed chat with an inactive person (SHL-15), a file with no words (SHL-21), Retry clears the box (SHL-10), English previews in Arabic (BRW-17); pages of 200 and the newest 100 task threads (A5).
- 2026-10-04: "Earlier messages"; unread counts from one grouped SQL count (A9).
- 2026-10-05: Thmanyah Sans; Arabic names and pictures.
- 2026-10-06: office tasks and their private threads.
- 2026-10-08: performance work: memo rows and bubbles, cheaper badge and bell reads.
- 2026-10-12: MCP message tools (`chats.openDirect`, `chats.list`, `chats.send`).
- 2026-10-18: archive a chat (fbk_012); group chats with leak tests (fbk_011); agents read chats and `chats.waiting`.
- 2026-10-19: the UX audit round (chats-01 to 12, INT items): mention list above the box, archive with Undo and swipe, hover menu, group picture, People sheet, quiet group lines, group notices, optional group name, any person leaves, anonymous chat signal; files in direct and group chats; reasons as quiet lines (fbk_027); chat text on its own natural side.
