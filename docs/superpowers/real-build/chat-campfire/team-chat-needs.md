# Madar chat: what the team and the owner asked for or decided

Collected 2026-10-19 (read only). Production runs 77c1a7d (owner release, 2026-10-19 15:37). Main is at 1bade883.

Sources: `TASKS.md`, `CLAUDE.md` (Owner decisions), the team requests plan of 2026-10-18, the meetings plan of 2026-10-19,
the specs, `docs/reviews` (colleague comments 2026-10-01, full audit 2026-10-03), the UX audit of 2026-10-19 (scratchpad of
session f526c126, `ux-audit/chats` and `ux-audit/integration`), the guides `src/CLAUDE.md`, `src/api/CLAUDE.md`,
`server/push/CLAUDE.md`, `server/mcp/CLAUDE.md`, the memory notes, and the in-app reports (`feedback.list`, all statuses).
The Madar tools loaded. `feedback.list` gave all 31 reports (fbk_001 to fbk_031) in one answer, with no next page.

## Open now (the team's newest reports)

| Need | Source | Date | Sender | Status | Notes |
|---|---|---|---|---|---|
| Drag and drop pictures and files into a chat | fbk_030 | 2026-10-19 | Osama Khalil (owner, Admin, Operations Manager) | open | No commit or branch names it. Today the attach button is the only way (chat files, 0d88eb06). |
| No desktop notification for each reply while the direct chat is open | fbk_028 (part 1) | 2026-10-19 | Faisal Al Howshani (Architect) | open | `public/sw.js` always shows the fixed line. It does not check for an open, visible Madar window on that chat. No fix found. |
| "Waits for reply" shows under the other person's name after Faisal saw the message | fbk_028 (part 2) | 2026-10-19 | Faisal Al Howshani (Architect) | open | It clashes with a rule built on purpose: a read chat whose newest message is from another person shows "Waits for your reply" (UX audit chats-17 and INT-26). Judge it by the need (memory note "Reports by need"). |
| A reason of a date move or a reopening shows as a system line, not as a person's message | fbk_027 | 2026-10-19 | Faisal Al Howshani (Architect) | waiting on owner | Built on main (4c246d7c, 2e421a9b, What's new da4d0e4b). Not in production 77c1a7d. The report stays "new" until the owner says the fix is live. |
| Chat text and typed text follow their own language (Arabic from the right, English from the left) | `src/CLAUDE.md`, commit 30d239e6 | 2026-10-19 | owner | waiting on owner | On main, not in production 77c1a7d. |
| A picture in a chat or a task comment shows as a preview, and a press opens a viewer | branch `rb/chat-preview` (4 commits, 2026-10-19 16:44) | 2026-10-19 | not found in the files | open | Not on main. It changes the rule of 2026-10-19 "a picture shows as a file chip; no preview picture" (`src/CLAUDE.md`). |

## Push about messages

| Need | Source | Date | Sender | Status | Notes |
|---|---|---|---|---|---|
| Free browser push for every new chat message and bell notice, never to the sender, only active people | `CLAUDE.md`, `TASKS.md` "Browser push" | 2026-10-08 | owner | done | Production bf3fa9f. One fixed line with no data. |
| Push on by default, one Allow card on Home | `CLAUDE.md`, `TASKS.md` | 2026-10-09 | owner | done | Production ef8e392. |
| A group message pushes to the other members; group quiet lines push nothing | team requests plan Task 7, `server/push/CLAUDE.md` | 2026-10-18 | owner (fbk_011) | done | Production 77c1a7d. |
| Try push on a real device (Allow, sign out and in, switch off) | `TASKS.md` lines 393, 401 | 2026-10-08 | owner step | waiting on owner | Not proven on a real push service yet (lines 395, 403). |
| A push for a plain comment on a task (no mention) | `TASKS.md` line 397 | 2026-10-08 | question for the owner | waiting on owner | Today a plain comment makes no notice and no push. |
| Limit the Admin's push to the chats of the Admin's own projects | `TASKS.md` line 405; full audit `shell.md` (unconfirmed list) | 2026-10-08 | question for the owner | waiting on owner | The Admin's Inbox counts every project chat, so the count may never reach zero. |

## Groups, archive, agents (the 2026-10-18 batch and the UX audit of 2026-10-19)

