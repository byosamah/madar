# Campfire and Madar chat: what to take

Campfire is the open-source chat of Basecamp. This page judges each Campfire idea for Madar, from the view of a 15-person office with many people with ADHD.
Each item says what Madar has today, the value, the ADHD fit, the size (S, M, L) and the advice. The owner picks by theme.

Totals: 40 items. 23 recommend, 3 maybe, 14 skip.

## Questions for the owner

### Q1. When you have a chat open and in front, should Madar still send a push for it? (fbk_028 part 1)

- A. The device hides the line while a Madar window is in front. Small work. Safari and the iPhone can cancel push for Madar.
- B. The server waits about 10 seconds and skips people who already read that chat, on any device. Medium work.
- C. Keep today: every message pushes.

**Advice:** B. It works on every browser and phone. It also keeps your phone quiet after you read on the laptop. It needs the small fix 'read only when in view' first.

### Q2. What should 'Waits for your reply' mean after you read a chat? (fbk_028 part 2)

- A. Keep the rule of 2026-10-19: the newest message from another person waits.
- B. A group waits only when it names you, like a project chat. A direct chat keeps the rule. A 👍 or ✅ on the last message counts as an answer.
- C. Add a 'No reply needed' tap on the row.
- D. Remove the words from chats. Keep them for task threads.

**Advice:** B. It follows Campfire's rule: a shared chat asks for you only when it names you. A reaction is the natural 'seen, OK'. It adds no new button.

### Q3. How much should a project chat push?

- A. Keep today: every message pushes the leader, the team and every Admin.
- B. Direct and group chats push every message. A project chat pushes only the people it names.
- C. B, plus one choice in each chat menu: 'All messages' or 'Only when I am named'.

**Advice:** C. Campfire's defaults cut most pings and keep the ones that matter. The menu choice lets a leader follow a busy project. The unread count still shows every message.

### Q4. Should the Admin's Inbox count every project chat?

- A. Keep today: every project chat counts and pushes for every Admin.
- B. Count and push only the chats of projects where the Admin leads or is on the team, plus any chat that names the Admin. The other project chats stay in the list with no count.
- C. Take the other project chats out of the Admin's Inbox. The Admin opens them from the project page.

**Advice:** B. The count can reach zero again, and nothing gets hidden. Option C needs the project page link first and hides chats from the list.

### Q5. Should a plain comment on a task send a push?

- A. No, as today. The task thread shows as unread in the Inbox.
- B. Yes, to the task lead and to the maker of an office task, when another person writes.
- C. Yes, to the lead, the helpers and the maker.

**Advice:** B. The lead is the one person who must answer. Helpers still get a push when a comment names them.

### Q6. Should the picture preview branch (rb/chat-preview) go in?

- A. Yes, after the team week. Pictures show as previews with a viewer, in chats and task comments.
- B. No. Keep file chips (the rule of 2026-10-19).

**Advice:** A. Site photos and sketches are daily work. The branch is built and tested. Its notes name you as the source, so this only confirms it.

### Q7. How should edit and delete of a chat message work?

- A. Like task comments: your own message, at any time, an 'edited' mark, and Undo after a delete.
- B. The same, but only within 15 minutes of the send.
- C. Edit only. No delete.

**Advice:** A. One rule for comments and messages is easier to learn. The 'edited' mark keeps it honest.

### Q8. Should message search include your own direct and group chats?

- A. Project chats and task threads only.
- B. Also your own direct and group chats, only for their members.

**Advice:** B. People remember 'Faisal told me in our chat'. The visibility rule for chats already exists, and leak tests cover it. Chat files stay out of search, as decided.

## Themes

### Read and catch up

| Feature | Madar today | Value | ADHD fit | Size | Advice |
| --- | --- | --- | --- | --- | --- |
| Keep my place, with a Newest button | partial | high | calmer | S | recommend |
| One face and name for messages in a row | partial | medium | calmer | S | recommend |
| A line at the first new message | missing | high | calmer | M | recommend |
| A message that names you stands out | missing | medium | calmer, without the wiggle | S | recommend |
| A chat counts as read only when you look at it | partial | high | calmer | S | recommend |
| One look for a task comment in both places | partial | medium | calmer | M | recommend |
| Older messages load as you scroll up | partial | low | neutral | S | skip |
| A message of only emoji shows big | missing | low | noisier | S | skip |

#### Keep my place, with a Newest button (recommend)

- **Campfire:** A new message scrolls into view only when you are near the bottom. If you scrolled up to read, you stay in place and a round down-arrow button shows above the box.
- **Madar today (partial):** Every new message scrolls the chat to the bottom, also while the person reads older messages (MessageLog in Thread.tsx). The branch rb/chat-preview keeps the bottom in view while a picture loads, but it still jumps on a new message.
- **Value:** high. **ADHD fit:** calmer: a jump in the middle of a read breaks focus and loses the place. **Size:** S.
- **Why:** It fixes a known fault with a small change. It makes no new rule. Every chat kind gets it at once.
- **In Madar:** In every chat pane (project, direct, group), the Inbox task thread and the task panel Conversation tab. When you read older messages and a new one comes, the screen stays still. A small round button with a down arrow shows above the box. A press takes you to the newest message. Your own sent message always takes you down. The button does not pulse.
- **Touches:** screens, i18n, What is new.
- **Risks:** The branch rb/chat-preview changes the same code, so merge one after the other. The button needs a screen-reader name in English and Arabic.
- **Asked by:** Known gap in the chat map (Thread.tsx lines 151 to 153). No team report.

#### One face and name for messages in a row (recommend)

