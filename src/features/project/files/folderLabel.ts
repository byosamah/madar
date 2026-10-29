import type { TFunction } from 'i18next';
import type { ProjectFolder } from '../../../api/contract/entities';

/**
 * The name of a folder as a screen shows it (fbk_074). A standard folder (Client documents, Contract) shows the word of the viewer's language
 * while it keeps its preset. A rename ends the preset, and the folder then shows its own name.
 */
export const folderLabel = (folder: Pick<ProjectFolder, 'name' | 'preset'>, t: TFunction): string => (folder.preset ? t(`folders.preset.${folder.preset}`) : folder.name);
