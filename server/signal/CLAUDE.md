# Change signals

The Realtime signals of the server: `realtime.ts` (the change signals), `typing.ts` (the typing signal). The office object has its own
socket path (`server/office/CLAUDE.md`). The record of the rules is `Diff` in `server/data/save.ts`.

## Rules
- Change signals go out inside the save transaction (`realtime.send`, topics `office` and `person:<id>`). A rollback sends nothing. A failed
  send only warns, and the sender counts it. The next signal shows a gap in `seq`, and the screens reload.
- The office signal tells kinds, never names of private records. A record that only some people may see sends only person signals, each with its
  own id. The Realtime rules need no change: the server sends on any `person:` topic, and each person reads only their own.
- An office task, its comments and its files (`Diff.privateChange`) go as a person signal to each person of the task (maker, lead, helpers,
  before and after) and each active holder of `task.officeAll`. The office signal tells only the project part (`Diff.publicKinds`). A save of
  office tasks alone sends no office signal.
- A meeting with no project, its notices and its events (`officeMeetings` in `data/save.ts`) are private in the same way: person signals with
  no names, to the organizer (the person behind an agent) and the attendees, before and after. A save that touches office tasks and a private
  meeting sends the union of the two groups. Test: `core/meetingsSignal.test.ts`.
- A direct chat or a group tells only its members. `diffState` puts the records of such a chat in `Diff.chatKinds` and `Diff.chatPeople` (every
  member before and after, an agent member mapped to its person, and the owner of each mark and notice). These kinds are never in
  `publicKinds`, so no office signal tells them and the save makes no `office_meta` update for them. All the people of a save go in one
  `person_seq` statement and one `realtime.send`. A project chat keeps the office signal with the actor and the story. A message or file whose
  chat neither State holds falls back to the nameless office signal (`Diff.anonymous`). Tests: `core/chatSignalMembers.test.ts`,
  `core/chatSignalLeaks.test.ts`, `data/save.test.ts`.
- A project that at least one active person may not view tells only the people who view it. `data/projectAudience.ts` (`audienceFinder`) asks
  the one view rule (`mayViewProject`) for each active human, in `before` and in `after`. `diffState` puts every record that names such a
  project in `Diff.hidden`, never in `publicKinds`, `restKinds` or `projects`. `writeDiff` sends each person of the audience (before and
  after, so a person who loses the view and one who gains it both hear) one person signal with the kinds and project ids that the person
  views. The office signal never names the project. A comment whose target the call did not load is looked up by `writeDiff`
  (`COMMENT_TARGETS_SQL`). With the default settings no project is restricted. Tests: `data/hiddenProjectSignals.test.ts`,
  `data/hiddenProjectSignalsRun.test.ts`.
- The three live paths (Postgres, the memory path of the tests, the SQLite socket path of the office object) share `diffState` and
  `writeDiff`. `test/invariants.ts` knows the part.

## Typing and status
- `chats.typing` (`calls/typing.ts`) is a server-only read with no lock. It checks the chat with `typingRecipients` and sends through
  `Deps.typing`: `typing.ts` (`realtime.send`, event `typing` on `person:<id>` of each other member; it never throws) on Supabase and Workers,
  and `officeTyping` on the office object. The change listener of the screens takes only the event `changed`.
- Status needs no server code on Supabase: each person tracks the Presence topic `status:<id>` (`20261022000200_platform_presence.sql`).
  The office path has its own (`server/office/presence.ts`).