- **Campfire:** Messages from one person within 5 minutes show one face and one name, and the bubbles sit close. A new day shows a date line.
- **Madar today (partial):** Madar has day labels (Today, Yesterday, a date). Every bubble repeats the face and the name.
- **Value:** medium. **ADHD fit:** calmer: less repeated noise, so the words stand out. **Size:** S.
- **Why:** It makes a busy chat shorter and easier to scan. It changes only the look.
- **In Madar:** In all chat kinds and task threads. The first bubble of a run shows the face and the name. The next bubbles from the same person within 5 minutes show only the text and the time. A quiet line, a new day or another person starts a new run. An agent message starts its own run, with the Agent label and 'for <name>'.
- **Touches:** screens.
- **Risks:** The Agent label and 'for <name>' must stay visible. The right-to-left order must stay correct. The bubble corners must work in light and dark.
- **Asked by:** Known gap in the chat map. No team report.

#### A line at the first new message (recommend)

- **Campfire:** Campfire does not have this. It opens every room at the bottom on purpose.
- **Madar today (missing):** A chat opens at the bottom. Nothing shows where the new messages start.
- **Value:** high. **ADHD fit:** calmer: the person sees where to start, and does not miss the messages above the screen. **Size:** M.
- **Why:** After a day on site, a project chat can hold 20 new messages. Today the person lands on the last one and must guess where to start.
- **In Madar:** When you open a chat with unread messages, the chat opens at the first unread message, with a thin line 'New' above it. With no unread messages, the chat opens at the bottom, as now. The line goes when you send a message or leave the chat. In project, direct and group chats and in task threads.
- **Touches:** contract, handler, MCP, i18n, What is new, screens.
- **Risks:** chats.messages must give the read time from before the open, because the open marks the chat read. A new field in an output that agents read needs a TOOL_DOCS line. This item goes against the Campfire choice, on purpose.
- **Asked by:** Known gap in the chat map ('No unread line').

#### A message that names you stands out (recommend)

- **Campfire:** A message that mentions you gets a light red background and a small wiggle. Only you see it.
- **Madar today (missing):** A mention shows as a bold blue name only. The bubble looks like every other bubble.
- **Value:** medium. **ADHD fit:** calmer, without the wiggle: the eye finds what is for you in a busy chat. **Size:** S.
- **Why:** In a project chat of 6 people, the message for you is easy to lose. A soft mark helps, with no new control.
- **In Madar:** In project chats, groups and task threads. A message that names you gets a soft tint and a thin bar on its start side. It does not move. Only you see it. It uses no red, because Madar keeps red for Late and errors.
- **Touches:** screens.
- **Risks:** A new tint needs a token in tokens.css and a line in DESIGN.md. It must pass the contrast check in light and dark.

#### A chat counts as read only when you look at it (recommend)

- **Campfire:** You count as present in a room only while its tab is open and in view. A tab hidden for more than 5 seconds counts as away, so new messages stay unread and can push.
- **Madar today (partial):** An open chat marks each new message read at once, also when the tab is hidden or the laptop is locked (ConversationPane.tsx). A person with Madar open in a back tab can miss a message, because the Inbox count never shows it.
- **Value:** high. **ADHD fit:** calmer: nothing gets lost behind another tab. **Size:** S.
- **Why:** It closes a quiet hole where messages vanish as read. It is also the base for the best fix of fbk_028 part 1.
- **In Madar:** In every chat kind and in task threads (Inbox and task panel). A message that comes while the tab is hidden stays unread. When the tab comes back into view, the chat marks it read. Read marks still follow you across your devices, as now.
- **Touches:** screens.
- **Risks:** Small. The tests of the read mark must cover a hidden tab.
- **Asked by:** Supports fbk_028 part 1 (Faisal Al Howshani, 2026-10-19).

#### One look for a task comment in both places (recommend)

- **Campfire:** Campfire shows a message the same way everywhere, with the same small menu.
- **Madar today (partial):** In the task panel a comment has reactions and an Edit or Delete menu for its author. In the Inbox task thread the same comment has none of these.
- **Value:** medium. **ADHD fit:** calmer: one look and one way to act, wherever the person meets the comment. **Size:** M.
- **Why:** Two looks for one comment confuse people. The person must remember where each action lives.
- **In Madar:** The Inbox task thread gets the same reactions and the same author menu as the task panel. The rules stay: a date reason never goes, and a Madar shift line never changes.
- **Touches:** screens, i18n, What is new.
- **Risks:** Two parts of the code draw comments today (CommentThread and Thread). The reason lines keep their own rules. No MCP change: comments.update, comments.delete and reactions.toggle stay on the deny list.
- **Asked by:** Known gap in the chat map.

#### Older messages load as you scroll up (skip)

- **Campfire:** Pages of 40 messages load by themselves when you reach the top or the bottom. The screen keeps your place.
- **Madar today (partial):** A chat loads 200 messages and shows an 'Earlier messages' button at the top. The Inbox task thread loads every comment at once.
- **Value:** low. **ADHD fit:** neutral: the button is clear, and 200 messages is a lot. **Size:** S.
- **Why:** The button works and is clear. A page of 200 holds weeks of talk for this office.
- **In Madar:** No change. The Inbox task thread can load by pages later, for speed.
- **Risks:** None.

#### A message of only emoji shows big (skip)

- **Campfire:** A message with only emoji has no bubble and shows the emoji at 2.4 times the size.
- **Madar today (missing):** Emoji show at text size inside a bubble.
- **Value:** low. **ADHD fit:** noisier: big pictures pull the eye away from work messages. **Size:** S.
- **Why:** It adds play, not clarity. It does not fit the calm design.
- **In Madar:** No change.
- **Risks:** None.

