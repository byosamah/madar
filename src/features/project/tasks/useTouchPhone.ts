import { useIsPhone } from '../../../app/useIsPhone';
import { usePointerCoarse } from '../../../app/usePointerCoarse';

/**
 * True on a phone with a touch screen (phone width and a finger as the main pointer). The rows and the cards use it to hide the drag grip
 * and to take the press and hold (400 ms). A narrow desk window with a mouse is not a touch phone, and a wide touch screen is not either.
 * Both queries come from shared listeners, so this hook is cheap in a first-load file.
 */
export function useTouchPhone(): boolean {
  const phone = useIsPhone();
  const coarse = usePointerCoarse();
  return phone && coarse;
}
