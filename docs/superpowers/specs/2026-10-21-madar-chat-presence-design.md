# Chat: who is here, Seen, typing and emoji

Owner decisions of 2026-10-21. Branch `rb/chat-presence` (from main `7f115515`), worktree `~/dev/madar-rb/chat-presence`.

## Why

The owner asked for four chat features "like Slack", "in the best way and accurate": a status for each person (Online, Away,
Offline), "Seen" on messages, a "typing..." line, and a list of emoji to put in messages. On 2026-10-19 the owner skipped
typing and online dots (`2026-10-19-madar-chat-campfire-design.md`, Non-goals). This request turns that back for these two.

The team works in one office and on site visits. A person wants to know three things before they wait for an answer: is
the other person here, did they see my message, are they answering now. Today the chat answers none of them.

The mockup page is `2026-10-21-madar-chat-presence-mockup.html` (next to this file). The owner said "go ahead" on it on
2026-10-21 with no panel clicks, so the mockup is the look to build, with dot look A. Where the mockup and this text differ,
this text wins. The mockup uses a system font; the real screens use Thmanyah Sans.

Lines marked *My call* are choices of the design writer, made from the owner's answers. The owner checks them when he reads
this document. A builder check (2026-10-21) asked four questions; the answers are in the text, each marked *My call*.

## Owner answers (2026-10-21)

1. Status: Madar sets it by itself, and a person can also set Away by hand.
2. Seen: a direct chat shows "Seen" under your last message; a group or project chat shows "Seen by N", and a tap shows the names.
3. Emoji list: the full standard list, a search in English and Arabic, the recent emoji first, loaded only when a person opens it.
4. Reactions: 👍 ✅ 👀 stay first, and a + button opens the full list. Only 👍 and ✅ count as an answer for "Waits for your reply".
5. The mockup: "go ahead". The guess on it holds: an Away set by hand stays on until the person turns it off.

## Goals

- A person sees at a glance who can answer now.
- A sender knows that the reader saw the message, without a question in the chat.
- A person sees that an answer comes, so they do not write a second message.
- A person adds an emoji in two clicks, and the usual ones in one.
- Every mark is true. A wrong "Online" or a wrong "Seen" is worse than no mark. Nobody can fake the mark of another person.

## Non-goals and anti-goals

- Not in this batch: "Last seen" times, a status text or a status emoji, Do Not Disturb, push rules that follow the status,
  big emoji for an emoji-only message, the `:name:` shortcut in the box, typing and Seen in task threads, dots outside the
  places listed in item A4, a change to the read mark or the unread counts.
- Anti-goals (a failure even when it works):
  - Watching people. No history of status, no report of online hours, no status for the Admin that others do not see.
  - A mark that lies. "Seen" for a person who did not look at the chat; "Online" for a phone in a pocket; a dot or a typing
    line that one person makes for another.
  - Noise. A dot that blinks, a typing line that jumps the messages, a face stack, red or navy for any of these marks.
  - A leak. A person outside a chat learns that someone types or reads in it.
  - A cost. Any paid plan, or a free limit that fills.

## What gets built

The kinds: P = project chat, D = direct chat, G = group chat. Task threads (T) get none of A to C, only the reactions of E.

### A. The status of a person

1. **Three states.** For each active person:
   - **Online**: at least one device has Madar open and in view, and the person used it (a key, a click, a touch, a scroll)
     in the last 10 minutes. This test is "active" in the rest of this document.
   - **Away**: Madar is open on at least one device, and no device is active; or Madar is open and the person set Away by hand.
   - **Offline**: no device has Madar open. A closed tab shows Offline at once. A device that loses the network shows
     Offline when the live connection of Realtime times out (*My call:* no extra "still here" signals, see Cost; the plan
     measures the time and reports it to the owner when it is more than 2 minutes).
   - A tab that goes out of view (another tab, a phone screen that locks) makes that device Away at once.
   - Agents, turned-off people and people who left the office have no status and no dot.
2. **Away by hand.** The person menu gets one switch: "Show me as Away". It holds on every device of the person and after a
   sign-out, until the person turns it off. While it is on, each open device of the person shows Away, whatever the use.
   With no device open, the person shows Offline (*My call:* every mark is true). The person's own face shows the Away mark
   and the menu line says "Away (set by you)". Others see only "Away", and never read the switch itself: it is a personal
   setting, stored on the server, read only by the person's own devices. Pushes, typing and Seen work as before.