### Write and reply

| Feature | Madar today | Value | ADHD fit | Size | Advice |
| --- | --- | --- | --- | --- | --- |
| One small menu on each message | partial | medium | neutral | M | recommend |
| Reply to one message | missing | high | calmer | M | recommend |
| Edit or delete your own chat message | partial | high | calmer | M | recommend |
| Quick reactions on chat messages | partial | high | calmer | M | recommend |
| Your message shows at once | partial | medium | calmer | M | maybe |
| Keep a half-written message after the tab closes | partial | medium | calmer | S | recommend |
| On a phone, Enter makes a new line | partial | low | calmer | S | recommend |
| Bold, lists and a text toolbar | missing | low | noisier | M | skip |

#### One small menu on each message (recommend)

- **Campfire:** A '...' button shows next to a message on hover. It opens a small menu with quick emoji, Reply, Copy link and Edit.
- **Madar today (partial):** Task panel comments have an Edit or Delete menu for the author. Chat bubbles have no menu.
- **Value:** medium. **ADHD fit:** neutral: it adds one control, but the control hides until needed. **Size:** M.
- **Why:** Reply, reactions, edit and delete need one home. One menu keeps the bubble clean.
- **In Madar:** On a computer, '...' shows on hover or keyboard focus beside the bubble. On a phone, a long press opens the same choices in a bottom sheet. The menu shows only the actions that the person may take. It is the same in every chat kind and in task threads.
- **Touches:** screens, i18n.
- **Risks:** A long press can clash with text selection on a phone. The menu must work with the keyboard and in right-to-left.

#### Reply to one message (recommend)

- **Campfire:** Reply puts the old message in the box as a quote, with the author name and a link back. The reply is a normal new message in the same chat. Campfire has no threads.
- **Madar today (missing):** A message has no reply or quote field.
- **Value:** high. **ADHD fit:** calmer: everyone sees which question the answer is for, with no side threads. **Size:** M.
- **Why:** In a busy project chat, 'yes' can answer three questions. A reply link removes the guess.
- **In Madar:** In the message menu, 'Reply'. The box shows a small grey strip with the name and the first line of the message, and an X to cancel. The sent message shows the strip above its text. A press on the strip takes you to the old message. In project, direct and group chats. Task threads can follow later.
- **Touches:** contract, handler, server, MCP, i18n, What is new, screens.
- **Risks:** Store a link to the old message, not a copy of its text, so an edit or a delete shows correctly. chats.send gets an optional field, so MCP needs a TOOL_DOCS line. The old message must be in the same chat. Check whether the messages table needs a new column.

#### Edit or delete your own chat message (recommend)

- **Campfire:** The author edits a message in place at any time, with no 'edited' mark. Delete asks first and leaves no trace. The Up key in an empty box edits your last message.
- **Madar today (partial):** Task comments can be edited and deleted by their author, with Undo on delete. Chat messages have no edit or delete call. Message.editedAt exists, but nothing sets it.
- **Value:** high. **ADHD fit:** calmer: a typo or a wrong person gets a fix without a second message. **Size:** M.
- **Why:** People send mistakes. Today the only fix is a new message, which adds noise and a push.
- **In Madar:** In the message menu, 'Edit' and 'Delete', for your own messages only. An edited message shows 'edited', as comments do today. Delete shows a toast with Undo. An edit sends no push. On a computer, the Up key in an empty box opens your last message for edit. In direct, group and project chats.
- **Touches:** contract, handler, server, realtime, MCP, i18n, What is new, screens.
- **Risks:** Two new calls need the full new-call checklist and the MCP deny list. A deleted message with a mention must clear its notice. 'Waits for your reply' must count again. A chat file in a deleted message stays, because Madar never deletes chat files.

#### Quick reactions on chat messages (recommend)

- **Campfire:** 8 fixed emoji and short free text (boosts), each shown with the face of the person. Campfire does not count them.
- **Madar today (partial):** 👍 ✅ 👀 exist on task comments and posts. Chat messages and the Inbox task thread have none.
- **Value:** high. **ADHD fit:** calmer: 'seen' or 'done' takes one tap, and it makes no new message and no push. **Size:** M.
- **Why:** Many messages today are 'ok' or 'thanks'. Each one is a push for everyone. A reaction says the same with no noise.
- **In Madar:** In the message menu, the same three: 👍 ✅ 👀. Under the bubble, small pills with the emoji and a count. A press on a pill shows the names. A reaction makes no push and no unread mark. In project, direct and group chats, and in the Inbox task thread.
- **Touches:** contract, handler, server, realtime, MCP, i18n, What is new, screens.
- **Risks:** reactions.toggle must accept a chat message (an additive change). The signal of a reaction in a private chat must name nobody (INT-16). Leak tests for groups and late members. Faces under each pill would break the rule 'no avatar stacks', so the pills show counts.
- **Asked by:** Can answer fbk_028 part 2, if a reaction counts as a reply.

#### Your message shows at once (maybe)

- **Campfire:** The message shows before the server answers. If it fails, it turns faded, with a red dashed edge and a 'no entry' sign. Offline, the box greys out.
- **Madar today (partial):** The box waits for the server. A failed send shows a toast with Retry and the same key, so no double. A banner shows a lost connection, and the lists load again after it.
- **Value:** medium. **ADHD fit:** calmer: the failure stays on the message, not in a toast that goes away. **Size:** M.
- **Why:** On a weak site connection, people feel the wait. But Madar already stops doubles, and one trip to the server is short on a good line.
- **In Madar:** In all chats. Your message shows at once, a little faded until the server saves it. If it fails, the bubble shows 'Not sent' and a Retry button.
- **Touches:** screens, i18n.
- **Risks:** Two copies can show if the live signal comes before the answer. The tests must cover the order.

