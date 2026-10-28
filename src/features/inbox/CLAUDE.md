# Inbox and chat

The Inbox, the chats (project, direct, group, to-do thread), the message log, presence and typing, the emoji panel. Files and pictures
in a chat: `src/features/files/CLAUDE.md`. The chat inside Focus mode: `src/features/focus/CLAUDE.md`. The phone shell: `src/app/CLAUDE.md`.

## Messages and the bubble
- The handlers of a bubble reach `MessageBubble` through `BubbleActionsContext` (`bubbleActions.ts`), never through a `MessageLog` prop.
  `ChatPane` and `TaskPane` each give one stable object (`useMemo`). A memoized bubble then renders again only when its own `Bubble` changes.
- `useBubbles` (`bubbles.ts`, shared by `TaskPane` and `TaskComments`) keeps one `Bubble` for each message view object. It finds a bubble
  by the key of its message and reuses it when `replaceEqualDeep` says the view is equal. The key of a message that the outbox claimed
  has `#claimed`. A chat at its limit slides its page for each new message, so every view is a new object without this rule.
- One menu for each message (`MessageMenu.tsx`). A touch screen (`usePointerCoarse`) builds no "..." button, except in the sheet of a
  to-do (`inSheet`). A long press (`longPress.ts`) opens `MessageSheet` on a phone. The `head` of `Menu` holds the reactions
  (`role="menuitemcheckbox"`). The row menu of the Inbox list is also left out on a phone or under a finger.
- Reply puts `ComposerReplyStrip` above the field. The next send passes `replyToId` (`chats.send` or `comments.create`). A closed chat has no
  Reply (`canReply`). A press on the quote (`BubbleReplyQuote`) frames the old message when it is live (`BubbleActions.focusMessage`,
  `FRAME_MS`). The strip of a deleted message stays plain text.
- Edit and delete work on own messages only (`Bubble.canEdit`). Delete asks nothing: `useDeleteMessage` shows a toast with Undo (the same
  call with `deleted: false`). A task comment keeps `comments.update` and `useUndoable('comments.delete')`. `useEarlierMessages` keeps a
  message that left the newest page only when it is older than the oldest message of the new page.
- Keep the @ tip in every box hint (`chat.placeholderPhone` on a phone): a project chat pushes only the people that a message names.
- Instant send (`outbox.ts`): a send adds an outbox entry and clears the box. The log draws a faded bubble (`Bubble.status` "pending").
  `matchOutbox` pairs an entry with the saved message of the same person with the same words that was not in the log at the send (or with
  the message of the answer id), one to one, oldest first. A change signal before the answer then shows the message once. A failed send
  (code `failed`) shows "Not sent" and "Send again" (`useAction` `retry`: the same input and the same idempotency key). A refusal still
  shows its toast.
- The task panel takes the chat look: `CommentThread` draws a task comment with `TaskComments.tsx` (its own `BubbleActionsContext` and
  `EditingContext`) and a post comment with `CommentItem.tsx`. A reason line stays a `CommentItem` line. The comments stay in the scroll of
  the panel: no Newest button, no "New" line.
- The bell says "X replied to you" for a mention notice with `reply: true` (`NotificationsScreen.tsx`, keys `notices.replied*`).
- A reason of a date move, a reopening or a Madar shift is a quiet line, never a bubble (`features/comments/ReasonLine.tsx`). The sentence
  keeps the name and the reason between FSI and PDI. The quiet lines of a group (`Conversation.log`, `ChatThread.lines`) are no messages:
  never unread, no push.
- `MentionField` opens above the Inbox box (`placement="above"`) and ranks names that start with the typed letters first (`rankedMatches`,
  `lib/personName.ts`). With `everyone` (the count) the list starts with the row "Everyone" when nothing follows the "@" or the letters
  start `everyone`, `all` or `الجميع`. A pick writes `@everyone` (English screens) or `@الجميع` (Arabic screens). No count (a direct chat, no
  right) means no row. `RichText everyone` draws the words as a mention chip when the message named people.

