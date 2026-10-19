# Campfire: inventory of every feature a person can see or feel

Source: the Campfire repository (Basecamp / 37signals, "ONCE Campfire"), schema version 2026_10_07.
Read in full: `config/routes.rb`, `db/schema.rb`, every model, controller, channel, job, helper, view,
Stimulus controller, JavaScript model and library, the main stylesheets, `lib/` and `docs/`.
The code was only read. Nothing in it was run.

Each feature has five parts: what the person sees, how it behaves, the fine details, the data it stores,
and the files. All paths are relative to the repository root.

Two facts first, because the brief asked about them and the code does not have them:

- **There is no first-unread mark.** A room always opens at its newest 40 messages, scrolled to the bottom
  (`app/controllers/rooms_controller.rb` `find_messages` uses `last_page`; `messages_controller.js`
  `connect` calls `autoscroll(true)`). No view or style draws a "new messages" line.
- **There is no edit or delete window.** The author or an administrator can edit or delete a message at any
  time (`User::Role#can_administer?` in `app/models/user/role.rb`). The edit leaves no "edited" label.

---

## Contents

- Rooms: 1 to 7
- Sidebar and unread state: 8 to 12
- Reading the timeline: 13 to 24
- Composer: 25 to 34
- Message actions: 35 to 40
- Files: 41 to 45
- Notifications: 46 to 49
- Presence: 50
- Search: 51 to 52
- People and sign-in: 53 to 59
- Administration: 60 to 64
- Bots: 65 to 67
- App shell: 68 to 75
- Design principles
- Left out on purpose

---

## Rooms

### 1. Open rooms (everyone is in)
- **Sees:** a room in the sidebar list. On the room settings page an "Everyone" row has its switch on, and
  every person shows with a check mark.
- **Behaves:** an open room gives a membership to every active person. A person who joins the account later
  gets a membership to every open room at once, in one database statement.
- **Details:** the first room "All Talk" is open. An open room changes into a closed room with the
  "Everyone" switch, and back. To delete an open room, Campfire first changes it to closed, so that nobody
  who joins in that moment gets in.
- **Data:** `rooms` (`type = Rooms::Open`, `name`, `creator_id`, `messages_count`), `memberships`.
- **Files:** `app/models/rooms/open.rb`, `app/models/user.rb` (`grant_membership_to_open_rooms`),
  `app/controllers/rooms/opens_controller.rb`, `app/views/rooms/opens/*`.

### 2. Closed rooms (chosen people)
- **Sees:** the same settings page, with the "Everyone" switch off and one switch for each person.
  Chosen people are listed first, then a line, then the others.
- **Behaves:** only people with a switch on get a membership. Save grants and revokes in one transaction.
  A revoked person loses the live stream at once: Campfire closes their sockets, and their sidebar reloads.
- **Details:** when you create a closed room you are always in it (a fixed check mark, no switch).
  A "Filter…" field shows only when there are more than 20 people. It filters as you type (300 ms debounce).
  The room name field keeps its text when you flip between the open and closed forms.
- **Data:** `rooms` (`type = Rooms::Closed`), `memberships`.
- **Files:** `app/models/rooms/closed.rb`, `app/controllers/rooms/closeds_controller.rb`,
  `app/views/rooms/closeds/*`, `app/javascript/controllers/filter_controller.js`,
  `app/helpers/users/filter_helper.rb`.

### 3. Pings (direct messages, one-to-one and groups)
- **Sees:** a row of round avatars at the top of the sidebar, with a "Ping" button first. In the room header
  the name is the other people's names. On the person's profile page there is a big message button.
- **Behaves:** a Ping is a room of type `Rooms::Direct`. Campfire finds the one room whose members are
  exactly this set of people, or makes it. So the same people always land in the same Ping.
- **Details:** a Ping can never become an open or closed room. Every member of a Ping can delete it.
  The settings page of a Ping shows the members as large avatars and one "Delete Ping" button with a
  confirm. The default notification level of a Ping is "everything", not "mentions".
- **Data:** `rooms` (`type = Rooms::Direct`, no name), `memberships` (`involvement = everything`).
- **Files:** `app/models/rooms/direct.rb`, `app/controllers/rooms/directs_controller.rb`,
  `app/views/rooms/directs/*`, `app/views/users/show.html.erb`.

### 4. Start a Ping with the people picker
- **Sees:** tap "Ping". The avatar row turns into a text field with a back arrow and a check button.
  The hint under it says "Type names to ping someone…". Each chosen person becomes a pill with an avatar
  and a small remove button.
- **Behaves:** typing searches people (300 ms debounce). Up and Down move in the list. Enter, Tab or a
  click commits the choice. Esc cancels the list. Backspace in an empty field removes the last pill.
  The check button opens the Ping.
- **Details:** the list leaves out you and the people you already chose. Matching ignores accents and
  prefers names that start with the text, then names with a word that starts with it. The chosen row
  flashes before it turns into a pill. The picker survives a background reload of the sidebar.
- **Data:** none until the Ping exists.
- **Files:** `app/views/rooms/directs/new.html.erb`, `app/javascript/controllers/autocomplete_controller.js`,
  `app/javascript/lib/autocomplete/*`, `app/controllers/autocompletable/users_controller.rb`,
  `app/views/users/autocompletables/_template.html.erb`, `rooms_list_controller.js` (`#preserveDirectEditor`).

### 5. Create and edit a room
- **Sees:** a "+" button at the bottom of the room list. A panel with the room name ("New room" by default),
  the access list and a check button. The "…" button in the room header opens the same panel for an
  existing room.
- **Behaves:** Enter in the name field saves. The new room appears in the sidebar of each member at once.
  A rename updates every member's sidebar at once.
- **Details:** the room creator and the administrators can change a room. Other people open the same page
  and see the name as a heading and the member list without switches.
- **Data:** `rooms`, `memberships`.
- **Files:** `app/views/rooms/layouts/_form.html.erb`, `_new.html.erb`, `_edit.html.erb`,
  `app/helpers/rooms_helper.rb`.

### 6. Delete a room
- **Sees:** a red trash button with the room name on the settings page, and a confirm: "Are you sure you
  want to delete this room and all messages in it? This can't be undone."
- **Behaves:** Campfire removes the memberships at once and deletes the messages in a background job,
  one message at a time, so other people can still post meanwhile. The room leaves every sidebar at once.
- **Details:** a person who sends into a deleted room sees "This room was deleted." in red in the composer,
  with a shake.
- **Data:** deletes `rooms`, `memberships`, `messages`, boosts and files.
- **Files:** `app/models/room.rb` (`destroy_later`), `app/jobs/room/destroy_job.rb`,
  `app/views/messages/room_not_found.html.erb`.