#### Keep a half-written message after the tab closes (recommend)

- **Campfire:** Each room keeps its draft in the browser. It comes back after a restart.
- **Madar today (partial):** The text draft lives in session storage, so it goes when the tab closes. Picked files live in memory and go at a reload.
- **Value:** medium. **ADHD fit:** calmer: an interrupted thought is still there when the person comes back. **Size:** S.
- **Why:** People with ADHD often switch away. The loss of a long message hurts.
- **In Madar:** In every chat and task thread. The text draft stays on this device after the tab or the browser closes. Sign out clears every draft. Files still need a new pick, because a browser cannot keep them.
- **Touches:** screens.
- **Risks:** A shared computer: clear the drafts at sign out. Drop drafts older than 30 days.

#### On a phone, Enter makes a new line (recommend)

- **Campfire:** On a touch device, Enter never sends; the arrow button sends. Enter also waits while the mention list is open or an input method writes.
- **Madar today (partial):** Enter sends on every device. Shift+Enter makes a new line. Madar already waits for the mention list and for an input method.
- **Value:** low. **ADHD fit:** calmer: fewer half-sent messages from a phone. **Size:** S.
- **Why:** A phone keyboard has no easy Shift+Enter, so today a person cannot write two lines on a phone. WhatsApp works the same way as Campfire.
- **In Madar:** On a phone or a tablet, Enter makes a new line and the Send button sends. On a computer nothing changes.
- **Touches:** screens.
- **Risks:** A tablet with a keyboard: decide by the pointer type, not by the screen size.

#### Bold, lists and a text toolbar (skip)

- **Campfire:** Rich text with a toolbar that stays hidden behind a button. Phones get no toolbar.
- **Madar today (missing):** Plain text with line breaks, mentions and #project codes.
- **Value:** low. **ADHD fit:** noisier: more buttons and more styles to read. **Size:** M.
- **Why:** The office writes short work messages. Formatting adds controls and little value.
- **In Madar:** No change.
- **Risks:** None.

### Notifications and attention

| Feature | Madar today | Value | ADHD fit | Size | Advice |
| --- | --- | --- | --- | --- | --- |
| No push for a chat you have open and in view | missing | high | calmer | M | recommend |
| What 'Waits for your reply' means | have | high | noisier today | S | recommend |
| Choose how much one chat notifies you | missing | medium | calmer | M | maybe |
| A push for a plain comment on your task | missing | medium | neutral | S | recommend |
| The Admin's count and push for other projects | have | high | noisier today | S | recommend |
| A number on the Madar app icon | missing | low | noisier | S | skip |
| An install button for push | partial | low | neutral. | S | maybe |

#### No push for a chat you have open and in view (recommend)

- **Campfire:** Campfire sends no push and no bold mark for the room you look at. It knows that you look while the tab is open and in view.
- **Madar today (missing):** The service worker shows the fixed line for every push. The push carries no data, so the device cannot know which chat it is for.
- **Value:** high. **ADHD fit:** calmer: no ping for a message that the person reads at that moment. **Size:** M.
- **Why:** Faisal reported it. A ping for each reply in an open chat is pure noise.
- **In Madar:** When you have the chat open and in front, a reply makes no banner and no sound. When you read the chat on your laptop, your phone also stays quiet. Every other case keeps the one fixed line of 2026-10-08. In all chat kinds.
- **Touches:** push, server, screens, What is new.
- **Risks:** The server way waits about 10 seconds before each push. The device way is smaller, but Safari and the iPhone can cancel push for a site that shows nothing. See the owner question.
- **Asked by:** fbk_028 part 1, Faisal Al Howshani (Architect), 2026-10-19.

#### What 'Waits for your reply' means (recommend)

- **Campfire:** Campfire has no such words. Its rule: a shared room asks for you only when it names you, and a one-to-one chat asks for every message.
- **Madar today (have):** A read direct or group chat whose newest message is from another person shows 'Waits for your reply' (UX audit 2026-10-19, INT-26). In a group, any message from anyone marks it for every member. A project chat waits only on a mention.
- **Value:** high. **ADHD fit:** noisier today: the words stay on chats that need no answer, so they lose meaning. **Size:** S.
- **Why:** A label that is often wrong teaches people to ignore it. Faisal reads it as a fault after he saw the message.
- **In Madar:** On the Inbox rows, and in chats.waiting for agents. Proposed: a group waits only when it names you, like a project chat. A direct chat keeps the rule. A 👍 or ✅ on the last message counts as an answer. No change in task threads.
- **Touches:** handler, MCP, What is new.
- **Risks:** The reaction part needs reactions on chat messages first. The TOOL_DOCS of chats.waiting must change in the same commit. Ask Faisal if the words, not only the rule, were the problem.
- **Asked by:** fbk_028 part 2, Faisal Al Howshani (Architect), 2026-10-19.

#### Choose how much one chat notifies you (maybe)

- **Campfire:** A bell in each room moves through 4 levels: all messages, only mentions, nothing, and hidden. Shared rooms start at 'only mentions'. One-to-one chats start at 'all messages'.
- **Madar today (missing):** One push switch for each device. A switch for each notice kind in Settings. No mute for one chat.
- **Value:** medium. **ADHD fit:** calmer: a busy project chat stops the pings, and the unread count still shows. **Size:** M.
- **Why:** It depends on the owner answer about project chat pushes. Two levels are enough, because Archive already hides a chat.
- **In Madar:** In the chat header menu, next to Archive: 'Notify me: All messages' or 'Only when I am named'. The unread count stays. In project, direct and group chats.
- **Touches:** contract, handler, server, push, MCP, i18n, What is new, screens.
- **Risks:** The push SQL changes. The setting may need a new column in chat_reads. The paused Track R must respect it. The new call goes on the MCP deny list. It is a new control, so it stays inside the menu.
- **Asked by:** Known gap ('No mute for one chat').