## Inbox list and groups
- The Arabic word of the To-dos kind is one word, «المهام» (`chatFilter.todos`), so the four chips fit one row at 390 px. A longer word sends
  the last chip to a second row. `tests/e2e/inboxPhone.spec.ts` measures the row. The same key names the option of the desk menu.
- The kind menu (`ChatList.tsx`, All, Projects, To-dos, People; a phone has `ChatKindChips`) lasts through `usePersistentChoice`
  (`madar.chatKind`). Search and "Archived (n)" look only in the chosen kind. A search in the main list looks in every chat. A group matches
  by its name. The line "unread messages are in other chats" with "Show all" (`inboxLine.*`) shows only for a kind other than All with no
  search word and no archived list. It has no red and no badge.
- `chats.archive` writes no event, so the Undo of an archive calls it again with the other value (`archive.ts`, `useArchive`).
  A swipe on a row archives it on a phone or under a finger.
- The Inbox does not call `chats.waiting` (the API keeps the rule for agents). The menu of a chat has "Mark as unread" instead
  (`chatMenuItems`): it shows only for a chat with nothing unread that is not archived. The Undo of its toast calls `chats.markRead`
  (`markUnread.ts`, kept in `InboxScreen` so the toast stays when the open chat closes).
- `ChatPane` marks a chat read at its first look (the first fresh answer while the tab shows), then only when a message is newer than the
  read time (`behind`). A mark set on the open chat from another device stays. `useMarkTaskRead` marks a thread once for each new count of
  comments. Read only while the page shows: `usePageVisible()`. A hidden tab marks the lists only (`app/signals.ts`), so a test that needs
  a hidden tab loads the chat with `queryClient.refetchQueries`.
- A group has one picture, `GroupPicture` (the glow of its id), never a stack of faces. Leave group asks first (Cancel has the focus).
  A group of one person left reads a closed chat. Notify me is two radio items in the header menu (`useNotifyItems`, `chats.setNotify`).
  The row menu of the list and a to-do thread have none.
- The Admin count: an Admin counts the project chats of the projects that the Admin leads or works on, plus every message that names the
  Admin (`countsNamedOnly`, `chatState.ts`). `ChatPane` marks a chat read on open when its newest message is newer than `readUpTo`
  (`behind`), because such a row can count 0 while plain messages are new. Read the Admin choice only with `adminReachOf` (`chatState.ts`).
  The choice, its effect on the lists and the push rule: `src/features/settings/CLAUDE.md`.
- `/inbox/<id>?at=<msg_ or cmt_>` opens the chat at that message. `ConversationPane` reads the mark (`messageParam`) and keys each pane by
  id and mark. A chat asks `chats.messages` with `around`. A window of an old message ends with "Show newer messages" (`NewerMessages.tsx`),
  and a send from a window goes to the newest page (`navigate(chatLink(id), { replace: true })`).
- The person sheet of Search has a Message button (`chats.openDirect`). The project header has a Project chat link (`ProjectDetail.chatId`,
  null for a person who may not open the chat). Both use the secondary look, never the navy main button.
- Search has a Messages group, last (`features/search/MessageHits.tsx`). The words of a hit fold as the server folds them
  (`lib/searchMatch.ts`), so an Arabic word marks across letter forms.

## The log
- Runs (`runs.ts`): messages of one person within 5 minutes form a run. A new day, a quiet line, another person, an agent message or the New
  line starts a run. `MessageView.namesMe` and `CommentView.namesMe` give the bubble the mention look and the hidden sentence `chat.namesYou`.
- Keep my place (`MessageLog`, `logScroll.ts`): a new message moves the log only when the reader is in the last 80 px or sent it. Else the
  round Newest button shows.
- New line (`newLine.ts`): the pane keeps the read state of the first fresh answer (`useOpenMark`) and shows the log only then. The mark read
  goes only after the mark exists, so a stale cached answer never clears the unread count first. At the open, the focus message beats
  the New line, and the New line beats the bottom.