### 7. Room header
- **Sees:** a black pill with the room name (or the Ping members' names), a "…" settings button, the
  notification bell, and the account logo when one is set.
- **Behaves:** the pill is not a button. "…" opens room settings. The bell is feature 46.
- **Details:** on a phone a soft white fade sits behind the header so messages scroll under it.
- **Data:** none.
- **Files:** `app/views/rooms/show/_nav.html.erb`, `app/assets/stylesheets/nav.css`.

---

## Sidebar and unread state

### 8. Room list in the sidebar
- **Sees:** a list of room name buttons under the Ping row, a "+" button, and at the bottom your avatar and
  a settings gear.
- **Behaves:** shared rooms sort by name, A to Z, without regard to case. The sidebar loads once and stays
  in place when you change rooms. It reloads after the socket reconnects, and when you come back to a tab
  that was hidden for more than 60 seconds.
- **Details:** a room set to "invisible" (feature 46) leaves the list. On a wide screen the sidebar takes
  26% of the width. The bottom tools sit on a blurred bar.
- **Data:** reads `memberships` and `rooms`.
- **Files:** `app/views/users/sidebars/show.html.erb`, `app/controllers/users/sidebars_controller.rb`,
  `app/javascript/controllers/sorted_list_controller.js`, `app/assets/stylesheets/sidebar.css`.

### 9. Ping row, sorted by recency, with suggestions
- **Sees:** a row you scroll sideways: the "Ping" button, your Pings, then avatars of people you have no
  Ping with yet.
- **Behaves:** Pings sort by last activity, newest first. A new message moves that Ping to the front at
  once. A tap on a suggested avatar opens a Ping with that person.
- **Details:** suggestions fill the row up to 20 people, oldest accounts first. A one-to-one Ping shows the
  first name. A group Ping shows up to 4 small avatars and the members' initials joined with "+".
- **Data:** reads `memberships` and `rooms.updated_at`.
- **Files:** `app/views/users/sidebars/rooms/_direct.html.erb`, `_direct_placeholder.html.erb`,
  `app/controllers/users/sidebars_controller.rb` (`DIRECT_PLACEHOLDERS = 20`).

### 10. Unread rooms
- **Sees:** an unread room shows in bold with a dark ring. An unread Ping shows a bold name and a small dot.
- **Behaves:** when a message arrives, each member who is not in the room now, did not write it, and has not
  hidden the room, becomes unread. Opening the room clears it.
- **Details:** the room you look at never turns unread. A shared room that is already unread is not
  written again, which saves work in big rooms. A Ping is written on every message, so it stays first.
  The notice goes to each member alone, so nobody learns about activity in rooms they are not in.
  A room with notifications "off" still turns bold. Only "invisible" stops the bold.
- **Data:** `memberships.unread_at`.
- **Files:** `app/models/room.rb` (`unread_memberships`), `app/models/message/broadcasts.rb`,
  `app/jobs/message/broadcast_unread_room_job.rb`, `app/channels/unread_rooms_channel.rb`,
  `app/javascript/controllers/rooms_list_controller.js`.

### 11. Read state across tabs and devices
- **Sees:** you read a room on your phone, and the room loses its bold on your laptop too.
- **Behaves:** when you open a room, the server clears your unread mark and sends "read, with a time" to all
  your open tabs and devices.
- **Details:** each tab keeps the last read time for each room. An unread notice that is older than that time
  still moves the room, but does not make it bold again. This stops a late notice from undoing a read.
- **Data:** `memberships.unread_at`, `connected_at`, `connections`.
- **Files:** `app/channels/presence_channel.rb` (`broadcast_read_room`), `app/channels/read_rooms_channel.rb`,
  `app/javascript/controllers/read_rooms_controller.js`, `rooms_list_controller.js` (`#readSince`).

### 12. App badge and the unread dot on the menu button
- **Sees:** a number on the installed app icon. On a phone, a red dot on the menu button when the sidebar is
  closed and any room is unread.
- **Behaves:** the page counts its unread room links and sets the badge. A push message also sets the badge
  to the number of unread rooms.
- **Details:** the badge counts rooms, not messages. It clears when nothing is unread.
- **Data:** none extra.
- **Files:** `app/javascript/controllers/badge_dot_controller.js`, `app/views/pwa/service_worker.js`,
  `app/models/push/subscription.rb`, `sidebar.css` (`.sidebar__toggle::after`).

---

## Reading the timeline

### 13. Endless scroll in both directions
- **Sees:** older messages appear as you scroll up. Newer ones appear as you scroll down after a jump.
- **Behaves:** a page holds 40 messages. Campfire watches the first and last message. When one comes into
  view it loads the next page and keeps your place.
- **Details:** the page keeps at most 300 messages (plus 20 spare) and drops the far end. This keeps a long
  session fast. Formatting is fixed across page edges, so grouping stays right.
- **Data:** none.
- **Files:** `app/javascript/models/message_paginator.js`, `app/models/message/pagination.rb`,
  `app/controllers/messages_controller.rb` (`index`).

### 14. Stick to the bottom, or show "Jump to newest"
- **Sees:** new messages slide in at the bottom. If you scrolled up to read, a round down-arrow button with
  a pulsing ring shows above the composer instead.
- **Behaves:** if you are within 100 px of the bottom, Campfire scrolls to the new message. If not, it does
  not move you and shows the button. The button loads the latest page and scrolls down.
- **Details:** a late message is moved into its time order, so the list stays in order. Sending your own
  message always scrolls you down. All scroll work runs in one queue, so two updates never fight.
- **Data:** none.
- **Files:** `app/javascript/controllers/messages_controller.js`, `app/javascript/models/scroll_manager.js`,
  `app/helpers/rooms_helper.rb` (`button_to_jump_to_newest_message`), `messages.css`.

### 15. Keep your place when a message above you changes
- **Sees:** someone edits or boosts a message above you, and your screen does not jump.
- **Behaves:** edit and boost updates carry a "keep scroll" flag. Campfire measures the height change and
  corrects the scroll position.
- **Details:** it also stops touch inertia for one frame, so the correction is clean.
- **Data:** none.
- **Files:** `app/javascript/controllers/maintain_scroll_controller.js`, `app/javascript/helpers/dom_helpers.js`.

### 16. Messages grouped by sender and time
- **Sees:** several messages in a row from one person show one avatar and one name. The bubbles sit close.
- **Behaves:** a message from the same person within 5 minutes of the one above hides its avatar and name,
  and pulls up closer.
- **Details:** the browser does this, not the server, so the server can send the same HTML to everyone and
  cache it. Search results never group.
- **Data:** none.
- **Files:** `app/javascript/models/message_formatter.js` (`THREADING_TIME_WINDOW_MILLISECONDS = 5 * 60 * 1000`),
  `messages.css` (`.message--threaded`).

### 17. Day separators
- **Sees:** a centered pill with the date, for example "OCTOBER 19, 2026", between two thin lines, before the
  first message of each day.
- **Behaves:** the browser compares each message's date with the one above, in your own time zone.
- **Details:** the date uses your language settings. The first message on a page always shows its day.
- **Data:** none.
- **Files:** `message_formatter.js` (`#setFirstOfDayClass`), `messages.css` (`.message__day-separator`).

### 18. Your messages on the right
- **Sees:** your messages sit on the right with your avatar on the right. Other people's sit on the left.
- **Behaves:** the browser compares the author with you and adds a "me" class.
- **Details:** the options button also flips to the other side for your messages.
- **Data:** none.
- **Files:** `message_formatter.js` (`#setMeClass`), `messages.css` (`.message--me`).

### 19. Messages that mention you stand out
- **Sees:** a message that mentions you has a light red background and gives a small wiggle when it appears.
- **Behaves:** the browser looks for a mention chip with your avatar inside the message.
- **Details:** the red is stronger in dark mode.
- **Data:** none.
- **Files:** `message_formatter.js` (`#highlightMentions`), `messages.css` (`.message--mentioned`).

### 20. Emoji-only messages show big
- **Sees:** a message of only emoji has no bubble and shows the emoji at 2.4 times the size.
- **Behaves:** the server and the pending copy in the browser both test "only emoji".
- **Details:** a boost that is only emoji also shows a size larger.
- **Data:** none.
- **Files:** `lib/rails_ext/string.rb` (`all_emoji?`), `app/javascript/models/client_message.js`,
  `messages.css` (`.message--emoji`).

### 21. Local times and the timestamp link
- **Sees:** a short time next to each name, for example "3:42 PM". Hover shows date and time.
- **Behaves:** the server sends a standard time. The browser writes it in your language and time zone.
- **Details:** the time is a link to the message's own address (feature 22).
- **Data:** none.
- **Files:** `app/javascript/controllers/local_time_controller.js`, `app/helpers/time_helper.rb`.

### 22. Message permalinks
- **Sees:** "Copy link" in the message menu. Opening such a link shows the room around that message, with a
  dark frame that fades after one second.
- **Behaves:** the address is `/rooms/<id>/@<message id>`. Campfire loads 40 messages before and after it and
  centers it on screen. Scrolling down then loads the newer pages.
- **Details:** the copy button flashes a success state. Search results link here.
- **Data:** none.
- **Files:** `config/routes.rb` (`@:message_id`), `rooms_controller.rb` (`page_around`),
  `messages_controller.js` (`#highlightSearchResult`), `app/javascript/controllers/copy_to_clipboard_controller.js`.

### 23. Rich text, code and links in messages
- **Sees:** bold, italic, strike, highlight, lists, quotes, one heading size, tables, code blocks with
  color, and links that open in a new tab.
- **Behaves:** the server cleans the HTML in three layers, then turns plain web and email addresses into links.
  The browser colors code blocks with highlight.js.
- **Details:** code colors exist for 12 languages (bash, css, diff, go, java, javascript, json, python, ruby,
  rust, sql, xml). Links to Campfire itself open in the same tab. Text direction follows the text, so
  Arabic shows right to left.
- **Data:** `action_text_rich_texts.body`.
- **Files:** `app/helpers/messages_helper.rb`, `app/helpers/content_filters*.rb`,
  `app/javascript/initializers/highlight.js`, `app/views/messages/_presentation.html.erb` (`dir="auto"`).

### 24. Reconnect and catch up
- **Sees:** when the connection drops for more than 5 seconds, the composer greys out and you cannot send.
  When it comes back, the missed messages appear.
- **Behaves:** on each reconnect, Campfire asks for messages created or changed since the newest one on screen.
  New ones are added. Changed ones are replaced. A tab hidden for more than 60 seconds does the same on return.
- **Details:** when the browser comes back online it retries the socket at once. Short drops under 5 seconds
  show nothing.
- **Data:** none.
- **Files:** `app/javascript/controllers/refresh_room_controller.js`, `app/controllers/rooms/refreshes_controller.rb`,
  `app/views/rooms/refreshes/show.turbo_stream.erb`, `app/channels/heartbeat_channel.rb`.

---

## Composer

### 25. Send keys and focus
- **Sees:** one rounded input with a paperclip, a text-style button and a black send arrow.
- **Behaves:** Enter sends. Shift+Enter makes a new line. With the text toolbar open, Enter makes a new line
  and Cmd+Enter or Ctrl+Enter sends. On a touch device Enter never sends: you tap the arrow.
- **Details:** Enter does not send while the @mention list is open, or while an input method (for example
  Arabic or Japanese typing) is still composing. On a computer the composer takes focus when the room opens.
  After a send the composer keeps focus.
- **Data:** none.
- **Files:** `app/javascript/controllers/composer_controller.js` (`submitByKeyboard`),
  `app/views/rooms/show/_composer.html.erb`, `app/helpers/rich_text_helper.rb`.

### 26. Text toolbar that stays hidden
- **Sees:** no toolbar by default. A text-style button shows it below the text.
- **Behaves:** the toggle opens and closes the toolbar. Sending closes it again.
- **Details:** the button exists only on wide screens with a mouse. Phones get no toolbar. Markdown-style
  shortcuts still work as you type (the tests cover strike-through). Only one heading level. The editor
  refuses files: files go through the paperclip only.
- **Data:** none.
- **Files:** `composer_controller.js` (`toggleToolbar`), `app/javascript/initializers/rich_text.js`,
  `composer.css`.

### 27. A draft for each room
- **Sees:** you type half a message, go to another room, come back, and your text is still there.
- **Behaves:** each change saves the text in the browser under the room's id. Opening the room puts it back
  with the cursor at the end. Sending or clearing removes it.
- **Details:** the draft lives on this device only.
- **Data:** browser `localStorage` key `composer-draft-<room id>`.
- **Files:** `composer_controller.js` (`saveDraft`, `#restoreDraft`).

### 28. Instant send with a failure mark
- **Sees:** your message shows at once, before the server answers. If it fails, it turns half-transparent,
  wiggles, gets a red dashed outline and a "no entry" sign.
- **Behaves:** the browser makes a temporary id, draws a copy of the message, then sends. The real message
  from the server replaces the copy.
- **Details:** a "/play" message shows "Playing name…" while it waits. The server match uses the temporary id
  but only removes copies marked as pending, so nobody can replace another person's message.
- **Data:** `messages.client_message_id`.
- **Files:** `app/javascript/models/client_message.js`, `app/views/messages/_template.html.erb`,
  `messages_controller.js` (`#reconcilePendingMessage`), `messages.css` (`.message--failed`).

### 29. @mentions
- **Sees:** type "@" and a list of the room's people with avatars shows. The choice becomes a chip with a small
  round avatar and the bold name.
- **Behaves:** the list filters on the server as you type. It shows "No matches" when empty. Only people in
  this room show.
- **Details:** in plain text a mention reads "@Name". A mention of a person who is not in the room does nothing.
  There is no "@everyone" or "@here". A mention of a bot calls the bot (feature 67).
- **Data:** the mention is a signed reference inside `action_text_rich_texts.body`.
- **Files:** `app/models/user/mentionable.rb`, `app/models/message/mentionee.rb`,
  `app/helpers/rich_text_helper.rb` (`mention_prompt_tag`), `app/views/autocompletable/users/_prompt_item.html.erb`,
  `app/views/users/_mention.html.erb`.

### 30. Link previews
- **Sees:** paste a link and a card with the page title, a short text and a picture appears under it in the
  composer, before you send.
- **Behaves:** the browser asks the server for the page's preview data. The server fetches the page within
  10 seconds in total. When the message is only the link, the bare link text is hidden and only the card shows.
- **Details:** links to X or Twitter go through a helper site to get a card. A Twitter avatar shows small and
  round. Title stops at 280 characters, text at 560. Links to files, pictures and videos get no card. The
  server refuses private network addresses and checks that the picture is really a picture.
- **Data:** the card is stored inside the message body.
- **Files:** `app/javascript/controllers/unfurl_controller.js`, `app/controllers/unfurl_links_controller.rb`,
  `app/models/opengraph/*`, `lib/rails_ext/actiontext_opengraph_embeds.rb`,
  `app/helpers/content_filters/remove_solo_unfurled_link_text.rb`, `app/assets/stylesheets/embeds.css`.

### 31. Reply as a quote
- **Sees:** "Reply" in the message menu. The composer fills with the message as a quote, then the author name
  and a "#" link back to the original, then an empty line for you.
- **Behaves:** the browser copies the message body into a quote block. Your reply is a new, normal message.
- **Details:** mention chips become plain names. Link cards are dropped. If only a card was there, the quote
  shows its link. The reply replaces what was in the composer. Reply exists for text messages only.
- **Data:** none extra.
- **Files:** `app/javascript/controllers/reply_controller.js`, `app/javascript/lib/rich_text/cite_node.js`,
  `app/assets/stylesheets/actiontext.css` (`blockquote`, `cite`).

### 32. Up arrow edits your last message
- **Sees:** with an empty composer, press the Up arrow and your last message opens for edit.
- **Behaves:** Campfire finds your newest message on screen and clicks its Edit button.
- **Details:** it works only when you see the newest messages and the composer is empty.
- **Data:** none.
- **Files:** `messages_controller.js` (`editMyLastMessage`), `app/helpers/messages_helper.rb` (`keydown.up`).

### 33. /play sounds
- **Sees:** type "/play tada" and everyone in the room hears a sound. The message shows a speaker button and a
  short text or a small picture.
- **Behaves:** a message that is exactly "/play name" with a known name becomes a sound message. People who
  watch the room live hear it when it arrives. The speaker button plays it again.
- **Details:** 56 sounds, for example bell, crickets, rimshot, tada, trombone, vuvuzela, yay. Some show a
  picture (nyan, clowntown). An unknown name stays a plain text message. Old messages loaded later stay silent.
- **Data:** none extra (the body is the command).
- **Files:** `app/models/sound.rb`, `app/models/message.rb` (`sound`), `app/javascript/controllers/sound_controller.js`,
  `messages_helper.rb` (`message_sound_presentation`), `client_message.js` (`SOUND_NAMES`).

### 34. Typing indicator
- **Sees:** names of the people who type now, above the composer, with a small spinner. It fades in and out.
- **Behaves:** while you type, your browser sends "start" at most once each second. Sending or clearing the text
  sends "stop". Other browsers drop a name after 5 seconds with no "start".
- **Details:** names sort A to Z and join with commas. You never see yourself. Nothing is stored.
- **Data:** none (live signal only).
- **Files:** `app/javascript/controllers/typing_notifications_controller.js`, `app/javascript/models/typing_tracker.js`,
  `app/channels/typing_notifications_channel.rb`, `composer.css` (`.typing-indicator`).

---

## Message actions

### 35. The message menu
- **Sees:** a "…" button next to each message. It opens a small menu with an arrow: 8 emoji in a grid, a boost
  button, and one row with Reply (or Download and Share for files), Copy link and Edit.
- **Behaves:** on a computer the "…" shows on hover after 150 ms. On a phone it shows at half strength all the
  time. The menu opens upward when the message is near the bottom of the screen. Esc or a click outside closes it.
- **Details:** Edit shows only on your own messages, or for an administrator. The row splits its width by the
  number of buttons.
- **Data:** none.
- **Files:** `app/views/messages/_actions.html.erb`, `app/javascript/controllers/popup_controller.js`,
  `messages.css` (`.message__actions-menu`, `.message__edit-btn`).

### 36. Quick boosts (fixed emoji)
- **Sees:** 8 emoji in the menu: thumbs up, clapping, waving hand, muscle, red heart, tears of joy, party
  popper, fire.
- **Behaves:** one tap adds that emoji as your boost and closes the menu.
- **Details:** this is the whole emoji choice. There is no emoji picker.
- **Data:** `boosts` (`content`, `booster_id`, `message_id`).
- **Files:** `app/helpers/emoji_helper.rb` (`REACTIONS`), `app/views/messages/_actions.html.erb`.

### 37. Boosts (short text or emoji, shown with your face)
- **Sees:** pills under a message. Each pill shows the booster's small avatar and their text, for example
  "nice!" or an emoji. A "+" boost button shows after the pills.
- **Behaves:** the boost button opens a small field with your avatar. You type up to 16 characters and press
  the check. Esc cancels. Each boost appears for everyone at once.
- **Details:** boosts are not grouped or counted: two thumbs show as two pills with two faces. The "+" at the
  end shows only when the message already has a boost. The new field pops in with a scale animation.
  On a phone the keyboard opens at once with a hidden-input trick.
- **Data:** `boosts.content` (16 characters at most).
- **Files:** `app/models/boost.rb`, `app/controllers/messages/boosts_controller.rb`,
  `app/views/messages/boosts/*`, `app/javascript/controllers/soft_keyboard_controller.js`, `boosts.css`.

### 38. Remove your own boost
- **Sees:** tap your own boost and a red minus button appears next to it. Tap it and the pill shrinks away.
- **Behaves:** only the booster can remove a boost. Other people's boosts do not react to a tap.
- **Details:** keyboard users reach their own boost with Tab and Enter. A screen reader hears
  "Press enter to delete this boost".
- **Data:** deletes the `boosts` row.
- **Files:** `app/javascript/controllers/boost_delete_controller.js`, `app/views/messages/boosts/_boost.html.erb`.

### 39. Edit a message in place
- **Sees:** the bubble turns into an editor with the same text, a check button, a trash button and an X.
- **Behaves:** Cmd+Enter or Ctrl+Enter or the check saves. Esc or X closes without saving. Everyone sees the new
  text at once, and their scroll does not jump.
- **Details:** no time limit. No "edited" label. Mentions and link cards survive the edit. A file message cannot
  be edited, only deleted. The editor scrolls into the middle of the screen.
- **Data:** `action_text_rich_texts.body`, the search index.
- **Files:** `app/views/messages/edit.html.erb`, `app/controllers/messages_controller.rb` (`update`),
  `app/helpers/rich_text_helper.rb` (`editable_body`), `app/javascript/controllers/form_controller.js`.

### 40. Delete a message
- **Sees:** the trash button in edit mode, with "Are you sure you want to delete this message?".
- **Behaves:** the message leaves every screen at once.
- **Details:** no "message deleted" placeholder stays. The author or an administrator can delete, at any time.
- **Data:** deletes `messages`, its boosts, its file and its search row.
- **Files:** `messages_controller.rb` (`destroy`), `app/views/messages/destroy.turbo_stream.erb`.

---

## Files

### 41. Attach by button, paste or drag
- **Sees:** chosen files wait above the input as cards: a thumbnail for pictures, a file icon for others, the
  name and a small remove circle.
- **Behaves:** the paperclip opens the file chooser (many files at once). A paste of files adds them. A drop
  anywhere in the room adds them. Tap a card to remove it. Send sends them.
- **Details:** cards sort by file name. A long name cuts with "…" but keeps the extension. Pasted text still
  pastes as text.
- **Data:** none until sent.
- **Files:** `composer_controller.js` (`filePicked`, `pasteFiles`, `dropFiles`, `#updateFileList`),
  `app/javascript/controllers/drop_target_controller.js`, `composer.css`.

### 42. One message for each file, with progress
- **Sees:** each file shows at once as its own message with the name, a percent and a grey bar that fills.
- **Behaves:** the browser uploads files one after the other. When one finishes, the real message replaces
  the copy.
- **Details:** text and files sent together become separate messages: the files, then the text.
- **Data:** `messages`, `active_storage_blobs`, `active_storage_attachments`.
- **Files:** `app/javascript/models/file_uploader.js`, `composer_controller.js` (`#submitFiles`),
  `messages.css` (`.message__pending-upload`).

### 43. Pictures, videos and other files in the timeline
- **Sees:** a picture shows as a preview with a zoom cursor. A video shows a player with a still frame. Any other
  file shows an icon, the name, a download button and a share button.
- **Behaves:** Campfire makes the preview when the file is posted (at most 1200 by 800). It does not try again
  later.
- **Details:** a picture shows at half its pixel size, so phone photos look sharp. Video previews stop after
  10 seconds of work. Very large pictures (over 250 million pixels) get no preview. Videos do not preload.
  Files that are not plain media download instead of opening, for safety.
- **Data:** `active_storage_blobs` (`metadata` width and height), `active_storage_variant_records`.
- **Files:** `app/models/message/attachment.rb`, `app/helpers/messages/attachment_presentation.rb`,
  `lib/rails_ext/time_limited_video_previewer.rb`, `config/initializers/uploaded_script_guard.rb`.

### 44. Picture lightbox
- **Sees:** click a picture and it fills the screen over a blurred background, with Close (top right), Share
  (top left) and Download (bottom right).
- **Behaves:** Esc or Close shuts it. The same viewer shows the QR codes of feature 53 and 56.
- **Details:** Download is hidden in the installed iPhone app, where downloads do not work.
- **Data:** none.
- **Files:** `app/javascript/controllers/lightbox_controller.js`, `app/views/layouts/_lightbox.html.erb`,
  `lightbox.css`.

### 45. Native share
- **Sees:** a share button on files, in the lightbox, and next to the join link and the sign-in link.
- **Behaves:** the button opens the phone's or computer's own share sheet. For a file it sends the file itself.
- **Details:** the button hides when the browser cannot share. A shared file gets a name like "Campfire_x7k2.png".
- **Data:** none.
- **Files:** `app/javascript/controllers/web_share_controller.js`, `app/helpers/users/profiles_helper.rb`.

---

## Notifications

### 46. The bell: four levels for each room
- **Sees:** a bell in the room header. Each tap moves to the next level, with its own bell icon.
- **Behaves:** shared rooms cycle "mentions" (default), "everything", "nothing", "invisible". Pings cycle
  "everything" (default) and "nothing".
  - mentions: a push only when someone mentions you.
  - everything: a push for every message.
  - nothing: no push, but the room still turns bold.
  - invisible: no push, no bold, and the room leaves your sidebar.
- **Details:** the header bell shows its levels only after this device allows notifications (feature 47). Your
  profile page lists every room with its own bell. Invisible rooms show there at half strength, so you can bring
  them back. Screen readers hear "Notifying about @ mentions" and the like.
- **Data:** `memberships.involvement`.
- **Files:** `app/models/membership.rb` (enum), `app/controllers/rooms/involvements_controller.rb`,
  `app/helpers/rooms/involvements_helper.rb`, `app/views/rooms/involvements/*`,
  `app/views/users/profiles/_membership.html.erb`.

### 47. Allow notifications, with help when blocked
- **Sees:** on first use the bell pulses with an orange ring. If this device has no push yet, the bell shows an
  alert mark. Tap it and the browser asks to allow notifications. If notifications are blocked, a dialog
  "Notifications aren't allowed" opens with steps for your exact browser and system.
- **Behaves:** the tap registers the service worker, asks for permission, and saves this device's push address
  on the server.
- **Details:** the pulse stops after the first tap, and the app and the browser remember this apart. The dialog
  has sections for browser settings, system settings and app install. When only one applies, it opens by itself.
  On an iPhone the steps say that you must install the app first.
- **Data:** `push_subscriptions` (`endpoint`, `p256dh_key`, `auth_key`, `user_agent`), cookies
  `notifications-first-run-seen` and `notifications-pwa-first-run-seen`.
- **Files:** `app/javascript/controllers/notifications_controller.js`, `app/views/rooms/involvements/_bell.html.erb`,
  `app/views/pwa/_browser_settings.html.erb`, `_system_settings.html.erb`, `_install_instructions.html.erb`,
  `app/controllers/users/push_subscriptions_controller.rb`.

### 48. What a push says, and who gets it
- **Sees:** in a Ping: the sender's name as the title and the message text. In a room: the room name as the
  title and "Name: text". The account logo is the icon. A tap opens the room.
- **Behaves:** a background job sends the push. It goes only to people who are not looking at the room now,
  who are active (not banned or removed), who did not write it, and whose level allows it.
- **Details:** a tap reuses the open window when there is one. A file message shows the file name as the text.
  A push address that the vendor rejects is deleted by itself. Pushes go out with high urgency. Only the
  big push services are allowed as addresses.
- **Data:** reads `push_subscriptions`, `memberships`.
- **Files:** `app/models/room/message_pusher.rb`, `app/jobs/room/push_message_job.rb`, `lib/web_push/*`,
  `config/initializers/web_push.rb`, `app/views/pwa/service_worker.js`.

### 49. Sign out ends this device's push
- **Sees:** nothing extra. After you sign out, this device stops getting pushes.
- **Behaves:** before the sign-out form goes, the browser removes its push subscription and tells the server.
- **Details:** in development a page lists each device ("Chrome 120 on macOS") with a test-push button and a
  delete button.
- **Data:** deletes the `push_subscriptions` row.
- **Files:** `app/javascript/controllers/sessions_controller.js`, `app/controllers/sessions_controller.rb`,
  `app/views/users/push_subscriptions/*`, `app/controllers/users/push_subscriptions/test_notifications_controller.rb`.

---

## Presence

### 50. Quiet presence (no online list)
- **Sees:** nothing directly. You do not get bold marks or pushes for the room you are looking at.
- **Behaves:** opening a room counts you as present in it. Your browser checks in every 50 seconds. After 60
  seconds without a check-in you count as away. Each tab and device counts, and you are away only when all are gone.
- **Details:** a tab you hide for more than 5 seconds makes you away. A quick switch to another tab and back
  does not. Campfire never shows who is online: presence only decides unread marks and pushes.
- **Data:** `memberships.connected_at`, `memberships.connections`.
- **Files:** `app/channels/presence_channel.rb`, `app/models/membership/connectable.rb` (`CONNECTION_TTL = 60.seconds`),
  `app/javascript/controllers/presence_controller.js`.

---

## Search

### 51. Search all your rooms
- **Sees:** a magnifier left of the composer. It swaps the composer for a search field with a smooth animation.
  Results show as messages, newest at the bottom, each with "→ room name". A pill shows the query and the count.
- **Behaves:** Campfire searches the text of every message in rooms you are in. It finds word forms too
  ("run" finds "running"). All words must match. A tap on a time opens the message in its room.
- **Details:** at most the newest 100 hits. Punctuation is ignored. Results have no menus. Esc clears the field.
  The back arrow returns you to the last room you visited. File names are searchable.
- **Data:** `message_search_index` (SQLite full-text table), `searches`.
- **Files:** `app/controllers/searches_controller.rb`, `app/models/message/searchable.rb`,
  `app/views/searches/index.html.erb`, `app/javascript/controllers/search_results_controller.js`,
  `sidebar.css` (`.searches`).

### 52. Recent searches
- **Sees:** your last searches as chips in quotes: in the sidebar on a computer, in a row under the header on a phone.
  A broom button clears them, with a confirm.
- **Behaves:** each search you run moves to the top. Campfire keeps 10.
- **Details:** a repeat search does not add a second chip.
- **Data:** `searches` (`query`, `user_id`, `updated_at`).
- **Files:** `app/models/search.rb`, `searches_controller.rb` (`clear`).

---

## People and sign-in

### 53. The join link
- **Sees:** "Share to invite more people" with a link and buttons: QR code, copy, share. Administrators also see
  a refresh button. The same block shows in the welcome card of the first room.
- **Behaves:** anyone with the link can make an account. Refresh makes a new link and the old one stops working.
- **Details:** every member, not only administrators, sees and can share the link. The code looks like
  "Ab3d-9fGh-k2Lm". The share text is "Hit this link to join me in Campfire and start chatting."
- **Data:** `accounts.join_code`.
- **Files:** `app/views/accounts/_invite.html.erb`, `app/models/account/joinable.rb`,
  `app/controllers/accounts/join_codes_controller.rb`, `app/controllers/qr_code_controller.rb`.

### 54. Sign up from the join link
- **Sees:** a name-tag card on a lanyard: avatar, name, email, password, and a check button.
- **Behaves:** the account is made, you are signed in, and you land in a room. You join every open room.
- **Details:** if the email already exists, Campfire sends you to sign-in with the email filled in. A wrong code
  shows "not found". The password is at most 72 characters.
- **Data:** `users`, `memberships`, `sessions`.
- **Files:** `app/controllers/users_controller.rb`, `app/views/users/new.html.erb`, `signup.css`.

### 55. Sign in
- **Sees:** the account logo and name, email, password and an arrow button. Below it, the email of the first
  administrator as a help button, and the version.
- **Behaves:** after sign-in you go to the page you first asked for. A wrong try shakes the card and says
  "Too many requests or unauthorized."
- **Details:** 10 tries in 3 minutes at most. You stay signed in for years (a permanent cookie). The session
  saves its device and address once an hour.
- **Data:** `sessions` (`token`, `user_agent`, `ip_address`, `last_active_at`).
- **Files:** `app/controllers/sessions_controller.rb`, `app/views/sessions/new.html.erb`,
  `app/views/accounts/_help_contact.html.erb`, `app/controllers/concerns/authentication.rb`, `app/models/session.rb`.

### 56. Sign-in link for another device, and account recovery
- **Sees:** on your profile: a link, a QR code button, copy and share, under a laptop-to-phone picture.
  An administrator sees the same block on another person's page: "Share to get them back into their account".
- **Behaves:** the link signs in whoever opens it, as that person, for 4 hours. Scan the QR with a phone and you
  are signed in there.
- **Details:** this replaces "forgot password". Campfire sends no email at all. The share text warns
  "This is your own private sign-in URL, DO NOT SHARE IT."
- **Data:** none stored (a signed, time-limited id).
- **Files:** `app/models/user/transferable.rb` (`TRANSFER_LINK_EXPIRY_DURATION = 4.hours`),
  `app/controllers/sessions/transfers_controller.rb`, `app/views/users/profiles/_transfer.html.erb`,
  `app/javascript/controllers/auto_submit_controller.js`.

### 57. Your profile
- **Sees:** a large avatar with camera and minus buttons, then name, email, a new password field and a short bio.
  Then all your rooms with their bells, then the sign-in link block, then a sign-out button in the header.
- **Behaves:** a new avatar saves the moment you pick it. The other fields save with the check.
- **Details:** after an avatar change Campfire says "It may take up to 30 minutes to change everywhere."
  The bio (200 characters) shows on hover over your name in messages: "Name, bio". The install help shows at the
  top when the app is not installed.
- **Data:** `users` (`name`, `email_address`, `password_digest`, `bio`), the avatar file.
- **Files:** `app/controllers/users/profiles_controller.rb`, `app/views/users/profiles/show.html.erb`,
  `app/controllers/users/avatars_controller.rb`, `app/javascript/controllers/upload_preview_controller.js`.

### 58. Initials avatars
- **Sees:** a person with no photo gets a colored square with white initials.
- **Behaves:** the server draws the picture. The color comes from the person's id, so it never changes.
- **Details:** 18 warm colors. Three or more initials squeeze to fit. Bots get a robot picture. Avatars cache for
  30 minutes.
- **Data:** none extra.
- **Files:** `app/views/users/avatars/show.svg.erb`, `app/helpers/users/avatars_helper.rb`.

### 59. Another person's page
- **Sees:** avatar, name, bio, and one big message button that opens a Ping. Administrators also see the email,
  the sign-in link block and a "Ban" button.
- **Behaves:** a tap on any avatar or name in messages opens this page.
- **Details:** a removed person shows "Name is no longer on this account". A banned person's avatar is dimmed with
  a cross over it.
- **Data:** reads `users`.
- **Files:** `app/views/users/show.html.erb`, `app/controllers/users_controller.rb` (`show`), `avatars.css` (`.banned`).

---

## Administration

### 60. Account name and logo
- **Sees:** account settings (gear in the sidebar): the logo with camera and minus buttons, the account name and a check.
- **Behaves:** a new logo saves the moment you pick it.
- **Details:** the logo becomes the tab icon, the home-screen icon, the push icon, and shows on the sign-in page
  and in the room header. Without a logo Campfire uses its own icon. Members see the logo and name, without controls.
- **Data:** `accounts.name`, the logo file (512 and 192 pixel copies).
- **Files:** `app/controllers/accounts_controller.rb`, `app/views/accounts/edit.html.erb`,
  `app/controllers/accounts/logos_controller.rb`, `app/models/account.rb`.

### 61. People list, admin role and removal
- **Sees:** on account settings: administrators first, a line, then members. Each row has a crown button
  (administrator on or off) and a red minus (remove). Your own row has a pencil to your profile.
- **Behaves:** the crown saves on tap. Remove asks "Are you sure you want to permanently remove this person from
  the account? This can't be undone."
- **Details:** you cannot change your own role. Removal ends their sessions, takes them out of every room except
  their Pings, deletes their pushes and searches, and changes their email so it can be used again. Their messages
  stay. The list loads 500 people at a time.
- **Data:** `users.role`, `users.status`.
- **Files:** `app/controllers/accounts/users_controller.rb`, `app/views/accounts/users/*`, `app/models/user.rb`
  (`deactivate`).

### 62. Ban a person
- **Sees:** a "Ban Name" button on the person's page, with "This will log them out, delete their messages, and
  block their IP addresses." Later a red "Remove ban" button.
- **Behaves:** the ban signs them out on every device, blocks every address they used, and deletes all their
  messages in the background. The messages disappear from every screen.
- **Details:** a blocked address can still read pages but gets "too many requests" on any change. Private and
  local addresses are never blocked. Remove ban lifts the address blocks and makes the person active again.
  Banned people get no pushes. Administrators still see them in lists, so they can lift the ban.
- **Data:** `bans` (`user_id`, `ip_address`), `users.status = banned`.
- **Files:** `app/models/user/bannable.rb`, `app/models/ban.rb`, `app/controllers/users/bans_controller.rb`,
  `app/controllers/concerns/block_banned_requests.rb`, `app/jobs/remove_banned_content_job.rb`,
  `app/views/users/_ban_button.html.erb`.

### 63. Only administrators may create rooms (setting)
- **Sees:** a switch on account settings: "Must be admin to create new rooms".
- **Behaves:** when on, the "+" room button hides for members and the server refuses them. Pings stay open to all.
- **Details:** off by default. Without the setting, anyone can create a room, and the creator manages it.
- **Data:** `accounts.settings` (`restrict_room_creation_to_administrators`).
- **Files:** `app/models/account.rb`, `app/views/accounts/edit.html.erb`, `rooms_controller.rb`
  (`ensure_permission_to_create_rooms`).

### 64. Custom CSS
- **Sees:** a paint-palette button (administrators only) opens a code box: "Add custom CSS styles. Use Caution:
  you could break things."
- **Behaves:** the CSS goes into every page for every person. Cmd+Enter or Ctrl+Enter saves.
- **Details:** this is the whole theming system: brand colors, fonts and layout tweaks.
- **Data:** `accounts.custom_styles`.
- **Files:** `app/controllers/accounts/custom_styles_controller.rb`, `app/views/accounts/custom_styles/edit.html.erb`,
  `app/helpers/application_helper.rb` (`custom_styles_tag`).

---

## Bots

### 65. Set up a bot
- **Sees:** a robot button on account settings (administrators only) opens "Chat bots". Each bot shows its name,
  a pencil, and for each room it is in, two ready commands with copy buttons: one to post text and one to post a file.
- **Behaves:** add a bot with a name, an avatar and an optional webhook address. The edit page can delete the bot
  or make a new key, each with a confirm.
- **Details:** a bot is a person with the "bot" role and a key like "12-Ab3dE9fGhK2L". It joins open rooms like
  anyone. You add it to a closed room like a person. You start a Ping with it from its page. The key is hidden in
  server logs.
- **Data:** `users` (`role = bot`, `bot_token`), `webhooks` (`url`).
- **Files:** `app/models/user/bot.rb`, `app/controllers/accounts/bots_controller.rb`,
  `app/controllers/accounts/bots/keys_controller.rb`, `app/views/accounts/bots/*`,
  `lib/rails_ext/log_scrubbing_formatter.rb`.

### 66. Bot API
- **Sees:** messages from the bot show like any message, with its name and avatar.
- **Behaves:** `POST /rooms/<room>/<bot key>/messages` with plain text posts a message. A form with
  `attachment=@file` posts a file. The bot can also list messages as JSON, change or delete its own messages, and
  add or remove its own boosts.
- **Details:** a post answers "201 Created" with the new message address. The list has pages: a `Link` header
  points to the next page, and `X-Total-Count` gives the number of messages in the room. A bot can reach only rooms
  it is in. A bot cannot use the normal screens.
- **Data:** `messages`, `boosts`.
- **Files:** `app/controllers/messages/by_bots_controller.rb`, `app/controllers/messages/boosts/by_bots_controller.rb`,
  `app/views/messages/by_bots/*`, `app/views/messages/_message.json.jbuilder`.

### 67. Bot webhooks (answer when called)
- **Sees:** mention the bot, and its answer appears in the room a moment later.
- **Behaves:** Campfire calls the bot's webhook when someone mentions it in a room, or for any message in a Ping
  with it. The call carries the person, the room, the message as HTML and as plain text, and the address to post
  back. A text answer becomes a bot message. Any other answer type becomes a file message.
- **Details:** the plain text drops the bot's own mention. A bot that takes more than 7 seconds causes a message
  "Failed to respond within 7 seconds". The call runs in the background.
- **Data:** none extra.
- **Files:** `app/models/webhook.rb`, `app/jobs/bot/webhook_job.rb`, `messages_controller.rb`
  (`deliver_webhooks_to_bots`).

---

## App shell

### 68. Install as an app
- **Sees:** a fold-out "Install Campfire as a web app." with steps for your browser and system. Where the browser
  allows it, an "Install now" button.
- **Behaves:** Campfire catches the browser's own install offer and shows it as the button.
- **Details:** the app name and icon come from the account. The app has two shortcuts: "New chat room" and
  "My profile". The install help hides once the app is installed.
- **Data:** none.
- **Files:** `app/views/pwa/manifest.json.erb`, `app/javascript/controllers/pwa_install_controller.js`,
  `app/views/pwa/_install_instructions.html.erb`, `app/controllers/pwa_controller.rb`.

### 69. Phone layout
- **Sees:** on a phone the room fills the screen. A menu button slides the sidebar in from the side over a
  blurred glass background. Message bubbles use the full width.
- **Behaves:** below 100 characters of width the layout switches to this mode.
- **Details:** when the composer has focus, the search button and the hint icon hide to give the text more room.
  The page resizes with the keyboard. Zoom is off. The message "…" sits under the name, not beside the bubble.
- **Data:** none.
- **Files:** `app/assets/stylesheets/layout.css`, `sidebar.css`, `composer.css`, `messages.css`,
  `app/views/layouts/application.html.erb` (viewport).

### 70. Dark mode
- **Sees:** the whole app turns dark when the device uses dark mode.
- **Behaves:** colors flip by the system setting. There is no in-app switch.
- **Details:** icons invert, code colors change, the browser bar color matches.
- **Data:** none.
- **Files:** `app/assets/stylesheets/colors.css`, `code.css`, `app/views/layouts/application.html.erb`.

### 71. Help in seven languages next to key fields
- **Sees:** a small globe button next to fields such as email, password, name, room name and bio.
- **Behaves:** the globe opens a card with the same sentence in 7 languages, each with a flag.
- **Details:** the screens stay in English. This card is the only translation.
- **Data:** none.
- **Files:** `app/helpers/translations_helper.rb`.

### 72. First run and the welcome card
- **Sees:** on a new install, a "Set up Campfire" name-tag form. Then the first room "All Talk" with a welcome card
  that shows the join link.
- **Behaves:** the form makes the first administrator, the account "Campfire" and the open room "All Talk".
- **Details:** the welcome card stays until the first room holds more than one page of messages.
  A person with no rooms sees an empty "No rooms yet" screen.
- **Data:** `accounts`, `users`, `rooms`, `memberships`.
- **Files:** `app/models/first_run.rb`, `app/controllers/first_runs_controller.rb`, `app/views/first_runs/show.html.erb`,
  `app/views/rooms/show/_invitation.html.erb`, `app/views/welcome/show.html.erb`.

### 73. Back to your last room
- **Sees:** the home address, every back arrow and the search exit take you to the room you used last.
- **Behaves:** a cookie remembers your last room. Without it, Campfire uses the first room.
- **Details:** settings pages all use this for their back arrow.
- **Data:** cookie `last_room`.
- **Files:** `app/controllers/concerns/tracked_room_visit.rb`, `app/helpers/rooms_helper.rb`.

### 74. Confirmations without words
- **Sees:** after a save, a green circle with a check fades in and out at the top. An error shows a red circle.
- **Behaves:** the circle shows for 3 seconds, then removes itself.
- **Details:** screen readers hear the full text.
- **Data:** none.
- **Files:** `app/views/layouts/application.html.erb` (flash), `flash.css`, `element_removal_controller.js`.

### 75. Smooth moves, access and old browsers
- **Sees:** buttons and avatars glide into their new place when you open a page (for example the search button
  turns into the search field). Links load fast because pages load on hover.
- **Behaves:** the browser's page-transition feature and link prefetch do this.
- **Details:** a "Skip to main content" link, screen-reader labels on every icon button, and a list that reads out
  mention choices. Old browsers get "Upgrade to a supported web browser" with the minimum versions (Safari 17.2,
  Chrome 120, Firefox 121, Opera 104). Links shared through Apple Messages still preview.
- **Data:** none.
- **Files:** `app/views/layouts/application.html.erb`, `app/controllers/concerns/allow_browser.rb`,
  `app/views/sessions/incompatible_browser.html.erb`.

---

## Design principles seen in the code

1. **One flat timeline for each room.** The word "threaded" in the code means visual grouping only. A reply is a
   quote inside a new message.
2. **Attention is earned.** Shared rooms push only on mentions by default. Nothing is pushed or made bold for the
   room you are in. Presence never shows, it only keeps noise away.
3. **One control for one decision.** Notifications are one bell for each room, with one tap to the next level.
   No global settings page for them.
4. **Show it at once, fix it later.** Your message, your files and their progress show before the server answers.
   A failure is marked on the message itself.
5. **Live, with a way back.** Every change goes out live. After a drop, the page asks for what it missed, and the
   composer locks while offline.
6. **Same HTML for everyone, personal touches in the browser.** "Mine", "mentions me", grouping and day lines are
   added in the browser, so the server caches one copy.
7. **Hidden until needed.** The message menu shows on hover. The text toolbar hides. The people filter shows only
   past 20 people.
8. **Trust the team.** No edit window, open invite link for every member, anyone can create rooms by default,
   the creator manages a room.
9. **Few words, many icons.** Buttons are icons with screen-reader labels. Confirmations are a check in a circle.
10. **A little play.** /play sounds, free-text boosts, wiggles and pops.
11. **One office, one install.** One account, a join link, no email, recovery through an administrator's link.
12. **Phone first.** An installable app with a badge, a share sheet, a slide-in sidebar and keyboard tricks.

---

## Left out on purpose (with evidence)

| Left out | Evidence in the code |
| --- | --- |
| Threads | `messages` has no parent column (`db/schema.rb`). Reply copies a quote into the composer (`reply_controller.js`). |
| Emoji picker and counted reactions | Quick boosts are 8 fixed emoji (`emoji_helper.rb`). Boosts are free text up to 16 characters, one pill each, never counted (`boosts.content limit: 16`). |
| Formatting toolbar by default | Hidden, and absent on touch screens (`composer.css`). One heading level. No files inside the editor (`initializers/rich_text.js`). |
| "Edited" label and edit time limit | No such text or rule anywhere. `can_administer?` allows the author at any time. |
| "Message deleted" placeholder | `broadcast_remove` takes the message away (`message/broadcasts.rb`). |
| First-unread line | Rooms open at `last_page` and scroll to the bottom. No marker in views or styles. |
| Unread counts for each room | The sidebar uses bold and a dot only. The badge counts rooms, not messages. |
| Read receipts ("seen by") | Read state is one time for each membership (`memberships.unread_at`), never for each message. |
| Online list or status | Presence fields exist, but no view shows them. |
| Email of any kind | No `app/mailers` folder. Recovery uses the sign-in link (`user/transferable.rb`). |
| @everyone or @here | Mentions are only people in the room (`message/mentionee.rb`). |
| Room topics and descriptions | `rooms` has only `name` and `type`. |
| Leaving a room | No such action. You hide a room with the "invisible" level. |
| Search filters | One text box. No person, room or date filters (`searches_controller.rb`). |
| Pins, saved messages, file gallery | No tables or routes for them. |
| GIF picker, stickers, calls | None. The /play pictures are the fun media. |
| Screen translations | English screens. Globe cards only (`translations_helper.rb`). |
| More than one organization | One account (`Current.account` is `Account.first`). The docs say to run one install for each group. |
| Two-step sign-in, single sign-on | Email and password only (`sessions_controller.rb`). |
| Scheduled messages, reminders | None. |