#### A push for a plain comment on your task (recommend)

- **Campfire:** A one-to-one chat pushes every message. A shared room pushes only a mention.
- **Madar today (missing):** A plain task comment makes no notice and no push. It shows only as an unread task thread in the Inbox.
- **Value:** medium. **ADHD fit:** neutral: one more push, but only for your own task. **Size:** S.
- **Why:** A lead can miss a question on their own task for hours. The lead is the one person who must answer.
- **In Madar:** A plain comment from another person pushes the task lead, and the maker of an office task. Other people get a push only when the comment names them. A quiet reason line never pushes.
- **Touches:** push, server, What is new.
- **Risks:** More pushes for busy leads. Office task privacy must hold in the push list.
- **Asked by:** TASKS.md line 397, open owner question since 2026-10-08.

#### The Admin's count and push for other projects (recommend)

- **Campfire:** Campfire asks for attention only when it is earned. A hidden room leaves the list and the count.
- **Madar today (have):** Every Admin gets a push for every project chat message, and every project chat counts as unread for the Admin. The count may never reach zero.
- **Value:** high. **ADHD fit:** noisier today: a count that never reaches zero stops meaning anything. **Size:** S.
- **Why:** The owner is the Admin. His Inbox count should mean 'something waits for me'.
- **In Madar:** Proposed: the Admin's count and push include only the project chats where the Admin leads or is on the team, plus any chat that names the Admin. The other project chats stay in the list and open as now, with no count.
- **Touches:** server, push, handler, MCP, What is new.
- **Risks:** The Admin can miss a problem in a project that he does not follow. The unread loader and the paused Track R must agree. The TOOL_DOCS of chats.list must say what 'unread' means for the Admin.
- **Asked by:** TASKS.md line 405, open owner question since 2026-10-08.

#### A number on the Madar app icon (skip)

- **Campfire:** The installed app icon shows the number of unread rooms. A push also sets it.
- **Madar today (missing):** The unread count shows only inside Madar (the Inbox badge).
- **Value:** low. **ADHD fit:** noisier: a number on the home screen pulls the person back all day. **Size:** S.
- **Why:** Madar keeps one unread count inside the app. A count outside the app is a new pull on attention.
- **In Madar:** No change.
- **Risks:** None.

#### An install button for push (maybe)

- **Campfire:** The bell pulses once to ask for a tap. When notifications are blocked, a dialog shows steps for your exact browser and system. An 'Install now' button shows where the browser allows it.
- **Madar today (partial):** Madar has one Allow card on Home, a 'blocked' text in Settings and an iPhone line ('add Madar to the Home Screen first'). Sign out already removes the push of that device. Madar has no install button.
- **Value:** low. **ADHD fit:** neutral. **Size:** S.
- **Why:** Madar covers the main cases. An install button helps Android and computer users, but it is one more control.
- **In Madar:** In Settings, under 'Notify me on this device': an 'Install Madar' button, only where the browser offers an install.
- **Touches:** screens, i18n, What is new.
- **Risks:** The install offer differs by browser. Wait for the owner's real-device push test first.
- **Asked by:** The owner's real-device push test (TASKS.md lines 393 and 401).

### Files, pictures and links

| Feature | Madar today | Value | ADHD fit | Size | Advice |
| --- | --- | --- | --- | --- | --- |
| Drop or paste files into a chat | partial | high | neutral | S | recommend |
| Pictures show in the chat, with a viewer | partial | high | calmer | S | recommend |
| A progress bar for each file | partial | medium | calmer | S | recommend |
| Web addresses become links | missing | high | calmer | S | recommend |
| A preview card for a link | missing | low | noisier | M | skip |
| The phone's own share sheet for a file | missing | low | neutral. | S | skip |

#### Drop or paste files into a chat (recommend)

- **Campfire:** The paperclip picks many files. A paste of files adds them. A drop anywhere in the room adds them. They wait as cards above the box until Send.
- **Madar today (partial):** The attach button is the only way. The project Files tab already takes a drop (FilesTab.tsx).
- **Value:** high. **ADHD fit:** neutral: no new button; the hands do what they expect. **Size:** S.
- **Why:** The owner asked for it. Architects drag drawings and screenshots all day.
- **In Madar:** Drop files anywhere on an open chat (project, direct, group) or on a task thread. A soft frame says 'Drop to attach'. A paste of a screenshot into the box adds it. The files join the picked chips. Nothing sends until Send. The same limits apply (10 files, safe types, the store limit).
- **Touches:** screens, i18n, What is new.
- **Risks:** A closed chat must refuse a drop. A project chat file goes to the project Files tab, as with the button. Pasted text must stay text.
- **Asked by:** fbk_030, Osama Khalil (owner), 2026-10-19.

#### Pictures show in the chat, with a viewer (recommend)

