# Focus mode

Focus mode is `?focus=<taskId>` with a 25-minute timer (`FocusMode.tsx`, `FocusTimer.tsx`).

## Rules
- The dialog is `z-[35]`: above the tab pill and the corner buttons (`z-30`), below the dim layer of a sheet (`z-40`), the sheets, the
  picture viewer and the menus (`z-50`) and the toasts (`z-80`), so a layer that the chat opens shows above Focus. Pin every new layer
  number against these. Never wrap `FocusPage` in a new parent: the timer would start again.
- The Focus chat is one quiet grey button at the end of the top row (`project.chat`, or `chat.taskThread` for an office to-do), with no dot
  and no count. It shows only when `projects.get` gives a `chatId`. From 1024 px (`useIsWide`, `focusChat.ts`) a press opens a docked sidebar
  `aside[data-focus-chat]` on the end edge, and the dialog gets `lg:pe-[24rem]`. Under 1024 px it opens a full page over Focus
  (`PhoneChatPage` with `layer="z-[36]"` and `inertWhileSheet={false}`, because Focus sets `data-panel-open`) with "Back to focus". The
  Focus column is `inert` under the page.
- The device keeps the choices: `madar.focus.chat` (`open` or `closed`, first `closed`; `open` counts only from 1024 px) and
  `madar.focus.chatKind` (`chat` or `task`). A project to-do has two chats, picked by a two-part switch (`EmbeddedChat.below`). An office
  to-do and a person who may not open the project chat get the thread only.
- The chat code is the lazy chunk `FocusChatPane.tsx` (`lazyOverlay`, warmed at pointer or focus on the button). Never import it statically
  (`app/firstLoadImports.test.ts`). It is the Inbox pane in its embedded form (`embedded` prop of `ChatPane` and `TaskPane`): a slim head, no
  menu, no Search, no options sheet, no typing line, no "Show newer messages", no composer autofocus, the compact `Composer`, and a reply
  strip to a message older than the loaded pages does nothing. A closed panel mounts nothing: no `chats.messages`, no read mark. An open
  panel reads and marks read like the Inbox (visible tab only).
- Escape that starts inside `[data-focus-chat]`, or that a layer above Focus used (`defaultPrevented`), does not end Focus. With the full page
  open, Escape on the page behind it brings Focus back first. The draft of the box lives in `madar.draft.*`, so it survives a close.
- Test: `FocusChat.test.tsx` (the helper `phoneMedia` answers `(min-width: 1024px)` with `wide`).
