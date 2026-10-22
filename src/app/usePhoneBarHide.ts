import { useLocation } from 'react-router';
import { useFocusLink } from '../features/focus/focusLink';
import { isPhoneChatPath } from './phoneChat';
import { useIsPhone } from './useIsPhone';
import { useKeyboardOpen } from './useKeyboardOpen';

/**
 * Why the phone tab bar hides, or null when it shows:
 * - 'route': an open chat or Focus mode. The bar leaves the page.
 * - 'keyboard': the on-screen keyboard is open. The bar stays mounted, clear and inert.
 * A desk always gets null. A phone turned sideways passes 640 px, so the value turns null and the bar comes back.
 */
export function usePhoneBarHide(): 'route' | 'keyboard' | null {
  const phone = useIsPhone();
  const { pathname } = useLocation();
  const { taskId } = useFocusLink();
  const keyboard = useKeyboardOpen();
  if (!phone) return null;
  if (isPhoneChatPath(pathname) || taskId !== null) return 'route';
  return keyboard ? 'keyboard' : null;
}