- **Campfire:** A picture shows as a preview. A press opens it full screen with Close, Share and Download. A video shows a player.
- **Madar today (partial):** On main, a picture is a file chip. The branch rb/chat-preview (not merged, 5 commits) shows pictures up to 240 px from a small copy, and opens a viewer with Download and arrow keys.
- **Value:** high. **ADHD fit:** calmer: a picture is faster to read than a file name, and the viewer hides the page behind it. **Size:** S.
- **Why:** Site photos and sketches are the daily talk of the office. The work is already built and tested on the branch.
- **In Madar:** In project, direct and group chats and in task comments. A picture shows as a small rounded preview. Two or more sit in a grid. A press opens the viewer. Other files stay chips. A video stays a chip for now.
- **Touches:** screens, i18n, What is new.
- **Risks:** It reverses the 2026-10-19 rule 'no preview picture'. The branch notes say 'owner, 2026-10-19', so confirm. Merge it before or after the scroll fix, not together.
- **Asked by:** Branch rb/chat-preview, 2026-10-19.

#### A progress bar for each file (recommend)

- **Campfire:** Each file shows at once as its own message, with a percent and a bar. Files upload one after another.
- **Madar today (partial):** Picked files show as chips. The attach code shows no percent and no bar.
- **Value:** medium. **ADHD fit:** calmer: the person sees that the work goes on, and does not press Send twice. **Size:** S.
- **Why:** Drawings and site photos are large. On a phone line, a silent wait looks like a fault.
- **In Madar:** On each picked chip, a thin bar fills while the file uploads. In every chat and task thread.
- **Touches:** screens.
- **Risks:** The upload code must report progress to the screen. Keep one message for text and files, as now.

#### Web addresses become links (recommend)

- **Campfire:** Campfire turns web and email addresses into links. Outside links open in a new tab. Campfire links open in the same tab.
- **Madar today (missing):** Addresses show as plain text (RichText.tsx). Only #project codes are links.
- **Value:** high. **ADHD fit:** calmer: one press, no copy and paste. **Size:** S.
- **Why:** People share Google Maps pins, Drive folders and Balady links. Today they must copy them by hand.
- **In Madar:** In every chat, task comment and post. An address that starts with http or https becomes a link. It opens in a new tab. A Madar address opens in the same tab.
- **Touches:** screens.
- **Risks:** Allow only http and https. A long address must wrap. A link inside Arabic text must keep its own direction.
- **Asked by:** Known gap ('URLs in messages show as plain text').

#### A preview card for a link (skip)

- **Campfire:** The server reads the page and adds a card with a title, a short text and a picture.
- **Madar today (missing):** No cards.
- **Value:** low. **ADHD fit:** noisier: big cards push the words apart. **Size:** M.
- **Why:** The server must fetch outside pages, which is a safety risk. The cards add noise for little gain.
- **In Madar:** No change. A small card for a Madar project or task link can come later, with no outside fetch.
- **Risks:** None if skipped.

#### The phone's own share sheet for a file (skip)

- **Campfire:** A share button on files and in the picture viewer opens the share sheet of the device.
- **Madar today (missing):** Download exists. Madar's own Share puts a project file into a chat.
- **Value:** low. **ADHD fit:** neutral. **Size:** S.
- **Why:** Download already covers it. A share button makes it too easy to send office files out of Madar.
- **In Madar:** No change.
- **Risks:** None.

### Find and open

| Feature | Madar today | Value | ADHD fit | Size | Advice |
| --- | --- | --- | --- | --- | --- |
| Search messages and comments | partial | high | neutral | L | recommend |
| Open a chat at one message | missing | medium | calmer | M | recommend |
| Start a chat from a person or a project | missing | medium | calmer | S | recommend |
| Recent searches | missing | low | noisier | S | skip |
| Back to the chat you used last | partial | low | neutral. | S | skip |

#### Search messages and comments (recommend)

- **Campfire:** A search finds words in every room you are in, also other forms of a word. It shows the newest 100 hits. A press opens the message in its chat.
- **Madar today (partial):** The Inbox filters by chat title, Arabic name and project name. The main Search finds no message and no comment.
- **Value:** high. **ADHD fit:** neutral: a person finds 'the drawing Faisal sent' with no long scroll. **Size:** L.
- **Why:** Decisions live in chats. Without search, people lose them after a week.
- **In Madar:** The main Search screen gets a 'Messages' group. Each hit shows the chat name, the person, the line and the date. A press opens the chat at that message. It covers project chats and task threads, and your own direct and group chats if the owner agrees.
- **Touches:** contract, handler, server, migration, MCP, i18n, What is new, screens.
- **Risks:** Leaks are the big risk: office tasks, groups, late members and the Admin who is not a member. Every read path needs leak tests. Arabic needs a match across letter forms (أ إ آ ا, ة ه). Chat files stay out of search.
- **Asked by:** Known gap ('Search finds no message or comment').

#### Open a chat at one message (recommend)

- **Campfire:** Each message has its own address. It opens the chat with that message in the middle, in a dark frame that fades after one second.
- **Madar today (missing):** A mention notice opens the chat at the bottom.
- **Value:** medium. **ADHD fit:** calmer: the person lands on the right message. **Size:** M.
- **Why:** Search hits, notices and replies all need to land on one message.
- **In Madar:** A bell notice 'X mentioned you' opens the chat with that message in the middle and a soft frame for one second. Search hits and reply strips use the same way. No 'Copy link' button for now.
- **Touches:** contract, handler, MCP, screens.
- **Risks:** The message can be older than the loaded page. A person with no right to the chat must get not_found; today a direct or project chat answers forbidden.

#### Start a chat from a person or a project (recommend)

- **Campfire:** A press on any face or name opens the person page with one big message button.
- **Madar today (missing):** The Search person sheet has no Message button. The project page has no link to its project chat. A direct chat starts only from the Inbox.
- **Value:** medium. **ADHD fit:** calmer: the next step sits where the person already is. **Size:** S.
- **Why:** Fewer steps to the right chat. The calls already exist.
- **In Madar:** The person sheet gets 'Message', which opens the direct chat. The project page gets 'Project chat', for the people who may open it. Both are plain buttons, not navy.
- **Touches:** screens, i18n, What is new.
- **Risks:** Fix first the empty direct chat that shows in the other person's Inbox before any message.
- **Asked by:** Known gap in the chat map.