3. **The look (dot look A, like Slack).** A green filled dot = Online. An empty ring in the Ink 2 color = Away. No dot =
   Offline. The dot sits on the end-bottom corner of the face, with a ring of the panel color. It never moves or blinks.
   Shape and color differ, so the state does not depend on color alone.
4. **Where the dot shows.** *My call:* the face of a D row in the chat list; the face in the D chat head, with the state in
   words under the name ("Online", "Away", "Offline"); the faces next to messages in P and G; the "Seen by" names list; the
   @ mention list; the person list of "New message". Nowhere else in this batch.
5. **Words for a screen reader.** The dot is hidden from a screen reader. The face's label says the state:
   "Reem Al-Ghamdi, Online".
6. **Own status.** The person's own face in the top bar and the person menu shows their own dot, so they can see how others
   see them.

### B. Typing

1. **When it shows.** A person types in the box of a P, D or G chat (*My call:* a key that changes the text; a focus, a paste of
   a file, an edit of an old message and a draft that comes back do not count).
2. **Where it shows.**
   - In the open chat, one line above the box: "Reem is typing...", "Reem and Faisal are typing...", "Several people are
     typing..." (3 or more). The line has a fixed height, so the messages never jump when it comes and goes.
   - In the chat list, the row's last message line changes to "typing..." (D) or "Reem is typing..." (P, G), in the link
     color.
3. **When it stops.** At Send, when the box becomes empty, when the chat closes, when the tab goes out of view, and 6 seconds
   after the last signal (a lost "stop" never leaves the line on). The new message of that person also ends it.
4. **Who sees it.** Only the members of the chat, never the typist's own other devices, never an Admin who reads a chat that
   they are not a member of. The server checks the membership and names the typist, so no screen can fake it. Agents never
   make a typing signal.
5. **Motion.** Three small dots fade one after the other. With "reduce motion" on, they stand still. *My call:* a fade, not
   a bounce (the calm rules).
6. **Rate.** A typist sends at most one signal every 3 seconds for one chat, and one "stop".

### C. Seen

1. **Direct chat.** Under the person's own last message, in small Ink 2 text: "Seen", once the other person saw it.
   Nothing before that (no "Sent", no "Delivered").
2. **Group and project chat.** Under the person's own last message: "Seen by 3" when 3 members saw it, "Seen by everyone"
   when every other member did (*My call:* no count to check). Nothing at 0. A tap (or Enter) opens a small list of the
   names, each with the face and the dot. *My call:* no times in the list (the mockup showed times; this text wins).
3. **Only under the last own message.** Older own messages show nothing. A message of an agent that acts for the person
   counts as the person's own.
4. **What "seen" means (*My call*, builder check question 1).** Seen has its own saved time for each member and chat (the
   "seen time"). It moves only when that member has the chat open, in view, and is active on that device (A1). So:
   - An archive, the Undo of "Mark as unread", and an agent never move it.
   - A chat that stays open on an idle computer does not move it. When the person uses Madar again with the chat in view,
     it moves then.
   - The read mark (`chatReads.lastReadAt`), the unread counts and the "New" line do not change in this batch.
   A message is seen by a member when that member's seen time is at or after the message time. Only members count: an
   Admin who is not a member never shows.
5. **From the release on.** *My call:* no seen time is copied from old read marks. "Seen" shows for the looks after the
   release, so no old mark can lie.
6. **Live.** The sender's "Seen" changes within about 2 seconds of the look, while the chat is open. A move of the seen time
   signals only the people whose own message became seen by it, not every member (cost and noise).

### D. The emoji list

1. **Button.** A smiley button between the clip and the box, in every box that sends a chat message (P, D, G) and in the box
   of a task thread and the task panel (the box is shared). Label "Add an emoji".
2. **Computer.** A panel opens above the button: a search field, a row of group buttons, "Recent", then the groups of the
   Unicode list. A click puts the emoji in the box where the cursor is. The panel stays open for a second emoji. Esc, a
   click outside, or Send closes it, and the cursor goes back to the box. Arrow keys move in the grid, Enter picks.