- `MessageLog` `focusId` centers a bubble (`data-message-id`), frames it once and calls `onFocused`.
- First mount: a log of more than `FIRST_BUBBLES` bubbles mounts the newest bubbles at once and the older ones at the idle step (`whenIdle`,
  `logStage.ts` `stageStartId`). The focus message and the message after the New line are always in the first mount. A test that reads an old
  bubble waits for it (`waitFor`).
- Links (`segmentsOf`, `RichText`): an outside address opens in a new tab with `noopener noreferrer`. The marks at the end of a sentence stay
  out of the link. A cut title: the `<bdi>` itself is `block truncate`, never its parent.
- Drafts (`app/drafts.ts`) live in localStorage for each person. `keepDraftsOf('')` on sign-out clears them. Picked files stay in memory only,
  so a test that picks files calls `keepDraftsOf('')` after it. On a phone Enter adds a line and the Send button sends.

## On a phone
- `/inbox` and `/notifications` share the title "Inbox" and `InboxViews`. The list is a page, not a panel. Search text is at least 16 px.
- An open chat is `PhoneChatPage`: a portal on the body (`[data-chat-page]`). Its top and height follow `visualViewport` and it sets
  `--chat-h` inline. It calls `useSheetToasts(true)`. It is `inert` while a sheet is open (the `data-panel-open` mark); Focus mode turns
  that off (`inertWhileSheet={false}`) and sets its own `layer`. The entrance is keyed by the chat id only. The list stays mounted but hidden.
- Back rule (`chatBack.tsx`): a screen that opens a chat passes `state: { from }` with `chatState(from)`. `ChatBackLink` goes one step back
  when `state.from` exists and the history index is above 0, else to `/inbox`. `useLeaveChat` does the same for Archive, Mark as unread and
  Leave group. A test waits for the chat log before it presses Back.
- `ChatHeader`: Search is a link to `/search?in=messages` (a mark for the screen only). `ChatOptionsSheet` is one sheet for all four chat
  kinds. Add, Rename and Leave open one frame after it closes.
- Composer on a phone: no focus when a chat opens (`isPhoneNow()`). The field stops at 40 percent of `--chat-h`. A failed message is kept as
  the draft of its chat (`keepAsDraft`, `useDraftOnClose`).

## Presence and typing (`src/app/live/`)
- `LivePort` (`types.ts`) is fixed. `Runtime.live` is optional: with no port every person is Offline and no typing shows.
- A device is Online while the page shows and the person used it in the last `ACTIVE_MS`. A page out of view is Away at once, and rests
  after `REST_PHONE_MS` or `REST_COMPUTER_MS` (`activity.ts`). `typing.ts` shows a typer for `TYPING_SHOW_MS` and sends a signal each
  `TYPING_SEND_MS`.
- `useTypingSender(id, others)` sends no signal while the port knows the state of every person in `others` and each one is Offline
  (`LivePort.knowsState`). Away still sends. The list is unknown until the chat loads.
- Three adapters: `live/prototypeLive.ts` (BroadcastChannel `madar-live`), `app/remote/presence.ts` (Supabase Presence topic
  `status:<id>`, typing on `person:<me>`), `app/remote/officeLive.ts` (the office socket). A `track()` on another person's status topic answers
  `error` (policy `madar_status_track`): the adapter warns once and never tries again. A topic that has not synced since its last join shows
  its person Offline. Tests use `src/test/fakeLive.ts` and the `live` option of `renderApp`.
- `Composer` `change(next)` is the one door of the text (the field, the clear after a send, the emoji panel).

## Emoji (`src/features/emoji/`)
- `data.generated.json` comes from `scripts/emoji/build-data.ts` (the header has the command). The script drops U+FE0F after an
  `Emoji_Presentation` character, so the panel equals the quick reactions.
- `EmojiButton` loads the panel with `import()` at the first open: `check-bundles` refuses the `EMOJI_MARKER` in the first load. A phone gets
  a sheet, except inside a dialog, where the panel floats (`EmojiFloat`).
- The panel draws Recent and the first group at once and the other groups at the idle step (`Groups`, `useStaged`). An undrawn group
  keeps its id and a box of the height of its grid. A test that needs the last group waits for it (`findByRole`).