| Need | Source | Date | Sender | Status | Notes |
|---|---|---|---|---|---|
| Group chats in the Inbox (more than 2 people) | fbk_011 | 2026-10-15 | Osama Khalil (owner) | done | Owner answer 2026-10-18. Production 77c1a7d. Report marked done 2026-10-19. |
| Archive chats in the Inbox | fbk_012 | 2026-10-15 | Osama Khalil (owner) | done | Private to each person; a new message brings it back. Production 77c1a7d. |
| AI agents read the person's chats and list what waits for a reply (`chats.messages`, `chats.waiting`) | fbk_011 owner answer, plan Task 8 | 2026-10-18 | owner | done | Agents never mark read, never archive, never make or change groups. |
| AI agent sends a direct message for a person | fbk_002 | 2026-10-08 | Faisal Al Howshani (Architect) | done | Production cb0f7b9 (2026-10-12). |
| An archive marks the chat read (no unread number hides in an archived chat) | UX audit chats-03, INT-01 | 2026-10-19 | owner ("fix everything, pick the best option") | done | The paused Track R must do the same (see below). |
| The mention list opens above the box; names that start with the letters come first | UX audit chats-01 | 2026-10-19 | owner (audit) | done | |
| Archive toast with Undo, "Archived (n)" under the search field, a titled archived view, search finds archived chats | chats-04, chats-05, INT-14 | 2026-10-19 | owner (audit) | done | |
| Row menu only on hover or focus; a swipe archives on a phone | chats-06 | 2026-10-19 | owner (audit) | done | |
| Members see who is in a group (People sheet, "4 people") | chats-07 | 2026-10-19 | owner (audit) | done | |
| One group picture (glow and people icon) | chats-08 | 2026-10-19 | owner (audit) | done | |
| The group flow: one tap for a direct chat, a "New group" button, a count line, an optional name | chats-09, chats-13, INT-21 | 2026-10-19 | owner (audit) | done | This closes the open item "the group chat flow". |
| Group changes show a quiet line; Leave asks first; Remove has Undo | chats-10, INT-15 | 2026-10-19 | owner (audit) | done | A late member reads the whole history. |
| Any person can leave a group; a group of one reads as a closed chat | chats-11, INT-06, INT-07 | 2026-10-19 | owner (audit) | done | |
| A mention in a group names the group ("mentioned you in <group>") | chats-12, INT-03 | 2026-10-19 | owner (audit) | done | This closes the open item "the group mention word". |
| An inactive group maker: the first active member acts as the maker | INT-05 | 2026-10-19 | owner (audit) | done | |
| The office signal of a direct or group message names nobody | INT-16 | 2026-10-19 | owner (audit) | done | |
| People learn that a member's AI agent can read the chat (What's new line) | INT-17 | 2026-10-19 | owner (audit) | done | |
| "Waits for your reply" on the person's own Inbox rows | chats-17, INT-26 | 2026-10-19 | owner (audit) | done | fbk_028 part 2 now questions it. |
| Files in every chat; direct and group files stay in the chat | `src/CLAUDE.md`, `server/mcp/CLAUDE.md` | 2026-10-19 | owner | done | Production 77c1a7d. Agents see the file name only. |

## Read state and history

| Need | Source | Date | Sender | Status | Notes |
|---|---|---|---|---|---|
| The Inbox count includes unread task threads | full audit README, `CLAUDE.md` | 2026-10-03 | owner | done | Audit SHL-5 found the gap. |
| Unread counts without a load of the whole history (A9) | `TASKS.md` line 63 | 2026-10-04 | plan (C2 review) | done | |
| "Earlier messages" control in a chat | `TASKS.md` line 82 | 2026-10-04 | review (track A) | done | |
| A stored unread number for each person and chat (Track R) | `TASKS.md` lines 620 to 641, exit spec 2026-10-16 | 2026-10-18 | owner OK of the design | waiting on owner | Stopped with the Supabase exit pause (owner, 2026-10-18). It must count groups and treat an archived chat as read. The chat badge is about 75% of the rows read. |
| A quiet line is never unread and never waits for a reply | `src/api/CLAUDE.md` "Quiet lines" | 2026-10-19 | owner (fbk_027) | waiting on owner | On main with the fbk_027 fix. |

## Older chat items

