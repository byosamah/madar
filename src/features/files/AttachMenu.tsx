import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { lazyOverlay } from '../../app/lazyOverlay';
import { useRight } from '../../app/useRight';
import { IconButton } from '../../components/IconButton';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { AttachFileIcon } from '../../components/icons/animated/attach-file';
import { Menu, type MenuItem } from '../../components/Menu';
import { AttachButton } from './Attachments';
import type { InsertScope, PickedProjectFile } from './ProjectFilePicker';

/** The picker loads in its own chunk at the first press, so the first load of the chat stays small. */
const picker = lazyOverlay(() => import('./ProjectFilePicker').then((m) => m.ProjectFilePicker));

type Props = {
  /** The files that the person chose on the computer. They join the picked files of the box. */
  onPick: (list: FileList | null) => void;
  /** False when the person may not upload here (no file.upload): the clip then offers only the insert. Default true. */
  canUpload?: boolean;
  /** Where the picker looks. Missing: the box takes no project files, and the clip is the plain attach button. */
  insert?: InsertScope;
  /** The project files that the person picked, in the order of the picks. The box sends them. */
  onInsert: (files: PickedProjectFile[]) => void;
  /** The round clip of the chat box. Without it, a pill with a word (the comments of a task). */
  compact?: boolean;
};

/**
 * The attach control of a chat box and of the comments of a task (fbk_070, owner 2026-10-27). The clip opens a short menu with two choices:
 * "Upload a file" (as before) and "Insert from a project" (a picker of the files that live in the projects). The menu is a bottom sheet on
 * a phone. The second choice shows only for a person with the switch "Share files" (file.share, the switch of Share in the Files tab),
 * and only where the box takes project files (`insert`). Without it the clip is the plain attach button.
 * The file input stays here, out of the tab order, as in the Files tab: the menu item opens it.
 */
export function AttachMenu({ onPick, canUpload = true, insert, onInsert, compact = false }: Props) {
  const { t } = useTranslation();
  const mayInsert = useRight('file.share') && insert !== undefined;
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  if (!mayInsert) return canUpload ? <AttachButton compact={compact} onPick={onPick} /> : null;
  const icon = <AnimatedIcon icon={AttachFileIcon} size={18} aria-hidden />;
  const items: MenuItem[] = [
    { label: t('files.uploadOne'), onSelect: () => input.current?.click(), hidden: !canUpload },
    { label: t('attachments.insertFromProject'), onSelect: () => setOpen(true), onPrepare: () => picker.warm() },
  ];
  return (
    <>
      {canUpload && (
        <input
          ref={input}
          type="file"
          multiple
          tabIndex={-1}
          aria-hidden
          aria-label={t('attachments.attach')}
          className="sr-only"
          onChange={(event) => {
            onPick(event.target.files);
            event.target.value = '';
          }}
        />
      )}
      {canUpload ? (
        <Menu
          label={t('attachments.attachMenu')}
          icon={icon}
          // The list grows from the start edge of the clip, so it stays over the chat and never over the list of chats.
          align="start"
          {...(compact ? {} : { text: t('attachments.attachMenu') })}
          triggerClassName={compact ? 'text-label-2 hover:bg-fill' : 'text-link hover:bg-fill'}
          items={items}
          sheetOnPhone
        />
      ) : (
        <IconButton label={t('attachments.insertFromProject')} onClick={() => setOpen(true)} onPointerDown={() => picker.warm()}>{icon}</IconButton>
      )}
      {open && <picker.Overlay scope={insert!} onClose={() => setOpen(false)} onSend={(files) => { setOpen(false); onInsert(files); }} />}
    </>
  );
}