#### Recent searches (skip)

- **Campfire:** Your last 10 searches show as chips. A press runs one again.
- **Madar today (missing):** No search history.
- **Value:** low. **ADHD fit:** noisier: a row of chips. **Size:** S.
- **Why:** Madar does not use chip rows. The value is small.
- **In Madar:** No change.
- **Risks:** None.

#### Back to the chat you used last (skip)

- **Campfire:** The home address and every back arrow open the room you used last.
- **Madar today (partial):** A chat switch keeps the list. The Inbox opens on the list.
- **Value:** low. **ADHD fit:** neutral. **Size:** S.
- **Why:** The Inbox list is the overview that a person needs first.
- **In Madar:** No change.
- **Risks:** None.

### People and presence

| Feature | Madar today | Value | ADHD fit | Size | Advice |
| --- | --- | --- | --- | --- | --- |
| Show who types now | missing | low | noisier | M | skip |
| Who is online | missing | low | noisier, and it feels like a watch on people. | M | skip |
| One chat for the whole office | missing | low | noisier | M | skip |
| Rooms for chosen people | have | low | neutral. | S | skip |
| Sounds in the chat (/play) | missing | low | noisier | S | skip |
| Bots that post and answer in a chat | partial | low | neutral. | M | skip |

#### Show who types now (skip)

- **Campfire:** The names of people who type now show above the box, with a small spinner. Campfire stores nothing.
- **Madar today (missing):** Madar has no signal for this.
- **Value:** low. **ADHD fit:** noisier: text that moves near the box, and people wait for a reply that may not come. **Size:** M.
- **Why:** Most of the team sits in one office. The signal adds live traffic and leak risk for little gain.
- **In Madar:** No change.
- **Risks:** If it comes later, the signal must reach only the chat members and name nobody to others (INT-16).

#### Who is online (skip)

- **Campfire:** Campfire tracks presence but never shows it. It uses presence only for unread marks and pushes.
- **Madar today (missing):** Only 'Inactive' for a person who is turned off.
- **Value:** low. **ADHD fit:** noisier, and it feels like a watch on people. **Size:** M.
- **Why:** Campfire also leaves it out on purpose. Use presence only out of sight (see 'No push for a chat you have open').
- **In Madar:** No change.
- **Risks:** None.

#### One chat for the whole office (skip)

- **Campfire:** Open rooms include every person, also new people. The first room, 'All Talk', is open.
- **Madar today (missing):** Project chats, direct chats and groups. A group can hold everyone by hand, but new people do not join it.
- **Value:** low. **ADHD fit:** noisier: every message reaches 15 people. **Size:** M.
- **Why:** The owner decided 'no team mentions or chats' on 2026-10-01.
- **In Madar:** No change.
- **Risks:** None.

#### Rooms for chosen people (skip)

- **Campfire:** Closed rooms with a switch for each person. The maker manages the room and can delete it with all its messages. A setting lets only Admins make rooms.
- **Madar today (have):** Groups with a maker, a People sheet, quiet lines, Leave, and Remove with Undo.
- **Value:** low. **ADHD fit:** neutral. **Size:** S.
- **Why:** Madar's groups already do this, with more care. A delete of a room with all its messages removes data; a Madar group ends by Leave.
- **In Madar:** No change. See the polish ideas: type to find a person, and offer a group that already has the same people.
- **Risks:** None.

#### Sounds in the chat (/play) (skip)

- **Campfire:** Type '/play tada' and everyone in the room hears a sound.
- **Madar today (missing):** No sound in Madar.
- **Value:** low. **ADHD fit:** noisier: a sound breaks focus for everyone. **Size:** S.
- **Why:** It is play, not work.
- **In Madar:** No change.
- **Risks:** None.

#### Bots that post and answer in a chat (skip)

- **Campfire:** A bot is a member with a key. It posts through a web address, and it answers when someone names it.
- **Madar today (partial):** AI agents read and send through MCP as their person, with the Agent label and 'for <name>'.
- **Value:** low. **ADHD fit:** neutral. **Size:** M.
- **Why:** A Madar agent acts for one person, with that person's rights. A bot that answers by itself breaks that rule.
- **In Madar:** No change. Agents can use Reply and reactions later, if those come.
- **Risks:** None.

## Keep Madar's own

