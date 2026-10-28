import { MESSAGE_MAX } from '../../api/contract/entities';
import { MAX_ATTACHMENTS } from '../../api/contract/limits';
import type { PickedProjectFile } from './ProjectFilePicker';

/**
 * The messages that carry the project files of one pick (fbk_070, owner 2026-10-27): 10 files in each message (MAX_ATTACHMENTS), in the order
 * of the picks. The words of a message are the file names, as for a file sent with no words (the bubble leaves them out when they equal the
 * joined names, `isFileNamesBody`). The chat box, the Inbox thread of a to-do and the comments of a to-do all use this one rule.
 */
export function insertParts(picked: readonly PickedProjectFile[]): { body: string; fileIds: string[] }[] {
  const parts: { body: string; fileIds: string[] }[] = [];
  for (let at = 0; at < picked.length; at += MAX_ATTACHMENTS) {
    const part = picked.slice(at, at + MAX_ATTACHMENTS);
    parts.push({ body: part.map((file) => file.name).join(', ').slice(0, MESSAGE_MAX), fileIds: part.map((file) => file.id) });
  }
  return parts;
}
