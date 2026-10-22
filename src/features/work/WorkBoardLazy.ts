import { lazyOverlay } from '../../app/lazyOverlay';
import type { WorkBoardProps } from './WorkBoard';

/**
 * The Board of the Tasks screen is a chunk of its own (fbk_042, FL-2): the List view, which most sessions use, never loads the board
 * code or the drag code behind it. `warm()` starts the import at idle and when the View button is pressed, so a Board that mounts
 * later renders with no Suspense step (`lazyOverlay`). Never import `WorkBoard.tsx` statically.
 */
export const lazyWorkBoard = lazyOverlay<WorkBoardProps>(() => import('./WorkBoard').then((module) => module.WorkBoard));