| Madar feature | Why it stays | Campfire ideas that improve it |
| --- | --- | --- |
| Task threads in the Inbox | Talk about a task stays next to the task, and the Inbox still shows it with an unread count. Campfire has nothing like it. | One look and one menu for a comment in the Inbox and the task panel. The unread line. Read only when the tab is in view. A notice that opens at the comment. |
| Quiet reason lines in task threads | A date move or a reopen shows as a fact, not as a person's message. It is never unread and never waits for a reply. | Keep the screen still when a line above changes (Campfire keeps the scroll place on edits). A quiet line ends a run of grouped bubbles. A quiet line gets no message menu. |
| Project chats tied to the team | Each project has one place to talk, open only to its team, its leader and the Admin. Its files join the project. | A 'Project chat' button on the project page. A notify level for each chat ('only when I am named'). The Newest button. Reply to one message. |
| Waits for your reply | It turns the Inbox into a short list of what needs an answer. It also helps agents. | Campfire's rule that attention is earned: a group waits only when it names you. A reaction on the last message counts as an answer. |
| Archive for each person | Each person cleans their own list. A new message brings the chat back. | Archive already does the job of Campfire's 'hidden' level, so a notify level needs only two choices. |
| Groups with a maker and quiet lines | Small groups with clear rules: anyone makes one, only the maker removes, anyone leaves. | Campfire puts the same people in the same Ping: offer the group that already has these people before a new one is made. A field to type a name in the person list. |
| AI agents that act for a person | Agents read and send with one person's rights, and both names show. This is safer than Campfire's bots. | If Reply and reactions come, agents can link a reply to the message they answer. Keep reactions off the agent list, like today. |
| Office task privacy in threads | An office task thread shows only to its maker, lead, helpers and the Admin. Everyone else gets not_found. | Campfire cuts the live stream at once for a person who loses access. Every new signal (reactions, edits) must follow the same person-only rule. |
| Private chat files | A file in a direct chat or a group opens only for its members. It shows in no search and no Files tab. | Picture previews and a viewer, drop and paste, and a progress bar. Keep out the share sheet. |
| Closed chats with inactive people | A chat with a person who left stays readable and takes no new message. | None needed. Madar's quiet closed line is calmer than Campfire's red shake. |
| Two languages done right | Names in the screen language, text on its own natural side, search by both names. | Campfire sets the text direction from the text, as Madar does. Message search must match Arabic letter forms. Links inside Arabic text must keep their own direction. |
| Nameless signals and an empty push | A private chat tells the office only that somebody wrote. The push carries one fixed line and no data. | Campfire's quiet presence: know out of sight who looks at a chat, only to skip a push. Never show it. |
| Share a project file into a chat or task | A project file goes into the right talk without a second upload. | A picture preview for a shared picture. No outside share sheet. |
| Meeting summary to project chats | The meeting result reaches each project team in its own chat. | None from Campfire. Send a long summary as more than one message, so no project stays out. |
| Calm chat design | One main button, one group picture, a hover-only row menu and one quiet Archived row. | Campfire's 'hidden until needed' message menu. One face for a run of messages. Keep Madar's words on buttons, because icons alone are not clear in two languages. |

## Polish with no owner choice

- Keep your place when a new message comes, and show a still 'Newest' arrow button with no pulse.
- Show one face and one name for messages in a row from one person within 5 minutes.
- Mark a chat read only while its tab is in view. A hidden tab leaves new messages unread until the person looks.
- Turn http and https addresses in messages, comments and posts into links.
- On a phone, make Enter add a new line. The Send button sends, as in WhatsApp.
- Keep the text draft after the tab closes. Clear all drafts at sign out.
- Show a thin progress bar on each file while it uploads.
- Give a soft tint to a message that names the reader, with no motion and no red.
- Show the full date and time when the pointer rests on the time of a message.
- Keep the screen still when a reaction or an edit changes a message above it (when reactions and edit come).
- Show a direct chat in the other person's Inbox only after its first message (Madar gap).
- Add a field to type a name in the person list of New message.
- Before a new group is made, offer the group that already has exactly these people.
- Send a long meeting summary as more than one message, so no project stays out (Madar gap).
- Use the red badge, not navy, for the unread count on a chat row, as DESIGN asks (Madar gap).
- Answer not_found, not forbidden, for a direct or project chat that a person may not open, as groups do (Madar gap).

## Conflicts with Madar rules

- Campfire pushes a shared room only on a mention. The owner decided on 2026-10-08 that every new chat message pushes to every reader.
- Campfire has a bell with 4 levels in each room. Madar has one push switch for each device and asks for the fewest controls.
- Campfire has an open room for everyone. The owner decided on 2026-10-01 (D6): no team mentions and no team chats.
- Campfire shows picture previews and a viewer. The 2026-10-19 rule says a picture shows as a file chip. The branch rb/chat-preview reverses that rule.
- Campfire edits leave no 'edited' mark, and a delete leaves no trace. Madar comments show 'edited', give Undo after a delete, and never delete a date reason.
- Campfire boosts show the face of each person and free text. Madar has no avatar stacks and a fixed set of three reactions.
- Campfire marks a mention in red with a wiggle, and its Newest button pulses. Madar keeps red for Late and errors, and uses no pulse for attention.
- Campfire puts the sender and the text in a push. Madar sends one fixed line with no data (2026-10-08).
- Campfire bots answer by themselves when someone names them. A Madar agent acts only for one person and sends only when that person asks.
- Campfire lets the maker delete a room with all its messages, and lets any member delete a Ping. Madar groups end by Leave, and a delete of data needs the owner.
- Campfire signals for typing and presence name a person. Madar sends nameless office signals for private chats (INT-16).
- Campfire shows recent searches as chips. Madar has no chip rows.
- 'Waits for your reply' on read chats came from the owner's UX audit (INT-26, 2026-10-19). Campfire's rule (ask only when earned) and Faisal's report fbk_028 question it.
- Team week: no production change from 2026-10-18 to 2026-10-22 unless the owner calls it a fix. Everything here ships from 2026-10-23.
- A notify level for each chat and a new Admin count change the unread rules. The paused Track R must then count the same way.

## Left out

- **About Campfire hosting or admin, not chat:** the join link, sign up, sign in, the sign-in link with a QR code, the first-run setup, the account name and logo, custom CSS, the people list with the admin crown, ban, the profile bio, the translation cards, page moves and old-browser pages, and the confirm circles.
- **Already in Madar, no change:** day labels, your own messages on the end side, clock times, @mentions with a ranked list, the chat header and the Inbox list, read marks across devices, the reload after a lost connection, push removal at sign out, the wait for an input method before Enter sends, dark mode and the phone layout.
