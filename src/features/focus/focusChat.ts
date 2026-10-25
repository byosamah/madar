import { useEffect, useState, useSyncExternalStore } from 'react';
import type { TaskDetail } from '../../api/contract/views';
import { usePersistentChoice } from '../../app/choices';
import { useCall } from '../../app/runtime';

/** The key of the device choice. The value is "open" or "closed". A new device starts closed (owner, 2026-10-25, fbk_059). */
export const FOCUS_CHAT_KEY = 'madar.focus.chat';

/** From this width the chat is a panel beside the Focus column. Under it, the chat is a full page over Focus. Tailwind `lg`. */
const WIDE = '(min-width: 1024px)';

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(WIDE);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/** True from 1024 px. A window that is narrower shows the chat as a page. */
export function useIsWide(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(WIDE).matches, () => false);
}

/** The key of the device choice between the project chat (`chat`) and the to-do thread (`task`) (owner, 2026-10-25). */
export const FOCUS_CHAT_KIND_KEY = 'madar.focus.chatKind';

/** A chat of a to-do: the project chat (`chat`) of its project, or its own thread (`task`). */
export type FocusChatTarget = { kind: 'chat' | 'task'; id: string };

/** What the Focus page needs to draw the button and the chat. `target` is null when the person has no chat to open here. */
export type FocusChat = {
  /** The chat that shows: the pick of the device when it is one of `choices`, else the first choice. */
  target: FocusChatTarget | null;
  /** The chats of this to-do: the project chat (when the person may open it), then the to-do thread. An office to-do has the thread only. */
  choices: FocusChatTarget[];
  /** Picks the shown chat, and the device keeps the pick. */
  pick: (kind: FocusChatTarget['kind']) => void;
  /** The panel shows (a wide window, and the person chose open). */
  panel: boolean;
  /** The full page shows (a narrow window, and the person pressed the button). */
  page: boolean;
  /** The button: it toggles the panel on a wide window and opens the page on a narrow one. */
  press: () => void;
  /** Close, in the panel; Back to focus, on the page. */
  close: () => void;
};

/**
 * The state of the chat in Focus mode (fbk_059). The project chat id comes from `projects.get` (`chatId` is null for a person who may
 * not open it). Every to-do also has its own thread, so a project to-do has two chats and the sidebar switches between them; an office
 * to-do and a person without the project chat have the thread only (owner, 2026-10-25). The panel choice and the chat pick sit on the
 * device; a remembered "open" counts only from 1024 px, and a press under 1024 px opens the page and leaves the choice as it was.
 */
export function useFocusChat(data: TaskDetail | undefined, taskId: string | null): FocusChat {
  const projectId = data?.project?.id;
  const project = useCall('projects.get', { id: projectId ?? '' }, { enabled: projectId !== undefined });
  const wide = useIsWide();
  const [choice, choose] = usePersistentChoice(FOCUS_CHAT_KEY, ['open', 'closed'] as const, 'closed');
  const [kind, pick] = usePersistentChoice(FOCUS_CHAT_KIND_KEY, ['chat', 'task'] as const, 'chat');
  const [pageOpen, setPageOpen] = useState(false);
  // A new to-do, or a window that grows to the panel, starts with no page.
  useEffect(() => {
    setPageOpen(false);
  }, [taskId, wide]);
  const choices: FocusChatTarget[] = [];
  if (data) {
    // The project chat waits for `projects.get`, so the thread does not show first and then jump to the chat.
    if (data.project !== null && project.data?.chatId) choices.push({ kind: 'chat', id: project.data.chatId });
    if (data.project === null || project.data) choices.push({ kind: 'task', id: data.task.id });
  }
  const target = choices.find((option) => option.kind === kind) ?? choices[0] ?? null;
  const panel = target !== null && wide && choice === 'open';
  const page = target !== null && !wide && pageOpen;
  return {
    target,
    choices,
    pick,
    panel,
    page,
    press: () => (wide ? choose(panel ? 'closed' : 'open') : setPageOpen(true)),
    close: () => (wide ? choose('closed') : setPageOpen(false)),
  };
}
