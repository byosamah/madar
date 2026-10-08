import { browserLanguage } from './firstLanguage';
import { loadWords } from './index';

/**
 * The remote build starts the words of the first language when the first script starts to run, before the screens of the
 * entry run (performance audit BND-7). So they load next to the bootstrap and the first screen, and the first frame waits for
 * no extra round trip. main.tsx imports this file second, after zodConfig. main.tsx waits for the same load before the first
 * render, so an error here is ignored. The prototype holds its words in its one script file.
 */
if (import.meta.env.VITE_MADAR_API === 'remote') void loadWords(browserLanguage()).catch(() => undefined);
