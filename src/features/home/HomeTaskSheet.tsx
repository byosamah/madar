import { lazyOverlay } from '../../app/lazyOverlay';

/**
 * The task panel of Home (performance audit 2026-10-21, FL-1). Most Home visits never open it, and its chain (the chat log,
 * the comments, the date picker, the files) was 38 KB gz of the first load. It loads in its own chunk instead: Home starts the
 * import 1 s after it mounts (`warmTaskSheet`), and main.tsx starts it at once for an address with ?task= (a push link).
 */
const sheet = lazyOverlay(() => import('../project/tasks/TaskSheet').then((m) => m.ProjectTaskSheet));

export const HomeTaskSheet = sheet.Overlay;
export const warmTaskSheet = sheet.warm;
export const taskSheetLoaded = sheet.isLoaded;
