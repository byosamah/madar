# A better chat, with lessons from Campfire

Owner decisions of 2026-10-19. Branch `rb/chat-campfire` (from main `c40777ef`).

## Why

The owner wants the Madar chat "much better and perfect". We read the full source of Campfire, the open-source chat of
Basecamp (`github.com/basecamp/once-campfire`, MIT), and compared it with the Madar chat on main. Campfire has 75 features.
40 of them matter to a person in the office. The owner chose 16 of them and answered 6 rule questions. Two team reports
come in here too: fbk_028 (Faisal: a push for each reply while the chat is open, and "Waits for your reply" after he read
the message) and fbk_030 (the owner: drop files into a chat).

Campfire's lesson in one line: **a chat asks for attention only when it earns it, and it keeps the place of the reader.**

Study notes in `docs/superpowers/real-build/chat-campfire/`: the comparison of each feature (`campfire-vs-madar.md`), the
Campfire inventory, the map of the Madar chat on 2026-10-19 (`madar-chat-map.md`), and the team needs. The mockup page is
`2026-10-19-madar-chat-campfire-mockup.html` (next to this file). The owner said "go ahead" on the
mockup on 2026-10-19 with no panel clicks, so the mockup is the look to build. Where the mockup and this text differ, this
text wins. The mockup uses a system font; the real screens use Thmanyah Sans.

Lines marked *My call* are choices of the design writer, made from the owner's answers. The owner checks them when he
approves this document.

## Goals

- A person who comes back to a busy chat sees where to start, and nothing moves under their eyes while they read.
- Fewer pushes, and each push means "this is for you".
- One message has one small menu, the same in every chat kind and in task threads.
- People find a decision again by search, a week later.

## Non-goals and anti-goals

- No typing signal, no "online" dots, no office-wide chat (refused 2026-10-01, D6), no sounds, no big emoji, no bold or
  list toolbar, no link preview cards, no bots that answer by themselves, no app icon count, no phone share sheet, no
  recent-search chips, no auto-load on scroll, no "back to the last chat".
- Anti-goals (a failure even when it works): a screen that jumps while a person reads; a push that the person did not need;
  a new navy button; red for anything but Late and errors; a badge, pulse or wiggle to get attention; a face stack.

## Madar features that stay

Project chats tied to the team, direct and group chats, task threads in the Inbox, quiet reason lines (never unread, never
"waits"), "Waits for your reply", Archive with Undo and swipe, groups with a maker and quiet lines, AI agents that act for
one person, office-task privacy, private chat files, closed chats with an inactive person, two languages done right
(names in the screen language, chat text on its own natural side), nameless office signals (INT-16), the one fixed push
line with no data (2026-10-08), Share a file into a chat, the meeting summary to project chats, the calm design rules.

## What gets built

Each item says what the person sees. The kinds: P = project chat, D = direct chat, G = group chat, T = the task thread in
the Inbox (`/inbox/tsk_...`). The task panel Conversation tab takes the look of T (item 6), not its scroll behaviour.

"Names you" in every rule below means: an @mention of you in the text, or a reply to your message (item 10).

### A. Read and catch up

1. **Keep my place.** A new message scrolls the log only when the person is at the bottom (or sent it). A person who
   scrolled up stays still, and a round "Newest" button with a down arrow shows above the box: still, no pulse, no count.
   A press goes to the newest message. P D G T. Today `Thread.tsx` scrolls on every new last message.
2. **Runs.** The messages of one person within 5 minutes form a run: the first shows the face and the name, the next show
   only the text, with the time beside the bubble on hover or focus. A new day, a quiet line, another person, or an agent
   message starts a new run. An agent message keeps the Agent label and "for <name>". P D G T.
3. **The "New" line.** A chat with unread messages opens at the first unread message, with a thin line in the link blue and
   the word "New" above it. With no unread message, it opens at the bottom, as today. The line stays until the person sends
   a message or leaves the chat. It needs the read time from before the open (the open marks the chat read). P D G T.
4. **"Names you" mark.** A message that names the reader gets a soft lilac tint and a 3 px bar on its start side. Only the
   reader sees it. No motion, no red. Two new tokens: `--c-mention-bg` (light `#F4EDFF`, dark `#2D2442`) and
   `--c-mention-bar` (light `#7E22CE`, dark `#C29BFF`), with their lines in `DESIGN.md`. P G T (and D, where a mention can be).