| Need | Source | Date | Sender | Status | Notes |
|---|---|---|---|---|---|
| The chat Inbox | `CLAUDE.md` Owner decisions | 2026-10-01 | owner | done | |
| Team mentions or team chats | colleague comments D6 | 2026-10-01 | colleague (via the owner) | refused | Owner: "no team mentions or chats". |
| A date reason goes to the task's conversation; its author may fix the words; nobody deletes it | colleague comments O5 | 2026-10-02 | owner | done | fbk_027 changes how it shows. |
| The meeting summary goes to the project chats with the action owner and due date | O6; full audit F-18 | 2026-10-02 / 2026-10-03 | owner; audit | done | F-18 fixed in fix wave 4. |
| "Share in chat" toast names where the file went, with Open | full audit F-20 | 2026-10-03 | audit | done | Fix wave 4. |
| After a mention pick, typed letters stay in order | `TASKS.md` line 166 (41a9c18) | 2026-10-04 | build fault | done | |

## Open owner decisions about the chat

1. fbk_028 part 1: a push while the person has that chat open and in view. Recommended: the service worker shows no line when a
   focused Madar window is open. It keeps the one fixed line of 2026-10-08 for every other case.
2. fbk_028 part 2: what "Waits for your reply" means for a message the person read. The audit rule (built on 2026-10-19) shows it.
   Faisal reads it as a fault.
3. A push for a plain task comment with no mention (`TASKS.md` line 397, open since 2026-10-08).
4. Limit the Admin's push (and Inbox count) to the chats of the Admin's own projects (`TASKS.md` line 405, open since 2026-10-08).
5. The picture preview on `rb/chat-preview`: it replaces the 2026-10-19 rule "no preview picture". Merge it or not.
6. The production release of the fbk_027 fix and the chat text direction (main, not in production). The team week rule says no
   production change before 2026-10-23 unless the owner asks for a fix.
7. The restart of Track R (paused 2026-10-18).
8. The owner's real-device push test.

Closed, not open: "the group chat flow" and "the group mention word" were open on 2026-10-18 (memory note). The owner's audit
answer of 2026-10-19 closed both (`TASKS.md` line 680).

## Past owner decisions that bind the chat

- 2026-10-01: Madar has a chat Inbox. No team mentions and no team chats (D6).
- 2026-10-02: every date move asks a reason (everyone, the Admin too). The reason goes to the task thread. Its author may fix the
  words; nobody deletes it (O5).
- 2026-10-02: meetings are for the team only. The summary may go to the project chats (O6).
- 2026-10-03: the Inbox count includes task threads.
- 2026-10-05: every feature change updates the MCP side (tools, TOOL_DOCS, INSTRUCTIONS) in the same commit.
- 2026-10-08: free Web Push only (no email, WhatsApp, SMS or vendor). One fixed line with no data. It goes for every new bell
  notice and every new chat message, to the people who read the chat, never to the sender, only to active people. One switch for
  each device.
- 2026-10-09: push is on by default. One Allow card on Home. The push calls stay on the MCP deny list.
- 2026-10-12: an agent may open a direct chat, list chats and send one message as its person, with its own name beside it. A sent
  message has no Undo. Send only when the person asks.
- 2026-10-18 (fbk_012): an archive is private to each person. A new message brings the chat back. Agents cannot archive.
- 2026-10-18 (fbk_011): anyone makes a group; only the maker removes people; anyone can leave. Agents read the chats their person
  may open and see what waits for a reply. A read by an agent is not a read by the person.
- 2026-10-18: team reports are judged by the need behind them, not by the label "bug" or "feature".
- 2026-10-18: no production change from 2026-10-18 to 2026-10-22 unless the owner asks for a fix. A report is marked done only
  after the owner says the fix is live.
- 2026-10-19: "fix everything, pick the best option, keep it consistent" (the UX audit). Each chat choice took the auditor's
  recommended option (archive marks read; any person leaves; a group mention names the group; a late member reads the whole
  history; quiet lines are never unread and never push; "Waits for your reply" on the Inbox rows).
- 2026-10-19: every chat takes files. A file of a direct or group chat stays in that chat (no Files tab, no search). Agents never
  open a chat file.
- 2026-10-19 (fbk_027): a reason of a date move, a reopening or a Madar shift is a quiet line, never a person's message.
- 2026-10-19: chat text follows its own language. Every change updates the What's new page before the deploy.
- Always: free plans only, zero cost, no Vercel.