3. **Phone.** The same content in a bottom sheet. *My call:* the sheet stays open for more picks; a swipe down or a tap
   outside closes it. Press areas of 44 px at 390 px width (8 columns).
4. **Search.** One field finds English and Arabic names and keywords at the same time, whatever the screen language.
   *My call:* the Arabic search ignores the short vowels and treats the forms of alef (أ إ آ ا), ة and ه, ى and ي as the same.
   No hit: "No emoji has this name."
5. **Recent.** The last 16 emoji that the person used on this device, newest first, in one or two rows. *My call:* on a new
   device: 👍 🙏 ✅ 🎉 😂 🔥 👀 ❤️. Stored on the device, not on the server.
6. **Skin tone.** One choice, stored on the device, used for every emoji that has tones.
7. **Which emoji.** The standard list up to Emoji 15.0 (*My call:* new enough for the iPhones and Android phones of
   2023 and later; the builder lowers it if a team phone shows a box).
8. **Load.** The panel code and its data load at the first open, never in the first load of the app. Once loaded, it works
   with no network (the Home Screen app). No font or image of emoji: the device draws them.

### E. Reactions with any emoji

1. **Menu.** The reaction row of the message menu (computer) and of the long-press sheet (phone) keeps 👍 ✅ 👀 first and adds
   a + button ("Add a reaction"). The + opens the emoji list of D. One pick sets that reaction and closes the list.
   *My call:* on a phone, the message sheet closes first and then the emoji sheet opens (a sheet inside a sheet fails in
   Vaul).
2. **Where.** Everywhere the three reactions exist today: chat messages and task comments (one look, one rule).
3. **Pills.** One pill for each emoji in use, as today. The order: 👍 ✅ 👀 first, then the others in the order of the emoji
   list (*My call:* stable after a reload, with no new stored order).
4. **Rules that stay.** A press on a pill toggles the reaction of the reader. No push for a reaction. Only 👍 and ✅ count
   as an answer for "Waits for your reply".
5. **Limits.** A reaction is one emoji of the standard list, never text. *My call:* at most 20 different emoji on one message.

## How the live parts travel (*My call*, the plan proves each fact first)

Status and typing are live signals that Madar does not save. Seen is saved data (the seen time) on the normal write path.

- **Seen.** The screen calls a write when the chat is open, in view and the person is active, and the seen time is older than
  the newest message. The chat view gives the seen times of the other members. The save signals the authors whose message
  became seen (today the signal of a read goes only to the reader, `server/data/save.ts`).
- **Status on Supabase (the live copies today).** One private Realtime Presence topic for each person, `status:<Madar id>`.
  Only that person may track on it: a new insert policy for the `presence` extension allows the topic of the caller's own id
  only (`madar_private.current_madar_user_id()`), and never an agent token or a turned-off person. Every active person may
  join every status topic to read it. Each device of the person tracks its own state there (Online or Away), and the screens
  join the states of a topic into one (Online wins, then Away; no device = Offline). A screen joins the status topics of all
  active people: 15 today. Realtime allows 100 channels for each connection, so this holds to about 95 people.
  (*My call*, builder check question 3: the policy checks the topic at the join, so no screen can track for another person.
  One shared topic would be cheaper, but any screen could fake any status there.)
- **Typing on Supabase.** Through the Madar server, never screen to screen. The typist's screen sends a small server call
  (no save, no office lock). The server finds the person from the token, checks that the person may see the chat and is a
  member of it, and sends the signal (the chat, the typist, start or stop) to `person:<id>` of each other member, with its
  own event name next to the change signals. Only the server writes on `person:` topics today, and that stays true. The
  receiving screen trusts the server, so it needs no check of its own. The prototype rule: the same membership check in
  `src/api`, so both builds name the same members.
- **The office path (Cloudflare office object, paused exit, on main).** The same rules over the one socket: the screen sends
  its state and its typing on the socket, the object knows the person of each socket, checks the chat members in its own
  data, and sends to their sockets. The state must outlive the hibernation of a socket. Keep `test:lite` and `test:office`
  green.
