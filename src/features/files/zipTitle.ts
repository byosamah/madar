import { createContext } from 'react';

/**
 * The title that a "Download all" button puts in the name of its ZIP file (fbk_050): the title of the chat, or of the to-do. The pane
 * around the files gives it. Null where no pane gives one (the button then uses the word "Files").
 */
export const ZipTitleContext = createContext<string | null>(null);