5. **Read only while you look.** An open chat marks new messages read only while its tab is visible. A message that comes
   while the tab is hidden stays unread; it is marked read when the tab shows again. Read marks still follow the person on
   all devices. P D G T.
6. **One look for a task comment.** The Inbox task thread and the task panel Conversation tab draw a comment the same way:
   bubbles, runs, reaction pills, the message menu, the reply strip. The quiet reason lines keep their rules (a date reason
   never goes, a Madar shift line never changes). *My call: the task panel takes the chat look, so it changes too (the
   designer's question 1). It takes only the look: the comments stay in the scroll of the panel, with no Newest button and
   no "New" line, and the panel layout stays.* The comments on project posts (the Activity tab) stay as they are today in
   this batch, except for links (item 7).
7. **Small write fixes.** A web address that starts with `http://` or `https://` becomes a link in chats, comments and
   posts: an outside link opens in a new tab, a Madar link in the same tab; a long address wraps; a link inside Arabic text
   keeps its own direction. On a phone, Enter makes a new line and the Send button sends. A half-written message stays
   after the tab closes; sign-out clears every draft.
8. **A bug found on the way.** On an Arabic phone screen, a long English chat title cuts off its start ("...iche Office
   Tower"). It must cut off its end, in both languages. *My call: in this batch.*

### B. Write and reply

9. **The message menu.** On a computer, a "..." button shows beside a bubble on hover or keyboard focus. On a phone, a long
   press opens a bottom sheet with a preview of the pressed message at its top. The menu holds the three reactions in one
   row, then Reply, Edit, Delete. It shows only what the person may do: on another person's message, the reactions and
   Reply. Delete is red text, as in today's Menu. P D G T. *My call: the phone sheet also has "Copy text", because the long
   press takes the place of the phone's own text selection. A computer keeps normal selection and needs no Copy item.*
10. **Reply.** Reply puts a grey strip in the box (the name and the first line of the old message, and an X to cancel). The
    sent message shows the strip above its text. A press on the strip goes to the old message and gives it a soft frame for
    one second. The reply keeps a link to the old message, never a copy: an edit shows the new text, and a deleted message
    shows as "Deleted message". The old message must be in the same chat or the same task thread. P D G, and T. *My call: task
    threads get Reply in this batch, so the menu is the same everywhere (the designer's question 2).*
    *My call: a reply names the author of the old message (not when you reply to yourself). So that person gets the "names
    you" mark, the push of item 19, the "Waits for your reply" row of item 22, and a bell notice "X replied to you". In
    Campfire a reply notifies nobody, but here a reply to you is for you.*
11. **Edit and delete your own message.** Like task comments today: the author only, at any time. An edited message shows
    "edited". On a computer, the Up key in an empty box opens your last message for edit. P D G. T keeps today's comment
    edit and delete, with the push rule below.
    - An edit finds the names again. A person named for the first time gets the notice and the push, as a comment edit does
      today (through the wait of item 20). A person whose name the edit removes loses the notice. An edit with no new name
      sends nothing.
    - Delete asks nothing and shows a toast with Undo. The message leaves the log for everyone, as a deleted comment does
      today. A reply strip that points to it shows "Deleted message". It also leaves the unread counts, the row preview,
      "Waits for your reply", search, and any push that has not gone yet. Its notices go. The old text never comes back on
      any read path (chats, previews, search, MCP, signals) until Undo.
    - A file of a deleted message stays in the store (and in the project Files tab for a project chat), as Madar never
      deletes chat files.
12. **Reactions on chat messages.** The same three as on comments: 👍 ✅ 👀. Under the bubble, a small pill for each reaction
    in use, with the emoji and a count (28 px high, a 44 px press area). Your own reaction has the thin blue ring of today's
    task panel. A press on a pill toggles your reaction; hover or a long press shows the names. No faces under the pills (no
    face stacks). A reaction makes no push and no unread mark. P D G T.
13. **Instant send.** Your message shows at once, a little faded until the server saves it. If the send fails, the bubble
    shows "Not sent" in the error red with the alert icon, and a "Send again" button that sends with the same key (no double).
    The saved message replaces the faded one; a signal that comes before the answer must not show it twice. P D G T.

### C. Files and search

14. **Drop and paste files.** Drop files anywhere on an open chat or task thread: a soft dashed frame says "Drop to attach",
    and a second line says where the files go ("The files also join the files of the project." in a project chat; "The
    files stay in this chat." in a direct or group chat). A paste of a picture into the box adds it. Pasted text stays text.
    The files join the picked chips, and nothing sends until Send. Each chip shows a thin grey progress bar while it
    uploads; Send waits for the uploads. The limits stay (10 files, safe types, the store limit). A closed chat refuses a
    drop. This is fbk_030.
15. **Picture previews.** Done: merged on main at `f990f13f` (branch `rb/chat-preview`). It replaces the 2026-10-19 rule
    "a picture shows as a file chip". This batch only keeps it working with runs, the menu and reactions.
16. **Search messages.** The main Search screen gets a "Messages" group, last after Files. A hit shows the chat picture, the
    chat name (project, task with its key, group, or person), "Person: line" with the matched word marked in grey, and the
    date. A press opens the chat at that message (item 17). It finds what the person may open today, and no more:
    - the messages of the project chats the person may open (the team, the leader, the Admin);
    - the person's own direct and group chats (a late group member finds only what they may read);
    - the comments of every task the person may read, with the quiet reason lines (a date reason is often the decision a
      person looks for). Every active person reads the comments of every project task today, so they find them too; office
      task comments only for their people.
    - Not in this batch: the comments on project posts. Arabic matches across letter forms (أ إ آ ا, ة ه, ى ي, no tashkeel or tatweel), and
    the mark covers the whole word so the letters stay joined. Chat files stay out of search. The agent's `search.query`
    finds the same messages and comments as its person (agents read chats since 2026-10-18, fbk_011); chat files stay closed
    to agents.
17. **Open a chat at one message.** A bell notice "X mentioned you", a search hit and a reply strip open the chat with that
    message in the middle and a soft frame for one second, also when the message is older than the first page. A person who
    may not open the chat gets `not_found`. Today a direct or project chat answers `forbidden`, so an outsider learns that the
    id exists: this changes to `not_found`, as groups do. *My call: a task comment (a notice, a search hit, a reply strip)
    opens in the Inbox task thread at that comment, with its "Open task" button. Today a task mention notice opens the task
    panel on its Details tab. A notice of a chat message or a comment stores which message it points to.*
18. **Shortcuts.** The person sheet gets a "Message" button that opens the direct chat. The project page header gets a
    "Project chat" button for the people who may open it. Both are grey secondary buttons with the message icon (not navy).
    The person sheet opens only where it opens today (Search). The meeting view does not change.
    First fix: today "New message", then a person, makes an empty direct chat that shows at once in the other person's
    Inbox. A direct chat with no message shows only for the person who opened it.

### D. Notifications and attention

19. **Push rules.** The push stays one fixed line with no data (2026-10-08). Who gets a push for a new message:
    - D and G: the members, as today.
    - P: only the people the message names. This replaces "every message pushes every reader" (2026-10-08).
    - T: the task lead and, on an office task, its maker, for a comment from another person; anyone else only when named.
      Today a plain task comment pushes nobody (`TASKS.md` line 397).
    - Never the author, never the person an agent writes for, never for a reaction, a delete or a quiet line. An edit pushes
      only a person it names for the first time (item 11).
    - The "Notify me" choice of item 21 changes the list for that person and that chat.
    - *My call: the push follows these chat rules only. The "mention" switch in Settings keeps its job for the bell notice and
      the mention email, and does not stop the push of a chat that names you.*
20. **No push for a chat you read.** The server waits about 10 seconds after a new message and then skips each person who
    already read that chat or task thread (on any device). Item 5 makes "read" mean "looked at it". A push therefore comes
    about 10 seconds later than today. This is fbk_028 part 1.
    - One path: the push for a chat message or a task comment, and the push of its mention or reply notice, go through this
      one wait and check. A person gets at most one push for one message. The bell notice itself shows at once.
    - *My call: the mention email of a chat message or a task comment takes the same wait and the same skip.*
    - *My call: when a person reads a chat or a task thread, its mention and reply notices in the bell become read too.*
21. **"Notify me" for each chat.** In the chat header "..." menu, under Archive: a heading "Notify me" and two choices, "All
    messages" and "Only when I am named", with the line "The unread count still shows every message." A project chat starts
    at "Only when I am named"; a direct chat and a group start at "All messages". The choice belongs to the person and the
    chat. P D G (not T).
22. **"Waits for your reply".**
    - D: the newest message is from the other person, as today.
    - G: only when a newer message names you, like a project chat. This changes the UX audit rule INT-26 (2026-10-19).
    - P: as today (a newer message names you).
    - T: as today.
    - In every kind: your 👍 or ✅ on the message that waits counts as an answer. The message that waits is the newest
      message from the other person (D) or the newest message that names you (G, P, T). *My call: task threads too, since
      they now have reactions.* This is fbk_028 part 2.
23. **The Admin's count.** An Admin's Inbox count and push cover the project chats of the projects that the Admin leads or
    works on, plus every message that names the Admin. The other project chats stay in the list and open as now, with no
    count and no push. *My call: an Admin who picks "All messages" on such a chat gets its count and its push back.*
    Today every project chat counts and pushes for every Admin (`TASKS.md` line 405).
    - "Leads or works on" means the project leader or a member of the project team (the same people who open a project
      chat). A task lead outside the team does not count.
    - In the other project chats, the row count and the badge count only the unread messages that name the Admin.
    - In the Admin's own project chats, the push follows the rule for everyone (item 19 and item 21).

Unread counts: a chat counts every unread message for every person who may open it, whatever their "Notify me" choice,
except the Admin's other project chats (item 23). Reactions, edits and quiet lines never count.

## New words (proposed by the mockup; the builder may adjust them to the STE and Thmanyah rules)

| Key | English | Arabic |
| --- | --- | --- |
| `chat.newLine` | New | جديد |
| `chat.newest` | Go to the newest message | انتقل إلى أحدث رسالة |
| `chat.messageActions` | Actions for this message | إجراءات هذه الرسالة |
| `chat.reply` | Reply | رد |
| `chat.replyTo` | Reply to {{name}} | رد على {{name}} |
| `chat.cancelReply` | Cancel the reply | ألغِ الرد |
| `chat.deletedMessage` | Deleted message | رسالة محذوفة |
| `chat.namesYou` | This message names you. | هذه الرسالة تذكرك. |
| `chat.notSent` | Not sent | لم تُرسَل |
| `chat.sendAgain` | Send again | أرسلها مجددًا |
| `chat.yourMessage` | Your message | رسالتك |
| `chat.uploading` | Uploading {{name}}: {{percent}}% | يُرفع {{name}}: {{percent}}% |
| `chat.dropToAttach` | Drop to attach | أفلت الملفات لإرفاقها |
| `chat.dropProject` | The files also join the files of the project. | تنضم الملفات أيضًا إلى ملفات المشروع. |
| `chat.dropChat` | The files stay in this chat. | تبقى الملفات في هذه المحادثة. |
| `chat.notify` | Notify me | نبّهني |
| `chat.notifyAll` | All messages | كل الرسائل |
| `chat.notifyNamed` | Only when I am named | فقط عندما يذكرني أحد |
| `chat.notifyNote` | The unread count still shows every message. | يظل عدد غير المقروءة يحسب كل رسالة. |
| `chat.copyText` | Copy text | انسخ النص |
| `notices.repliedToYou` | {{name}} replied to you in {{chat}} | ردّ {{name}} عليك في {{chat}} |
| `person.message` | Message | أرسل رسالة |
| `project.chat` | Project chat | محادثة المشروع |
| `search.messages` | Messages | الرسائل |

## Constraints

- Free plans only. No new vendor, no paid plan. Supabase Realtime, Postgres and Storage stay; push stays free Web Push.
- Every write goes through `runCall`. Handlers stay synchronous and pure. Every shared call works in the prototype fake and
  on the server. Contract changes are additive.
- The new-call checklist of `src/api/CLAUDE.md` for each new call. A new stored field gets its migration, `tables.ts` line,
  and a `STATE_VERSION` step. A module with its own SQL gets its `_LITE` twin. Keep `test:lite` and `test:office` green
  (the paused Supabase exit).
- MCP in the same commit as each change (`server/mcp/tools.ts`, `TOOL_DOCS`, `INSTRUCTIONS`):
  - `chats.send` and `comments.create` take an optional reply link; `chats.messages` and `comments.list` show the reply
    link, the reactions, `editedAt` and a deleted mark; `chats.messages` takes the "open at one message" input.
  - The new calls for message edit, message delete and "Notify me" go on the deny list, like `comments.update`,
    `comments.delete` and `reactions.toggle` today.
  - `search.query` finds messages and comments for agents as for their person (item 16).
  - The `TOOL_DOCS` of `chats.waiting` and `chats.list` say the new "waits" rule and what "unread" means for an Admin.
- Search reads must stay cheap on the free database: an index for the search, a small number of hits for each group, and no
  scan of every message for each key press. The planner picks the method (for example a folded text column with a trigram
  or full-text index). *My call: while the Supabase exit is paused, the SQLite office path may scan, with its rows pins
  raised and the reason in `proof.md`. The plan adds an item to `exit-handoff.md`: give the office path a search index
  (for example FTS5) at the restart.*
- The new count rules (items 19, 21, 23) change what the paused Track R (a stored unread number) must count. Write them in
  `docs/superpowers/real-build/exit-handoff.md` so the restart counts the same way.
- Leak tests from each builder: an outsider on every read path (`chats.list`, `chats.messages`, `chats.waiting`,
  `chats.unreadCount`, `comments.list`, notices, `files.link`, `search.query`, MCP), the error texts, and the Realtime
  signals. New private kinds (reactions on messages, edits, deletes, "Notify me") keep the nameless office signal (INT-16).
  A reply link may never point into another chat. Office task threads keep their person-only rule.
- Two languages: every visible word in English (STE, no em-dash) and Arabic (Thmanyah style). Screenshots in English and
  Arabic, light and dark, at 390 px and on a computer, for every screen change.
- Calm design rules of `DESIGN.md` and `src/CLAUDE.md`: one main button, navy only in its four places, no face stacks, red
  only for Late and errors, 44 px press areas, nothing under 12 px, tokens only, logical sides only.
- What's new: one line for each group of changes (read, write, files, search, notifications), English and Arabic, before the
  deploy.
- Team week: no production change before Friday 2026-10-23. The test copy is fine. Production goes out only by the owner.

## Build method (owner, 2026-10-19)

- Opus 5.5 writes the plan from this design with `superpowers:writing-plans`. The plan splits the work into tracks with few
  shared files, and orders the tracks that touch `Thread.tsx`, `ConversationPane.tsx` and `CommentThread.tsx`.
- Sonnet 5.5 builders implement the plan, tests first, one builder for each track in its own worktree under
  `~/dev/madar-rb/`. Each builder writes its report to a file before it returns.
- The Opus merge lead joins the tracks, runs the merge gate once (typecheck, `npm test`, builds, `test:db`, `test:it`,
  `test:mcp`, prototype smoke), takes the screenshots, and deploys to the test copy. No separate checker agent (owner rule
  of 2026-10-07).

## Left to the builder

- The names and shapes of the new calls and fields, and where the reply link, the reactions of a message, the delete mark
  and the "Notify me" choice are stored (for example a column on `messages` and on `chat_reads`).
- How Undo of a message delete works (messages write no History event today), as long as the toast Undo brings the message
  back for everyone.
- How "open at one message" loads an older page, and where the "New" line goes when the first unread message is older than
  the first page.
- How the 10-second wait of item 20 runs (the outbox and the 15-minute job are there today).
- How the faded message of item 13 and the saved message meet, and the order of the signal and the answer.
- The exact search method and index, within the read limit above.
- Small word changes that keep the meaning.

## Not in this batch (proposed for later, not approved)

A name field in the person list of "New message"; offer the group that already has the same people; split a long meeting
summary into more than one message; the red badge in place of the navy unread count on a chat row; the 10 px comment
count on a task row; the raw direction marks in `GroupSheets.tsx` and `ReasonLine.tsx`; the word fixes of the chat map.