- **The prototype.** No server. Tabs of the same browser share status and typing through a BroadcastChannel, so two tabs that
  preview two people show each other. The sample people with no open tab get fixed sample states (some Online, one Away, the
  rest Offline). If the BroadcastChannel is missing (an artifact frame), only the sample states show.
- **One port.** The screens read status and typing through one small interface with three adapters (Supabase, office
  socket, prototype), next to the change source of `src/app/signals.ts`.

### Facts to prove before the build (a cloud probe on `madar-test`, written in `proof.md`)

1. Presence on `status:<id>` with the new policies: the person tracks on their own topic; a track on another person's topic
   fails; a turned-off person and an agent token cannot track; every active person can read.
2. The server sends a typing signal on `person:<id>` with a new event name, and the change source of that person ignores it.
3. How long Realtime keeps the presence of a device that lost the network (a phone with flight mode on, and a locked iPhone).
4. Which presence events (join, track, leave, the state at a join) and broadcasts count as Realtime messages for the free
   2 million, and whether each receiving screen counts as one message.
5. The message count of the current month and the Edge Function calls of the current month on both Supabase projects.

## Cost and the free plan

No money. No new vendor. The free Supabase plan gives 2 million Realtime messages a month, 500,000 Edge Function calls a
month, 200 connections, 100 messages a second and 100 channels for each connection.

A rough count for 15 people on 22 work days, if each receiving screen counts as one message (the proof measures it):

| Part | How it adds up | A month |
| --- | --- | --- |
| Status | About 30 phone opens a day for each person (3 state changes each) plus the computer changes, to about 20 open screens, plus the states at each join | about 0.9 million messages |
| Typing | About 3,000 signals a day, each to about 4 members | about 0.26 million messages, about 66,000 server calls |
| Seen | One saved write for each look that moves the seen time, and its signal | small |

Production made about 422 server calls a day (about 13,000 a month), so typing keeps the total under 20% of the free
500,000. The status count is the big part.

