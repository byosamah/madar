import { useEffect, useRef, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router';
import { useIsPhone } from '../../app/useIsPhone';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { ChevronLeftIcon } from '../../components/icons/animated/chevron-left';

/**
 * The state that a screen passes when it opens a chat (Direction D, lead amendment 6). `from` is the path and the search of that
 * screen. The Back link of the chat then goes one step back, so the screen keeps its scroll place. A link with no state (a push line,
 * a mail link, a bookmark) makes Back go to /inbox.
 */
export type ChatOpener = { from: string };
export const chatState = (from: string): ChatOpener => ({ from });

/** The step of the history that the browser holds now. A page that was opened by a link has 0. It is unknown where the history hides it. */
function historyIndex(): number {
  try {
    const idx = (window.history.state as { idx?: unknown } | null)?.idx;
    return typeof idx === 'number' ? idx : 0;
  } catch {
    return 0;
  }
}

const hasOpener = (state: unknown): boolean => typeof (state as { from?: unknown } | null)?.from === 'string';

/**
 * The Back step of a chat. `canGoBack` is true when the opener passed `state.from` and the history holds an earlier step in this app.
 * `goBack` reads both at the moment of the press. It goes one step back, or to /inbox as a new step. A second press while the first
 * step runs does nothing.
 */
export function useChatBack(): { canGoBack: boolean; goBack: () => void } {
  const navigate = useNavigate();
  const location = useLocation();
  const busy = useRef(false);
  const state = useRef(location.state);
  state.current = location.state;
  // A new location ends the step.
  useEffect(() => {
    busy.current = false;
  }, [location.key]);
  const canGoBackNow = () => hasOpener(state.current) && historyIndex() > 0;
  const goBack = () => {
    if (busy.current) return;
    busy.current = true;
    if (canGoBackNow()) void navigate(-1);
    else void navigate('/inbox');
  };
  return { canGoBack: hasOpener(location.state) && historyIndex() > 0, goBack };
}

/** The Back link of a chat page: 44 px, a link to the Inbox for a click with a modifier, and the Back rule for a plain click. */
export function ChatBackLink({ className = '' }: { className?: string }) {
  const { t } = useTranslation();
  const { goBack } = useChatBack();
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    // The browser keeps a Ctrl, Cmd, Shift or Alt click and a click of another button.
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    goBack();
  };
  return (
    <Link
      to="/inbox"
      aria-label={t('chat.back')}
      onClick={onClick}
      className={`pressable grid size-11 shrink-0 place-items-center rounded-full text-ink-2 hover:text-ink ${className}`}
    >
      <AnimatedIcon icon={ChevronLeftIcon} size={22} className="rtl:-scale-x-100" aria-hidden />
    </Link>
  );
}

/**
 * Closes the open chat (Direction D). On a phone it takes the Back step, so the screen that opened the chat shows again with its scroll
 * place. On a desk it goes to /inbox, where the pane shows the empty text. Archive, Mark as unread and Leave group use it.
 */
export function useLeaveChat(): () => void {
  const phone = useIsPhone();
  const navigate = useNavigate();
  const { goBack } = useChatBack();
  return () => {
    if (phone) goBack();
    else void navigate('/inbox');
  };
}