*My call* (builder check question 2): no repeated "still here" signals: they would multiply the status count. If the
proof shows that the total of Realtime messages (today's use plus the new parts) passes 50% of the free limit, the plan
takes these steps in order, and tells the owner which ones it took:
1. A phone that goes out of view leaves its status topic after 1 minute (the person shows Offline sooner).
2. The typing interval goes from 3 to 5 seconds.
3. A computer tab that stays out of view for 30 minutes leaves its status topic.
4. If the total still passes 50%, the plan stops and asks the owner.

## New words (proposed; the builder may adjust them to the STE and Thmanyah rules)

Arabic forms follow the gender of the person where Madar knows it (`gender`). With no gender, the masculine form.

| Key | English | Arabic |
| --- | --- | --- |
| `presence.online` | Online | متصل / متصلة |
| `presence.away` | Away | بعيد عن الشاشة / بعيدة عن الشاشة |
| `presence.offline` | Offline | غير متصل / غير متصلة |
| `presence.awayByYou` | Away (set by you) | بعيد عن الشاشة، باختيارك / بعيدة عن الشاشة، باختيارك |
| `presence.showAway` | Show me as Away | أظهرني بعيداً عن الشاشة / أظهرني بعيدةً عن الشاشة |
| `presence.faceLabel` | {{name}}, {{state}} | {{name}}، {{state}} |
| `chat.typingOne` | {{name}} is typing... | {{name}} يكتب... / {{name}} تكتب... |
| `chat.typingTwo` | {{a}} and {{b}} are typing... | {{a}} و{{b}} يكتبان... |
| `chat.typingMany` | Several people are typing... | عدة أشخاص يكتبون... |
| `chat.typingRow` | typing... | يكتب... / تكتب... |
| `chat.seen` | Seen | قرأها / قرأتها |
| `chat.seenBy` | Seen by {{count}} | قرأها {{count}} (Arabic number forms) |
| `chat.seenByAll` | Seen by everyone | قرأها الجميع |
| `chat.seenByTitle` | Seen by | من قرأها |
| `emoji.add` | Add an emoji | أضف إيموجي |
| `emoji.search` | Search emoji | ابحث عن إيموجي |
| `emoji.recent` | Recent | استخدمتها مؤخراً |
| `emoji.skinTone` | Skin tone | لون البشرة |
| `emoji.none` | No emoji has this name. | لا يوجد إيموجي بهذا الاسم. |
| `emoji.group.*` | Smileys and people, Animals and nature, Food and drink, Activities, Travel and places, Objects, Symbols, Flags | الوجوه والأشخاص، الحيوانات والطبيعة، الطعام والشراب، الأنشطة، السفر والأماكن، الأشياء، الرموز، الأعلام |
| `chat.addReaction` | Add a reaction | أضف تفاعلاً |

The emoji names and keywords come from the Unicode CLDR annotations (English and Arabic), not from the word files.

## Constraints

- Free plans only. No new vendor, no paid plan, no font or image of emoji.
- Every write goes through `runCall`: the Away switch and the seen time are writes. Status and typing are not writes and never
  touch the Madar tables. Handlers stay synchronous and pure. Contract changes are additive: the reaction schema takes any
  emoji and still reads the old three-key records.
- The new-call checklist of `src/api/CLAUDE.md` for each new call. A new stored field (the seen time, the Away switch) gets its
  migration, `tables.ts` line and `STATE_VERSION` step, and its `_LITE` twin where a module has its own SQL.
- MCP in the same commit as each change (`server/mcp/tools.ts`, `TOOL_DOCS`, `INSTRUCTIONS`):
  - The Away call, the seen call and the typing call go on the deny list (personal or live, like "Notify me" and the push
    calls). Agents see no live status, move no seen time and make no typing signal.
  - `chats.messages`: `TOOL_DOCS` says what the new seen information means. `reactions.toggle` stays on the deny list;
    `TOOL_DOCS` of `chats.messages` and `comments.list` say that a reaction key can be any emoji.
- Leak tests from each builder: an outsider on every read path (`chats.list`, `chats.messages`, `comments.list`, MCP), the
  error texts and the signals. The seen times in a chat view are those of its members only. The signal of a seen time goes
  only to the authors whose message became seen. A typing call for a chat that the person cannot see answers like any hidden
  chat and sends nothing; a typing signal goes only to members. A person cannot track on `status:<other>`, and a turned-off
  person or an agent token cannot track at all. The same probes on the office path.
- Two languages: every visible word in English (STE, no em-dash) and Arabic (Thmanyah style). Screenshots in English and
  Arabic, light and dark, at 390 px and on a computer, for every screen change.
- Calm design rules of `DESIGN.md` and `src/CLAUDE.md`: tokens only, logical sides only, 44 px press areas, nothing under
  12 px, no face stack, navy only in its four places, red only for Late and errors.
- Performance: the emoji panel and its data stay out of the first load (`check-bundles` budget unchanged). A status change
  re-renders only the faces that show that person.
- What's new: one line, English and Arabic, before the deploy.
- Team week: no production change before Friday 2026-10-23. The test copy is fine. Production goes out only by the owner.

## Build method

- Opus 5.5 writes the plan from this design with `superpowers:writing-plans`: first the proof task, then tracks with few
  shared files.
- Sonnet 5.5 builders implement the plan, tests first, one builder for each track in its own worktree under
  `~/dev/madar-rb/`. Each builder writes its report to a file before it returns.
- The Opus merge lead joins the tracks, runs the merge gate once (typecheck, `npm test`, builds, `test:db`, `test:it`,
  `test:mcp`, `test:lite`, `test:office`, prototype smoke), takes the screenshots, and deploys to the test copy. No separate
  checker agent (owner rule of 2026-10-07).

## Left to the builder

- The names and shapes of the new calls and fields: the Away switch, the seen time, the typing call and the seen
  information in the chat view.
- The picker: a maintained library or a small own grid over the CLDR data, within the rules of D (no runtime fetch from a
  CDN, both themes, right to left, keyboard, lazy load).
- How the office object keeps the state of a socket across hibernation, and how the presence of many devices of one person
  joins into one state.
- The exact Arabic number forms of "Seen by {{count}}", and small word changes that keep the meaning.

## Not in this batch (proposed for later, not approved)

The read mark and the "New" line also wait for an active person (so messages that came while a person was away from the desk
stay new); no push to a person who has the chat open on a computer while their phone gets the push; a status on the People
list and on project team faces; typing and Seen in task threads; a "Last seen" time; big emoji for an emoji-only message; the
`:name:` shortcut.
